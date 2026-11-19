/**
 * Por qué un paso quedó `failed` (la recuperación del modo —escalación o replan— la resuelve `runTask`). Vive en `types/` porque los contratos de los modelos
 * (`contracts.ts`) la nombran y no deben importar del motor; `engine/outcomes.ts` la reexporta.
 */

export const STEP_FAILURE_CAUSES = ["call_cap", "repeat_blocked", "review_rejected", "verify_rejected", "tool_failed", "user_rejected", "denied", "no_tools"] as const;
export type StepFailureCause = (typeof STEP_FAILURE_CAUSES)[number];
