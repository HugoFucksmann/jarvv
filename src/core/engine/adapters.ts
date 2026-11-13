/**
 * JARVIS Core — Adaptadores entre las vistas del contexto y los consumidores del ejecutor.
 *
 * Decision #1, #2 y #3 y el verificador reciben campos ya armados: aquí se convierten los objetos estructurados de
 * `ctx.view.*` en esos campos, aplicando los topes por sección y por elemento de 8.2 (`BUDGET.caps`). Todo texto que viene
 * de fuera del contexto se sanea con `render/shared` (neutraliza `<obs>` y las etiquetas de bloque). Solo `renderArgs`
 * (argumentos), `renderAsk` (pregunta al usuario), `renderPending` (lista de pendientes) y `renderPlan` (plan) se usan como renderizadores.
 *
 * También reúne las opciones de las vistas y de los renderizadores, que salen de `BUDGET` y del catálogo.
 */

import { BUDGET } from "../budget.ts";
import type { ArgsViewOptions, CallView, CriterionView, FinalViewOptions, JsonObject, PlanViewOptions, ReviewView, ReviewViewOptions, RouteView, RouteViewOptions, TaskContext, VerifyView, WindowOptions } from "../ctx/index.ts";
import { renderArgs, renderPending, renderPlan } from "../render/index.ts";
import type { ArgsRenderOptions, AskRenderOptions, FinalRenderOptions, PlanRenderOptions, Rendered } from "../render/index.ts";
import {
  argsText,
  callHead,
  clipMarked,
  failureLine,
  lastCapped,
  oneLine,
  readEntry,
  refText,
  stateLines,
  stepDoneLine,
  userLines,
} from "../render/shared.ts";
import { READ_ARG_KEYS } from "../tools/manifest.ts";
import type { MCPTool } from "../types.ts";
import { cleanInputSchema } from "../utils.ts";
import type { ExecutableRoute } from "../types/routes.ts";
import type { ArgsFromViewInput, CompletionDecisionInput, DecisionFrame, PendingFromViewInput, PlanFromViewInput, ReviewCandidate, ReviewDecisionInput, RouteDecisionInput, ToolDecisionInput, VerifyDecisionInput } from "../contracts.ts";

// ───────────────────────── Opciones de vistas y renderizadores ─────────────────────────

export function windowOptions(): WindowOptions {
  return { recentWindows: BUDGET.recentWindows };
}

/** Decisión 1 sin `route`; Decisión 2 con la ruta elegida (los intentos se filtran a ella). */
export function routeViewOptions(route?: ExecutableRoute): RouteViewOptions {
  return route === undefined ? windowOptions() : { ...windowOptions(), route };
}

export function reviewViewOptions(): ReviewViewOptions {
  return { recentWindows: BUDGET.recentWindows, lastReads: BUDGET.caps.lastReads };
}

export function argsViewOptions(tool?: string): ArgsViewOptions {
  return { ...reviewViewOptions(), readArgKeys: READ_ARG_KEYS, refs: BUDGET.caps.refs, tool };
}

export function argsRenderOptions(): ArgsRenderOptions {
  return { caps: BUDGET.caps };
}

export function askRenderOptions(): AskRenderOptions {
  return { caps: BUDGET.caps };
}

/** `feedback`: el del plan en curso (PARAM de `forPlan`), ya recortado a `BUDGET.feedbackMax`; `null` si no es `user_feedback`. */
export function planViewOptions(feedback: string | null): PlanViewOptions {
  return { ...windowOptions(), feedback, previousFeedback: BUDGET.caps.previousFeedback, stepsDone: BUDGET.caps.stepsDone };
}

export function planRenderOptions(): PlanRenderOptions {
  return { caps: BUDGET.caps, feedbackMax: BUDGET.feedbackMax };
}

export function finalViewOptions(): FinalViewOptions {
  return { lastReads: BUDGET.caps.lastReads, evidence: BUDGET.caps.evidence, steps: BUDGET.caps.stepsDone };
}

export function finalRenderOptions(): FinalRenderOptions {
  return { caps: BUDGET.caps };
}

