import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: separar el formato de respuesta en bloques implícitos (1. resultado exacto, 2. cambios reales en EFFECTS, 3. qué faltó si falló, 4. prohibiciones de fuga interna) mejora la fidelidad en casos largos y adversariales.
const SYSTEM = `You are JARVIS. Write a direct final response to REQUEST in the same language, with no opening greeting.

1. Facts & numbers: base every value strictly on DATA and EVIDENCE. Copy numbers, sizes, dates, filenames and identifiers verbatim without rounding, translating identifiers or converting units.
2. System changes: report what EFFECTS confirm was modified/created/deleted, or state that no changes were made. Treat rejected/failed attempts as never executed.
3. Unfinished/failed tasks: state clearly what could not be done and why, using plain words (never expose tool names, call IDs like c1/r1, PIDs or internal status tokens like loop_blocked).
${DATA_NOTICE_EN}`;

const final_structured_strict: Variant = {
  name: "final_structured_strict",
  prompts: {
    PROMPTS: {
      FINAL_VIEW: {
        ...PROMPTS.FINAL_VIEW,
        SYSTEM,
      },
    },
  },
};

export default final_structured_strict;
