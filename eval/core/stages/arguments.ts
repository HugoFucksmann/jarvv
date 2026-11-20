/**
 * eval/core/stages/arguments.ts
 *
 * Etapa generativa `arguments`: generación de argumentos para una herramienta.
 */

import { argsInput, renderArgsView } from "../../../src/core/engine/adapters.ts";
import { analyzePowerShell, precheckCall } from "../../../src/core/engine/precheck.ts";
import type { CommandAnalyzer } from "../../../src/core/engine/precheck.ts";
import { argumentsStageRequest } from "../../../src/core/models/stageRequests.ts";
import { argsProblemText, isRecord, NOT_JSON_ERROR, parseJsonObject, validateArgs } from "../contract.ts";
import type { ToolInputSchema } from "../contract.ts";
import { ArgumentsGrader } from "../graders/arguments.ts";
import { LatencyGrader, NotTruncatedGrader } from "../graders/common.ts";
import type { ArgumentsExpect, ArgumentsOutput, GenerativeRequest } from "../types.ts";
import type { GenerativeStageEntry, OracleHelpers } from "./index.ts";
import { noLabel } from "./shared.ts";

/** El analizador de producción, con caché acotado por comando (cada análisis lanza un PowerShell). */
const MAX_ANALYSIS_CACHE = 512;
const analysisCache = new Map<string, ReturnType<CommandAnalyzer>>();
const cachedAnalyze: CommandAnalyzer = (command) => {
  let r = analysisCache.get(command);
  if (r === undefined) {
    if (analysisCache.size >= MAX_ANALYSIS_CACHE) {
      const oldest = analysisCache.keys().next().value;
      if (oldest !== undefined) analysisCache.delete(oldest);
    }
    r = analyzePowerShell(command);
    analysisCache.set(command, r);
  }
  return r;
};

function valueFor(
  schema: unknown,
  h: OracleHelpers,
  bad: (s: string) => boolean = () => false,
  depth = 0,
): unknown {
  const s = h.rec(schema);
  if ("const" in s) return s.const;
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    return s.enum.find((e) => !(typeof e === "string" && bad(e))) ?? s.enum[0];
  }
  const t = s.type;
  const type = Array.isArray(t) ? t.find((x) => x !== "null") : t;
  if (type === undefined && depth < 4) {
    const branches = [...(Array.isArray(s.anyOf) ? s.anyOf : []), ...(Array.isArray(s.oneOf) ? s.oneOf : [])];
    const branch = branches.find((b) => h.rec(b).type !== "null");
    if (branch !== undefined) return valueFor(branch, h, bad, depth + 1);
  }
  switch (type) {
    case "number":
    case "integer": {
      let n = 0;
      const min = h.num(s.minimum);
      const exMin = h.num(s.exclusiveMinimum);
      const max = h.num(s.maximum);
      if (min !== undefined && n < min) n = min;
      if (exMin !== undefined && n <= exMin) n = exMin + 1;
      if (max !== undefined && n > max) n = max;
      return type === "integer" ? Math.ceil(n) : n;
    }
    case "boolean":
      return true;
    case "array": {
      const minItems = h.num(s.minItems) ?? 0;
      if (minItems <= 0 || depth >= 4) return [];
      return Array.from({ length: minItems }, () => valueFor(s.items, h, bad, depth + 1));
    }
    case "object": {
      const out: Record<string, unknown> = {};
      if (depth >= 4) return out;
      const props = h.rec(s.properties);
      for (const key of h.strs(s.required)) out[key] = valueFor(props[key], h, bad, depth + 1);
      return out;
    }
    default:
      return "mock";
  }
}

export const argumentsStage: GenerativeStageEntry<ArgumentsOutput, ArgumentsExpect> = {
  stageName: "arguments",
  requestType: "generative",
  rejectTruncated: true,
  expectSpec: {
    keys: { requiredFields: "string[]", exactFieldValues: "object", forbiddenHardcodedValues: "string[]" },
    atLeastOne: ["requiredFields", "exactFieldValues", "forbiddenHardcodedValues"],
    validate(expectObj, errs) {
      if (isRecord(expectObj.exactFieldValues) && Object.keys(expectObj.exactFieldValues).length === 0) {
        errs.push("expect.exactFieldValues no puede ser un objeto vacío (no generaría ningún check).");
      }
    },
  },
  graders: [LatencyGrader, NotTruncatedGrader, ArgumentsGrader],
  buildRequest(sc, ov, h) {
    const { ctx } = h.buildContext(sc);
    const at = sc.at ?? {};
    const route = h.need(at.route, "route", "arguments");
    const tool = h.toolOf(route, h.need(at.tool, "tool", "arguments"), at.inputSchema);
    const { kind, sources, environment: env } = h.precheckBase(ctx, route, tool.name, at.environment);
    // Sin `priorAttempts`: un caso `arguments` es siempre el primer intento (`argsInput` aplica 0).
    const request = argumentsStageRequest(argsInput(tool, env, renderArgsView(ctx, tool.name).text), h.config(), h.effectivePrompts(ov).P);
    return {
      request: h.generative(request),
      toolSchema: tool.inputSchema as ToolInputSchema,
      toolName: tool.name,
      environment: env,
      precheck: { kind, sources },
    };
  },
  parseOutput(rawOutput: string, _sentReq: GenerativeRequest, toolSchema?: ToolInputSchema): ArgumentsOutput {
    const obj = parseJsonObject(rawOutput);
    if (!obj) throw new Error(NOT_JSON_ERROR);

    // Eliminar null en parámetros no requeridos
    const required = new Set(toolSchema?.required ?? []);
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null && !required.has(k)) continue;
      args[k] = v;
    }

    // Producción siempre valida contra el schema de la herramienta: sin él el caso no mide lo mismo.
    if (!toolSchema) {
      throw new Error("El caso 'arguments' no trae meta.toolSchema: no se puede validar como lo hace producción.");
    }
    const errs = validateArgs(args, toolSchema);
    if (errs.length > 0) throw new Error(argsProblemText(errs));

    return { args };
  },
  label: noLabel,
  async postCheck({ parsed, fc, collector }) {
    if (fc.meta?.toolName === undefined || fc.meta.environment === undefined || fc.meta.precheck === undefined) return;
    const finding = await precheckCall(
      {
        tool: fc.meta.toolName,
        kind: fc.meta.precheck.kind,
        args: parsed.args,
        sources: fc.meta.precheck.sources,
        environment: fc.meta.environment,
      },
      cachedAnalyze,
    );
    collector.check("precheck_ok", finding === null, `El pre-chequeo de producción rechazaría estos argumentos: ${finding?.reason}`);
  },
  oracleOutput(_prepared, ctx, expect, h) {
    const schema = h.rec(ctx?.toolSchema);
    const props = h.rec(schema.properties);
    const foldPath = (s: string) => s.replace(/\\/g, "/").toLowerCase();
    const forbidden = h.strs(expect.forbiddenHardcodedValues).map(foldPath).filter((w) => w.length > 0);
    const bad = (v: string) => forbidden.some((w) => foldPath(v).includes(w));
    const args: Record<string, unknown> = {};
    for (const key of h.strs(schema.required)) args[key] = valueFor(props[key], h, bad);
    for (const f of h.strs(expect.requiredFields)) {
      if (args[f] === undefined) args[f] = props[f] === undefined ? "value" : valueFor(props[f], h, bad);
    }
    Object.assign(args, h.rec(expect.exactFieldValues));
    return JSON.stringify(args);
  },
};
