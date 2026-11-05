/**
 * eval/prompts/core/variants/apply.ts
 *
 * Aplica una variante a un caso frozen sin mutar el original (sección 7.1 y 5.3).
 * Si algo es inconsistente se lanza con un error `variant_apply_error`.
 */

import type { ChoiceQ, DecisionRequest, FrozenCase, GenerativeRequest } from "../types.ts";
import type { CriteriaEdit, DecisionStageVariant, GenerativeStageVariant, TextEdit, Variant } from "./types.ts";

/** Error lanzado por `applyVariant`; el runner lo captura y registra `variant_apply_error`. */
export class VariantApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariantApplyError";
  }
}

// ───────────────────────── TextEdit ─────────────────────────

function applyTextEdit(text: string, edit: TextEdit): string {
  if (typeof edit === "function") return edit(text);
  if (edit.replace !== undefined) return edit.replace;
  let out = text;
  if (edit.prepend) out = edit.prepend + out;
  if (edit.append) out = out + edit.append;
  return out;
}

// ───────────────────────── CriteriaEdit ─────────────────────────

function applyCriteriaEdit(
  criteria: Record<string, string>,
  edit: CriteriaEdit,
  context: string,
): Record<string, string> {
  let out = { ...criteria };

  // 1. remove
  for (const key of edit.remove ?? []) {
    if (!Object.hasOwn(out, key)) {
      throw new VariantApplyError(
        `variant_apply_error: se intentó eliminar la opción '${key}' que no existe en ${context}.`,
      );
    }
    delete out[key];
  }

  // 2. set
  if (edit.set) out = { ...out, ...edit.set };

  // 3. append
  if (edit.append) out = { ...out, ...edit.append };

  if (Object.keys(out).length === 0) {
    throw new VariantApplyError(
      `variant_apply_error: la edición de criterios en ${context} resultó en un objeto vacío.`,
    );
  }
  return out;
}

// ───────────────────────── DecisionRequest ─────────────────────────

function applyDecisionVariant(req: DecisionRequest, sv: DecisionStageVariant): DecisionRequest {
  let questions = { ...req.questions };

  // removeQuestions
  for (const key of sv.removeQuestions ?? []) {
    if (!Object.hasOwn(questions, key)) {
      throw new VariantApplyError(
        `variant_apply_error: removeQuestions apunta a la pregunta '${key}' que no existe.`,
      );
    }
    delete questions[key];
  }

  // addQuestions
  if (sv.addQuestions) {
    questions = { ...questions, ...sv.addQuestions };
  }

  // questions edits
  for (const [key, edit] of Object.entries(sv.questions ?? {})) {
    if (!Object.hasOwn(questions, key)) {
      throw new VariantApplyError(
        `variant_apply_error: questions apunta a la pregunta '${key}' que no existe.`,
      );
    }
    const q = questions[key];

    if (edit.replace) {
      questions[key] = edit.replace;
    } else {
      let newQ = { ...q };
      if (edit.instructions) {
        newQ = { ...newQ, instructions: applyTextEdit(newQ.instructions, edit.instructions) };
      }
      if (edit.criteria && newQ.type !== "choice") {
        // Antes se ignoraba en silencio y el A/B comparaba dos prompts idénticos.
        throw new VariantApplyError(
          `variant_apply_error: questions.${key}.criteria no aplica: la pregunta es de tipo '${newQ.type}' y no tiene criterios.`,
        );
      }
      if (edit.criteria && newQ.type === "choice") {
        const newCriteria = applyCriteriaEdit(
          (newQ as ChoiceQ).criteria,
          edit.criteria,
          `questions.${key}.criteria`,
        );
        newQ = { ...newQ, criteria: newCriteria } as ChoiceQ;
      }
      questions[key] = newQ;
    }
  }

  // Verificar que no quedan preguntas vacías (choice sin criteria)
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === "choice" && Object.keys((q as ChoiceQ).criteria).length === 0) {
      throw new VariantApplyError(
        `variant_apply_error: la pregunta '${key}' quedó sin criterios después de aplicar la variante.`,
      );
    }
  }

  if (Object.keys(questions).length === 0) {
    throw new VariantApplyError(
      "variant_apply_error: el request quedó sin preguntas después de aplicar la variante.",
    );
  }

  let state = req.state;
  if (sv.state) state = applyTextEdit(state, sv.state);

  return { ...req, state, questions };
}

// ───────────────────────── GenerativeRequest ─────────────────────────

function applyGenerativeVariant(req: GenerativeRequest, sv: GenerativeStageVariant): GenerativeRequest {
  let system = req.system;
  let user = req.user;

  if (sv.system) system = applyTextEdit(system, sv.system);
  if (sv.user) user = applyTextEdit(user, sv.user);

  const params = sv.params ?? {};
  return {
    ...req,
    system,
    user,
    ...(params.thinking !== undefined ? { thinking: params.thinking } : {}),
    ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.schema !== undefined ? { schema: params.schema } : {}),
    ...(params.reasoningEffort !== undefined ? { reasoningEffort: params.reasoningEffort } : {}),
  };
}

// ───────────────────────── Punto de entrada ─────────────────────────

/**
 * Aplica la variante al caso. Devuelve un caso nuevo (copias superficiales); el original no se muta.
 * Lanza `VariantApplyError` si algo es inconsistente.
 */
export function applyVariant(c: FrozenCase, variant: Variant): FrozenCase {
  const req = c.request;

  if (req.type === "decision") {
    const sv = variant.decision?.[c.stage as import("../types.ts").DecisionStage];
    if (!sv) return c; // variante no afecta esta etapa
    const newReq = applyDecisionVariant(req, sv);
    return { ...c, request: newReq };
  } else {
    const sv = variant.generative?.[c.stage as import("../types.ts").GenerativeStage];
    if (!sv) return c;
    const newReq = applyGenerativeVariant(req, sv);
    return { ...c, request: newReq };
  }
}

/**
 * Aplica una cadena de variantes en orden.
 * El acumulador es siempre el caso resultante del paso anterior.
 */
export function applyVariantChain(c: FrozenCase, variants: Variant[]): FrozenCase {
  return variants.reduce((acc, v) => applyVariant(acc, v), c);
}

