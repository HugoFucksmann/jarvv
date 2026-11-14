/**
 * eval/core/stages/generative.ts
 *
 * Entradas del registro para las etapas generativas
 * (plan, arguments, final, question, pending).
 * Secciones 3 y 7.7.
 */

import {
  argsProblemText,
  MAX_STEPS,
  NOT_JSON_ERROR,
  parseJsonObject,
  parsePendingList,
  parsePlanStepsResult,
  stripThink,
  validateArgs,
} from "../contract.ts";
import type { ToolInputSchema } from "../contract.ts";
import { LatencyGrader, NotTruncatedGrader } from "../graders/common.ts";
import { ArgumentsGrader } from "../graders/arguments.ts";
import { FinalResponseGrader } from "../graders/final.ts";
import { PendingGrader } from "../graders/pending.ts";
import { PlanStepsGrader } from "../graders/plan.ts";
import { QuestionGrader } from "../graders/question.ts";
import type {
  ArgumentsExpect,
  ArgumentsOutput,
  FinalExpect,
  FinalOutput,
  GenerativeRequest,
  PendingExpect,
  PendingOutput,
  PlanExpect,
  PlanOutput,
  PlanStep,
  QuestionExpect,
  QuestionOutput,
} from "../types.ts";
import type { GenerativeStageEntry, LabelInfo } from "./index.ts";

// ───────────────────────── Helpers de parseo ─────────────────────────

function noLabel(): LabelInfo {
  return { predicted: null, expected: null, rawScore: null, probabilities: null };
}

/** Lee el `maxItems` del schema **enviado** (si no hay, usa MAX_STEPS). */
function maxItemsFromSchema(req: GenerativeRequest): number {
  const schema = req.schema;
  if (!schema) return MAX_STEPS;
  const steps = (schema as { properties?: { steps?: { maxItems?: unknown } } }).properties?.steps;
  if (typeof steps?.maxItems === "number") return steps.maxItems;
  return MAX_STEPS;
}

// ───────────────────────── plan ─────────────────────────

export const planStage: GenerativeStageEntry<PlanOutput, PlanExpect> = {
  stageName: "plan",
  requestType: "generative",
  graders: [LatencyGrader, NotTruncatedGrader, PlanStepsGrader],
  parseOutput(
    rawOutput: string,
    sentReq: GenerativeRequest,
  ): PlanOutput {
    const obj = parseJsonObject(rawOutput);
    if (!obj) throw new Error(NOT_JSON_ERROR);

    // Mismo orden y textos que `generatePlanFromView`: primero cada paso (y el tope `BUDGET.maxSteps`), luego el tope del input.
    const result = parsePlanStepsResult(obj.steps, 1, false);
    if ("error" in result) throw new Error(result.error);
    const parsed = result.steps;
    const maxItems = maxItemsFromSchema(sentReq);
    if (parsed.length > maxItems) throw new Error(`máximo ${maxItems} pasos; se recibieron ${parsed.length}`);

    // Convertir PlanStep interno a PlanStep de output (goal, suggested_mcp, expected_outcome)
    const steps: PlanStep[] = parsed.map((s) => ({
      goal: s.instruction,
      suggested_mcp: s.route,
      expected_outcome: s.expectedOutcome,
    }));
    return { steps };
  },
  label: noLabel,
};

// ───────────────────────── arguments ─────────────────────────

export const argumentsStage: GenerativeStageEntry<ArgumentsOutput, ArgumentsExpect> = {
  stageName: "arguments",
  requestType: "generative",
  graders: [LatencyGrader, NotTruncatedGrader, ArgumentsGrader],
  parseOutput(
    rawOutput: string,
    _sentReq: GenerativeRequest,
    toolSchema?: ToolInputSchema,
  ): ArgumentsOutput {
    const obj = parseJsonObject(rawOutput);
    if (!obj) throw new Error(NOT_JSON_ERROR);

    // Eliminar null en parámetros no requeridos
    const required = new Set(toolSchema?.required ?? []);
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null && !required.has(k)) continue;
      args[k] = v;
    }

    // Producción siempre valida contra el schema de la herramienta: sin él el caso no mide lo mismo.
    if (!toolSchema) {
      throw new Error("El caso 'arguments' no trae meta.toolSchema: no se puede validar como lo hace producción.");
    }
    const errs = validateArgs(args, toolSchema);
    if (errs.length > 0) throw new Error(argsProblemText(errs));

    return { args };
  },
  label: noLabel,
};

// ───────────────────────── final ─────────────────────────

export const finalStage: GenerativeStageEntry<FinalOutput, FinalExpect> = {
  stageName: "final",
  requestType: "generative",
  graders: [LatencyGrader, NotTruncatedGrader, FinalResponseGrader],
  parseOutput(rawOutput: string): FinalOutput {
    const response = stripThink(rawOutput).trim();
    if (!response) throw new Error("salida vacía");
    return { response };
  },
  label: noLabel,
};

// ───────────────────────── pending ─────────────────────────

export const pendingStage: GenerativeStageEntry<PendingOutput, PendingExpect> = {
  stageName: "pending",
  requestType: "generative",
  graders: [LatencyGrader, NotTruncatedGrader, PendingGrader],
  parseOutput(rawOutput: string): PendingOutput {
    const obj = parseJsonObject(rawOutput);
    if (!obj) throw new Error(NOT_JSON_ERROR);
    // La misma validación que producción: arreglo de textos no vacíos (puede venir vacío).
    const parsed = parsePendingList(obj.pending);
    if ("error" in parsed) throw new Error(parsed.error);
    return { pending: parsed.pending };
  },
  label: noLabel,
};

// ───────────────────────── question ─────────────────────────

export const questionStage: GenerativeStageEntry<QuestionOutput, QuestionExpect> = {
  stageName: "question",
  requestType: "generative",
  graders: [LatencyGrader, NotTruncatedGrader, QuestionGrader],
  parseOutput(rawOutput: string): QuestionOutput {
    const question = stripThink(rawOutput).trim();
    if (!question) throw new Error("salida vacía");
    return { question };
  },
  label: noLabel,
};

