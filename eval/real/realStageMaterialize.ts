/**
 * eval/real/realStageMaterialize.ts
 *
 * Materializa un caso real (`FrozenStageCapture`: snapshot + target) con el código real de producción:
 * `create.fromSnapshot` → `ctx.view.*` → `engine/adapters.ts` → `stageRequests.ts` / `DECISION_PROMPTS`.
 *
 * Respeta fielmente `VerifyDecisionInput`: nunca inyecta sintéticamente `request` ni `expected`
 * en `result_verification`.
 */

import { ConfigManager } from "../../src/core/config.ts";
import type { ProbeQuery } from "../../src/core/contracts.ts";
import { codeAnswersOk } from "../../src/core/engine/postcondition.ts";
import { collectSources } from "../../src/core/engine/precheck.ts";
import {
  argsInput,
  askRenderOptions,
  completionInput,
  finalRenderOptions,
  finalViewOptions,
  pendingInput,
  planInput,
  renderArgsView,
  reviewInput,
  reviewViewOptions,
  routeInput,
  routeViewOptions,
  toolInput,
  verifyInput,
} from "../../src/core/engine/adapters.ts";
import { renderAsk, renderFinal } from "../../src/core/render/index.ts";
import {
  argumentsStageRequest,
  BASE_TEMPERATURE,
  finalStageRequest,
  pendingStageRequest,
  planStageRequest,
  questionStageRequest,
} from "../../src/core/models/stageRequests.ts";
import type { StageRequest } from "../../src/core/models/stageRequests.ts";
import { getToolPolicy, probesOf, serverOf, SYSTEM_TOOL_MANIFEST } from "../../src/core/tools/manifest.ts";
import type { ProbeCall } from "../../src/core/tools/probes.ts";
import type { MCPTool } from "../../src/core/types.ts";
import type { ExecutableRoute } from "../../src/core/types/routes.ts";
import type { UserEnvironment } from "../../src/core/environment.ts";
import { EXECUTABLE_ROUTES, JUDGE_BATCH } from "../core/contract.ts";
import type { ToolInputSchema } from "../core/contract.ts";
import type { Materialized } from "../core/scenario.ts";
import type { DecisionRequest, GenerativeRequest, Variant } from "../core/types.ts";
import { applyVariantPrompts } from "../core/variants/prompts.ts";
import { rehydrateContext } from "./migrateSnapshot.ts";
import type { FrozenStageCapture } from "./types.ts";

const DEFAULT_REAL_ENVIRONMENT: UserEnvironment = {
  platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
  home: "/tmp/jarvis-eval-sandbox/home",
  desktop: "/tmp/jarvis-eval-sandbox/desktop",
  documents: "/tmp/jarvis-eval-sandbox/documents",
  downloads: "/tmp/jarvis-eval-sandbox/downloads",
};

