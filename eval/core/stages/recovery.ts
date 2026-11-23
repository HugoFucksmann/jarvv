/**
 * eval/core/stages/recovery.ts
 *
 * Etapa `recovery`: qué hacer cuando falla el paso de un ítem de la lista del reactivo. En el motor corre en **modo sombra** (`src/core/engine/recoveryShadow.ts`, `PENDIENTES_CODIGO.md` §9.1, punto 1): el prompt base («prod») es `DECISION_PROMPTS.buildRecovery`, y el eval mide cómo responde el modelo de decisión con esos casos.
 *
 * Evalúa `buildRecovery(recoveryInput(ctx, previous, cause, attempts))`. Pregunta principal `action` (`choice`: close, rewrite_item, replan; no hay `skip_continue`). Las reglas deterministas de `src/core/engine/recoveryRules.ts` no pasan por
 * acá: se miden contra los resultados guardados (`eval/GUIA_DECISION.md`, sección 5).
 */

import { RECOVERY_ACTIONS, RECOVERY_KEY, recoveryInput, STEP_FAILURE_CAUSES } from "../contract.ts";
import type { StepFailureCause } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { RecoveryLabelGrader } from "../graders/label.ts";
import type { ChoiceQ, DecisionRequest, NoulQ, RecoveryExpect, RecoveryOutput } from "../types.ts";
import { DecisionParseError, mainChoice, parseAnswers } from "../variants/labels.ts";
import { checkRange01 } from "./shared.ts";
import type { DecisionStageEntry } from "./types.ts";

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
    const consecutiveFailed = ctx.consecutiveFailures();
    if (at.attempts !== undefined) {
      if (!Number.isInteger(at.attempts) || at.attempts < 1) {
        throw new Error(`etapa 'recovery': scenario.at.attempts debe ser un entero >= 1 (recibido: ${at.attempts}).`);
      }
      if (at.attempts !== consecutiveFailed) {
        throw new Error(
          `etapa 'recovery': scenario.at.attempts (${at.attempts}) debe coincidir con los pasos fallidos seguidos en scenario.steps (${consecutiveFailed}), igual que en producción.`,
        );
      }
    }
    const attempts = Math.max(1, consecutiveFailed);
    const cause = (at.cause ?? null) as StepFailureCause | null;
    return h.decision(h.effectivePrompts(ov).D.buildRecovery(recoveryInput(ctx, previous, cause, attempts)));
  },
  validateRequest(req) {
    const act = req.questions[RECOVERY_KEY];
    if (act?.type !== "choice") {
      return `recovery requiere pregunta choice '${RECOVERY_KEY}'.`;
    }
    for (const opt of RECOVERY_ACTIONS) {
      if (!(opt in act.criteria)) {
        return `recovery.action.criteria debe incluir '${opt}'.`;
      }
    }
    return null;
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest): RecoveryOutput {
    const answers = parseAnswers(rawOutput);
    const { choice, probabilities } = mainChoice("recovery", RECOVERY_KEY, answers, sentReq);
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
