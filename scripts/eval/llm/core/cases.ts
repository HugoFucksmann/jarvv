/**
 * Constructores de casos. Un dataset solo necesita importar este archivo:
 *
 *   import { planCase, replanCase, argsCase, finalCase } from "../core/cases.ts";
 *   export const testCases = [ planCase({...}, {...}), ... ];
 *
 * Qué resuelven frente a escribir el LlmTestCase a mano:
 *  - `stage` se escribe una sola vez (antes: stage + input.prompt.stage, que debían coincidir).
 *  - `expect` se pasa plano (antes: expect.<stage>).
 *  - argsCase deriva `cleanedSchema` de `tool.inputSchema` y trae un `environment` por defecto.
 *  - replanCase activa mustNotRepeatEffects / mustNotRepeatCompleted cuando se dan las listas
 *    (en el evaluador, la lista sin el flag no hace nada).
 *
 * Los tipos de datos salen de LlmPromptInput (types.ts); no se agrega ningún import de src.
 */
import type {
  ArgumentsEvaluationExpectation,
  FinalResponseEvaluationExpectation,
  LlmPromptInput,
  LlmTestCase,
  PlanEvaluationExpectation,
  ReplanEvaluationExpectation,
} from "./types.ts";

export type {
  ArgumentsEvaluationExpectation,
  FinalResponseEvaluationExpectation,
  LlmTestCase,
  PlanEvaluationExpectation,
  ReplanEvaluationExpectation,
};

type DataOf<S extends "replan" | "arguments" | "final_response"> = Extract<LlmPromptInput, { stage: S }>["data"];
type ArgsData = DataOf<"arguments">;

/** Campos comunes a todos los casos. `thinking` pisa el default de la etapa (ver STAGE_SPECS). */
export interface CaseMeta {
  id: string;
  category: string;
  description: string;
  notes?: string;
  thinking?: boolean;
}

/** Rutas de esta PC para los casos de arguments (valores neutros; cámbialos si el caso depende de ellos). */
export const DEFAULT_ENV = {
  home: "C:\\Users\\eval",
  desktop: "C:\\Users\\eval\\Desktop",
  documents: "C:\\Users\\eval\\Documents",
  downloads: "C:\\Users\\eval\\Downloads",
} as unknown as ArgsData["environment"];

export function planCase(
  spec: CaseMeta & {
    goal: string;
    chatContext?: string;
    /** Si se omite, producción usa buildCompactCatalog() (catálogo vivo de src). Fíjalo para reproducibilidad. */
    compactCatalog?: string;
    modificationFeedback?: string;
    existingPlanSummary?: string;
  },
  expect: PlanEvaluationExpectation = {}
): LlmTestCase {
  const { id, category, description, notes, thinking, ...prompt } = spec;
  return {
    id,
    stage: "plan",
    category,
    description,
    notes,
    input: { thinking, prompt: { stage: "plan", ...prompt } },
    expect: { plan: expect },
  };
}

export function replanCase(
  spec: CaseMeta & { data: DataOf<"replan"> },
  expect: ReplanEvaluationExpectation = {}
): LlmTestCase {
  const { id, category, description, notes, thinking, data } = spec;
  const normalized: ReplanEvaluationExpectation = {
    ...expect,
    mustNotRepeatEffects: expect.mustNotRepeatEffects ?? !!expect.effects?.length,
    mustNotRepeatCompleted: expect.mustNotRepeatCompleted ?? !!expect.completedSteps?.length,
  };
  return {
    id,
    stage: "replan",
    category,
    description,
    notes,
    input: { thinking, prompt: { stage: "replan", data } },
    expect: { replan: normalized },
  };
}

export function argsCase(
  spec: CaseMeta &
    Omit<ArgsData, "tool" | "cleanedSchema" | "environment"> & {
      tool: { name: string; description?: string; inputSchema: Record<string, unknown> };
      /** Por defecto, tool.inputSchema. */
      cleanedSchema?: Record<string, unknown>;
      /** Por defecto, DEFAULT_ENV. */
      environment?: ArgsData["environment"];
    },
  expect: ArgumentsEvaluationExpectation = {}
): LlmTestCase {
  const { id, category, description, notes, thinking, tool, cleanedSchema, environment, ...rest } = spec;
  const data = {
    ...rest,
    tool,
    cleanedSchema: cleanedSchema ?? tool.inputSchema,
    environment: environment ?? DEFAULT_ENV,
  } as unknown as ArgsData;
  return {
    id,
    stage: "arguments",
    category,
    description,
    notes,
    input: { thinking, prompt: { stage: "arguments", data } },
    expect: { arguments: { tool: tool.name, ...expect } },
  };
}

export function finalCase(
  spec: CaseMeta & { data: DataOf<"final_response"> },
  expect: FinalResponseEvaluationExpectation = {}
): LlmTestCase {
  const { id, category, description, notes, thinking, data } = spec;
  return {
    id,
    stage: "final_response",
    category,
    description,
    notes,
    input: { thinking, prompt: { stage: "final_response", data } },
    expect: { final_response: expect },
  };
}