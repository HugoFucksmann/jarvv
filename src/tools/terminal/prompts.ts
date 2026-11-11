/**
 * `run_command`: ¿la última línea de un proceso es un prompt?
 *
 * Node no puede saber si un proceso está bloqueado leyendo su entrada (no hay PTY). Se decide por la forma de la última línea y por cuánto lleva el
 * proceso callado. Cuanto más se parece a una pregunta, menos silencio hace falta:
 * - `strong`: una elección o una tecla (`[S/N]`, `(y/n)`, `Press any key`, `Contraseña:`). Sin salto de línea, `PROMPT_IDLE_MS`; con salto de línea (hay
 *   programas que preguntan y bajan de línea), solo las elecciones y las teclas, con `TERMINATED_PROMPT_IDLE_MS`.
 * - `likely`: termina como un prompt (`:`, `?`, `>`, `]`, `)`, `#`, `$`, `=`, `»`): `Tu nombre: `, `>>> `, `Valor? `. Sin salto de línea, `PROMPT_IDLE_MS`.
 * - `weak`: cualquier otro texto sin salto de línea (`Ingrese un valor`): hace falta más silencio, `WEAK_PROMPT_IDLE_MS`.
 * - `none`: no es un prompt aunque quede quieto: vacío, demasiado largo, o un avance (`progreso...`, `45%`, `[####    ]`, un indicador giratorio).
 */

export type PromptKind = "strong" | "likely" | "weak" | "none";

/** Silencio que necesita un prompt `strong` o `likely` sin salto de línea. */
export const PROMPT_IDLE_MS = 1500;
/** Silencio que necesita una línea sin salto que no termina como un prompt. */
export const WEAK_PROMPT_IDLE_MS = 5000;
/** Silencio que necesita una elección o una tecla en una línea ya terminada. */
export const TERMINATED_PROMPT_IDLE_MS = 3000;
/** Largo máximo de la línea que se toma por prompt. */
export const PROMPT_MAX_CHARS = 300;

const CHOICE = String.raw`(?:y|n|s|a|q|yes|no|si|sí|all|todo)`;
/** Una elección (`[S/N]`, `(y/n)`, `yes/no`) o una tecla (`Press any key`, `Presione una tecla`). Vale también con salto de línea. */
const CHOICE_OR_KEY = new RegExp(
  [
    String.raw`[\[(]\s*${CHOICE}(?:\s*/\s*${CHOICE})+\s*[\])]`,
    String.raw`\b(?:y/n|s/n|yes/no|s[ií]/no)\b`,
    String.raw`\b(?:press|hit)\s+(?:any\s+key|enter|return)`,
    String.raw`\b(?:presione|presiona|pulse|pulsa|oprima)\s+(?:una\s+tecla|cualquier\s+tecla|entrar|enter|intro)`,
  ].join("|"),
  "i",
);
/** Preguntas típicas sin la forma de una elección: solo cuentan sin salto de línea. */
const ASKS = /\b(?:password|passphrase|contraseña|are you sure|est[aá]s? segur[oa]|desea continuar|do you want to|continue\?|continuar\?)/i;
/** Termina como un prompt. */
const PROMPT_END = /[:?>\]\)#$=»]\s*$/;
/** Un avance que se detuvo: no es un prompt. */
const PROGRESS_END = /(?:\.\s*\.\s*\.|…|\d+(?:[.,]\d+)?\s*%|\[[#=>\-.*\s|]*\]|[|/\\-])\s*$/;

/** Qué tan probable es que `line` sea un prompt. `terminated`: la línea ya tiene su salto (el proceso bajó de línea después de escribirla). */
export function classifyPrompt(line: string, terminated: boolean): PromptKind {
  const text = line.trim();
  if (text.length === 0 || line.length > PROMPT_MAX_CHARS) return "none";
  if (CHOICE_OR_KEY.test(text)) return "strong";
  if (terminated) return "none";
  if (ASKS.test(text)) return "strong";
  if (PROGRESS_END.test(text)) return "none";
  if (PROMPT_END.test(text)) return "likely";
  return "weak";
}

/** Silencio que necesita cada clase de prompt antes de darlo por tal; `null`: nunca. */
export function promptIdleMs(kind: PromptKind, terminated: boolean, idle: { readonly prompt: number; readonly weak: number; readonly terminated: number }): number | null {
  if (kind === "none") return null;
  if (terminated) return kind === "strong" ? idle.terminated : null;
  return kind === "weak" ? idle.weak : idle.prompt;
}
