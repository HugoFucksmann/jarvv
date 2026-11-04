/**
 * scripts/eval-next/core/stages/arguments.ts
 *
 * Etapa ARGUMENTS (LLM 2): Generación de argumentos para herramientas MCP.
 * Usa ARGUMENTS_VIEW de producción, renderArgs y validateArgs.
 */

import { PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import { parseJsonObject, stripThink, validateArgs } from "../../../../src/core/reasoner/qwen.ts";
import { renderArgs } from "../../../../src/core/render/args.ts";
import { argsRenderOptions } from "../../../../src/core/engine/adapters.ts";
import { cleanInputSchema } from "../../../../src/core/utils.ts";
import { LatencyGrader, NonEmptyOutputGrader, NotTruncatedGrader } from "../graders/common.ts";
import { ArgumentsGrader } from "../graders/arguments.ts";
import type {
  ArgumentsExpect,
  ArgumentsInput,
  ArgumentsOutput,
  GenerativeModelRequest,
  ParseResult,
  PromptVariant,
  StageDefinition,
} from "../types.ts";

export const ArgumentsStage: StageDefinition<ArgumentsInput, ArgumentsOutput, ArgumentsExpect> = {
  name: "arguments",
  defaultClient: "generative",
  defaultThinking: false,
  maxTokensKey: "arguments",

  build(input: ArgumentsInput, variant: PromptVariant): GenerativeModelRequest {
    let viewText: string;
    if (input.mode === "raw") {
      viewText = input.text;
    } else {
      viewText = renderArgs(input.view, argsRenderOptions()).text;
    }

    const env = input.environment || {
      home: "C:\\Users\\eval",
      desktop: "C:\\Users\\eval\\Desktop",
      documents: "C:\\Users\\eval\\Documents",
      downloads: "C:\\Users\\eval\\Downloads",
    };

    const cleanedSchema = cleanInputSchema(input.tool.inputSchema) as Record<string, unknown>;
    const system = variant.systemOverride || PROMPTS.ARGUMENTS_VIEW.buildSystemPrompt(input.tool);
    const user = PROMPTS.ARGUMENTS_VIEW.buildUserPrompt({
      environment: env as any,
      tool: input.tool,
      cleanedSchema,
      view: viewText,
    });

    return {
      type: "generative",
      system,
      user: variant.userPrefix ? `${variant.userPrefix}\n${user}` : user,
      json: true,
      thinking: false,
    };
  },

  parse(raw: string, input: ArgumentsInput): ParseResult<ArgumentsOutput> {
    const cleaned = stripThink(raw).trim();
    if (!cleaned) {
      return { ok: false, error: "Salida de argumentos vacía tras remover <think>." };
    }

    const parsed = parseJsonObject(cleaned);
    if (!parsed) {
      return { ok: false, error: "La salida no es un objeto JSON parseable." };
    }

    // null en un parámetro opcional equivale a "no usado"
    const required = input.tool.inputSchema.required || [];
    for (const k of Object.keys(parsed)) {
      if (parsed[k] === null && !required.includes(k)) {
        delete parsed[k];
      }
    }

    const problem = validateArgs(parsed, input.tool.inputSchema);
    if (problem) {
      return { ok: false, error: `Schema inválido: ${problem}` };
    }

    return {
      ok: true,
      value: { args: parsed },
    };
  },

  graders: [NotTruncatedGrader, NonEmptyOutputGrader, LatencyGrader, ArgumentsGrader],
};

