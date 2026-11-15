/**
 * eval/real/executableScenario.ts
 *
 * Corre `runTask(ctx, runtime, deps)` en un sandbox aislado hasta alcanzar una etapa objetivo
 * (`{ stage, occurrence }`), congela `ctx.snapshot()` y captura el `StageTarget` exacto
 * entregado por las vistas y adaptadores de producción.
 */

import type {
  ArgsFromViewInput,
  CompletionDecision,
  CompletionDecisionInput,
  ContinuationDecision,
  ContinuationInput,
  EngineDeps,
  EngineLLM,
  FinalFromViewInput,
  FinalGenerationResult,
  FirstQueryDecision,
  FirstQueryInput,
  IActionDecision,
  PendingFromViewInput,
  PendingGenerationResult,
  PlanFromViewInput,
  PlanGenerationResult,
  ProbeAnswer,
  ProbeQuery,
  QuestionGenerationResult,
  QuestionInput,
  ReviewDecision,
  ReviewDecisionInput,
  RouteDecision,
  RouteDecisionInput,
  ToolDecision,
  ToolDecisionInput,
  VerifyDecision,
  VerifyDecisionInput,
} from "../../src/core/contracts.ts";
import { create } from "../../src/core/ctx/index.ts";
import { firstQueryKind } from "../../src/core/engine/firstQuery.ts";
import { TaskRuntime } from "../../src/core/engine/runtime.ts";
import { runTask } from "../../src/core/engine/runTask.ts";
import type { MemoryFact } from "../../src/core/memory.ts";
import { parseJsonObject } from "../../src/core/models/qwen.ts";
import type { ExecutableRoute } from "../../src/core/types/routes.ts";
import type { StageName } from "../core/types.ts";
import { EVAL_CONTEXT_LIMITS } from "./migrateSnapshot.ts";
import { createEvalSandbox } from "./sandbox.ts";
import type { ExecutableStopSpec, FrozenStageCapture, StageTarget } from "./types.ts";

class CaptureReachedError extends Error {
  readonly capture: FrozenStageCapture;
  constructor(capture: FrozenStageCapture) {
    super(`Capture reached at stage '${capture.stage}'`);
    this.capture = capture;
  }
}

function resolveExecutableRoute(req: string, available: readonly ExecutableRoute[]): ExecutableRoute {
  if (available.includes("files") && /(archivo|leer|escrib|carpeta|document|desktop|notes|notas|txt|md)/i.test(req)) {
    return "files";
  }
  if (available.includes("terminal") && /(comando|terminal|proceso|npm|bash|powershell)/i.test(req)) {
    return "terminal";
  }
  return available[0];
}

/**
 * Ejecuta una tarea real en `runTask` hasta la ocurrencia pedida de `spec.stopAt.stage`
 * y devuelve el snapshot congelado + `StageTarget` listo para `materializeRealStage`.
 */
