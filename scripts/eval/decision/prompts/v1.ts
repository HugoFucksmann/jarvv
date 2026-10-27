import type { TestCase, GoldPostLabel } from "../core/types.ts";

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function formatArguments(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${clip(s, 200)}`);
  }
  return parts.join(", ");
}

/**
 * Estado actual (V0)
 */
export function buildStateV0(c: TestCase): string {
  const lines = [
    `Step instruction: ${clip(c.instruction, 1000)}`,
    c.expected_outcome ? `Expected outcome: ${clip(c.expected_outcome, 1000)}` : null,
    `Tool: ${c.tool}`,
    `Result: ${clip(c.result, 2500)}`,
    `Observation: ${clip(c.observation, 2500)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Estado extendido S+ (V0b, V1, V1-3, V2, V3)
 */
export function buildStateSPlus(c: TestCase): string {
  const lines = [
    `Step instruction: ${clip(c.instruction, 1000)}`,
    c.expected_outcome ? `Expected outcome: ${clip(c.expected_outcome, 1000)}` : null,
    `Tool: ${c.tool}`,
    `Arguments: ${formatArguments(c.args)}`,
    `Result: ${clip(c.result, 2500)}`,
    `Observation: ${clip(c.observation, 2500)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Estado Pre-ejecución (P)
 */
export function buildStatePre(c: TestCase): string {
  const argLines = Object.entries(c.args)
    .map(([k, v]) => `  ${k}=${clip(typeof v === "string" ? v : JSON.stringify(v), 200)}`)
    .join("\n");

  const lines = [
    `Step instruction: ${clip(c.instruction, 1000)}`,
    c.expected_outcome ? `Expected outcome: ${clip(c.expected_outcome, 1000)}` : null,
    `Tool: ${c.tool}`,
    `Proposed arguments:\n${argLines}`,
    c.context?.recent_targets && c.context.recent_targets.length > 0
      ? `Known values from context: ${c.context.recent_targets.join(", ")}`
      : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Preguntas estándar
 */
export const QUESTIONS_V0 = {
  ok: {
    type: "noul",
    instructions: "Does the result contain usable data (not empty and not an error message)?",
  },
  cumple: {
    type: "noul",
    instructions: "Does the result accomplish the step instruction?",
  },
};

export const CRITERIA_V1 = {
  matches:
    "The tool ran and its effect matches the instruction: right target (file, path, process, item) and the requested content or outcome.",
  wrong_target:
    "The tool ran, but it acted on a different file, path, process or item than the instruction asks for.",
  wrong_content:
    "The tool ran on the right target, but the content or outcome differs from what was requested.",
  partial: "Only part of what the instruction asks for was done.",
  failed: "The tool did not do what was asked: error, empty result or nothing changed.",
  unknown: "The output does not provide enough information to tell.",
};

export const CRITERIA_V1_3 = {
  matches:
    "The tool ran and its effect matches the instruction: right target and the requested content or outcome.",
  mismatch:
    "The effect does not match the instruction: wrong target, wrong content, partial execution or error.",
  unknown: "The output does not provide enough information to tell.",
};

export const QUESTIONS_V3 = {
  ok: {
    type: "noul",
    instructions: "Does the result contain usable data (not empty and not an error message)?",
  },
  cumple: {
    type: "noul",
    instructions: "Does the result accomplish the step instruction?",
  },
  target_ok: {
    type: "noul",
    instructions: "Is the target in the arguments (file, path, process, item) the one the step instruction refers to?",
  },
  content_ok: {
    type: "noul",
    instructions: "Does the content or outcome in the arguments and result match what the step instruction requests?",
  },
};
