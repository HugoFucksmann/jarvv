/**
 * eval/prompts/core/graders/label.ts
 *
 * Graders de coincidencia de etiquetas para las etapas de decisión.
 */

import { ASK_USER } from "../contract.ts";
import type {
  ArgsReviewExpect,
  ArgsReviewOutput,
  Grader,
  GraderCollector,
  ResultVerificationExpect,
  ResultVerificationOutput,
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

export const RouteLabelGrader: Grader<RouteOutput, RouteExpect> = {
  name: "route_label",
  grade(output, expect, _ctx, col) {
    if (!output) {
      col.check("route_valid", false, "No se pudo obtener la decisión de ruta.");
      return;
    }

    col.check(
      "action_match",
      output.action === expect.expectedAction,
      `Acción obtenida '${output.action}' difiere de la esperada '${expect.expectedAction}'.`,
    );

    if (expect.expectedAction === "route" && expect.expectedRoute) {
      col.check(
        "route_match",
        output.action === "route" && output.route === expect.expectedRoute,
        `Ruta obtenida '${output.route}' difiere de la esperada '${expect.expectedRoute}'.`,
      );
    }

    // La clave de probabilidad es la ruta (si la acción esperada es route) o la acción (fin / ask_user).
    const probKey = expect.expectedAction === "route" ? expect.expectedRoute : expect.expectedAction;
    if (probKey !== undefined) {
      checkMinProbability(col, "min_probability_met", probKey, output.probabilities?.[probKey], expect.minProbability);
    } else if (expect.minProbability !== undefined) {
      col.check("min_probability_met", false, "minProbability requiere expectedRoute cuando expectedAction es 'route'.");
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
      col.check(
        "tool_match",
        output.selected === expect.expectedTool,
        `Herramienta seleccionada '${output.selected}' difiere de la esperada '${expect.expectedTool}'.`,
      );
    }

    if (expect.expectedAction === "ask_user") {
      col.check(
        "ask_user_match",
        output.selected === ASK_USER,
        `Se esperaba '${ASK_USER}' pero se seleccionó '${output.selected}'.`,
      );
    }

    // `expectedAction: "tool"` sin `expectedTool`: cualquier herramienta, pero no ask_user.
    if (expect.expectedAction === "tool") {
      col.check(
        "tool_action_match",
        output.selected !== ASK_USER,
        `Se esperaba una herramienta pero se seleccionó '${ASK_USER}'.`,
      );
    }

    const target = expect.expectedTool ?? (expect.expectedAction === "ask_user" ? ASK_USER : undefined);
    if (target !== undefined) {
      checkMinProbability(col, "min_probability_met", target, output.probabilities?.[target], expect.minProbability);
    } else if (expect.minProbability !== undefined) {
      col.check("min_probability_met", false, "minProbability requiere expectedTool o expectedAction 'ask_user'.");
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
