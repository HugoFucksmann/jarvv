/**
 * eval/core/client/mock.ts
 *
 * `--client=mock`. Sección 11. No hace llamadas de red. `prepare` delega en los clientes reales,
 * así `--dry-run` imprime los mismos bodies con cualquiera de los dos clientes.
 */

import type { ToolInputSchema } from "../contract.ts";
import { estimateTokens } from "../contract.ts";
import type { DecisionRequest, GenerativeRequest } from "../types.ts";
import { createDecisionClient } from "./decision.ts";
import type { DecisionCallContext, DecisionClient, DecisionClientConfig } from "./decision.ts";
import { createGenerativeClient } from "./generative.ts";
import type {
  GenerativeCallContext,
  GenerativeClient,
  GenerativeClientConfig,
  PreparedRequest,
} from "./generative.ts";

/** Probabilidad que devuelve el mock para la opción elegida y para `noul`. */
const MOCK_PROB = 0.96;

export interface MockGenerativeResponse {
  rawOutput: string;
  finishReason?: string;
}

/** Recibe lo que se habría enviado; devuelve el contenido del modelo. */
export type MockGenerativeResponder = (
  prepared: PreparedRequest,
  req: GenerativeRequest,
  ctx?: GenerativeCallContext,
) => MockGenerativeResponse | string;

/** Recibe lo que se habría enviado; devuelve el cuerpo de respuesta (texto JSON). */
export type MockDecisionResponder = (prepared: PreparedRequest, req: DecisionRequest, ctx?: DecisionCallContext) => string;

// ───────────────────────── Generativo ─────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sentSchema(prepared: PreparedRequest): Record<string, unknown> | undefined {
  const rf = prepared.body.response_format;
  if (!isRecord(rf) || rf.type !== "json_schema") return undefined;
  const js = rf.json_schema;
  return isRecord(js) && isRecord(js.schema) ? js.schema : undefined;
}

function hasResponseFormat(prepared: PreparedRequest, type: "json_object"): boolean {
  const rf = prepared.body.response_format;
  return isRecord(rf) && rf.type === type;
}

/** Primera ruta del enum de `suggested_mcp` del schema enviado (o "files"). */
export function mockPlanRoute(prepared: PreparedRequest): string {
  const schema = sentSchema(prepared);
  const props = schema?.properties;
  const steps = isRecord(props) ? props.steps : undefined;
  const items = isRecord(steps) ? steps.items : undefined;
  const itemProps = isRecord(items) ? items.properties : undefined;
  const mcp = isRecord(itemProps) ? itemProps.suggested_mcp : undefined;
  const enumValues = isRecord(mcp) && Array.isArray(mcp.enum) ? mcp.enum : [];
  return typeof enumValues[0] === "string" ? enumValues[0] : "files";
}

function mockPlan(prepared: PreparedRequest): string {
  const route = mockPlanRoute(prepared);
  return JSON.stringify({
    steps: [{ goal: "Mock goal", suggested_mcp: route, expected_outcome: "Mock outcome" }],
  });
}

function mockValueFor(propSchema: unknown): unknown {
  const t = isRecord(propSchema) ? propSchema.type : undefined;
  const type = Array.isArray(t) ? t.find((x) => x !== "null") : t;
  switch (type) {
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "mock";
  }
}

export function mockArgsFor(toolSchema: ToolInputSchema | undefined): string {
  const out: Record<string, unknown> = {};
  const props = toolSchema?.properties;
  for (const key of toolSchema?.required ?? []) {
    out[key] = mockValueFor(isRecord(props) ? props[key] : undefined);
  }
  return JSON.stringify(out);
}

function defaultGenerativeResponder(
  prepared: PreparedRequest,
  _req: GenerativeRequest,
  ctx?: GenerativeCallContext,
): MockGenerativeResponse {
  const schema = sentSchema(prepared);
  if (schema) {
    return { rawOutput: isRecord(schema.properties) && schema.properties.steps ? mockPlan(prepared) : "{}" };
  }
  if (hasResponseFormat(prepared, "json_object")) return { rawOutput: mockArgsFor(ctx?.toolSchema) };
  return { rawOutput: "Mock response." };
}

export function createMockGenerativeClient(
  cfg: GenerativeClientConfig,
  responder?: MockGenerativeResponder,
): GenerativeClient {
  const real = createGenerativeClient(cfg);

  return {
    prepare: (req) => real.prepare(req),
    async call(req, _timeoutMs, ctx) {
      const prepared = real.prepare(req);
      const out = responder ? responder(prepared, req, ctx) : defaultGenerativeResponder(prepared, req, ctx);
      const res: MockGenerativeResponse = typeof out === "string" ? { rawOutput: out } : out;
      const prompt = estimateTokens(req.system + req.user);
      const completion = estimateTokens(res.rawOutput);
      return {
        ok: true,
        rawOutput: res.rawOutput,
        finishReason: res.finishReason ?? "stop",
        tokens: { prompt, completion, total: prompt + completion },
        tokensEstimated: true,
        durationMs: 0,
      };
    },
  };
}

// ───────────────────────── Decisión ─────────────────────────

/** Elige la primera opción de los `criteria` recibidos (y 0.96 para `noul`). */
function defaultDecisionResponder(_prepared: PreparedRequest, req: DecisionRequest): string {
  const answers: Record<string, unknown> = {};
  for (const [key, q] of Object.entries(req.questions)) {
    if (q.type === "noul") {
      answers[key] = { noul: MOCK_PROB };
    } else {
      const first = Object.keys(q.criteria)[0];
      answers[key] = { choice: first, probabilities: { [first]: MOCK_PROB } };
    }
  }
  return JSON.stringify({ answers });
}

export function createMockDecisionClient(
  cfg: DecisionClientConfig,
  responder?: MockDecisionResponder,
): DecisionClient {
  const real = createDecisionClient(cfg);

  return {
    prepare: (req) => real.prepare(req),
    async call(req, _timeoutMs, ctx) {
      const prepared = real.prepare(req);
      const rawOutput = responder ? responder(prepared, req, ctx) : defaultDecisionResponder(prepared, req);
      const prompt = estimateTokens(JSON.stringify({ state: req.state, questions: req.questions }));
      const completion = estimateTokens(rawOutput);
      return {
        ok: true,
        rawOutput,
        tokens: { prompt, completion, total: prompt + completion },
        tokensEstimated: true,
        durationMs: 0,
      };
    },
  };
}
