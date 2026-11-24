import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Variante generada por código: la salida de producción (DECISION_PROMPTS.buildContinuation) con estos textos reemplazados.
interface Patch {
  instructions?: Record<string, string>;
  criteria?: Record<string, Record<string, string>>;
  stateNote?: string;
}

const PATCH: Patch = {
  "instructions": {
    "follow": "A request is a continuation if it makes sense only because of the previous task's specific output (active dependency on result). A request is NOT a continuation if it is an independent query, a general conversation flow, or continues a topic without referencing or depending on the specific details of the prior response."
  }
};

// Preguntas cuya instrucción lleva texto propio de cada caso: lo fijo de producción (antes y después) y el marcador donde va ese texto.
const DYNAMIC: Record<string, { before: string; after: string }> = {};
const DATA_MARK = "{{DATA}}";
const groupOf = (key: string): string => (/\d+$/.test(key) ? `${key.replace(/\d+$/, "")}*` : key);

// Conserva la marca final entre corchetes que producción agrega a una opción (por ejemplo `[the last attempt on this route failed]`).
const MARKER = /\s*(\[[^\]]*\])\s*$/;

function buildContinuation(data: Parameters<typeof DECISION_PROMPTS.buildContinuation>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildContinuation(data);
  const questions: DecisionInput["questions"] = {};
  for (const [key, question] of Object.entries(base.questions)) {
    const next = { ...question };
    const group = groupOf(key);
    const instructions = PATCH.instructions?.[group];
    const split = DYNAMIC[group];
    if (instructions !== undefined && split === undefined) next.instructions = instructions;
    if (instructions !== undefined && split !== undefined && question.instructions.startsWith(split.before) && question.instructions.endsWith(split.after)) {
      const data = question.instructions.slice(split.before.length, question.instructions.length - split.after.length);
      next.instructions = instructions.replace(DATA_MARK, () => data);
    }
    const criteria = PATCH.criteria?.[group];
    if (next.type === "choice" && criteria !== undefined) {
      const merged: Record<string, string> = { ...next.criteria };
      for (const [option, text] of Object.entries(criteria)) {
        if (!(option in merged)) continue;
        const marker = MARKER.exec(merged[option]);
        merged[option] = marker ? `${text} ${marker[1]}` : text;
      }
      next.criteria = merged;
    }
    questions[key] = next;
  }
  const state = PATCH.stateNote === undefined ? base.state : `${PATCH.stateNote}\n${base.state}`;
  return { ...base, state, questions };
}

const continuation_v03: Variant = {
  name: "continuation_v03",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};
export default continuation_v03;