export async function captureExecutableScenario(spec: ExecutableStopSpec): Promise<FrozenStageCapture> {
  const sandbox = createEvalSandbox({ files: spec.files });
  const targetStage = spec.stopAt.stage;
  const targetOccurrence = Math.max(1, spec.stopAt.occurrence ?? 1);
  const seen = new Map<StageName, number>();

  let clock = spec.now ? new Date(spec.now).getTime() : 1_700_000_000_000;
  if (Number.isNaN(clock)) clock = 1_700_000_000_000;
  const ctx = create.context(
    { id: "real_exec_capture", request: spec.request, mode: spec.mode },
    { ...EVAL_CONTEXT_LIMITS, now: () => (clock += 1000) },
  );

  const script = spec.script ?? {};
  let pendingIdx = 0;
  let planIdx = 0;
  let routeIdx = 0;
  let toolIdx = 0;
  let argsIdx = 0;
  let reviewIdx = 0;
  let verifyIdx = 0;
  let probeIdx = 0;
  let completionIdx = 0;
  let questionIdx = 0;
  let planApprovalIdx = 0;
  let toolApprovalIdx = 0;
  let answerIdx = 0;

  // Rastreos para capturar `previous` en `pending` y `args`/`tool` en `args_review` / `arguments`.
  let lastPendingList: string[] = [];
  let lastRoute: ExecutableRoute | undefined;
  let lastTool: string | undefined;
  let lastProposedArgs: Record<string, unknown> | undefined;

  const runtime = new TaskRuntime({
    onChange: (waiting) => {
      if (!waiting) return;
      queueMicrotask(() => {
        if (waiting.kind === "plan") {
          const item = script.planApprovals?.[planApprovalIdx++] ?? { approved: true };
          runtime.resolvePlanApproval(waiting.request.id, item.approved, item.instruction);
        } else if (waiting.kind === "approval") {
          const item = script.toolApprovals?.[toolApprovalIdx++] ?? { approved: true };
          runtime.resolveApproval(waiting.request.id, item.approved, item.instruction);
        } else if (waiting.kind === "question") {
          const ans = script.answers?.[answerIdx++] ?? "documentos";
          runtime.answer(ans);
        }
      });
    },
  });

  const hit = (stage: StageName, buildTarget: () => StageTarget): void => {
    const count = (seen.get(stage) ?? 0) + 1;
    seen.set(stage, count);
    if (stage === targetStage && count === targetOccurrence) {
      const capture: FrozenStageCapture = {
        stage,
        snapshot: ctx.snapshot(),
        target: {
          ...buildTarget(),
          ...(spec.now ? { now: spec.now } : {}),
        },
        sourceInfo: { kind: "executable", n: ctx.n },
      };
      runtime.cancel();
      throw new CaptureReachedError(capture);
    }
  };

  const memoryFacts: MemoryFact[] = (spec.memory ?? []).map((m, idx) => ({
    id: `m${idx + 1}`,
    key: m.key,
    value: m.value,
    updatedAt: new Date(clock).toISOString(),
  }));

  const decision: IActionDecision = {
    async firstQuery(input: FirstQueryInput): Promise<FirstQueryDecision> {
      hit("d0", () => ({}));
      const kind = script.firstQueryKind ?? "multi";
      const multi = kind === "multi" ? 0.9 : 0.1;
      const chatProb = kind === "chat" ? 0.9 : 0.05;
      const singleProb = kind === "single" ? 0.9 : 0.05;
      return {
        kind: firstQueryKind(chatProb, multi),
        probabilities: { chat: chatProb, single: singleProb, multi },
        multi,
        rawInput: input.request,
        rawOutput: "{}",
      };
    },
    async continuation(input: ContinuationInput): Promise<ContinuationDecision> {
      hit("continuation", () => ({ previousTask: input.previous }));
      const follows = script.continuationFollows === false ? 0.1 : 0.9;
      return { follows, rawInput: input.request, rawOutput: "{}" };
    },
    async chooseRoute(input: RouteDecisionInput): Promise<RouteDecision> {
      hit("route", () => ({ routes: [...input.routes] }));
      const preferred = script.routes?.[routeIdx++];
      const route = preferred && input.routes.includes(preferred) ? preferred : resolveExecutableRoute(input.step?.instruction ?? spec.request, input.routes);
      lastRoute = route;
      return {
        action: "route",
        route,
        probabilities: Object.fromEntries(input.routes.map((r) => [r, r === route ? 0.9 : 0.05])),
        rawInput: "",
        rawOutput: "",
      };
    },
    async chooseTool(input: ToolDecisionInput): Promise<ToolDecision> {
      hit("tool_choice", () => ({ route: input.route, tools: input.tools }));
      const preferredName = script.tools?.[toolIdx++];
      const tool = (preferredName ? input.tools.find((t) => t.name === preferredName) : undefined) ?? input.tools[0];
      lastRoute = input.route;
      lastTool = tool.name;
      return {
        action: "tool",
        tool,
        probabilities: Object.fromEntries(input.tools.map((t) => [t.name, t.name === tool.name ? 0.9 : 0.05])),
        rawInput: "",
        rawOutput: "",
      };
    },
    async reviewArgs(input: ReviewDecisionInput): Promise<ReviewDecision> {
      const parsedArgs = parseJsonObject(input.candidate.args) ?? lastProposedArgs ?? {};
      hit("args_review", () => ({
        route: lastRoute ?? (input.candidate.route as ExecutableRoute),
        tool: input.candidate.tool,
        args: parsedArgs as StageTarget["args"],
      }));
      const review = script.reviews?.[reviewIdx++] ?? "approved";
      return {
        review,
        probabilities: {
          approved: review === "approved" ? 0.9 : 0.05,
          args_invalid: review === "args_invalid" ? 0.9 : 0.05,
          info_missing: review === "info_missing" ? 0.9 : 0.05,
        },
        rawInput: "",
        rawOutput: "",
      };
    },
    async verifyResult(input: VerifyDecisionInput): Promise<VerifyDecision> {
      const lastCall = ctx.find("calls", {}).slice(-1)[0];
      hit("result_verification", () => ({ callId: lastCall?.id }));
      const ok = input.known?.ok ?? 0.95;
      const cumple = script.verifyCumple?.[verifyIdx++] === false ? 0.1 : 0.95;
      return { answers: { ok, cumple }, rawInput: "", rawOutput: "" };
    },
    async probe(input: ProbeQuery): Promise<ProbeAnswer> {
      const lastCall = ctx.find("calls", {}).slice(-1)[0];
      hit("probe", () => ({ callId: lastCall?.id, probeQuery: input }));
      const yes = script.probeYes?.[probeIdx++];
      const p = yes === undefined ? 0.9 : yes ? 0.95 : 0.05;
      return { probability: p, rawInput: "", rawOutput: "" };
    },
    async checkCompletion(_input: CompletionDecisionInput): Promise<CompletionDecision> {
      hit("completion", () => ({}));
      const complete = script.completion?.[completionIdx++] === false ? 0.1 : 0.95;
      return { requestComplete: complete, rawInput: "", rawOutput: "" };
    },
  };

  const llm: EngineLLM = {
    async generatePendingFromView(input: PendingFromViewInput): Promise<PendingGenerationResult> {
      const prev = [...lastPendingList];
      hit("pending", () => ({ previous: prev, ...(input.thread ? { thread: input.thread } : {}) }));
      const next = script.pendingLists?.[pendingIdx++] ?? (pendingIdx === 1 ? [spec.request] : []);
      lastPendingList = [...next];
      return { pending: next, rawInput: input.view, rawOutput: JSON.stringify({ pending: next }) };
    },
    async generatePlanFromView(input: PlanFromViewInput): Promise<PlanGenerationResult> {
      const triggerPlanFeedback = input.trigger === "user_feedback" ? ctx.find("plans", {}).slice(-1)[0]?.feedback ?? null : null;
      hit("plan", () => ({ feedback: triggerPlanFeedback }));
      const rawSteps = script.planSteps?.[planIdx++] ?? [
        { goal: spec.request, suggested_mcp: "files", expected_outcome: "Objetivo cumplido" },
      ];
      return {
        steps: rawSteps.map((s) => ({ instruction: s.goal, route: s.suggested_mcp, expected: s.expected_outcome })),
        rawInput: input.view,
        rawOutput: JSON.stringify({ steps: rawSteps }),
      };
    },
    async generateArgumentsFromView(input: ArgsFromViewInput) {
      hit("arguments", () => ({
        route: lastRoute ?? "files",
        tool: input.tool,
        priorAttempts: input.priorAttempts ?? 0,
        memory: input.memory ?? [],
        environment: input.environment,
      }));
      const scripted = script.arguments?.[argsIdx++];
      let args: Record<string, unknown>;
      if (scripted) {
        args = Object.fromEntries(
          Object.entries(scripted).map(([k, v]) => [k, typeof v === "string" ? v.replace("$HOME", sandbox.environment.home).replace("$DOCS", sandbox.environment.documents ?? sandbox.environment.home) : v]),
        );
      } else if (input.tool.name === "list_directory") {
        args = { path: sandbox.environment.documents ?? sandbox.environment.home };
      } else if (input.tool.name === "read_file") {
        const firstFile = Object.keys(spec.files ?? {})[0];
        args = { path: firstFile ? sandbox.resolveSandboxPath(firstFile) : sandbox.environment.home };
      } else if (input.tool.name === "write_file") {
        args = { path: `${sandbox.environment.documents}/salida.txt`, content: "ok", mode: "rewrite" };
      } else {
        args = { path: sandbox.environment.home };
      }
      lastProposedArgs = args;
      return { args, rawInput: input.view, rawOutput: JSON.stringify(args), timing: { startedAt: clock, durationMs: 1 } };
    },
    async generateQuestion(input: QuestionInput): Promise<QuestionGenerationResult> {
      hit("question", () => ({}));
      const question = script.questions?.[questionIdx++] ?? "¿Qué archivo deseas procesar?";
      return { question, rawInput: input.view, rawOutput: question };
    },
    async generateFinalFromView(input: FinalFromViewInput): Promise<FinalGenerationResult> {
      hit("final", () => ({ ...(input.thread ? { thread: input.thread } : {}) }));
      return { response: "Tarea completada en sandbox.", rawInput: input.view, rawOutput: "Tarea completada en sandbox." };
    },
  };

  const deps: EngineDeps = {
    decision,
    discovery: sandbox.discovery,
    llm,
    vault: sandbox.vault,
    guardScope: sandbox.guardScope,
    blacklist: sandbox.blacklist,
    environment: async () => sandbox.environment,
    autoMode: () => true,
    memory: () => memoryFacts,
    previousTask: spec.previousTask ?? null,
    disk: sandbox.disk,
    analyzeCommand: sandbox.analyzeCommand,
  };

  try {
    await runTask(ctx, runtime, deps);
  } catch (err) {
    if (err instanceof CaptureReachedError) {
      return err.capture;
    }
    throw err;
  } finally {
    sandbox.cleanup();
  }

  throw new Error(`El escenario ejecutable '${spec.request}' terminó (${ctx.task.state}) sin alcanzar '${targetStage}' #${targetOccurrence}.`);
}
