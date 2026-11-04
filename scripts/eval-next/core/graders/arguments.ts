/**
 * scripts/eval-next/core/graders/arguments.ts
 *
 * Graders para la etapa ARGUMENTS (ARGUMENTS_VIEW de producción).
 */

import type { Grader, ArgumentsExpect, ArgumentsOutput } from "../types.ts";

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

export const ArgumentsGrader: Grader<ArgumentsOutput, ArgumentsExpect> = {
  name: "arguments",
  grade(output, expect, _ctx, col) {
    if (!output || typeof output.args !== "object" || output.args === null) {
      col.check("valid_args_object", false, "Salida no es un objeto JSON de argumentos válido.");
      return;
    }

    const args = output.args;

    if (expect.requiredFields && expect.requiredFields.length > 0) {
      const missing = expect.requiredFields.filter((k) => args[k] === undefined || args[k] === null);
      col.check(
        "required_fields_present",
        missing.length === 0,
        `Campos requeridos ausentes: ${missing.join(", ")}`
      );
    }

    if (expect.exactFieldValues) {
      for (const [key, expectedVal] of Object.entries(expect.exactFieldValues)) {
        const actualVal = args[key];
        const match = stableStringify(actualVal) === stableStringify(expectedVal);
        col.check(
          `field_${key}_match`,
          match,
          `Valor para '${key}' (${stableStringify(actualVal)}) no coincide con el esperado (${stableStringify(expectedVal)}).`
        );
      }
    }

    const argsJson = JSON.stringify(args);

    if (expect.allowedRefTokens) {
      const matches = argsJson.match(/\{\{ref:r\d+\}\}/g) || [];
      const invalid = matches.filter((t) => !expect.allowedRefTokens!.includes(t));
      col.check(
        "valid_ref_tokens",
        invalid.length === 0,
        `Referencias a refs no permitidas usadas: ${invalid.join(", ")}`
      );
    }

    if (expect.forbiddenHardcodedValues) {
      for (const val of expect.forbiddenHardcodedValues) {
        col.check(
          `no_hardcoded_${val}`,
          !argsJson.includes(val),
          `Se encontró valor hardcodeado prohibido: '${val}'`
        );
      }
    }
  },
};

