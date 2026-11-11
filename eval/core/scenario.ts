/**
 * eval/core/scenario.ts
 *
 * Casos por escenario: en vez de guardar el prompt ya armado, el caso describe la situación (solicitud, pasos, llamadas con
 * su `status`, hechos, entradas del usuario) y el punto de decisión. El `request` se arma al cargar el dataset con el mismo
 * código que usa Jarvis:
 *
 *   escenario → `create.context` + `apply` → `ctx.view.<vista>` → adaptadores (`engine/adapters.ts`) → constructores de
 *   prompts (`models/prompts.ts`, `models/stageRequests.ts`) → request del eval.
 *
 * Así los mensajes fijos de `ctx/views/messages.ts`, los topes de `BUDGET`, los renderizadores y los parámetros de cada
 * etapa llegan al modelo tal como en producción, y un cambio en `src/` se refleja solo en el eval.
 *
 * Es, con `contract.ts`, la vía declarada hacia `src/` (también importan `src/` `config.ts`, `runner.ts` —pre-chequeo—, `types.ts`, `client/*`, `cross.ts` y `psvalid.ts`). Todas las entradas se arman con
 * las mismas funciones que el motor (`planInput`, `renderArgsView`, `argsInput`, `routeInput`…, en `engine/adapters.ts`).
 */

