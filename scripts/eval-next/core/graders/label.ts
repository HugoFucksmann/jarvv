/**
 * scripts/eval-next/core/graders/label.ts
 *
 * Graders de coincidencia de etiquetas para etapas de decisión (Decisión #1 a #4).
 */

import type {
  Grader,
  RouteOutput,
  RouteExpect,
  ToolChoiceOutput,
  ToolChoiceExpect,
  ArgsReviewOutput,
  ArgsReviewExpect,
  ResultVerificationOutput,
  ResultVerificationExpect,
} from "../types.ts";

export const RouteLabelGrader: Grader<RouteOutput, RouteExpect> = {
  name: "route_label",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("route_valid", false, "No se pudo obtener la decisión de ruta.");
      return;
    }

    if (expect.expectedAction) {
      const matchAction = output.action === expect.expectedAction;
      col.check(
        "action_match",
        matchAction,
        `Acción obtenida '${output.action}' difiere de la esperada '${expect.expectedAction}'.`
      );
    }

    if (expect.expectedRoute && output.action === "route") {
      const matchRoute = output.route === expect.expectedRoute;
      col.check(
        "route_match",
        matchRoute,
        `Ruta obtenida '${output.route}' difiere de la esperada '${expect.expectedRoute}'.`
      );
      const prob = output.probabilities?.[expect.expectedRoute];
      if (expect.minProbability !== undefined && prob !== undefined) {
        col.check(
          "min_probability_met",
          prob >= expect.minProbability,
          `Probabilidad ${prob.toFixed(3)} menor al mínimo ${expect.minProbability}.`
        );
      }
    }
  },
};

export const ToolChoiceLabelGrader: Grader<ToolChoiceOutput, ToolChoiceExpect> = {
  name: "tool_choice_label",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("tool_choice_valid", false, "No se pudo obtener la selección de herramienta.");
      return;
    }

    if (expect.expectedTool) {
      const match = output.selected === expect.expectedTool;
      col.check(
        "tool_match",
        match,
        `Herramienta seleccionada '${output.selected}' difiere de la esperada '${expect.expectedTool}'.`
      );

      const prob = output.probabilities?.[expect.expectedTool];
      if (expect.minProbability !== undefined && prob !== undefined) {
        col.check(
          "min_probability_met",
          prob >= expect.minProbability,
          `Probabilidad ${prob.toFixed(3)} menor al mínimo requerido ${expect.minProbability}.`
        );
      }
    }
  },
};

export const ArgsReviewLabelGrader: Grader<ArgsReviewOutput, ArgsReviewExpect> = {
  name: "args_review_label",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("args_review_valid", false, "No se pudo obtener la revisión de argumentos.");
      return;
    }

    const match = output.review === expect.expectedReview;
    col.check(
      "review_match",
      match,
      `Revisión obtenida '${output.review}' difiere de la esperada '${expect.expectedReview}'.`
    );

    const prob = output.probabilities?.[expect.expectedReview];
    if (expect.minProbability !== undefined && prob !== undefined) {
      col.check(
        "min_probability_met",
        prob >= expect.minProbability,
        `Probabilidad ${prob.toFixed(3)} menor al mínimo ${expect.minProbability}.`
      );
    }
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

    const matchOk = output.ok === expect.expectedOk;
    col.check(
      "ok_match",
      matchOk,
      `Veredicto 'ok' (${output.ok}) difiere del esperado (${expect.expectedOk}). Prob=${output.okProbability.toFixed(3)}`
    );

    const matchCumple = output.cumple === expect.expectedCumple;
    col.check(
      "cumple_match",
      matchCumple,
      `Veredicto 'cumple' (${output.cumple}) difiere del esperado (${expect.expectedCumple}). Prob=${output.cumpleProbability.toFixed(3)}`
    );

    if (expect.minOkProb !== undefined) {
      col.check(
        "min_ok_prob_met",
        output.okProbability >= expect.minOkProb,
        `Probabilidad ok ${output.okProbability.toFixed(3)} menor al mínimo ${expect.minOkProb}.`
      );
    }
    if (expect.minCumpleProb !== undefined) {
      col.check(
        "min_cumple_prob_met",
        output.cumpleProbability >= expect.minCumpleProb,
        `Probabilidad cumple ${output.cumpleProbability.toFixed(3)} menor al mínimo ${expect.minCumpleProb}.`
      );
    }
  },
};

