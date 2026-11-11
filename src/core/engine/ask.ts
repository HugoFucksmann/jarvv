/**
 * JARVIS Core — Pregunta al usuario (`ask_user`, Fase 5).
 *
 * Cuando la revisión de argumentos da `info_missing` o el paso llegaría al tope de llamadas, `runStep` llama a `askUser`:
 *
 * 1. Se genera el texto de la pregunta con el LLM a partir de `forAsk` (`generateQuestion`). Una salida inválida ya se
 *    reintentó una vez dentro de Qwen; si persiste, o el servicio cae, `service_unavailable` (D29). Sin texto de reserva.
 * 2. Se espera la respuesta en el `TaskRuntime` (la espera no vive en el contexto, 5.3). La cancelación resuelve la espera.
 * 3. Se escribe el hecho `answer_<stepId>_<n>` = `pregunta -> respuesta` (n = número de la pregunta en el paso; la de un proceso lleva además `_p<pid>`), recortado
 *    al tope de un hecho con `clipWithin` (D23). Si se recortó, el texto completo va al almacén y a `refs` en el mismo
 *    `apply` (D13). Un fallo del almacén conserva el hecho recortado, registra `service_unavailable` y cierra la tarea (D7).
 *
 * Un proceso que espera entrada (`waiting_input`) usa el mismo mecanismo con la pregunta ya armada por el código (`processQuestion`): el usuario ve
 * exactamente lo que el proceso pide, sin paráfrasis ni una llamada al modelo.
 *
 * No se registra ninguna llamada. Topes por paso: `BUDGET.maxQuestionsPerStep` para las preguntas del modelo (`canAskUser`) y
 * `BUDGET.maxProcessPromptsPerStep` para las de procesos (`canAskProcessPrompt`); se distinguen por la clave del hecho (`answer_<paso>_<n>_p<pid>`).
 */

import { BUDGET } from "../budget.ts";
import { clipAtWord, flatten } from "../text.ts";
import type { Op } from "../ctx/index.ts";
import { RefVaultError } from "../refs/refVault.ts";
import { renderAsk } from "../render/index.ts";
import { askRenderOptions } from "./adapters.ts";
import { clipWithin, withLineCount } from "./args.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";

export type AskOutcome =
  | { readonly kind: "answered" }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

const UNRECOVERABLE: AskOutcome = { kind: "close", stopReason: "unrecoverable" };

/** Tope de caracteres del prompt del proceso dentro de la pregunta. */
const PROMPT_MAX = 200;

/** Cierre fijo de la pregunta de un proceso; en el hecho `answer_*` lo sigue ` -> <respuesta>`. */
const PROCESS_ANSWER_SEPARATOR = "¿Qué debo responder? -> ";

/** La pregunta al usuario cuando un proceso espera entrada: el prompt detectado, en una línea y recortado. */
export function processQuestion(prompt: string): string {
  return `El proceso está esperando una entrada: "${clipAtWord(flatten(prompt), PROMPT_MAX)}". ¿Qué debo responder?`;
}

/**
 * Sufijo de la clave del hecho de la respuesta a un proceso (`answer_<paso>_<n>_p<pid>`): ata la respuesta al proceso que preguntó sin cambiar lo que leen
 * los modelos (las vistas muestran el texto de la respuesta, nunca la clave). Medido: poner el `pid` en el texto de la pregunta bajaba la verificación (D4).
 */
export const processAnswerSuffix = (pid: string): string => `p${pid}`;
const PROCESS_ANSWER_KEY = /_p(\d+)$/;

/** El proceso al que respondió un hecho `answer_*`, por su clave; `null` si fue la respuesta a otra pregunta. */
export function processOfAnswerKey(key: string): string | null {
  return PROCESS_ANSWER_KEY.exec(key)?.[1] ?? null;
}

/**
 * La respuesta del usuario dentro del valor de un hecho `answer_*` de un proceso (`pregunta -> respuesta`), o `null` si el hecho pudo recortarse y la
 * respuesta ya no es segura. Es lo que sigue a la ÚLTIMA aparición del cierre: el prompt lo escribió el proceso y podría imitarlo; la respuesta va al final.
 */
export function processAnswerText(value: string): string | null {
  if (value.length >= BUDGET.factValueMax) return null;
  const at = value.lastIndexOf(PROCESS_ANSWER_SEPARATOR);
  return at < 0 ? null : value.slice(at + PROCESS_ANSWER_SEPARATOR.length);
}

/**
 * `literalQuestion`: texto ya armado por el código; sin él, el LLM redacta la pregunta a partir de `forAsk`. `keySuffix`: se agrega a la clave del hecho de la
 * respuesta (`answer_<paso>_<n>_<sufijo>`), para quien necesite saber después a qué respondió (`processAnswerSuffix`).
 */
export async function askUser(env: EngineEnv, stepId: string, literalQuestion?: string, keySuffix?: string): Promise<AskOutcome> {
  const { ctx, runtime, deps } = env;

  let question: string;
  if (literalQuestion !== undefined) {
    question = literalQuestion;
  } else {
    // `forAsk` no muestra efectos: no desborda.
    const view = renderAsk(ctx.view.forAsk(), askRenderOptions());

    // El LLM ya reintentó una vez una salida inválida (Qwen): aquí no se repite (D29).
    const generated = await queryModel(() => env.llm.generateQuestion({ view }, runtime.signal), 0);
    if (!generated.ok) {
      const closure = closeOnFailure(ctx, stepId, generated.failure, generated.error);
      return closure.kind === "cancelled" ? { kind: "cancelled" } : UNRECOVERABLE;
    }
    if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
    question = generated.value.question;
  }
  const outcome = await runtime.askUser({ stepId, question });
  if (outcome.kind === "cancelled" || runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };

  const full = `${question} -> ${outcome.answer}`;
  const value = clipWithin(full, BUDGET.factValueMax);
  const key = keySuffix === undefined ? ctx.nextAnswerKey(stepId) : `${ctx.nextAnswerKey(stepId)}_${keySuffix}`;
  const setFact: Op = { op: "set", target: `facts.${key}`, value: { value, stepId } };

  if (value === full) {
    ctx.apply(setFact);
    return { kind: "answered" };
  }

  // Recortado: el texto completo va a disco y a `refs`; si el almacén falla se conserva el hecho recortado (D7).
  try {
    const stored = await deps.vault.put(ctx.task.id, full);
    if (ctx.isClosed()) return { kind: "cancelled" };
    ctx.apply([
      { op: "add", target: "refs", value: { stepId, label: withLineCount(key, full), size: stored.size, where: stored.where } },
      setFact,
    ]);
    return { kind: "answered" };
  } catch (error) {
    if (!(error instanceof RefVaultError)) throw error;
    console.error(`[Engine] no se pudo guardar la respuesta completa del usuario: ${error.message}`);
    if (ctx.isClosed()) return { kind: "cancelled" };
    ctx.apply([setFact, { op: "add", target: "errors", value: { stepId, kind: "service_unavailable" } }]);
    return UNRECOVERABLE;
  }
}