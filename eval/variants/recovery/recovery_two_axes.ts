import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: en vez de elegir una acción, dos `noul` (¿bloqueado?, ¿falta algo?) que la etapa combina en código (bloqueado → close; falta algo → replan; si no, rewrite_item). Mejor resultado en holdout (83 %), con más falsos `close`.
 * Sin `skip_continue` ni `independent`: se mide con los datasets `recovery_n1` a `recovery_n4` (nunca con `recovery_casos`, `recovery2` ni `recovery3`, que tienen `skip_continue`). Resultados y descartes: `eval/GUIA_DECISION.md`, sección 5.
 */
interface Q {
  instr: string;
  crit: Record<string, string>;
}
interface Ax {
  instr: string;
  t: string;
  f: string;
}
interface Cfg {
  view: "full" | "focus";
  mode: "one" | "cascade" | "axes" | "argmax3";
  one?: Q;
  A?: Q;
  B?: Q;
  blocked?: Ax;
  prereq?: Ax;
  footer?: string;
  errorInInstr?: boolean;
  fixable?: Ax;
  missing?: Ax;
}

const CFG: Cfg = {
  "view": "full",
  "mode": "axes",
  "blocked": {
    "instr": "Is the step blocked for good?",
    "t": "Access is denied or not permitted, the network or a server fails, a file is corrupt or locked, there is no space, tests fail, or this is the 2nd or later attempt with the same kind of error.",
    "f": "This is the first attempt and the error comes from how the call was written or from something that is missing."
  },
  "prereq": {
    "instr": "Does the error say that something the call needs is missing?",
    "t": "The error says the destination folder does not exist, a program is not recognized, a port is in use, or a file format is not supported.",
    "f": "The error says the command, parameter, path or name is wrong, or the file name is misspelled."
  }
};

const obsBlocks = (text: string): string[] => [...text.matchAll(/<obs>([\s\S]*?)<\/obs>/g)].map((m) => (m[1] ?? "").trim());

function stateOf(data: RecoveryDecisionInput): string {
  const behind = data.behind.length > 0 ? data.behind.map((item, i) => `${i + 1}) ${safe(item)}`).join(" ") : "none";
  const cause = data.cause === null ? "unknown" : data.cause;
  const rendered = PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view });
  if (CFG.view === "full") {
    const failedBlock = ["### THE STEP THAT JUST FAILED", `Item: ${safe(data.failed)}`, `Why it failed: ${cause}`, `Attempts so far: ${data.attempts}`, `Items after it: ${behind}`].join("\n");
    return `${rendered}\n\n${failedBlock}${CFG.footer ? `\n${CFG.footer}` : ""}`;
  }
  const req = /REQUEST:\s*(.*)/.exec(rendered)?.[1]?.trim() ?? "";
  const blocks = obsBlocks(rendered.slice(rendered.indexOf("FAILED")));
  const errors = blocks.join("\n").split("\n").filter((l) => l.trim() !== "").slice(-Math.max(2, data.attempts)).map((l) => l.slice(0, 360));
  return [
    `Request: ${req}`,
    `Failed item: ${safe(data.failed)}`,
    "Last errors:",
    ...errors,
    `Why it failed: ${cause}`,
    `Attempts so far: ${data.attempts}`,
    `Items after it: ${behind}`,
    ...(CFG.footer ? [CFG.footer] : []),
  ].join("\n");
}

function lastError(data: RecoveryDecisionInput): string {
  const rendered = PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view });
  const lines = obsBlocks(rendered.slice(rendered.indexOf("FAILED"))).join("\n").split("\n").filter((l) => l.trim() !== "");
  const last = lines[lines.length - 1] ?? "";
  return last.slice(Math.max(0, last.indexOf("|") + 1)).trim().slice(0, 300);
}

function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const state = stateOf(data);
  const pre = CFG.errorInInstr ? `The last error was: ${lastError(data)}. Attempts so far: ${data.attempts}. ` : "";
  if (CFG.mode === "one") {
    const one = CFG.one as Q;
    return { state, questions: { action: { type: "choice", instructions: pre + one.instr, criteria: one.crit } } };
  }
  if (CFG.mode === "cascade") {
    const A = CFG.A as Q;
    const B = CFG.B as Q;
    return { state, questions: { action: { type: "choice", instructions: A.instr, criteria: A.crit }, scope: { type: "choice", instructions: B.instr, criteria: B.crit } } };
  }
  if (CFG.mode === "argmax3") {
    const fixable = CFG.fixable as Ax;
    const missing = CFG.missing as Ax;
    const blockedQ = CFG.blocked as Ax;
    const mk = (a: Ax) => ({ type: "noul" as const, instructions: pre + a.instr, criteria: { true: a.t, false: a.f } });
    return { state, questions: { fixable: mk(fixable), missing: mk(missing), blocked: mk(blockedQ) } };
  }
  const blocked = CFG.blocked as Ax;
  const prereq = CFG.prereq as Ax;
  return {
    state,
    questions: {
      blocked: { type: "noul", instructions: blocked.instr, criteria: { true: blocked.t, false: blocked.f } },
      prereq: { type: "noul", instructions: prereq.instr, criteria: { true: prereq.t, false: prereq.f } },
    },
  };
}

const recovery_two_axes: Variant = { name: "recovery_two_axes", prompts: { DECISION_PROMPTS: { buildRecovery } } };
export default recovery_two_axes;
