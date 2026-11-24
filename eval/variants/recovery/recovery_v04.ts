import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

// Variante generada por código: la salida de producción (DECISION_PROMPTS.buildRecovery) con estos textos reemplazados.
interface Patch {
  instructions?: Record<string, string>;
  criteria?: Record<string, Record<string, string>>;
  stateNote?: string;
}

const PATCH: Patch = {
  "instructions": {
    "action": "Choose the action based on whether the fix lies within the command itself, requires an external change to the environment, or if the task is unrecoverable:"
  },
  "criteria": {
    "action": {
      "rewrite_item": "Retry only when the failure stems from a correctable element strictly inside the current command, including typos, syntax errors, parameter values, or output format.",
      "replan": "Rebuild plan when the execution fails because an external prerequisite or dependency is not yet ready (e.g., missing package, empty directory, occupied port, wrong input file).",
      "close": "Stop if the task is impossible to finish (blocked, denied, application missing, test failures) or if the maximum number of attempts has been reached."
    }
  }
};

// Preguntas cuya instrucción lleva texto propio de cada caso: lo fijo de producción (antes y después) y el marcador donde va ese texto.
const DYNAMIC: Record<string, { before: string; after: string }> = {};
const DATA_MARK = "{{DATA}}";
const groupOf = (key: string): string => (/\d+$/.test(key) ? `${key.replace(/\d+$/, "")}*` : key);

// Conserva la marca final entre corchetes que producción agrega a una opción (por ejemplo `[the last attempt on this route failed]`).
const MARKER = /\s*(\[[^\]]*\])\s*$/;

function buildRecovery(data: Parameters<typeof DECISION_PROMPTS.buildRecovery>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildRecovery(data);
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

const recovery_v04: Variant = {
  name: "recovery_v04",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};
export default recovery_v04;
