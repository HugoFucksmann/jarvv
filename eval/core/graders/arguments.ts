/**
 * eval/core/graders/arguments.ts
 *
 * Graders para la etapa ARGUMENTS.
 */

import { MAY_BE_EMPTY } from "../contract.ts";
import type { ArgumentsExpect, ArgumentsOutput, Grader } from "../types.ts";

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const body = Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}

/** Todos los strings que son VALORES de un valor JSON, sin escapar (las claves no cuentan). */
export function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") {
    for (const x of Object.values(v as Record<string, unknown>)) collectStrings(x, out);
  }
  return out;
}

/** Rutas y valores se comparan sin distinguir mayúsculas ni `\` / `/` (Windows). */
function normValue(s: string): string {
  return s.replace(/\\/g, "/").toLowerCase();
}

/** Una ruta absoluta (`C:/…`, `C:\\…`, `\\\\servidor\\…`, `/…`, `~/…`): en Windows `/` y `\\` y las mayúsculas no cambian a qué apunta. */
const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/;

/**
 * Igualdad de un valor generado con el esperado: exacta, salvo en rutas absolutas, donde se ignoran `/` frente a `\\` y mayúsculas
 * (producción las trata igual). Los demás textos (contenido, patrones, comandos) se comparan tal cual.
 */
export function sameArgValue(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "string" && typeof actual === "string" && ABSOLUTE_PATH_RE.test(expected)) return normValue(actual) === normValue(expected);
  if (Array.isArray(expected) && Array.isArray(actual)) return expected.length === actual.length && expected.every((e, i) => sameArgValue(actual[i], e));
  return stableStringify(actual) === stableStringify(expected);
}

export const ArgumentsGrader: Grader<ArgumentsOutput, ArgumentsExpect> = {
  name: "arguments",
  grade(output, expect, _ctx, col) {
    if (!output || typeof output.args !== "object" || output.args === null || Array.isArray(output.args)) {
      col.check("valid_args_object", false, "Salida no es un objeto JSON de argumentos válido.");
      return;
    }

    const args = output.args;

    if (expect.requiredFields && expect.requiredFields.length > 0) {
      // Un string vacío o en blanco no cuenta como presente (salvo en las claves que pueden ir vacías a propósito, como `content`).
      const blank = (k: string): boolean => typeof args[k] === "string" && (args[k] as string).trim() === "" && !MAY_BE_EMPTY.has(k.toLowerCase());
      const missing = expect.requiredFields.filter((k) => args[k] === undefined || args[k] === null || blank(k));
      col.check(
        "required_fields_present",
        missing.length === 0,
        `Campos requeridos ausentes: ${missing.join(", ")}`,
      );
    }

    if (expect.exactFieldValues) {
      for (const [key, expectedVal] of Object.entries(expect.exactFieldValues)) {
        const actualVal = args[key];
        col.check(
          `field_${key}_match`,
          sameArgValue(actualVal, expectedVal),
          `Valor para '${key}' (${stableStringify(actualVal)}) no coincide con el esperado (${stableStringify(expectedVal)}).`,
        );
      }
    }

    const allStrings = collectStrings(args);

    // Ojo: a diferencia de `containsTerm` (plan, final, question, pending), aquí la coincidencia es por SUBCADENA sobre el valor
    // normalizado (minúsculas, `\` → `/`): sin límite de palabra, sin quitar acentos y sin alternativas con `|`. Un valor prohibido
    // `12` aparece prohibido dentro de `120`. Es deliberado: son rutas, URLs o comandos, no palabras.
    // Se busca en los strings reales, no en JSON.stringify (que escapa `\` y `"`: una ruta
    // `C:\Users\x` nunca coincidía). La clave lleva índice para evitar colisiones.
    (expect.forbiddenHardcodedValues ?? []).forEach((val, i) => {
      col.check(
        `no_hardcoded_${i}`,
        !allStrings.some((s) => normValue(s).includes(normValue(val))),
        `Se encontró valor hardcodeado prohibido: '${val}'`,
      );
    });
  },
};