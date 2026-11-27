/**
 * Renderizador de `forPending` (8.3): el texto que recibe la consulta que mantiene la lista de pendientes del reactivo.
 * Aplica los topes de 8.2 (`options.caps`) con el marcador `…(+N)`. La vista no muestra efectos: nunca desborda.
 *
 * Secciones: REQUEST, PENDING (la lista anterior), STATE, USER, DONE (lo hecho: la instrucción del paso, la herramienta con sus `args` y el resultado) y FAIL (los
 * intentos no aprobados desde lo último que salió bien, con la razón).
 *
 * DONE y FAIL no llevan ids internos (`c1`, `s1`) ni lo que todo lo hecho tiene en común (`read ok verdict=approved`); el resultado va sin el encabezado de ejecución del comando
 * y con sus líneas (`resultText`).
 */

import type { PendingView, StepCallView } from "../ctx/index.ts";
import { clipMarked, joinSections, lastCapped, obsBlock, oneLine, resultText, stateBlock, userBlock } from "./shared.ts";
import type { ViewCaps } from "./shared.ts";

export interface PendingRenderOptions {
  readonly caps: ViewCaps;
}

/**
 * Encabezados con los que los prompts de `pending`, de Decisión 5 y de `recovery` muestran las secciones de `renderPending`. Las claves son los encabezados que emite
 * `renderPending` (`PENDING:`, `DONE:`, `FAIL:`, `USER:`); si se cambia uno allí, hay que cambiarlo acá: `tests/render.test.ts` lo comprueba.
 */
export const PENDING_PROMPT_TITLES = {
  PENDING: "### PREVIOUS TO-DO LIST (PENDING):",
  DONE: "### COMPLETED TASKS (DONE):",
  FAIL: "### FAILED TASKS (REPLACE IN PENDING):",
  USER: "### USER INSTRUCTIONS (FOLLOW):",
} as const;

/** El texto de `renderPending` con los encabezados de los prompts (`PENDING_PROMPT_TITLES`). Solo cambia la primera línea de cada sección. */
export function retitlePending(rendered: string): string {
  let out = rendered.trim();
  for (const [label, title] of Object.entries(PENDING_PROMPT_TITLES)) {
    out = out.replace(new RegExp(`^${label}:\\n`, "m"), `${title}\n`);
  }
  return out;
}

/** Cuerpo de una entrada: el resultado con sus líneas, sangrado bajo el encabezado y recortado al tope con el marcador `…(+N)`. */
function indented(text: string, max: number): string[] {
  return text === "" ? [] : clipMarked(text, max).split("\n").map((line) => `  ${line}`);
}

/** Encabezado de una entrada: `- <instrucción> → <herramienta> <args>` (las partes que no hay, se omiten). */
function entryHead(entry: StepCallView, caps: ViewCaps, argsMax: number, tail?: string): string {
  const { instruction, call } = entry;
  const parts = [
    instruction === null ? null : clipMarked(oneLine(instruction), caps.step),
    `→ ${oneLine(call.tool)}`,
    call.args === null ? null : clipMarked(oneLine(JSON.stringify(call.args)), argsMax),
    tail ?? null,
  ];
  return `- ${parts.filter((p) => p !== null).join(" ")}`;
}

/** Lo que se hizo: el encabezado y debajo el resultado. */
function doneEntry(entry: StepCallView, caps: ViewCaps): string {
  const { call } = entry;
  return [entryHead(entry, caps, caps.pendingEntry), ...indented(call.summary === null ? "" : resultText(call.summary), caps.pendingEntry)].join("\n");
}

/**
 * Lo que no salió: el encabezado con la razón entre corchetes (`rejected: not_accomplished`, `tool_error`). El resultado solo va si el estado no es `ok`: en una llamada rechazada
 * por la verificación es lo que se leyó (un listado, una salida larga), no lo que explica el fallo.
 */
function failEntry(entry: StepCallView, caps: ViewCaps): string {
  const { call } = entry;
  const why = call.verdict === "rejected" && call.status === "ok" ? `rejected${call.reason === null ? "" : `: ${call.reason}`}` : call.status;
  const body = call.status !== "ok" && call.summary !== null ? resultText(call.summary) : "";
  return [entryHead(entry, caps, caps.failureArgs, `[${why}]`), ...indented(body, caps.failureSummary)].join("\n");
}

export function renderPending(view: PendingView, options: PendingRenderOptions): string {
  const caps = options.caps;
  const previous = view.previous.map((item, i) => `${i + 1}. ${clipMarked(oneLine(item), caps.step)}`);

  const sections = [
    `REQUEST: ${clipMarked(oneLine(view.request), caps.request)}`,
    previous.length === 0 ? null : `PENDING:\n${previous.join("\n")}`,
    stateBlock(view.env, caps),
    userBlock(view.userInput, caps),
    obsBlock("DONE", lastCapped(view.done.map((d) => doneEntry(d, caps)), caps.done)),
    obsBlock("FAIL", view.attempts.map((a) => failEntry(a, caps))),
  ];
  return joinSections(sections);
}
