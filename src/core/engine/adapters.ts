/**
 * JARVIS Core — Adaptadores entre las vistas del contexto y los consumidores del ejecutor.
 *
 * Decision #1, #2 y #3 y el verificador reciben campos ya armados: aquí se convierten los objetos estructurados de
 * `ctx.view.*` en esos campos, aplicando los topes por sección y por elemento de 8.2 (`BUDGET.caps`). Todo texto que viene
 * de fuera del contexto se sanea con `render/shared` (neutraliza `<obs>` y las etiquetas de bloque). Solo `renderArgs`
 * (argumentos) y `renderAsk` (pregunta al usuario) se usan como renderizadores.
 *
 * También reúne las opciones de las vistas y de los renderizadores, que salen de `BUDGET` y del catálogo.
 */

import { BUDGET } from "../budget.ts";
import type { ArgsViewOptions, CallView, FinalViewOptions, JsonObject, PlanViewOptions, ReviewView, ReviewViewOptions, RouteView, RouteViewOptions, VerifyView, WindowOptions } from "../ctx/index.ts";
import type { ArgsRenderOptions, AskRenderOptions, FinalRenderOptions, PlanRenderOptions } from "../render/index.ts";
import {
  callHead,
  clipMarked,
  factLine,
  failureLine,
  lastCapped,
  multiLine,
  newestWithin,
  oneLine,
  readEntry,
  refText,
  stepDoneLine,
  userInputLine,
} from "../render/shared.ts";
import { READ_ARG_KEYS } from "../tools/manifest.ts";
import type { MCPTool } from "../types.ts";
import type { ExecutableRoute } from "../types/routes.ts";
import type { DecisionFrame, ReviewCandidate, ReviewDecisionInput, RouteDecisionInput, ToolDecisionInput, VerifyDecisionInput } from "./deps.ts";

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

export function argsViewOptions(): ArgsViewOptions {
  return { ...reviewViewOptions(), readArgKeys: READ_ARG_KEYS, refs: BUDGET.caps.refs };
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

/** El paso actual en dos textos: `step` (2000) reparte su tope entre `instruction` y `expected`. */
function stepText(step: NonNullable<RouteView["step"]>): { readonly instruction: string; readonly expected: string | null } {
  const half = Math.floor(caps.step / 2);
  return {
    instruction: clipMarked(oneLine(step.instruction ?? ""), half),
    expected: step.expected === null ? null : clipMarked(oneLine(step.expected), half),
  };
}

/** El marco común de Decisión 1 y 2: la vista `forRoute` en líneas saneadas y recortadas a los topes de 8.2. */
function decisionFrame(view: RouteView): DecisionFrame {
  return {
    request: view.request === null ? null : clipMarked(oneLine(view.request), caps.request),
    step: view.step === null ? null : stepText(view.step),
    lastResult: view.lastResult === null ? null : lastResultText(view.lastResult),
    done: lastCapped(view.done.map(lineText), caps.done),
    attempts: view.attempts.map((c) => ({ route: c.route, tool: c.tool, failed: c.failed, text: lineText(c) })),
    userInput: newestWithin(view.userInput.map(userInputLine), caps.userInput),
    env: newestWithin(view.env.map(factLine), caps.env),
  };
}

export interface RouteChoiceFlags {
  /** Rutas con alguna herramienta usable. */
  readonly routes: readonly ExecutableRoute[];
  readonly allowFin: boolean;
  readonly allowAsk: boolean;
}

export function routeInput(view: RouteView, flags: RouteChoiceFlags): RouteDecisionInput {
  return { ...decisionFrame(view), ...flags };
}

/** `view` es `forRoute` con `route`: los intentos ya están filtrados a la ruta elegida. */
export function toolInput(view: RouteView, route: ExecutableRoute, tools: MCPTool[], allowAsk: boolean): ToolDecisionInput {
  return { ...decisionFrame(view), route, tools, allowAsk };
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
  return { route, tool: tool.name, description, args: clipMarked(oneLine(JSON.stringify(args)), room) };
}

/** `args`: los registrados (refs sin resolver, strings recortados): lo que ve el modelo y queda en el contexto. */
export function reviewInput(view: ReviewView, route: ExecutableRoute, tool: MCPTool, args: JsonObject): ReviewDecisionInput {
  return {
    candidate: candidateOf(route, tool, args),
    request: view.request === null ? null : clipMarked(oneLine(view.request), caps.request),
    step: view.step === null ? null : stepText(view.step),
    stepsDone: lastCapped(view.stepsDone.map((s) => stepDoneLine(s, caps)), caps.stepsDone),
    done: lastCapped(view.done.map(lineText), caps.done),
    lastReads: view.lastReads.map((c) => readEntry(c, caps)),
    stepFailures: view.stepFailures.map((c) => failureLine(c, caps)),
    userInput: newestWithin(view.userInput.map(userInputLine), caps.userInput),
    env: newestWithin(view.env.map(factLine), caps.env),
  };
}

// ───────────────────────── Decision #4 ─────────────────────────

/** La llamada evaluada: cabecera, `args` (≤ `evaluatedArgs`), resumen completo y marca de ref. */
function evaluatedEntry(call: CallView): string {
  const lines = [clipMarked(callHead(call), caps.line)];
  if (call.args !== null) lines.push(`args=${clipMarked(oneLine(JSON.stringify(call.args)), caps.evaluatedArgs)}`);
  if (call.summary !== null) lines.push(clipMarked(multiLine(call.summary), caps.readSummary));
  if (call.ref !== null) lines.push(clipMarked(refText(call.ref), caps.refMark));
  return lines.join("\n");
}

export function verifyInput(view: VerifyView): VerifyDecisionInput {
  const criterion = view.criterion;
  const half = Math.floor(caps.step / 2);
  return {
    criterion:
      criterion.source === "request"
        ? { source: "request", text: clipMarked(oneLine(criterion.text), caps.request) }
        : {
          source: "step",
          instruction: clipMarked(oneLine(criterion.instruction ?? ""), half),
          expected: criterion.expected === null ? null : clipMarked(oneLine(criterion.expected), half),
        },
    call: evaluatedEntry(view.call),
    done: lastCapped(view.done.map(lineText), caps.done),
    userInput: newestWithin(view.userInput.map(userInputLine), caps.userInput),
  };
}