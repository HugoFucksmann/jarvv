/**
 * eval/variants/d0/d0_v06.ts
 *
 * D0 — variante v06 (Vuelta Manual 2):
 * Combina lo mejor de v04 y v05:
 * 1) En `chat`: explicaciones, preguntas conceptuales ("por qué pasa X", "qué significa error Y"),
 *    o capacidades ("¿vos podés hacer X?") son SIEMPRE chat.
 * 2) En `single`: exactamente UNA herramienta para UNA acción (incluso batch sobre múltiples archivos: mover 3 pdfs, zippear varias carpetas, o correr un test).
 * 3) En `multi`: cualquier secuencia de 2 o más herramientas:
 *    - Buscar archivo y luego leerlo (find then read).
 *    - Leer archivo y comparar con la web (read local package.json then check npm).
 *    - Leer portapapeles y guardar a archivo (clipboard then write).
 *    - Listar logs recientes y leer sus líneas (list then read).
 */

import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const KIND_CRITERIA: Record<string, string> = {
  chat: "Explanation, theory, meaning of errors/terms, conceptual questions (why CORS, why dates change), assistant capabilities (can you do X?), or small talk. No immediate actions.",
  single:
    "Exactly one single tool action: running one command/test, performing one batch file operation (moving 3 files, zipping folders, creating a file), downloading one file, or editing text.",
  multi:
    "Two or more sequential tool operations: find file then read its content, check local package.json then query npm, read clipboard then write to file, or find latest logs then read them.",
};

const MULTI_CRITERIA: { true: string; false: string } = {
  true: "Requires chaining two or more sequential tool actions (find then read, local check then web lookup, clipboard then write file, read then copy to clipboard).",
  false: "Requires only one tool action (including one batch operation across multiple files, or running one test), or purely conceptual discussion.",
};

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  const base = DECISION_PROMPTS.buildFirstQuery(data);
  const kindQ = base.questions.kind;
  const multiQ = base.questions.multi;
  if (kindQ.type !== "choice" || multiQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      kind: {
        ...kindQ,
        instructions:
          "Classify the request into the single appropriate category: " +
          "• 'chat': explanations, error diagnostics, or questions about capabilities (no tool execution). " +
          "• 'single': one tool operation (including batch operations like moving 3 files, creating a zip of folders, or running a test). " +
          "• 'multi': chaining two sequential tools (find file then read it, read local then check web, clipboard then save, find logs then inspect).",
        criteria: KIND_CRITERIA,
      },
      multi: {
        ...multiQ,
        criteria: MULTI_CRITERIA,
      },
    },
  };
}

const d0_v06: Variant = {
  name: "d0_v06",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};
export default d0_v06;
