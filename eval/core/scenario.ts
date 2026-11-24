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
import {
  argsMax,
  BASE_TEMPERATURE,
  BUDGET,
  applyDestination,
  collectSources,
  ConfigManager,
  create,
  DECISION_PROMPTS,
  getToolPolicy,
  precheckCall,
  PROMPTS,
  serverOf,
  SYSTEM_TOOL_MANIFEST,
} from "./contract.ts";
import type {
  CommandAnalyzer,
  ExecutableRoute,
  MCPTool,
  PrecheckFinding,
  PrecheckSources,
  PromptSet,
  StageRequest,
  TaskContext,
  ToolInputSchema,
  UserEnvironment,
  VariantPrompts,
} from "./contract.ts";
import { getStage, hasStage } from "./stages/index.ts";
import type {
  Materialized,
  Scenario,
  ScenarioAt,
  ScenarioHelpers,
  ScenarioStep,
} from "./stages/types.ts";
import type { DecisionRequest, GenerativeRequest, Variant } from "./types.ts";
import { inheritedOptions, withTaggedProd } from "./variants/inherited.ts";
import { decisionStructureDiff } from "./variants/structure.ts";

export type {
  Materialized,
  Scenario,
  ScenarioAt,
  ScenarioCall,
  ScenarioRecalled,
  ScenarioStep,
} from "./stages/types.ts";

/**
 * Lo que, además de `src/`, cambia los prompts de los casos por escenario: la fecha (`TODAY`) y la configuración que fija
 * tokens y thinking por etapa. Va en `meta.json` para explicar por qué cambió un `requestHash` entre corridas.
 */
export function promptEnvironment(): { date: string; stageConfigHash: string } {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, "0");
  const { qwenMaxTokens, thinking, reviewFullView, blacklist, qwenNumCtx, decisionMaxContext } = ConfigManager.getConfig();
  const stageConfig = JSON.stringify({ qwenMaxTokens, thinking, qwenNumCtx, decisionMaxContext, reviewFullView, blacklist, askMaxTokens: BUDGET.ask.maxTokens, pendingMaxTokens: BUDGET.pending.maxTokens });
  return {
    date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`,
    stageConfigHash: createHash("sha256").update(stageConfig).digest("hex").slice(0, 16),
  };
}

// ───────────────────────── Entorno por defecto ─────────────────────────

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
  const addOne = (op: Parameters<TaskContext["apply"]>[0]): string => ctx.apply(op).ids[0];

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
    for (const s of stepSpecs) addStep(s);
    for (let k = 0; k < callSpecs.length; k++) addCall(k);
    for (let i = 0; i < stepSpecs.length; i++) settle(i);
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

/**
 * La herramienta tal como producción se la muestra al modelo: descripción del manifest, schema del escenario (el del servidor no es estático)
 * recortado a los `params` del manifest (los que el caso no declara se agregan sin tipo), con sus notas de formato como descripciones y sin
 * parámetros extra (`applyDestination`).
 * Un caso que declare parámetros que producción no ofrece es un caso mal armado.
 */
function toolOf(route: ExecutableRoute, name: string, inputSchema?: ToolInputSchema): MCPTool {
  const def = SYSTEM_TOOL_MANIFEST.find((d) => d.name === name && d.route === route);
  if (!def) throw new Error(`la herramienta '${name}' no está en el manifest de la ruta '${route}'.`);
  const base = { name, description: def.description, inputSchema: inputSchema ?? { type: "object", properties: {} } } as MCPTool;
  const offered = def.params;
  const extra = offered ? Object.keys(base.inputSchema.properties ?? {}).filter((k) => !offered.includes(k)) : [];
  if (offered && extra.length > 0) {
    throw new Error(`'${name}': el schema del caso declara parámetros que producción no ofrece al modelo (${extra.join(", ")}); los ofrecidos son: ${offered.join(", ")}.`);
  }
  // Producción ofrece todos los `params` del manifest; un caso puede declarar solo los que usa, así que los demás se agregan sin tipo.
  const properties: Record<string, unknown> = { ...(base.inputSchema.properties ?? {}) };
  for (const param of def.params ?? []) if (!(param in properties)) properties[param] = {};
  return applyDestination(route, [{ ...base, inputSchema: { ...base.inputSchema, properties } } as MCPTool])[0] ?? base;
}

function need<T>(value: T | undefined, what: string, stage: string): T {
  if (value === undefined) throw new Error(`etapa '${stage}': falta scenario.at.${what}.`);
  return value;
}

// ───────────────────────── Armado por etapa ─────────────────────────

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
 * Arma el `request` de una etapa a partir del escenario, con los prompts de producción o los de la variante.
 * Lanza `Error` con el motivo si el escenario no sirve.
 */
export function materializeScenario(stage: string, sc: Scenario, variant?: Variant): Materialized {
  if (!hasStage(stage)) throw new Error(`etapa '${stage}' desconocida para un escenario.`);
  checkAtKeys(sc.at);
  const entry = getStage(stage);
  const built = entry.buildRequest(sc, variant?.prompts, scenarioHelpers);
  // Una variante `prompt` solo cambia textos: las preguntas y opciones son las de producción para este mismo escenario.
  if (variant?.mode === "prompt" && variant.prompts?.DECISION_PROMPTS !== undefined && built.request.type === "decision") {
    const base = entry.buildRequest(sc, undefined, scenarioHelpers).request as DecisionRequest;
    const diffs = decisionStructureDiff(base, built.request);
    if (diffs.length > 0) {
      throw new Error(
        `la variante '${variant.name}' es mode "prompt" pero cambia la estructura de la decisión (${diffs.join("; ")}). ` +
        `Con mode "prompt" solo se cambian textos; para probar otras preguntas u opciones, declarala mode "structure".`,
      );
    }
    // Completitud: si la variante cambia esta etapa, escribe el texto de TODAS sus opciones. Se arma el request otra vez con los textos de
    // producción marcados; una opción que conserva la marca la heredó de `src` (la variante no la escribió).
    if (JSON.stringify(built.request) !== JSON.stringify(base)) {
      const tagged = withTaggedProd(() => entry.buildRequest(sc, variant.prompts, scenarioHelpers).request as DecisionRequest);
      const inherited = inheritedOptions(tagged);
      if (inherited.length > 0) {
        throw new Error(
          `la variante '${variant.name}' está incompleta: ${inherited.length === 1 ? "la opción" : "las opciones"} ${inherited.join(", ")} ${inherited.length === 1 ? "sale" : "salen"} del texto de producción. ` +
          `Una variante escribe el texto de todas las opciones de todas las preguntas de la etapa, aunque coincida con el de producción.`,
        );
      }
    }
  }
  return built;
}

/** Claves de `scenario.at`: todas las que alguna etapa lee. Una desconocida es un typo y se informa en vez de ignorarla. */
const AT_KEYS: Record<keyof ScenarioAt, true> = {
  route: true, tool: true, inputSchema: true, args: true, call: true, lastItem: true, feedback: true, previous: true,
  cause: true, attempts: true, need: true, fragments: true, environment: true, priorAttempts: true,
};

function checkAtKeys(at: ScenarioAt | undefined): void {
  for (const key of Object.keys(at ?? {})) {
    if (key === "routes" || key === "tools") {
      throw new Error(`at.${key} ya no existe: las opciones de route y de tool_choice son las del backend (todas las rutas; todas las herramientas de la ruta).`);
    }
    if (!(key in AT_KEYS)) throw new Error(`clave desconocida 'at.${key}' (válidas: ${Object.keys(AT_KEYS).join(", ")}).`);
  }
}