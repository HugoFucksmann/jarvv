/**
 * eval/core/graders/label.ts
 *
 * Graders de coincidencia de etiquetas para las etapas de decisión.
 */

import type {
  ArgsReviewExpect,
  ArgsReviewOutput,
  FragmentJudgeExpect,
  FragmentJudgeOutput,
  Grader,
  GraderCollector,
  ResultVerificationExpect,
  ResultVerificationOutput,
  D0Expect,
  D0Output,
  RouteExpect,
  RouteOutput,
  ToolChoiceExpect,
  ToolChoiceOutput,
} from "../types.ts";

/**
 * Si el caso pide un mínimo, la probabilidad DEBE existir: sin dato el check falla
 * (antes se saltaba en silencio y el caso pasaba sin verificar nada).
 */
function checkMinProbability(
  col: GraderCollector,
  key: string,
  label: string,
  prob: number | undefined,
  min: number | undefined,
): void {
  if (min === undefined) return;
  if (prob === undefined || !Number.isFinite(prob)) {
    col.check(key, false, `Se pidió probabilidad mínima ${min} para '${label}' pero la salida no trae su probabilidad.`);
    return;
  }
  col.check(key, prob >= min, `Probabilidad ${prob.toFixed(3)} de '${label}' menor al mínimo ${min}.`);
}

export const D0LabelGrader: Grader<D0Output, D0Expect> = {
  name: "d0_label",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("d0_valid", false, "No se pudo obtener la decisión D0.");
      return;
    }
    col.check("kind_match", output.kind === expect.expectedKind, `D0 decidió '${output.kind}' y se esperaba '${expect.expectedKind}'.`);
    const chat = output.probabilities.chat;
    if (expect.minChatProbability !== undefined) checkMinProbability(col, "min_chat_probability_met", "chat", chat, expect.minChatProbability);
    if (expect.maxChatProbability !== undefined) {
      col.check(
        "max_chat_probability_met",
        typeof chat === "number" && chat <= expect.maxChatProbability,
        `Probabilidad ${typeof chat === "number" ? chat.toFixed(3) : "?"} de 'chat' mayor al máximo ${expect.maxChatProbability}.`,
      );
    }
  },
};

export const RouteLabelGrader: Grader<RouteOutput, RouteExpect> = {
  name: "route_label",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("route_valid", false, "No se pudo obtener la decisión de ruta.");
      return;
    }

    col.check(
      "route_match",
      output.route === expect.expectedRoute,
      `Ruta obtenida '${output.route}' difiere de la esperada '${expect.expectedRoute}'.`,
    );

    checkMinProbability(col, "min_probability_met", expect.expectedRoute, output.probabilities?.[expect.expectedRoute], expect.minProbability);
  },
};

export const ToolChoiceLabelGrader: Grader<ToolChoiceOutput, ToolChoiceExpect> = {
  name: "tool_choice_label",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("tool_choice_valid", false, "No se pudo obtener la selección de herramienta.");
      return;
    }

    col.check(
      "tool_match",
      output.selected === expect.expectedTool,
      `Herramienta seleccionada '${output.selected}' difiere de la esperada '${expect.expectedTool}'.`,
    );

    checkMinProbability(col, "min_probability_met", expect.expectedTool, output.probabilities?.[expect.expectedTool], expect.minProbability);
  },
};

export const ArgsReviewLabelGrader: Grader<ArgsReviewOutput, ArgsReviewExpect> = {
  name: "args_review_label",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("args_review_valid", false, "No se pudo obtener la revisión de argumentos.");
      return;
    }

    col.check(
      "review_match",
      output.review === expect.expectedReview,
      `Revisión obtenida '${output.review}' difiere de la esperada '${expect.expectedReview}'.`,
    );

    checkMinProbability(
      col,
      "min_probability_met",
      expect.expectedReview,
      output.probabilities?.[expect.expectedReview],
      expect.minProbability,
    );
  },
};

export const ResultVerificationGrader: Grader<ResultVerificationOutput, ResultVerificationExpect> = {
  name: "result_verification",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("verification_valid", false, "No se pudo obtener la verificación de resultado.");
      return;
    }

    col.measure("ok_prob", output.okProbability);
    col.measure("cumple_prob", output.cumpleProbability);

    col.check(
      "ok_match",
      output.ok === expect.expectedOk,
      `Veredicto 'ok' (${output.ok}) difiere del esperado (${expect.expectedOk}). Prob=${output.okProbability.toFixed(3)}`,
    );

    col.check(
      "cumple_match",
      output.cumple === expect.expectedCumple,
      `Veredicto 'cumple' (${output.cumple}) difiere del esperado (${expect.expectedCumple}). Prob=${output.cumpleProbability.toFixed(3)}`,
    );

    // Para `noul` la probabilidad es la de "sí"; un mínimo solo tiene sentido si lo esperado es true.
    if (expect.minOkProb !== undefined) {
      checkMinProbability(col, "min_ok_prob_met", "ok", output.okProbability, expect.minOkProb);
    }
    if (expect.minCumpleProb !== undefined) {
      checkMinProbability(col, "min_cumple_prob_met", "cumple", output.cumpleProbability, expect.minCumpleProb);
    }
  },
};

export const FragmentJudgeGrader: Grader<FragmentJudgeOutput, FragmentJudgeExpect> = {
  name: "fragment_judge",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("judge_valid", false, "No se pudo obtener el puntaje de los fragmentos.");
      return;
    }
    col.check(
      "fragment_count_match",
      output.relevant.length === expect.expectedRelevant.length,
      `El juez puntuó ${output.relevant.length} fragmentos y el caso espera ${expect.expectedRelevant.length}.`,
    );
    expect.expectedRelevant.forEach((want, i) => {
      const p = output.probabilities[i];
      if (p === undefined) return;
      col.measure(`f${i}_prob`, p);
      col.check(
        `fragment_${i}_match`,
        output.relevant[i] === want,
        `Fragmento ${i}: el juez dice ${output.relevant[i] ? "relevante" : "no relevante"} (p=${p.toFixed(3)}) y se esperaba ${want ? "relevante" : "no relevante"}.`,
      );
      if (want) checkMinProbability(col, `fragment_${i}_min_probability`, `f${i}`, p, expect.minProbability);
    });
  },
};
