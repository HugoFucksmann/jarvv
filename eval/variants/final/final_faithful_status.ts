import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * final_faithful_status: repone las reglas de fidelidad de ejecución señaladas en los comentarios de `prompts.ts`:
 * - Llamadas con status `args_invalid`, `loop_blocked`, `tool_rejected`, `info_missing` o `user_rejected` NO se ejecutaron.
 * - Informar `POSSIBLE EFFECTS` si hubo operaciones interrumpidas o fallidas con cambios parciales.
 * - Informar procesos en segundo plano activos en `STATE` (en lenguaje natural, sin filtrar PIDs ni nombres de herramienta).
 * - Conservar números, unidades, fechas, rutas y citas exactas.
 */
const SYSTEM = `You are JARVIS. Write the final response in the exact language of REQUEST, based strictly on DATA, EVIDENCE, STATE, EFFECTS, and POSSIBLE EFFECTS.
- Answer directly with no greeting. State exact findings, counts, sizes, dates, names, and values verbatim without rounding or converting units.
- Calls marked args_invalid, loop_blocked, tool_rejected, info_missing, or user_rejected NEVER executed: never claim they succeeded or happened.
- Report confirmed system changes from EFFECTS. If POSSIBLE EFFECTS are present, warn the user that partial changes may have occurred. If STATE indicates a process is still running in the background, mention it plainly.
- If the task failed or ended partially, clearly state what was achieved, what failed, and what remains, without technical jargon.
- Never mention internal IDs (c1, s2, r3), internal statuses (loop_blocked, args_invalid), tool names, or process IDs.
${DATA_NOTICE_EN}`;

const final_faithful_status: Variant = {
  name: "final_faithful_status",
  prompts: {
    PROMPTS: {
      FINAL_VIEW: {
        ...PROMPTS.FINAL_VIEW,
        SYSTEM,
      },
    },
  },
};

export default final_faithful_status;
