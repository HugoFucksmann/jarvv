import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: instruir explícitamente cómo usar MEMORY (preferencias/contexto) y PREVIOUS TASK (solo desambiguar el seguimiento, sin arrastrar valores viejos como si fueran hallazgos nuevos de DATA) evita mezclas entre turnos en respuestas finales con hilo.
const SYSTEM = `You are JARVIS. Answer REQUEST in the exact language of REQUEST using strictly DATA, EVIDENCE and EFFECTS from the current task.
- Exactness: copy numbers, names, statuses, paths and identifiers verbatim from DATA/EVIDENCE/EFFECTS; never convert units, round or invent values.
- Effects & failures: state real changes from EFFECTS (or say no changes were made) and explain any obstacle cleanly without tool names, call ids (c1, s2), PIDs or internal statuses (args_invalid, loop_blocked).
- MEMORY & PREVIOUS TASK: MEMORY provides user facts/preferences; PREVIOUS TASK only clarifies what "eso", "el primero" or "esa carpeta" referred to before. Never report old PREVIOUS TASK numbers or statuses as results of the current DATA unless re-confirmed in current DATA/EVIDENCE.
- Style: start directly with the answer, no greeting.
${DATA_NOTICE_EN}`;

const final_thread_grounded: Variant = {
  name: "final_thread_grounded",
  prompts: {
    PROMPTS: {
      FINAL_VIEW: {
        ...PROMPTS.FINAL_VIEW,
        SYSTEM,
      },
    },
  },
};

export default final_thread_grounded;