import { createHash } from "node:crypto";
import { BUDGET } from "../../src/core/budget.ts";
import { ConfigManager } from "../../src/core/config.ts";
import { create } from "../../src/core/ctx/index.ts";
import type { CallStatus, JsonObject, Op, StepState, StopReason, TaskContext, TerminalTaskState, VerdictReason } from "../../src/core/ctx/index.ts";
import {
  argsInput,
  askRenderOptions,
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
import { DECISION_PROMPTS, PROMPTS } from "../../src/core/models/prompts.ts";
import {
  argumentsStageRequest,
  BASE_TEMPERATURE,
  finalStageRequest,
  pendingStageRequest,
  planStageRequest,
  questionStageRequest,
} from "../../src/core/models/stageRequests.ts";
import type { PromptSet, StageRequest } from "../../src/core/models/stageRequests.ts";
import { collectSources, precheckCall } from "../../src/core/engine/precheck.ts";
import type { CommandAnalyzer, PrecheckFinding, PrecheckSources } from "../../src/core/engine/precheck.ts";
import { argsMax, getToolPolicy, serverOf, SYSTEM_TOOL_MANIFEST } from "../../src/core/tools/manifest.ts";
import type { MCPTool } from "../../src/core/types.ts";
import type { ExecutableRoute } from "../../src/core/types/routes.ts";
import { EXECUTABLE_ROUTES } from "./contract.ts";
import type { ToolInputSchema, VariantPrompts } from "./contract.ts";
import type { DecisionRequest, GenerativeRequest, GenerativeStage, Variant } from "./types.ts";
import type { UserEnvironment } from "../../src/core/environment.ts";

/**
 * Lo que, además de `src/`, cambia los prompts de los casos por escenario: la fecha (`TODAY`) y la configuración que fija
 * tokens y thinking por etapa. Va en `meta.json` para explicar por qué cambió un `requestHash` entre corridas.
 */
export function promptEnvironment(): { date: string; stageConfigHash: string } {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, "0");
  const { qwenMaxTokens, thinking } = ConfigManager.getConfig();
  const stageConfig = JSON.stringify({ qwenMaxTokens, thinking, askMaxTokens: BUDGET.ask.maxTokens, pendingMaxTokens: BUDGET.pending.maxTokens });
  return {
    date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`,
    stageConfigHash: createHash("sha256").update(stageConfig).digest("hex").slice(0, 16),
  };
}

// ───────────────────────── Forma del escenario ─────────────────────────

export interface ScenarioStep {
  /** Deliberativo: la del plan. Reactivo: el primer pendiente (default: la solicitud). */
  instruction?: string;
  route?: string;
  expected?: string;
  /** Estado final del paso (default `pending`). `completed` y `failed` pasan antes por `running`. */
  state?: StepState;
}

export interface ScenarioCall {
  /** Índice del paso en `steps` (default: el último). */
  step?: number;
  route: string;
  tool: string;
  /** Default `read`. */
  kind?: "read" | "write";
  status: CallStatus;
  /** Default `{}`; `null` solo con `args_invalid`. */
  args?: JsonObject | null;
  summary?: string | null;
  verdict?: "approved" | "rejected";
  reason?: VerdictReason | null;
  /** Resultado guardado aparte: el resumen no lo contiene completo. */
  ref?: { label: string; size: number; where: string };
}

/** Parámetros del punto de decisión; cada etapa lee solo los suyos. */
export interface ScenarioAt {
  // route
  routes?: ExecutableRoute[];
  // tool_choice, args_review, arguments
  route?: ExecutableRoute;
  /** tool_choice: nombres del manifest (default: todas las de la ruta). */
  tools?: string[];
  /** args_review y arguments: herramienta (nombre del manifest) con su schema de entrada. */
  tool?: string;
  inputSchema?: ToolInputSchema;
  /** args_review: argumentos propuestos. */
  args?: JsonObject;
  // result_verification: índice de la llamada evaluada en `calls` (default: la última).
  call?: number;
  // plan: instrucción del usuario (replan por feedback).
  feedback?: string;
  // pending: la lista de pendientes de la vuelta anterior (vacía o ausente en la primera vuelta).
  previous?: string[];
  // arguments: rutas del usuario (default fijo, para que el caso no dependa de la PC).
  environment?: { home: string; desktop?: string; documents?: string; downloads?: string };
}

export interface Scenario {
  mode: "reactive" | "deliberative";
  request: string;
  steps?: ScenarioStep[];
  calls?: ScenarioCall[];
  /** Hechos de entorno (hoy solo `process`). */
  facts?: Record<string, string>;
  /** Respuestas del usuario a preguntas anteriores (`answer_1`, `answer_2`…), en orden. */
  userInput?: string[];
  /** Cierre de la tarea (para `final`). */
  finish?: { state: TerminalTaskState; stopReason?: StopReason | null };
  at?: ScenarioAt;
}

/** Rutas de una PC Windows (las de los datasets: `C:/Users/hugof/...`); los casos que necesiten otras fijan `at.environment`. */
const DEFAULT_ENVIRONMENT = {
  platform: "windows" as const,
  home: "C:/Users/hugof",
  desktop: "C:/Users/hugof/Desktop",
  documents: "C:/Users/hugof/Documents",
  downloads: "C:/Users/hugof/Downloads",
};

// ───────────────────────── Contexto ─────────────────────────

/** Reloj determinista: cada `apply` avanza un segundo, así el orden cronológico no depende de cuándo se carga. */
function fixedClock(): () => number {
  let t = 1_700_000_000_000;
  return () => (t += 1000);
}

interface Built {
  ctx: TaskContext;
  callIds: string[];
}

function buildContext(sc: Scenario): Built {
  const ctx = create.context(
    { id: "eval", request: sc.request, mode: sc.mode },
    {
      now: fixedClock(),
      summaryMax: BUDGET.summaryMax,
      argsStringMax: argsMax(BUDGET.argsStringDefault),
      factValueMax: BUDGET.factValueMax,
      feedbackMax: BUDGET.feedbackMax,
      jsonMaxDepth: BUDGET.jsonMaxDepth,
    },
  );
  const addOne = (op: Op): string => ctx.apply(op).ids[0];

  // Deliberativo: un plan inicial al que pertenecen los pasos. Reactivo: sin plan; cada paso nace `running`.
  const deliberative = sc.mode === "deliberative";
  const planId = deliberative ? addOne({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }) : null;
  const stepSpecs: ScenarioStep[] = sc.steps && sc.steps.length > 0 ? sc.steps : [{}];
  const callSpecs = sc.calls ?? [];
  const lastIdx = stepSpecs.length - 1;
  // Paso de cada llamada (índice en `steps`; por defecto el último).
  const callStep = callSpecs.map((c) => (c.step !== undefined && c.step >= 0 && c.step <= lastIdx ? c.step : lastIdx));

  const stepIds: string[] = [];
  const callIds: string[] = [];

  const addStep = (s: ScenarioStep): void => {
    stepIds.push(
      addOne({
        op: "add",
        target: "steps",
        value: deliberative
          ? { planId, instruction: s.instruction ?? "", route: s.route ?? "", expected: s.expected ?? "" }
          : { planId: null, instruction: s.instruction ?? sc.request, route: null, expected: null },
      }),
    );
  };

  // Una llamada, con la ref (si la hay) agregada antes y el veredicto después, como en producción.
  const addCall = (k: number): void => {
    const c = callSpecs[k];
    const stepId = stepIds[callStep[k]];
    const refId = c.ref ? addOne({ op: "add", target: "refs", value: { stepId, ...c.ref } }) : null;
    const args = c.args === undefined ? {} : c.args;
    const sig = args === null || c.status === "refs_unresolved" ? null : `sig-${k}`;
    const id = addOne({
      op: "add",
      target: "calls",
      value: { stepId, route: c.route, tool: c.tool, kind: c.kind ?? "read", args, sig, status: c.status, summary: c.summary ?? null, ref: refId },
    });
    callIds[k] = id;
    if (c.verdict) ctx.apply({ op: "update", target: id, value: { verdict: c.verdict, reason: c.reason ?? null } });
  };

  // Estado final del paso: `completed` y `failed` pasan antes por `running`.
  const settle = (i: number): void => {
    const state = stepSpecs[i].state ?? "pending";
    if (state === "pending") return;
    ctx.apply({ op: "update", target: stepIds[i], value: { state: "running" } });
    if (state !== "running") ctx.apply({ op: "update", target: stepIds[i], value: { state } });
  };

  if (deliberative) {
    // Los pasos nacen `pending`: se crean todos, después las llamadas y al final los estados (de a uno y en orden).
    stepSpecs.forEach((s) => addStep(s));
    callSpecs.forEach((_, k) => addCall(k));
    stepSpecs.forEach((_, i) => settle(i));
  } else {
    // Reactivo: un paso nuevo nace `running` y el contexto admite uno solo (invariante 2): cada paso se crea, recibe sus
    // llamadas y llega a su estado final antes de crear el siguiente.
    stepSpecs.forEach((s, i) => {
      addStep(s);
      callSpecs.forEach((_, k) => {
        if (callStep[k] === i) addCall(k);
      });
      settle(i);
    });
  }
  const lastStepId = stepIds[lastIdx];

  for (const [key, value] of Object.entries(sc.facts ?? {})) {
    ctx.apply({ op: "set", target: `facts.${key}`, value: { value, stepId: lastStepId } });
  }
  (sc.userInput ?? []).forEach((text, i) => {
    ctx.apply({ op: "set", target: `facts.answer_${i + 1}`, value: { value: text, stepId: lastStepId } });
  });

  if (sc.finish) {
    ctx.apply({ op: "finish", target: "task", value: { state: sc.finish.state, stopReason: sc.finish.stopReason ?? null } });
  }
  return { ctx, callIds };
}

// ───────────────────────── Herramientas del manifest ─────────────────────────

/** Herramienta con la descripción real del manifest y el schema del escenario (el del servidor no es estático). */
function toolOf(route: ExecutableRoute, name: string, inputSchema?: ToolInputSchema): MCPTool {
  const def = SYSTEM_TOOL_MANIFEST.find((d) => d.name === name && d.route === route);
  if (!def) throw new Error(`la herramienta '${name}' no está en el manifest de la ruta '${route}'.`);
  return { name, description: def.description, inputSchema: inputSchema ?? { type: "object", properties: {} } } as MCPTool;
}

function need<T>(value: T | undefined, what: string, stage: string): T {
  if (value === undefined) throw new Error(`etapa '${stage}': falta scenario.at.${what}.`);
  return value;
}

// ───────────────────────── Armado por etapa ─────────────────────────

export interface Materialized {
  request: DecisionRequest | GenerativeRequest;
  /** `arguments`: schema real de la herramienta, para validar la salida. */
  toolSchema?: ToolInputSchema;
  /** `arguments`: herramienta y entorno del caso, para repetir el pre-chequeo de producción sobre la salida. */
  toolName?: string;
  environment?: UserEnvironment;
  /** `arguments`: `kind` de la herramienta y fuentes de la tarea, como los arma producción (`callRunner`); completan ese pre-chequeo. */
  precheck?: { kind: "read" | "write"; sources: PrecheckSources; refIds: string[] };
}

const decision = (d: { state: string; questions: unknown }): Materialized => ({
  request: { type: "decision", state: d.state, questions: d.questions as DecisionRequest["questions"] },
});

function generative(r: StageRequest, schemaName?: string): GenerativeRequest {
  return {
    type: "generative",
    system: r.system,
    user: r.user,
    json: r.json,
    ...(r.schema ? { schema: r.schema, schemaName: schemaName ?? r.stage } : {}),
    maxTokens: r.maxTokens,
    // Lo que fija producción en cada etapa (`arguments`: según los intentos previos); `BASE_TEMPERATURE` si no fija ninguna.
    temperature: r.temperature ?? BASE_TEMPERATURE,
    thinking: r.thinking,
    ...(r.retryThinking !== undefined ? { retryThinking: r.retryThinking } : {}),
  };
}

/**
 * Los prompts con que se arma un caso: los de producción, con las vistas y los constructores ENTEROS que la variante define (nada se
 * fusiona por pieza). Lo que la variante no nombra usa el prompt de producción.
 */
function effectivePrompts(ov?: VariantPrompts): { P: PromptSet; D: typeof DECISION_PROMPTS } {
  return { P: { ...PROMPTS, ...ov?.PROMPTS } as PromptSet, D: { ...DECISION_PROMPTS, ...ov?.DECISION_PROMPTS } };
}

/**
 * Entradas del pre-chequeo de producción (`callRunner`) para una llamada del escenario: `kind` según la política de la herramienta,
 * las fuentes de la tarea (`collectSources`) y el entorno del caso. Las usan `scenarioPrecheck` (`args_review`) y el caso
 * `arguments`: una sola construcción, la misma que hace producción.
 */
function precheckBase(
  ctx: TaskContext,
  route: ExecutableRoute,
  toolName: string,
  atEnvironment: ScenarioAt["environment"],
): { kind: "read" | "write"; sources: PrecheckSources; environment: UserEnvironment; refIds: string[] } {
  return {
    refIds: ctx.find("refs", {}).map((r) => r.id.toLowerCase()),
    kind: getToolPolicy(serverOf(route), toolName).mutates ? "write" : "read",
    sources: collectSources(ctx),
    environment: atEnvironment ? { ...DEFAULT_ENVIRONMENT, ...atEnvironment } : DEFAULT_ENVIRONMENT,
  };
}

/**
 * Pre-chequeo determinista (`src/core/engine/precheck.ts`) sobre un caso `args_review`: el mismo código que corre `runCall`,
 * con las fuentes del contexto del escenario. No usa ningún modelo.
 */
export async function scenarioPrecheck(sc: Scenario, analyze?: CommandAnalyzer): Promise<PrecheckFinding | null> {
  const { ctx } = buildContext(sc);
  const at = sc.at ?? {};
  const route = need(at.route, "route", "args_review");
  const tool = toolOf(route, need(at.tool, "tool", "args_review"), at.inputSchema);
  const { kind, sources, environment } = precheckBase(ctx, route, tool.name, at.environment);
  return precheckCall({ tool: tool.name, kind, args: at.args ?? {}, sources, environment }, analyze);
}

/**
 * Arma el `request` de una etapa a partir del escenario, con los prompts de producción o los de la variante, y le aplica los
 * parámetros de la variante (`params`: temperatura, tokens, thinking…). Lanza `Error` con el motivo si el escenario no sirve.
 */
export function materializeScenario(stage: string, sc: Scenario, variant?: Variant): Materialized {
  const built = buildFromScenario(stage, sc, variant?.prompts);
  const params = variant?.params?.[stage as GenerativeStage];
  if (params === undefined || built.request.type !== "generative") return built;
  const defined = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  return { ...built, request: { ...built.request, ...defined } };
}

function buildFromScenario(stage: string, sc: Scenario, ov?: VariantPrompts): Materialized {
  if (stage === "pending" && sc.mode !== "reactive") throw new Error("etapa 'pending': la lista de pendientes solo existe en modo reactivo.");
  const { ctx, callIds } = buildContext(sc);
  const at = sc.at ?? {};
  const config = ConfigManager.getConfig();
  const { P, D } = effectivePrompts(ov);

  switch (stage) {
    case "route": {
      const flags = {
        routes: at.routes ?? [...EXECUTABLE_ROUTES],
      };
      return decision(D.buildRouteChoice(routeInput(ctx.view.forRoute(routeViewOptions()), flags)));
    }
    case "tool_choice": {
      const route = need(at.route, "route", stage);
      const names = at.tools ?? SYSTEM_TOOL_MANIFEST.filter((d) => d.route === route).map((d) => d.name);
      const tools = names.map((n) => toolOf(route, n));
      return decision(D.buildToolChoice(toolInput(ctx.view.forRoute(routeViewOptions(route)), route, tools)));
    }
    case "args_review": {
      const route = need(at.route, "route", stage);
      const tool = toolOf(route, need(at.tool, "tool", stage), at.inputSchema);
      return decision(D.buildArgsReview(reviewInput(ctx.view.forReview(reviewViewOptions()), route, tool, at.args ?? {})));
    }
    case "result_verification": {
      const id = callIds[at.call ?? callIds.length - 1];
      if (id === undefined) throw new Error("etapa 'result_verification': el escenario no tiene la llamada a evaluar (scenario.calls / at.call).");
      return decision(D.buildResultVerification(verifyInput(ctx.view.forVerify(id))));
    }
    case "plan": {
      return { request: generative(planStageRequest(planInput(ctx, at.feedback ?? null), config, P), "plan") };
    }
    case "arguments": {
      const route = need(at.route, "route", stage);
      const tool = toolOf(route, need(at.tool, "tool", stage), at.inputSchema);
      // Misma construcción que `scenarioPrecheck`: `kind`, fuentes y entorno del pre-chequeo de producción.
      const { kind, sources, environment: env, refIds } = precheckBase(ctx, route, tool.name, at.environment);
      // Sin `priorAttempts`: un caso `arguments` es siempre el primer intento (`argsInput` aplica 0).
      const request = argumentsStageRequest(argsInput(tool, env, renderArgsView(ctx, tool.name).text), config, P);
      return {
        request: generative(request),
        toolSchema: tool.inputSchema as ToolInputSchema,
        toolName: tool.name,
        environment: env,
        precheck: { kind, sources, refIds },
      };
    }
    case "pending": {
      return { request: generative(pendingStageRequest(pendingInput(ctx, at.previous ?? []), P), "pending") };
    }
    case "question":
      return { request: generative(questionStageRequest({ view: renderAsk(ctx.view.forAsk(), askRenderOptions()) }, P)) };
    case "final":
      return {
        request: generative(finalStageRequest({ view: renderFinal(ctx.view.forFinal(finalViewOptions()), finalRenderOptions()).text }, config, P)),
      };
    default:
      throw new Error(`etapa '${stage}' desconocida para un escenario.`);
  }
}