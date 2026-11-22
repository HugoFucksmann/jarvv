/**
 * eval/core/stages/pending.ts
 *
 * Etapa generativa `pending`: lista de pendientes del modo reactivo.
 */

import { NOT_JSON_ERROR, parseJsonObject, parsePendingList, pendingInput, pendingStageRequest, previousTaskOf } from "../contract.ts";
import type { PreviousTask } from "../contract.ts";
import { LatencyGrader, NotTruncatedGrader } from "../graders/common.ts";
import { PendingGrader } from "../graders/pending.ts";
import type { PendingExpect, PendingOutput } from "../types.ts";
import { checkIntMin1, noLabel } from "./shared.ts";
import type { GenerativeStageEntry } from "./types.ts";

export const pendingStage: GenerativeStageEntry<PendingOutput, PendingExpect> = {
  stageName: "pending",
  requestType: "generative",
  rejectTruncated: true,
  expectSpec: {
    keys: { expectEmpty: "boolean", maxItems: "number", requiredKeywordsInFirst: "string[]", forbiddenKeywords: "string[]" },
    atLeastOne: ["expectEmpty", "maxItems", "requiredKeywordsInFirst", "forbiddenKeywords"],
    validate(expectObj, errs) {
      checkIntMin1(expectObj, ["maxItems"], errs);
      // Sin esto una lista vacía (o con cualquier cosa) pasaría: hay que decir si la lista debe venir vacía o por qué ítem empieza.
      if (expectObj.expectEmpty === undefined && expectObj.requiredKeywordsInFirst === undefined) {
        errs.push("expect debe incluir expectEmpty o requiredKeywordsInFirst: sin uno de los dos no se mide si la lista tiene que traer algo.");
      }
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
    const t = sc.recalled?.thread;
    const thread: PreviousTask | undefined =
      t && (t.previous_request !== undefined || t.previous_answer !== undefined)
        ? previousTaskOf(t.previous_request ?? "", t.previous_answer ?? "")
        : undefined;
    const input = { ...pendingInput(ctx, at.previous ?? []), ...(thread ? { thread } : {}) };
    return {
      request: h.generative(pendingStageRequest(input, h.effectivePrompts(ov).P), "pending"),
    };
  },
  parseOutput(rawOutput: string): PendingOutput {
    const obj = parseJsonObject(rawOutput);
    if (!obj) throw new Error(NOT_JSON_ERROR);
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
