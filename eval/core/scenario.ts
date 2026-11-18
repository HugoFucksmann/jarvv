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
 * El armado concreto de cada etapa vive en su módulo enchufable de `eval/core/stages/`; aquí viven el armado del
 * contexto (`buildContext`), los helpers compartidos (`scenarioHelpers`) y `materializeScenario`.
 */

import { createHash } from "node:crypto";
import { BUDGET } from "../../src/core/budget.ts";
import { ConfigManager } from "../../src/core/config.ts";
import { create } from "../../src/core/ctx/index.ts";
import type { CallStatus, JsonObject, Op, StepState, StopReason, TaskContext, TerminalTaskState, VerdictReason } from "../../src/core/ctx/index.ts";
import { collectSources, precheckCall } from "../../src/core/engine/precheck.ts";
import type { CommandAnalyzer, PrecheckFinding, PrecheckSources } from "../../src/core/engine/precheck.ts";
import type { UserEnvironment } from "../../src/core/environment.ts";
import { DECISION_PROMPTS, PROMPTS } from "../../src/core/models/prompts.ts";
import { BASE_TEMPERATURE } from "../../src/core/models/stageRequests.ts";
import type { PromptSet, StageRequest } from "../../src/core/models/stageRequests.ts";
import { argsMax, getToolPolicy, serverOf, SYSTEM_TOOL_MANIFEST } from "../../src/core/tools/manifest.ts";
import type { MCPTool } from "../../src/core/types.ts";
import type { ExecutableRoute } from "../../src/core/types/routes.ts";
import type { ToolInputSchema, VariantPrompts } from "./contract.ts";
import { getStage, hasStage } from "./stages/index.ts";
import type { ScenarioHelpers } from "./stages/index.ts";
import type { DecisionRequest, GenerativeRequest, GenerativeStage, Variant } from "./types.ts";

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
  /** result_verification: el ítem verificado es el último; la variante recibe `request` (la solicitud completa). */
  lastItem?: boolean;
  // plan: instrucción del usuario (replan por feedback).
  feedback?: string;
  // pending: la lista de pendientes de la vuelta anterior (vacía o ausente en la primera vuelta).
  previous?: string[];
  // recovery: la causa del fallo (`StepFailureCause`) y los pasos fallidos del ítem hasta ahora (default 1). `previous` trae la lista de la vuelta con el ítem fallido de primero.
  cause?: string;
  attempts?: number;
  // fragment_judge: la necesidad (la pregunta de `web_search`) y los fragmentos a puntuar (hasta `JUDGE_BATCH`). No usa el resto del escenario.
  need?: string;
  fragments?: string[];
  // arguments: rutas del usuario (default fijo, para que el caso no dependa de la PC).
  environment?: { home: string; desktop?: string; documents?: string; downloads?: string };
}

export interface ScenarioRecalled {
  /** Hechos del usuario (`source: "user_memory"`): `{ key, value }`, como los devuelve `MemoryProvider.recall`. */
  user_memory?: Array<{ key: string; value: string; from?: string }>;
  /** Hilo reciente (`source: "thread"`): las dos entradas que usa producción. */
  thread?: { previous_request?: string; previous_answer?: string };
}

export interface Scenario {
  mode: "reactive" | "deliberative";
  request: string;
  steps?: ScenarioStep[];
  calls?: ScenarioCall[];
  /** Hechos de entorno (hoy solo `process`). */
  facts?: Record<string, string>;
  /** Aportes recuperados de memoria (`user_memory` y `thread`: `previous_request`, `previous_answer`). */
  recalled?: ScenarioRecalled;
  /** Respuestas del usuario a preguntas anteriores (`answer_<paso>_<n>`), en orden. */
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
    const sig = args === null ? null : `sig-${k}`;
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
  // Como producción (`answer_<paso>_<n>`): cada respuesta del usuario queda asociada al paso.
  (sc.userInput ?? []).forEach((text, i) => {
    ctx.apply({ op: "set", target: `facts.answer_${lastStepId}_${i + 1}`, value: { value: text, stepId: lastStepId } });
  });

  // Una clave mal escrita no puede ignorarse en silencio: el caso se mediría sin memoria y el oracle (que contesta con `expect`) no lo notaría.
  const unknownRecalled = Object.keys(sc.recalled ?? {}).filter((k) => k !== "user_memory" && k !== "thread");
  if (unknownRecalled.length > 0) throw new Error(`scenario.recalled: clave desconocida (${unknownRecalled.join(", ")}); se admiten user_memory y thread`);
  if (sc.recalled?.user_memory) {
    for (const entry of sc.recalled.user_memory) {
      ctx.apply({
        op: "add",
        target: "recalled",
        value: { stepId: null, source: "user_memory", key: entry.key, value: entry.value, from: entry.from ?? null },
      });
    }
  }
  if (sc.recalled?.thread) {
    const { previous_request, previous_answer } = sc.recalled.thread;
    if (previous_request !== undefined) {
      ctx.apply({
        op: "add",
        target: "recalled",
        value: { stepId: null, source: "thread", key: "previous_request", value: previous_request, from: null },
      });
    }
    if (previous_answer !== undefined) {
      ctx.apply({
        op: "add",
        target: "recalled",
        value: { stepId: null, source: "thread", key: "previous_answer", value: previous_answer, from: null },
      });
    }
  }

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
  precheck?: { kind: "read" | "write"; sources: PrecheckSources };
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
): { kind: "read" | "write"; sources: PrecheckSources; environment: UserEnvironment } {
  return {
    kind: getToolPolicy(serverOf(route), toolName).mutates ? "write" : "read",
    sources: collectSources(ctx),
    environment: atEnvironment ? { ...DEFAULT_ENVIRONMENT, ...atEnvironment } : DEFAULT_ENVIRONMENT,
  };
}

const scenarioHelpers: ScenarioHelpers = {
  buildContext,
  effectivePrompts,
  decision,
  generative,
  precheckBase,
  toolOf,
  need,
  config: () => ConfigManager.getConfig(),
};

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
  if (!hasStage(stage)) throw new Error(`etapa '${stage}' desconocida para un escenario.`);
  const built = getStage(stage).buildRequest(sc, variant?.prompts, scenarioHelpers);
  const params = variant?.params?.[stage as GenerativeStage];
  if (params === undefined || built.request.type !== "generative") return built;
  const defined = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  return { ...built, request: { ...built.request, ...defined } };
}