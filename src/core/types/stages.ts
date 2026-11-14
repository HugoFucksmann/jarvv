/**
 * Etapas del flujo que consultan a un modelo: una sola lista, con el tipo derivado de ella. La traza (`engine/capture.ts`,
 * `trace/`) y el laboratorio de evaluación usan estos ids; agregar una etapa es agregarla aquí y clasificarla en `STAGE_KIND`.
 */

export const STAGES = ["continuation", "first_query", "route", "tool", "review", "verify", "completion", "args", "question", "plan", "final", "pending"] as const;
export type StageId = (typeof STAGES)[number];

/** Qué modelo corre cada etapa: el de decisión (d3) o el generativo (LLM). `satisfies` obliga a clasificar toda etapa. */
export const STAGE_KIND = {
  continuation: "decision",
  first_query: "decision",
  route: "decision",
  tool: "decision",
  review: "decision",
  verify: "decision",
  completion: "decision",
  args: "generative",
  question: "generative",
  plan: "generative",
  final: "generative",
  pending: "generative",
} as const satisfies Record<StageId, "decision" | "generative">;
export type StageKind = (typeof STAGE_KIND)[StageId];
