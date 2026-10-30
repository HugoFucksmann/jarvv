/**
 * Lectura tolerante de JSON para el visor de iteraciones.
 *
 * Los crudos de los modelos no siempre son JSON limpio: Qwen puede anteponer su razonamiento (`<think>…</think>`),
 * envolver la respuesta en una cerca de código (```json) o rodearla de prosa. Esta función separa esas partes y
 * devuelve el valor estructurado cuando existe. Es pura (sin React): el estado de la vista vive en el componente.
 */

export type JsonContainer = Record<string, unknown> | unknown[];

export interface ParsedJson {
  /** Hay un objeto o arreglo JSON que mostrar como árbol. */
  parsed: boolean;
  value?: JsonContainer;
  /** Contenido de `<think>…</think>`, si el texto lo trae. */
  reasoning?: string;
  /** Texto que rodea al JSON (solo cuando `parsed`). */
  before?: string;
  after?: string;
  /** Texto restante cuando no hay JSON (sin el razonamiento). */
  plain?: string;
  /** Entrada original como texto. */
  text: string;
}

export const isContainer = (v: unknown): v is JsonContainer => typeof v === "object" && v !== null;

/** Serialización con sangría; nunca lanza (el valor ya viene de JSON, pero el visor no debe romperse por un ciclo). */
export function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Solo acepta texto que sea, completo, un objeto o arreglo JSON. Los escalares JSON ("123", "\"a\"") no cuentan. */
export function tryParseJson(text: string): JsonContainer | undefined {
  const t = text.trim();
  if (t[0] !== "{" && t[0] !== "[") return undefined;
  try {
    const v: unknown = JSON.parse(t);
    return isContainer(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

const THINK_RE = /^\s*<think>([\s\S]*?)<\/think>\s*/i;
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

const nonEmpty = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);
const join = (...parts: Array<string | undefined>): string | undefined => nonEmpty(parts.filter(Boolean).join("\n\n"));

/** JSON embebido en prosa: del primer `{`/`[` al último `}`/`]` que cierra el mismo tipo. */
function extractEmbedded(text: string): { value: JsonContainer; before: string; after: string } | undefined {
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) return undefined;
  const start = Math.min(...starts);
  const end = text.lastIndexOf(text[start] === "{" ? "}" : "]");
  if (end <= start) return undefined;
  const value = tryParseJson(text.slice(start, end + 1));
  return value ? { value, before: text.slice(0, start), after: text.slice(end + 1) } : undefined;
}

export function parseJsonLoose(input: unknown): ParsedJson {
  if (typeof input !== "string") {
    return isContainer(input)
      ? { parsed: true, value: input, text: stringifyJson(input) }
      : { parsed: false, plain: input === undefined || input === null ? undefined : String(input), text: input == null ? "" : String(input) };
  }

  const text = input;
  const direct = tryParseJson(text);
  if (direct) return { parsed: true, value: direct, text };

  let rest = text;
  let reasoning: string | undefined;
  const think = THINK_RE.exec(rest);
  if (think) {
    reasoning = nonEmpty(think[1]);
    rest = rest.slice(think[0].length);
  }

  const clean = tryParseJson(rest);
  if (clean) return { parsed: true, value: clean, reasoning, text };

  const fence = FENCE_RE.exec(rest);
  if (fence) {
    const value = tryParseJson(fence[1]);
    if (value) {
      return {
        parsed: true,
        value,
        reasoning,
        before: nonEmpty(rest.slice(0, fence.index)),
        after: nonEmpty(rest.slice(fence.index + fence[0].length)),
        text,
      };
    }
  }

  const embedded = extractEmbedded(rest);
  if (embedded) {
    return {
      parsed: true,
      value: embedded.value,
      reasoning,
      before: nonEmpty(embedded.before),
      after: nonEmpty(embedded.after),
      text,
    };
  }

  return { parsed: false, reasoning, plain: join(rest), text };
}
