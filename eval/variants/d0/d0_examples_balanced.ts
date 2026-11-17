import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: un ejemplo mínimo por clase (chat / single / multi) reduce los falsos `multi` en pedidos de una sola acción con detalle (ej. buscar con filtros) y aclara la frontera entre charla pura y una búsqueda/apertura.
function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "Classify the minimum tool work required by Request.",
        criteria: {
          chat: "No tools needed: greeting, thanks, capabilities, or timeless conceptual explanation (e.g. 'hola, explicame qué es un DNS').",
          single: "One tool step suffices: open one app, check/read/find one target, run one command, or do one web search (e.g. 'buscá la cotización del dólar hoy').",
          multi: "Requires 2+ separate actions or chaining one result into another (e.g. 'buscá el precio y guardalo en un archivo').",
        },
      },
      multi: {
        type: "noul",
        instructions: "Does Request genuinely require 2 or more separate tool actions (true), vs 0 or 1 tool action (false)?",
      },
    },
  };
}

const d0_examples_balanced: Variant = {
  name: "d0_examples_balanced",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_examples_balanced;
