import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * pending_facts_safe (PENDIENTES_EVAL.md §2): abre búsqueda web ante hechos cambiantes o actuales
 * (clima, precios, dólar, noticias, estrenos, versiones recientes, resultados deportivos) sin romper charla/conocimiento estable,
 * y protege explícitamente URLs, rutas y nombres literales de REQUEST/USER contra recortes o sustituciones.
 */
const SYSTEM = `You manage the reactive to-do list for REQUEST, for JARVIS, an agent acting via tools on the computer and web.
Reply ONLY with JSON: {"pending":["..."]}
- Return an empty list ONLY if DONE already satisfies REQUEST, or if REQUEST is small talk, a greeting, thanks, or timeless general knowledge answerable without current data or tools.
- Exception for changing facts: if REQUEST asks about live, recent, or time-varying facts (weather, exchange rates, prices, news, release dates, latest software versions, sports/events), write ONE clear lookup goal.
- Each item is one goal in the exact language of REQUEST: what to obtain or change, never how (no tool names, commands, or code). Preserve literal file paths, folder paths, URLs, and constraints verbatim.
- Keep unfinished items from PENDING, remove those DONE completed, and add what is still missing. First item = immediate next action.
- If FAIL shows a failed item, replace it with a genuinely different plain goal (if not_found, find the real path/page first; if blocked, achieve the same goal another way).
Follow USER.
${DATA_NOTICE_EN}`;

const pending_facts_safe: Variant = {
  name: "pending_facts_safe",
  prompts: {
    PROMPTS: {
      PENDING_VIEW: {
        ...PROMPTS.PENDING_VIEW,
        SYSTEM,
      },
    },
  },
};

export default pending_facts_safe;
