/**
 * JARVIS Core — Topes y preguntas del bucle de paso (Fase 5).
 *
 * Sin estado propio (D5): todo se deriva de `calls` y `facts`. Los topes (qué se cuenta y contra qué número) están en `limits.ts`;
 * aquí quedan las decisiones que dependen de lo ya ocurrido en el paso (si se puede preguntar, si lo repetido ya estaba aprobado).
 */

import { BUDGET } from "../budget.ts";
import { isExecuted, type TaskContext } from "../ctx/index.ts";
import { processAnswerText, processOfAnswerKey } from "./ask.ts";

/**
 * ¿La llamada bloqueada por repetición repetía una llamada idéntica que la verificación ya aprobó? Entonces lo pedido ya está
 * hecho (el modelo volvió a pedir lo mismo, p. ej. tras reescribir el ítem): el paso se da por cumplido en vez de fallar.
 */
export function repeatsApprovedCall(ctx: TaskContext, callId: string): boolean {
  const calls = ctx.find("calls", {});
  const at = calls.findIndex((c) => c.id === callId);
  if (at < 0) return false;
  const blocked = calls[at];
  for (let i = at - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.tool === blocked.tool && c.sig === blocked.sig && c.sig !== null && isExecuted(c)) return c.verdict === "approved";
  }
  return false;
}

/** Valor de un hecho, o `null` si no existe o está retirado. */
export function factValue(ctx: TaskContext, key: string): string | null {
  const element = ctx.get(`facts.${key}`);
  return element !== undefined && "value" in element ? element.value : null;
}

/** Las respuestas del usuario en el paso a preguntas de procesos: el proceso (de la clave del hecho) y el valor. */
function processAnswers(ctx: TaskContext, stepId: string): { readonly pid: string; readonly value: string | null }[] {
  const out: { pid: string; value: string | null }[] = [];
  for (const answer of ctx.answers(stepId)) {
    const pid = processOfAnswerKey(answer.key);
    if (pid !== null) out.push({ pid, value: answer.value });
  }
  return out;
}

/** Preguntas de procesos (`waiting_input`) ya hechas en el paso. */
export function processPromptsAsked(ctx: TaskContext, stepId: string): number {
  return processAnswers(ctx, stepId).length;
}

/**
 * ¿Se puede preguntar al usuario en este paso? Preguntas del modelo (`info_missing`, antes de agotar el paso): `BUDGET.maxQuestionsPerStep`. Las de
 * procesos tienen su propio tope (`canAskProcessPrompt`) y no gastan este.
 */
export function canAskUser(ctx: TaskContext, stepId: string): boolean {
  return ctx.questionsAsked(stepId) - processPromptsAsked(ctx, stepId) < BUDGET.maxQuestionsPerStep;
}

/** ¿Se le puede preguntar al usuario lo que pide un proceso? Hasta `BUDGET.maxProcessPromptsPerStep` por paso (un instalador que pregunta dos veces). */
export function canAskProcessPrompt(ctx: TaskContext, stepId: string): boolean {
  return processPromptsAsked(ctx, stepId) < BUDGET.maxProcessPromptsPerStep;
}

/**
 * ¿El `input` de esta continuación es exactamente lo que el usuario respondió a la pregunta de ESE proceso en este paso, y esa respuesta todavía no se
 * envió? Entonces el texto lo escribió el usuario para ese proceso: pedirle además que apruebe el envío es preguntarle dos veces lo mismo (RC-20). Cada
 * respuesta autoriza un envío: un segundo envío del mismo texto, sin una respuesta nueva, se confirma como cualquier escritura. `recordedInput` es el
 * `input` tal como queda registrado (recortado), para contar los envíos ya hechos.
 */
export function inputAnswersProcess(ctx: TaskContext, stepId: string, tool: string, args: Readonly<Record<string, unknown>>, recordedInput: unknown): boolean {
  if (typeof args.pid !== "number" || typeof args.input !== "string" || args.command !== undefined) return false;
  const pid = String(args.pid);
  const input = args.input;
  const answered = processAnswers(ctx, stepId).filter((a) => a.pid === pid && a.value !== null && processAnswerText(a.value) === input).length;
  if (answered === 0) return false;
  const sent = ctx
    .find("calls", { stepId, tool })
    .filter((c) => isExecuted(c) && c.args !== null && String(c.args.pid) === pid && c.args.input === recordedInput && c.args.command === undefined).length;
  return sent < answered;
}