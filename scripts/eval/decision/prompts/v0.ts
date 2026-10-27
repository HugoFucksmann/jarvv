import type { TestCase } from "../core/types.ts";

/* =====================================================================
 * scripts/eval/prompts/v0.ts — línea base literal de producción.
 * Origen: src/core/reasoner/prompts.ts (DECISION_PROMPTS.buildStepVerification)
 * Fecha de congelamiento: 2026-10-27.
 *
 * REGLA: Si la implementación de producción en src/core/reasoner/prompts.ts
 * cambia en el futuro, no editar este archivo: crear v0b.ts.
 * Este archivo permanece como referencia histórica inmutable de v0.
 * ===================================================================== */

// Presupuestos en caracteres de producción (src/core/reasoner/prompts.ts:41-47)
const MAX_MESSAGE_CHARS = 1000;
const MAX_VERIFY_RESULT_CHARS = 2500; // MAX_EVIDENCE_OBS_CHARS
const MAX_OBSERVATION_CHARS = 2500;   // MAX_EVIDENCE_OBS_CHARS

// Recorte exacto de producción (src/core/reasoner/prompts.ts:51-52)
const clip = (s: string, n: number): string =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

/**
 * Reconstruye el estado tal como lo arma DECISION_PROMPTS.buildStepVerification.
 * Nota: Los argumentos en producción no tienen un bloque "Arguments:"; están
 * embebidos en el callLabel dentro de `Result` (ej: "create_directory C:\...: ...").
 */
export function buildStateV0(c: TestCase): string {
  // En producción (prompts.ts:526): evidenceSummary solo va si no está ya en resultSummary
  const evidenceSummary = (c.context as any)?.evidence_summary;
  const evidence = evidenceSummary && !c.result.includes(evidenceSummary)
    ? clip(evidenceSummary, MAX_VERIFY_RESULT_CHARS)
    : null;

  return [
    `Step instruction: ${clip(c.instruction, MAX_MESSAGE_CHARS)}`,
    c.expected_outcome ? `Expected outcome: ${clip(c.expected_outcome, MAX_MESSAGE_CHARS)}` : null,
    `Tool: ${c.tool}`,
    `Result: ${clip(c.result, MAX_VERIFY_RESULT_CHARS)}`,
    evidence ? `Observable evidence: ${evidence}` : null,
    c.observation ? `Observation: ${clip(c.observation, MAX_OBSERVATION_CHARS)}` : null,
  ].filter(Boolean).join("\n");
}

export const QUESTIONS_V0 = {
  ok: {
    type: "noul",
    instructions: "Does the result contain usable data (not empty and not an error message)?",
  },
  cumple: {
    type: "noul",
    instructions: "Does the result accomplish the step instruction?",
  },
};

export async function runEvaluation({
  runNoul,
}: {
  runNoul: (
    name: string,
    stateFn: (c: TestCase) => string,
    questions: Record<string, any>,
    preamble?: string,
  ) => Promise<void>;
  cases: TestCase[];
}) {
  // Ejecuta la verificación fija de producción: ok y cumple.
  // Producción aprueba solo si (ok > 0.5 && cumple > 0.5).
  await runNoul("V0_prod_baseline", buildStateV0, QUESTIONS_V0);
}
