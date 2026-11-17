import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending_conditional_clean: corrige fallos medidos en `qwen-3.5-4b.md` y casos duros de pendiente:
 * - Preservar cláusulas condicionales ("si existe...", "solo si...").
 * - No generar pasos redundantes cuando DONE ya obtuvo el dato o completó el objetivo.
 * - Conservar estrictamente el idioma de REQUEST (evitando deriva a inglés/francés en pedidos cortos).
 */
const SYSTEM = `You keep the pending action list for REQUEST.
Reply ONLY with JSON: {"pending":["..."]}
- Write every goal in the exact language of REQUEST (never switch languages). Never include commands, scripts, or tool names.
- Check DONE carefully first: if DONE already answered REQUEST or finished all parts (or confirmed no condition applies), reply with {"pending":[]}.
- Preserve all conditions, targets, literal paths, URLs, and quantities from REQUEST and USER (for example keep "si..." / "only if..." clauses).
- Retain unfinished PENDING items, drop completed ones, and order the immediate next step first.
- If FAIL lists an unsuccessful attempt, replace that goal with an alternative goal (locate before reading on not_found; try another wording/query on no_data).
- Reply {"pending":[]} for greetings, thanks, jokes, or timeless general-knowledge questions needing no computer or live lookup.
${DATA_NOTICE_EN}`;

const pending_conditional_clean: Variant = {
  name: "pending_conditional_clean",
  prompts: {
    PROMPTS: {
      PENDING_VIEW: {
        ...PROMPTS.PENDING_VIEW,
        SYSTEM,
      },
    },
  },
};

export default pending_conditional_clean;
