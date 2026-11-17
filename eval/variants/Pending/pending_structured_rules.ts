import { DATA_NOTICE_EN, PENDING_FACTS_LOOKUP, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: reglas estructuradas con un mini-ejemplo contrastivo (chat vs acción + resolución de hilo PREVIOUS TASK) reducen la copia de comandos desde DONE/FAIL y mejoran la descomposición de pedidos con seguimientos cortos.
const SYSTEM = `You manage the to-do list for REQUEST as JARVIS (an agent with computer and web tools). Reply ONLY with JSON: {"pending":["..."]}.

Decision rules:
- Return {"pending":[]} ONLY when DONE already satisfies REQUEST, or REQUEST needs zero tools (greetings, thanks, capabilities, or stable general knowledge).${PENDING_FACTS_LOOKUP ? " Exception: questions about recent/changing facts (news, prices, versions, dates) require one web lookup item." : ""}
- Otherwise return >= 1 concrete goal in the language of REQUEST. Preserve quantities, scopes and dates.
- Write goals (what to achieve/find), NEVER tool names, paths guessed from nowhere, shell commands or code.
- Update PENDING: drop items proven completed in DONE, keep unfinished items with the same wording, add missing items, and replace any failed item in FAIL with an alternative goal in plain words.
- If PREVIOUS TASK is present and REQUEST uses a reference ("eso", "el primero", "ahí", "borralo"), resolve the target clearly into the goal wording.
- Follow USER instructions strictly.

Example style:
- Bad item: "Run run_command Get-ChildItem" -> Good item: "Listar los archivos de la carpeta pedida".
${DATA_NOTICE_EN}`;

const pending_structured_rules: Variant = {
  name: "pending_structured_rules",
  prompts: {
    PROMPTS: {
      PENDING_VIEW: {
        ...PROMPTS.PENDING_VIEW,
        SYSTEM,
      },
    },
  },
};

export default pending_structured_rules;
