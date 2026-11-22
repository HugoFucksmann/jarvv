/**
 * eval/auto/stageContract.ts
 *
 * Contratos por etapa (las 14 registradas en `eval/core/stages/index.ts`): tipo de etapa (`decision` | `generative`) y dónde vive su prompt.
 * En ambos tipos el optimizador escribe solo textos y el código arma el archivo de la variante (`patchVariant.ts`):
 * - Decisión: instrucciones y descripciones de opciones sobre `DECISION_PROMPTS.<promptKey>`.
 * - Generativas: el texto `SYSTEM` de `PROMPTS.<promptKey>`; el resto de la vista (cómo se arma el mensaje del usuario) queda como en producción.
 */

import type { DecisionStage, GenerativeStage, StageName } from "../core/types.ts";

interface BaseStageContract {
  stage: StageName;
  /** Clave exacta del constructor o vista (`buildRouteChoice`, `FINAL_VIEW`, etc.). */
  promptKey: string;
}

export interface DecisionContract extends BaseStageContract {
  requestType: "decision";
  promptGroup: "DECISION_PROMPTS";
}

export interface GenerativeContract extends BaseStageContract {
  requestType: "generative";
  promptGroup: "PROMPTS";
  /** Qué tiene que producir el modelo evaluado (formato de su respuesta). */
  outputContract: string;
  /** Reglas clave de parseo y graders de `eval/core/stages/<stage>.ts`. */
  graderRules: string;
  /** Textos que el SYSTEM debe conservar para que el modelo evaluado siga respondiendo en el formato exigido (el código rechaza propuestas sin ellos). */
  requiredText: readonly string[];
}

export type StageContract = DecisionContract | GenerativeContract;

const DECISION_KEY_MAP: Record<DecisionStage, string> = {
  d0: "buildFirstQuery",
  route: "buildRouteChoice",
  tool_choice: "buildToolChoice",
  args_review: "buildArgsReview",
  result_verification: "buildResultVerification",
  fragment_judge: "buildFragmentJudge",
  d5: "buildCompletionCheck",
  recovery: "buildRecovery",
  continuation: "buildContinuation",
};

const GENERATIVE_KEY_MAP: Record<GenerativeStage, string> = {
  plan: "PLAN_VIEW",
  arguments: "ARGUMENTS_VIEW",
  final: "FINAL_VIEW",
  question: "QUESTION",
  pending: "PENDING_VIEW",
};

const DECISION_CONTRACTS = Object.fromEntries(
  (Object.entries(DECISION_KEY_MAP) as Array<[DecisionStage, string]>).map(([stage, promptKey]) => [
    stage,
    { stage, requestType: "decision", promptGroup: "DECISION_PROMPTS", promptKey } satisfies DecisionContract,
  ]),
) as Record<DecisionStage, DecisionContract>;

const CONTRACTS: Record<StageName, StageContract> = {
  ...DECISION_CONTRACTS,
  plan: {
    stage: "plan",
    requestType: "generative",
    promptGroup: "PROMPTS",
    promptKey: GENERATIVE_KEY_MAP.plan,
    outputContract:
      "PROMPTS.PLAN_VIEW: { SYSTEM: string, buildUserPrompt(data: { readonly view: string; readonly maxSteps: number; readonly catalog?: string }): string }. Debe responder JSON {\"steps\":[{\"goal\",\"suggested_mcp\",\"expected_outcome\"}]} con rutas válidas de EXECUTABLE_ROUTES.",
    graderRules:
      "rejectTruncated: true. parsePlanStepsResult valida 1..maxSteps y rutas ejecutables. Graders: minSteps, maxSteps, allowedRoutes, requiredRoutes, firstRoute, requiredKeywordsInGoal, forbiddenKeywordsInGoal, forbiddenRepeatedGoals, forbiddenExecutedEffects, mustReflectFeedback.",
    requiredText: ["\"steps\"","suggested_mcp","expected_outcome"],
  },

  arguments: {
    stage: "arguments",
    requestType: "generative",
    promptGroup: "PROMPTS",
    promptKey: GENERATIVE_KEY_MAP.arguments,
    outputContract:
      "PROMPTS.ARGUMENTS_VIEW: { SYSTEM, osLine(platform), buildSystemPrompt(tool, platform), buildUserPrompt(data: ArgsViewPromptData) }. Respuesta JSON objeto que cumpla `tool.inputSchema`.",
    graderRules:
      "rejectTruncated: true. validateArgs contra toolSchema + graders: requiredFields, exactFieldValues, forbiddenHardcodedValues + postCheck(precheckCall en cliente real: valida sintaxis PowerShell y paths).",
    requiredText: ["JSON"],
  },

  final: {
    stage: "final",
    requestType: "generative",
    promptGroup: "PROMPTS",
    promptKey: GENERATIVE_KEY_MAP.final,
    outputContract:
      "PROMPTS.FINAL_VIEW: { SYSTEM: string, buildUserPrompt(data: { readonly view: string; readonly thread?: PreviousTask }): string }. Respuesta de texto plano (sin JSON ni <think>).",
    graderRules:
      "rejectTruncated: false. parseOutput extrae texto no vacío sin <think>. Graders: mustContainFacts, mustMentionEffects, forbiddenHallucinations (busca palabras/frases sin distinguir acentos; los números y nombres exactos importan).",
    requiredText: [],
  },

  question: {
    stage: "question",
    requestType: "generative",
    promptGroup: "PROMPTS",
    promptKey: GENERATIVE_KEY_MAP.question,
    outputContract:
      "PROMPTS.QUESTION: { SYSTEM: string, buildUserPrompt(data: QuestionPromptData): string }. Debe responder SOLO el texto de UNA pregunta corta.",
    graderRules:
      "rejectTruncated: false. Graders: maxChars, mustContainKeywords, forbiddenKeywords, singleQuestionOnly. No mencionar herramientas, IDs internos ni pasos internos.",
    requiredText: [],
  },

  pending: {
    stage: "pending",
    requestType: "generative",
    promptGroup: "PROMPTS",
    promptKey: GENERATIVE_KEY_MAP.pending,
    outputContract:
      "PROMPTS.PENDING_VIEW: { SYSTEM: string, buildUserPrompt(data: { readonly view: string; readonly thread?: PreviousTask }): string }. Debe responder JSON {\"pending\": string[]}.",
    graderRules:
      "rejectTruncated: true. parsePendingList exige arreglo de strings no vacíos (puede ser []). Graders: expectEmpty, maxItems, requiredKeywordsInFirst, forbiddenKeywords (no copiar comandos/herramientas/código en ítems).",
    requiredText: ["\"pending\""],
  },
};

export function getStageContract(stage: StageName): StageContract {
  const c = CONTRACTS[stage];
  if (!c) throw new Error(`Etapa '${stage}' sin contrato registrado en eval/auto/stageContract.ts.`);
  return c;
}

/** Contrato de una etapa generativa. Las de decisión no lo tienen: ver `DecisionContract`. */
export function getGenerativeContract(stage: StageName): GenerativeContract {
  const c = getStageContract(stage);
  if (c.requestType !== "generative") throw new Error(`La etapa '${stage}' es de decisión: no tiene un texto SYSTEM único.`);
  return c;
}
