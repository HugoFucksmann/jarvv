/**
 * eval/core/graders/pending.ts
 *
 * Grader de la etapa PENDING: la lista de pendientes del reactivo. El primer pendiente es la instrucción del paso; la lista
 * vacía significa que no queda nada por hacer.
 */

import type { Grader, PendingExpect, PendingOutput } from "../types.ts";
import { containsTerm } from "./common.ts";

export const PendingGrader: Grader<PendingOutput, PendingExpect> = {
  name: "pending",
  grade(output, expect, _ctx, col) {
    if (!output || !Array.isArray(output.pending)) {
      col.check("valid_pending", false, "Salida no contiene una lista de pendientes válida.");
      return;
    }

    const list = output.pending;
    col.measure("pending_items", list.length);

    if (expect.expectEmpty !== undefined) {
      col.check(
        "empty_as_expected",
        (list.length === 0) === expect.expectEmpty,
        expect.expectEmpty
          ? `Se esperaba la lista vacía (nada por hacer) pero trae ${list.length} pendiente(s).`
          : "Se esperaba al menos un pendiente pero la lista vino vacía.",
      );
    }

    if (expect.maxItems !== undefined) {
      col.check(
        "max_items_met",
        list.length <= expect.maxItems,
        `La lista tiene ${list.length} pendientes, más que el máximo (${expect.maxItems}).`,
      );
    }

    const first = list[0] ?? "";
    (expect.requiredKeywordsInFirst ?? []).forEach((kw, i) => {
      col.check(
        `first_keyword_${i}`,
        containsTerm(first, kw),
        `El primer pendiente no contiene la palabra clave esperada: '${kw}'`,
      );
    });

    (expect.forbiddenKeywords ?? []).forEach((bad, i) => {
      col.check(
        `no_forbidden_${i}`,
        !list.some((item) => containsTerm(item, bad)),
        `Algún pendiente contiene la palabra prohibida: '${bad}'`,
      );
    });
  },
};
