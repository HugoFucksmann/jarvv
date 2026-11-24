/**
 * eval/variants/result_verification/result_verification_v04.ts
 *
 * Result Verification — variante v04 (Récord del bucle autónomo con qwen3.5:9b, 84.1%):
 * Logra un salto desde 75.0% hasta 84.1% (+45.5% sobre prod) mediante una frontera estricta:
 * - 'ok' es un filtro puramente técnico sobre presencia de tokens de datos sin importar completitud.
 * - 'cumple' exige 100% de cumplimiento funcional, rechazando explícitamente resultados parciales o subconjuntos.
 */

import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

interface Patch {
  instructions?: Record<string, string>;
  criteria?: Record<string, Record<string, string>>;
  stateNote?: string;
}

const PATCH: Patch = {
  instructions: {
    ok: "Technical filter only: does the result contain non-empty data tokens? Ignore correctness or completeness — strictly check that it is not empty, an error, or an exception. Do not judge quality or content validity.",
    cumple:
      "Functional check: assuming the result is usable, does it fully satisfy the step instruction and expected outcome with 100% compliance? A partial result, a subset match, or incomplete coverage is false.",
  },
  stateNote:
    "Focus on the strict boundary: 'ok' is purely existence (tokens), 'cumple' is strictly full satisfaction (no partials).",
};


function buildResultVerification(data: Parameters<typeof DECISION_PROMPTS.buildResultVerification>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildResultVerification(data);
  const questions: DecisionInput["questions"] = {};
  for (const [key, question] of Object.entries(base.questions)) {
    const next = { ...question };
    if (PATCH.instructions?.[key] !== undefined) next.instructions = PATCH.instructions[key];
    questions[key] = next;
  }
  const state = PATCH.stateNote === undefined ? base.state : `${PATCH.stateNote}\n${base.state}`;
  return { ...base, state, questions };
}

const result_verification_v04: Variant = {
  name: "result_verification_v04",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildResultVerification } },
};
export default result_verification_v04;
