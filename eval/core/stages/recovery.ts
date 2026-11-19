/**
 * eval/core/stages/recovery.ts
 *
 * Etapa `recovery`: qué hacer cuando falla el paso de un ítem de la lista del reactivo. TODAVÍA no existe en el motor (`docs/pendientes/PENDIENTES_CODIGO.md` §9.1,
 * punto 6): el prompt base («prod») es `DECISION_PROMPTS.buildRecovery`, escrito en `src/` sin conectarlo al flujo, para medir cómo responde el modelo de decisión
 * antes de integrarla.
 *
 * Evalúa `buildRecovery(recoveryInput(ctx, previous, cause, attempts))`. Pregunta principal `action` (`choice`: close, rewrite_item, replan; no hay `skip_continue`). Una variante puede no traer
 * `action` y usar en su lugar dos `noul` (`blocked`, `prereq`) que esta etapa combina (ver `parseOutput`). Las reglas deterministas de `src/core/engine/recoveryRules.ts` no pasan por
 * acá: se miden contra los resultados guardados (`eval/GUIA_DECISION.md`, sección 5).
 */

import { recoveryInput } from "../../../src/core/engine/adapters.ts";
import type { StepFailureCause } from "../../../src/core/engine/outcomes.ts";
import { RECOVERY_ACTIONS, RECOVERY_KEY, STEP_FAILURE_CAUSES } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { RecoveryLabelGrader } from "../graders/label.ts";
import type { ChoiceQ, DecisionRequest, NoulQ, RecoveryExpect, RecoveryOutput } from "../types.ts";
import { DecisionParseError, extractNoul, mainChoice, parseAnswers } from "../variants/labels.ts";
import type { DecisionStageEntry } from "./index.ts";
import { checkRange01 } from "./shared.ts";

/** Claves de las dos preguntas `noul` de la variante por ejes (`recovery_two_axes`). */
const AXIS_BLOCKED_KEY = "blocked";
const AXIS_PREREQ_KEY = "prereq";

const isAction = (v: string): v is RecoveryOutput["action"] => (RECOVERY_ACTIONS as readonly string[]).includes(v);

export const recoveryStage: DecisionStageEntry<RecoveryOutput, RecoveryExpect> = {
  stageName: "recovery",
  requestType: "decision",
  expectSpec: {
    keys: { expectedAction: "string", minProbability: "number", answers: "object" },
    required: ["expectedAction"],
    enums: { expectedAction: RECOVERY_ACTIONS as readonly string[] },
    validate(expectObj, errs) {
      checkRange01(expectObj, ["minProbability"], errs);
    },
  },
  graders: [LatencyGrader, RecoveryLabelGrader],
  buildRequest(sc, ov, h) {
    if (sc.mode !== "reactive") throw new Error("etapa 'recovery': la recuperación tras un fallo solo existe en modo reactivo.");
    const { ctx } = h.buildContext(sc);
    const at = sc.at ?? {};
    const previous = at.previous ?? [];
    if (previous.length === 0) throw new Error("etapa 'recovery': scenario.at.previous debe traer la lista de la vuelta, con el ítem fallido de primero.");
    if (ctx.find("steps", { state: "failed" }).length === 0) throw new Error("etapa 'recovery': el escenario necesita un paso en estado 'failed' (el que acaba de fallar).");
    if (at.cause !== undefined && !(STEP_FAILURE_CAUSES as readonly string[]).includes(at.cause)) {
      throw new Error(`etapa 'recovery': scenario.at.cause '${at.cause}' no es una causa válida (${STEP_FAILURE_CAUSES.join(", ")}).`);
    }
    const attempts = at.attempts ?? 1;
    if (!Number.isInteger(attempts) || attempts < 1) throw new Error(`etapa 'recovery': scenario.at.attempts debe ser un entero >= 1 (recibido: ${attempts}).`);
    const cause = (at.cause ?? null) as StepFailureCause | null;
    return h.decision(h.effectivePrompts(ov).D.buildRecovery(recoveryInput(ctx, previous, cause, attempts)));
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest): RecoveryOutput {
    const answers = parseAnswers(rawOutput);
    const questions = sentReq.questions;
    let choice: string;
    let probabilities: Record<string, number>;
    if (questions[RECOVERY_KEY] !== undefined) {
      ({ choice, probabilities } = mainChoice("recovery", RECOVERY_KEY, answers, sentReq));
    } else if (questions[AXIS_BLOCKED_KEY] !== undefined && questions[AXIS_PREREQ_KEY] !== undefined) {
      // Variante por ejes (dos `noul`): bloqueado >= 0,5 → close; si no, falta un prerrequisito >= 0,5 → replan; si no, rewrite_item.
      const blocked = extractNoul(answers, AXIS_BLOCKED_KEY);
      const prereq = extractNoul(answers, AXIS_PREREQ_KEY);
      choice = blocked >= 0.5 ? "close" : prereq >= 0.5 ? "replan" : "rewrite_item";
      probabilities = { close: blocked, replan: (1 - blocked) * prereq, rewrite_item: (1 - blocked) * (1 - prereq) };
    } else {
      throw new DecisionParseError("La variante de 'recovery' no trae la pregunta 'action' ni los ejes 'blocked' y 'prereq'.");
    }
    if (isAction(choice)) return { action: choice, probabilities };
    throw new DecisionParseError(`La acción '${choice}' no es válida (${RECOVERY_ACTIONS.join("|")}).`);
  },
  label(output, expect) {
    const predicted = output?.action ?? null;
    const expected = expect?.expectedAction ?? null;
    const rawScore = output?.probabilities && predicted !== null ? (output.probabilities[predicted] ?? null) : null;
    return { predicted, expected, rawScore, probabilities: output?.probabilities ?? null };
  },
  mainQuestionBindings(req, canonicalExpected) {
    return req.questions[RECOVERY_KEY] === undefined ? [] : [{ question: RECOVERY_KEY, expected: canonicalExpected }];
  },
  oracleAnswer(key, q: ChoiceQ | NoulQ, expect) {
    return q.type === "choice" && key === RECOVERY_KEY ? expect.expectedAction : undefined;
  },
};
