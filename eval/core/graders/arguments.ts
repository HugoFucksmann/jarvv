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

const EMBEDDED_REF_RE = /\{\{ref:(r\d+)\}\}/gi;
const WHOLE_REF_RE = /^\s*(?:\{\{ref:(r\d+)\}\}|ref:(r\d+))\s*$/i;

/** Ids de ref (`r1`) usados, con las mismas formas que acepta el resolvedor de producción. Lo usa también el runner (`argsWithoutRefs`). */
export function usedRefIds(strings: string[]): string[] {
  const ids: string[] = [];
  for (const s of strings) {
    const whole = WHOLE_REF_RE.exec(s);
    if (whole) {
      ids.push((whole[1] ?? whole[2]).toLowerCase());
      continue;
    }
    for (const m of s.matchAll(EMBEDDED_REF_RE)) ids.push(m[1].toLowerCase());
  }
  return ids;
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
          stableStringify(actualVal) === stableStringify(expectedVal),
          `Valor para '${key}' (${stableStringify(actualVal)}) no coincide con el esperado (${stableStringify(expectedVal)}).`,
        );
      }
    }

    const allStrings = collectStrings(args);

    const allowedRefTokens = expect.allowedRefTokens;
    if (allowedRefTokens) {
      const allowedIds = new Set(
        allowedRefTokens.map((t) => (/r\d+/i.exec(t)?.[0] ?? t).toLowerCase()),
      );
      const invalid = usedRefIds(allStrings).filter((id) => !allowedIds.has(id));
      col.check(
        "valid_ref_tokens",
        invalid.length === 0,
        `Referencias a refs no permitidas usadas: ${invalid.map((id) => `{{ref:${id}}}`).join(", ")}`,
      );
    }

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