/** Entrada de la lista de pendientes desde `forPending`: el texto de la vista con la lista anterior. */
export function pendingInput(ctx: TaskContext, previous: readonly string[]): PendingFromViewInput {
  return { view: renderPending(ctx.view.forPending(previous, windowOptions()), { caps: BUDGET.caps }) };
}

/**
 * Entrada de Decisión 5 (cierre): la vista de `forPending` con la lista vacía, o sea lo mismo que ve el LLM al confirmar que no falta nada
 * (REQUEST, STATE, USER, DONE completo, FAIL).
 */
export function completionInput(ctx: TaskContext): CompletionDecisionInput {
  return pendingInput(ctx, []);
}

// ───────────────────────── LLM 1 (plan) y argumentos ─────────────────────────

/**
 * Entrada de LLM 1 desde `forPlan`: el texto de la vista (puede lanzar `ContextOverflowError` si los efectos no caben), el
 * motivo del plan y el tope de pasos (`BUDGET.maxSteps` menos los `completed` vigentes, FLUJO 3). `trigger`: el que decide
 * quien llama; si se omite, el que deriva el contexto.
 */
export function planInput(ctx: TaskContext, feedback: string | null, trigger?: PlanFromViewInput["trigger"]): PlanFromViewInput {
  const view = ctx.view.forPlan(planViewOptions(feedback));
  const text = renderPlan(view, planRenderOptions()).text;
  const completed = ctx.find("steps", { state: "completed", superseded: false }).length;
  return { view: text, trigger: trigger ?? view.trigger.kind, maxSteps: BUDGET.maxSteps - completed };
}

/** La vista `forArgs` ya renderizada; `overflow` indica que los efectos no caben en su reserva (el motor cierra la tarea). */
export function renderArgsView(ctx: TaskContext, tool?: string): Rendered {
  return renderArgs(ctx.view.forArgs(argsViewOptions(tool)), argsRenderOptions());
}

/** Entrada de la generación de argumentos: la herramienta, su schema limpio, las rutas del usuario y el texto de la vista. */
export function argsInput(tool: MCPTool, environment: ArgsFromViewInput["environment"], view: string, priorAttempts = 0): ArgsFromViewInput {
  return { tool, cleanedSchema: cleanInputSchema(tool.inputSchema), environment, view, priorAttempts };
}

// ───────────────────────── Decision #1 y #2 ─────────────────────────

const caps = BUDGET.caps;

/** Línea de llamada `L`, recortada a su tope. */
const lineText = (call: CallView): string => clipMarked(callHead(call), caps.line);

/** Último resultado: `L` + resumen (≤ `lastResultSummary`) + marca de ref (≤ `refMark`), en una línea. */
function lastResultText(call: CallView): string {
  const parts = [lineText(call)];
  if (call.summary !== null) parts.push(`| ${clipMarked(oneLine(call.summary), caps.lastResultSummary)}`);
  if (call.ref !== null) parts.push(clipMarked(refText(call.ref), caps.refMark));
  return parts.join(" ");
}

/** Estados cuyo resumen explica el fallo (el mensaje de la herramienta o del código); en el resto es el dato leído y no aporta a elegir ruta o herramienta. */
const ATTEMPT_SUMMARY_STATUSES: readonly CallView["status"][] = ["tool_error", "exception", "args_invalid", "info_missing", "tool_rejected", "user_rejected"];

/**
 * Intento no aprobado (Decisión 1 y 2): la línea `L` y, solo si el resumen explica el fallo, ese resumen recortado a `attemptSummary`.
 * Una llamada ejecutada que la verificación rechazó ya dice por qué en la línea (`reasonNote`): su resumen es el resultado leído
 * (un listado, una salida larga) y no se repite acá.
 */
function attemptText(call: CallView): string {
  const parts = [lineText(call)];
  if (call.summary !== null && ATTEMPT_SUMMARY_STATUSES.includes(call.status)) parts.push(`| ${clipMarked(oneLine(call.summary), caps.attemptSummary)}`);
  return parts.join(" ");
}

