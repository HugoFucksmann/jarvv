/**
 * eval/core/stages/pending.ts
 *
 * Etapa generativa `pending`: lista de pendientes del modo reactivo.
 */

import { pendingInput } from "../../../src/core/engine/adapters.ts";
import { pendingStageRequest } from "../../../src/core/models/stageRequests.ts";
import { NOT_JSON_ERROR, parseJsonObject, parsePendingList } from "../contract.ts";
import { LatencyGrader, NotTruncatedGrader } from "../graders/common.ts";
import { PendingGrader } from "../graders/pending.ts";
import type { PendingExpect, PendingOutput } from "../types.ts";
import type { GenerativeStageEntry } from "./index.ts";
import { checkIntMin1, noLabel } from "./shared.ts";

export const pendingStage: GenerativeStageEntry<PendingOutput, PendingExpect> = {
  stageName: "pending",
  requestType: "generative",
  rejectTruncated: true,
  expectSpec: {
    keys: { expectEmpty: "boolean", maxItems: "number", requiredKeywordsInFirst: "string[]", forbiddenKeywords: "string[]" },
    atLeastOne: ["expectEmpty", "maxItems", "requiredKeywordsInFirst", "forbiddenKeywords"],
    validate(expectObj, errs) {
      checkIntMin1(expectObj, ["maxItems"], errs);
      if (expectObj.expectEmpty === true && expectObj.requiredKeywordsInFirst !== undefined) {
        errs.push("expect.requiredKeywordsInFirst contradice expectEmpty=true (una lista vacía no tiene primer pendiente).");
      }
    },
  },
  graders: [LatencyGrader, NotTruncatedGrader, PendingGrader],
  buildRequest(sc, ov, h) {
    if (sc.mode !== "reactive") throw new Error("etapa 'pending': la lista de pendientes solo existe en modo reactivo.");
    const { ctx } = h.buildContext(sc);
    const at = sc.at ?? {};
    return {
      request: h.generative(pendingStageRequest(pendingInput(ctx, at.previous ?? []), h.effectivePrompts(ov).P), "pending"),
    };
  },
  parseOutput(rawOutput: string): PendingOutput {
    const obj = parseJsonObject(rawOutput);
    if (!obj) throw new Error(NOT_JSON_ERROR);
    // Variante con objetos (`pending2`): se descartan los ítems sin `goal` y el grader valida la estructura.
    if (Array.isArray(obj.pending) && obj.pending.some((it) => typeof it !== "string")) {
      const goals = obj.pending.flatMap((it) => {
        const goal = (it as { goal?: unknown } | null)?.goal;
        return typeof goal === "string" && goal.trim() ? [goal.trim()] : [];
      });
      return { pending: goals, rich: obj.pending };
    }
    // La misma validación que producción: arreglo de textos no vacíos (puede venir vacío).
    const parsed = parsePendingList(obj.pending);
    if ("error" in parsed) throw new Error(parsed.error);
    return { pending: parsed.pending };
  },
  label: noLabel,
  oracleOutput(_prepared, _ctx, expect, h) {
    if (expect.expectEmpty === true) return JSON.stringify({ pending: [] });
    return JSON.stringify({ pending: [["Next action", ...h.firstAlt(h.strs(expect.requiredKeywordsInFirst))].join(" ")] });
  },
};