function resolveDate(now?: string | number | Date): Date | undefined {
  if (now === undefined) return undefined;
  const d = now instanceof Date ? now : new Date(now);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function need<T>(value: T | undefined, what: string, stage: string): T {
  if (value === undefined) {
    throw new Error(`modo real '${stage}': falta target.${what}.`);
  }
  return value;
}

function resolveTool(route: ExecutableRoute, spec: string | MCPTool, schemaOverride?: ToolInputSchema): MCPTool {
  if (typeof spec !== "string") {
    return schemaOverride ? { ...spec, inputSchema: { ...schemaOverride } } : spec;
  }
  const def = SYSTEM_TOOL_MANIFEST.find((d) => d.name === spec && d.route === route);
  if (!def) {
    throw new Error(`la herramienta '${spec}' no está en el manifest de la ruta '${route}'.`);
  }
  return {
    name: def.name,
    description: def.description,
    inputSchema: schemaOverride ?? { type: "object", properties: {} },
  } as MCPTool;
}

const decisionReq = (d: { state: string; questions: unknown }): Materialized => ({
  request: { type: "decision", state: d.state, questions: d.questions as DecisionRequest["questions"] },
});

function generativeReq(r: StageRequest, schemaName?: string): GenerativeRequest {
  return {
    type: "generative",
    system: r.system,
    user: r.user,
    json: r.json,
    ...(r.schema ? { schema: r.schema, schemaName: schemaName ?? r.stage } : {}),
    maxTokens: r.maxTokens,
    temperature: r.temperature ?? BASE_TEMPERATURE,
    thinking: r.thinking,
    ...(r.reasoningEffort !== undefined ? { reasoningEffort: r.reasoningEffort } : {}),
    ...(r.retryThinking !== undefined ? { retryThinking: r.retryThinking } : {}),
  };
}

/**
 * Materializa un `FrozenStageCapture` real en el `Materialized` estándar del eval (`request` + metadata),
 * aplicando las sobrescrituras de la `Variant` mediante `applyVariantPrompts`.
 */
export function materializeRealStage(capture: FrozenStageCapture, variant?: Variant): Materialized {
  const { prompts: P, decisionPrompts: D, stageParams } = applyVariantPrompts(variant);
  const { stage, snapshot, target } = capture;
  const nowDate = resolveDate(target.now);
  const ctx = rehydrateContext(snapshot, () => nowDate?.getTime() ?? Date.now());
  const config = ConfigManager.getConfig();

  if (stage === "d0") {
    return decisionReq(D.buildFirstQuery({ request: ctx.task.request }));
  }
  if (stage === "continuation") {
    return decisionReq(D.buildContinuation({ previous: need(target.previousTask, "previousTask", stage), request: ctx.task.request }));
  }
  if (stage === "fragment_judge") {
    const needText = need(target.need, "need", stage);
    const fragments = need(target.fragments, "fragments", stage);
    if (fragments.length === 0 || fragments.length > JUDGE_BATCH) {
      throw new Error(`modo real 'fragment_judge': target.fragments debe traer entre 1 y ${JUDGE_BATCH} elementos.`);
    }
    return decisionReq(D.buildFragmentJudge({ need: needText, fragments: [...fragments] }));
  }

  switch (stage) {
    case "route": {
      const routes = target.routes && target.routes.length > 0 ? [...target.routes] : [...EXECUTABLE_ROUTES];
      return decisionReq(D.buildRouteChoice(routeInput(ctx.view.forRoute(routeViewOptions()), { routes })));
    }
    case "tool_choice": {
      const route = need(target.route, "route", stage);
      const specs =
        target.tools && target.tools.length > 0
          ? target.tools
          : SYSTEM_TOOL_MANIFEST.filter((d) => d.route === route && d.internal !== true).map((d) => d.name);
      const tools = specs.map((s) => resolveTool(route, s));
      return decisionReq(D.buildToolChoice(toolInput(ctx.view.forRoute(routeViewOptions(route)), route, tools)));
    }
    case "args_review": {
      const route = need(target.route, "route", stage);
      const tool = resolveTool(route, need(target.tool, "tool", stage), target.inputSchema);
      return decisionReq(D.buildArgsReview(reviewInput(ctx.view.forReview(reviewViewOptions()), route, tool, target.args ?? {})));
    }
    case "result_verification": {
      const callId = target.callId ?? snapshot.calls[snapshot.calls.length - 1]?.id;
      if (!callId) throw new Error("modo real 'result_verification': falta target.callId o una llamada en el snapshot.");
      const input = verifyInput(ctx.view.forVerify(callId));
      const evaluated = ctx.find("calls", { id: callId })[0];
      const known = evaluated !== undefined && codeAnswersOk(evaluated.tool, evaluated.status, evaluated.summary) ? { ok: 1 } : undefined;
      // Fiel a producción (`verify.ts:92-94`): no se inyecta `request` ni se fuerza `expected`.
      return decisionReq(
        D.buildResultVerification({
          ...input,
          ...(known === undefined ? {} : { known }),
        }),
      );
    }
    case "completion": {
      return decisionReq(D.buildCompletionCheck(completionInput(ctx)));
    }
    case "probe": {
      let query: ProbeQuery;
      if (target.probeQuery) {
        query = target.probeQuery;
      } else {
        const callId = target.callId ?? snapshot.calls[snapshot.calls.length - 1]?.id;
        if (!callId) throw new Error("modo real 'probe': falta target.probeQuery o target.callId.");
        const evaluated = ctx.find("calls", { id: callId })[0];
        if (!evaluated) throw new Error(`modo real 'probe': no existe la llamada '${callId}'.`);
        const step = ctx.find("steps", { id: evaluated.stepId })[0];
        const stepText = step?.instruction ?? ctx.task.request;
        const probeCall: ProbeCall = {
          tool: evaluated.tool,
          args: evaluated.args,
          summary: evaluated.summary,
          request: ctx.task.mode === "reactive" ? ctx.task.request : stepText,
          step: ctx.task.mode === "reactive" ? ctx.task.request : stepText,
        };
        const applicable = probesOf(serverOf(evaluated.route as ExecutableRoute), evaluated.tool).filter((p) => p.applies(probeCall));
        const selected = target.probe ? applicable.find((p) => p.id === target.probe) : applicable[0];
        if (!selected) {
          throw new Error(`modo real 'probe': ninguna sonda aplicable para '${evaluated.tool}'.`);
        }
        const stageIdx = target.probeStage ?? 0;
        const picked = selected.stages(probeCall)[stageIdx];
        if (!picked) {
          throw new Error(`modo real 'probe': probeStage=${stageIdx} fuera de rango en '${selected.id}'.`);
        }
        query = { state: picked.state, question: picked.question };
      }
      return decisionReq({
        state: query.state,
        questions: { probe: { type: "noul", instructions: query.question.instructions, criteria: query.question.criteria } },
      });
    }
    case "plan": {
      const req = planStageRequest(planInput(ctx, target.feedback ?? null), config, P, {
        params: stageParams.plan,
        ...(nowDate ? { now: nowDate } : {}),
      });
      return { request: generativeReq(req, "plan") };
    }
    case "arguments": {
      const route = need(target.route, "route", stage);
      const tool = resolveTool(route, need(target.tool, "tool", stage), target.inputSchema);
      const step = ctx.current().step;
      const priorAttempts =
        target.priorAttempts ??
        (step
          ? ctx.find("calls", { stepId: step.id, tool: tool.name }).filter((c) => c.verdict !== "approved" && c.status !== "waiting_input").length
          : 0);
      const environment = target.environment ?? DEFAULT_REAL_ENVIRONMENT;
      const memory = target.memory ?? [];
      const req = argumentsStageRequest(
        argsInput(tool, environment, renderArgsView(ctx, tool.name).text, priorAttempts, memory),
        config,
        P,
        { params: stageParams.arguments, ...(nowDate ? { now: nowDate } : {}) },
      );
      return {
        request: generativeReq(req),
        toolSchema: tool.inputSchema as ToolInputSchema,
        toolName: tool.name,
        environment,
        precheck: {
          kind: getToolPolicy(serverOf(route), tool.name).mutates ? "write" : "read",
          sources: collectSources(ctx, memory),
          refIds: ctx.find("refs", {}).map((r) => r.id.toLowerCase()),
        },
      };
    }
    case "pending": {
      const input = pendingInput(ctx, target.previous ?? []);
      const fullInput = target.thread ? { ...input, thread: target.thread } : input;
      return { request: generativeReq(pendingStageRequest(fullInput, P, stageParams.pending), "pending") };
    }
    case "question": {
      const req = questionStageRequest({ view: renderAsk(ctx.view.forAsk(), askRenderOptions()) }, P, stageParams.question);
      return { request: generativeReq(req) };
    }
    case "final": {
      const view = renderFinal(ctx.view.forFinal(finalViewOptions()), finalRenderOptions()).text;
      const input = target.thread ? { view, thread: target.thread } : { view };
      const req = finalStageRequest(input, config, P, {
        params: stageParams.final,
        ...(nowDate ? { now: nowDate } : {}),
      });
      return { request: generativeReq(req) };
    }
    default:
      throw new Error(`Etapa '${String(stage)}' no soportada en materializeRealStage.`);
  }
}