/** El paso actual (o el criterio de la verificación) en dos textos: `step` (2000) reparte su tope entre `instruction` y `expected`. */
function stepText(step: CriterionView): { readonly instruction: string; readonly expected: string | null } {
  const half = Math.floor(caps.step / 2);
  return {
    instruction: clipMarked(oneLine(step.instruction ?? ""), half),
    expected: step.expected === null ? null : clipMarked(oneLine(step.expected), half),
  };
}

/** El marco común de Decisión 1 y 2: la vista `forRoute` en líneas saneadas y recortadas a los topes de 8.2. */
function decisionFrame(view: RouteView): DecisionFrame {
  return {
    step: view.step === null ? null : stepText(view.step),
    lastResult: view.lastResult === null ? null : lastResultText(view.lastResult),
    done: lastCapped(view.done.map(lineText), caps.done),
    // Un rechazo del usuario no es un fallo de la ruta ni de la herramienta: no se marca como tal (el texto ya lo dice).
    attempts: view.attempts.map((c) => ({ route: c.route, tool: c.tool, failed: c.failed && c.status !== "user_rejected", text: attemptText(c) })),
    userInput: userLines(view.userInput, caps),
    env: stateLines(view.env, caps),
  };
}

export interface RouteChoiceFlags {
  /** Rutas con alguna herramienta usable. */
  readonly routes: readonly ExecutableRoute[];
}

export function routeInput(view: RouteView, flags: RouteChoiceFlags): RouteDecisionInput {
  const request = view.request === null ? null : clipMarked(oneLine(view.request), caps.routeRequest);
  return { ...decisionFrame(view), request, ...flags };
}

/** `view` es `forRoute` con `route`: los intentos ya están filtrados a la ruta elegida. */
export function toolInput(view: RouteView, route: ExecutableRoute, tools: MCPTool[]): ToolDecisionInput {
  return { ...decisionFrame(view), route, tools };
}

// ───────────────────────── Decision #3 ─────────────────────────

/**
 * La llamada candidata (8.3, parámetro de `forReview`, ≤ `caps.candidate`): ruta, herramienta, descripción del catálogo y
 * `args` tal como los propuso el modelo. La descripción toma a lo sumo un cuarto del tope; los `args` el resto.
 */
function candidateOf(route: ExecutableRoute, tool: MCPTool, args: JsonObject): ReviewCandidate {
  const name = `${route}/${tool.name}`;
  const description = clipMarked(oneLine(tool.description ?? ""), Math.floor(caps.candidate / 4));
  const room = Math.max(0, caps.candidate - name.length - description.length);
  const schema = clipMarked(oneLine(JSON.stringify(cleanInputSchema(tool.inputSchema))), caps.candidateSchema);
  return { route, tool: tool.name, description, schema, args: argsText(args, room) };
}

/** `args`: los registrados (refs sin resolver, strings recortados): lo que ve el modelo y queda en el contexto. */
export function reviewInput(view: ReviewView, route: ExecutableRoute, tool: MCPTool, args: JsonObject): ReviewDecisionInput {
  return {
    candidate: candidateOf(route, tool, args),
    step: view.step === null ? null : stepText(view.step),
    stepsDone: lastCapped(view.stepsDone.map((s) => stepDoneLine(s, caps)), caps.stepsDone),
    done: lastCapped(view.done.map(lineText), caps.done),
    lastReads: view.lastReads.map((c) => readEntry(c, caps)),
    stepFailures: view.stepFailures.map((c) => failureLine(c, caps)),
    userInput: userLines(view.userInput, caps),
    env: stateLines(view.env, caps),
  };
}

// ───────────────────────── Decision #4 ─────────────────────────

/** La llamada evaluada: como una lectura, con más espacio para los `args` (`evaluatedArgs`). */
const evaluatedEntry = (call: CallView): string => readEntry(call, caps, caps.evaluatedArgs);

export function verifyInput(view: VerifyView): VerifyDecisionInput {
  return {
    criterion: stepText(view.criterion),
    call: evaluatedEntry(view.call),
    done: lastCapped(view.done.map(lineText), caps.done),
    userInput: userLines(view.userInput, caps),
    recent: view.previous.slice(-caps.lastReads).map(evaluatedEntry),
  };
}