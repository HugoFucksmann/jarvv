/**
 * eval/core/contract.ts
 *
 * Constantes y helpers de producción que usa el eval. No se copian: se reexportan desde `src/`, así un cambio allí se refleja
 * aquí sin que nada quede desactualizado en silencio. Solo se adaptan tres firmas: `validateArgs` devuelve la lista de
 * problemas (producción: un texto unido con `; `), `parsePlanSteps` devuelve `null` ante un error (producción: `{ error }`)
 * y `schemaTypes` devuelve un arreglo (producción: un `Set`).
 */

import { BUDGET } from "../../src/core/budget.ts";
import type { DECISION_PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { PromptSet } from "../../src/core/reasoner/stageRequests.ts";
import { parsePlanSteps as prodParsePlanSteps, validateArgs as prodValidateArgs } from "../../src/core/reasoner/qwen.ts";
import { schemaTypes as prodSchemaTypes } from "../../src/core/refs/refResolver.ts";

// ───────────────────────── Reexportado desde src ─────────────────────────

export { parseAnswersObject, validateAnswer } from "../../src/core/decision.ts";
export { NOUL_APPROVE } from "../../src/core/engine/verify.ts";
export { ARGS_REVIEWS } from "../../src/core/engine/deps.ts";
export { estimateTokens } from "../../src/core/llmTransport.ts";
export { retryNote } from "../../src/core/reasoner/prompts.ts";
export { parseJsonObject, parsePendingList, stripThink } from "../../src/core/reasoner/qwen.ts";
export {
  planViewSchema as buildPlanSchema,
  RETRY_TEMPERATURE,
  RETRY_TOKEN_FACTOR,
  TRUNCATED as TRUNCATED_ERROR,
} from "../../src/core/reasoner/stageRequests.ts";
export { isWholeRefToken } from "../../src/core/refs/refResolver.ts";
export { LLM_TRANSPORT_BACKOFF_MS, LLM_TRANSPORT_RETRIES } from "../../src/core/types/limits.ts";
export const LLM_INVALID_OUTPUT_RETRIES = BUDGET.invalidResponseRetries;
export const MAX_STEPS = BUDGET.maxSteps;
export { EXECUTABLE_ROUTES, isExecutableRoute } from "../../src/core/types/routes.ts";
export type { ExecutableRoute } from "../../src/core/types/routes.ts";
export { isRecord } from "../../src/core/utils.ts";

// ───────────────────────── Prompts de una variante ─────────────────────────

/**
 * Los prompts que una variante reemplaza, siempre ENTEROS: una vista generativa completa (`PROMPTS.<vista>`, con todas sus
 * piezas) o un constructor de decisión completo (`DECISION_PROMPTS.<constructor>`). No hay reemplazo por pieza ni se fusiona con
 * producción: lo que la variante no nombra usa el prompt de producción tal cual.
 */
export interface VariantPrompts {
  PROMPTS?: { [K in keyof PromptSet]?: PromptSet[K] };
  DECISION_PROMPTS?: Partial<typeof DECISION_PROMPTS>;
}

// ───────────────────────── Tipos locales ─────────────────────────

/** Sustituye a `MCPTool["inputSchema"]`. */
export interface ToolInputSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: unknown;
}

/** Sustituye al `PlanStep` de producción (distinto del `PlanStep` de salida en `types.ts`). */
export interface ParsedPlanStep {
  id: string;
  instruction: string;
  route: string;
  expectedOutcome: string;
}

// ───────────────────────── Adaptadores de firma ─────────────────────────

/** Tipos JSON Schema que admite un nodo, incluyendo ramas anyOf/oneOf. */
export function schemaTypes(schema: unknown): string[] {
  return [...prodSchemaTypes(schema)];
}

/** Valida los argumentos contra el schema (nivel superior). Devuelve la lista de problemas; vacía = válido. */
export function validateArgs(args: Record<string, unknown>, schema: ToolInputSchema): string[] {
  const problem = prodValidateArgs(args, schema as Parameters<typeof prodValidateArgs>[1]);
  return problem === null ? [] : problem.split("; ");
}

/** Convierte `steps` crudos a pasos. Devuelve `null` si algo no cumple (producción devuelve `{ error }`). */
export function parsePlanSteps(raw: unknown, firstId: number, allowEmpty: boolean): ParsedPlanStep[] | null {
  const parsed = prodParsePlanSteps(raw, firstId, allowEmpty);
  return "error" in parsed ? null : (parsed.steps as ParsedPlanStep[]);
}
