/**
 * eval/core/stages/final.ts
 *
 * Etapa generativa `final`: respuesta final al usuario.
 */

import { finalRenderOptions, finalViewOptions } from "../../../src/core/engine/adapters.ts";
import { finalStageRequest } from "../../../src/core/models/stageRequests.ts";
import { renderFinal } from "../../../src/core/render/index.ts";
import { stripThink } from "../contract.ts";
import { LatencyGrader, NotTruncatedGrader } from "../graders/common.ts";
import { FinalResponseGrader } from "../graders/final.ts";
import type { FinalExpect, FinalOutput } from "../types.ts";
import type { GenerativeStageEntry } from "./index.ts";
import { noLabel } from "./shared.ts";

export const finalStage: GenerativeStageEntry<FinalOutput, FinalExpect> = {
  stageName: "final",
  requestType: "generative",
  rejectTruncated: false,
  expectSpec: {
    keys: { mustContainFacts: "string[]", mustMentionEffects: "string[]", forbiddenHallucinations: "string[]" },
    atLeastOne: ["mustContainFacts", "mustMentionEffects", "forbiddenHallucinations"],
  },
  graders: [LatencyGrader, NotTruncatedGrader, FinalResponseGrader],
  buildRequest(sc, ov, h) {
    const { ctx } = h.buildContext(sc);
    return {
      request: h.generative(
        finalStageRequest({ view: renderFinal(ctx.view.forFinal(finalViewOptions()), finalRenderOptions()).text }, h.config(), h.effectivePrompts(ov).P),
      ),
    };
  },
  parseOutput(rawOutput: string): FinalOutput {
    const response = stripThink(rawOutput).trim();
    if (!response) throw new Error("salida vacía");
    return { response };
  },
  label: noLabel,
  oracleOutput(_prepared, _ctx, expect, h) {
    return ["Listo.", ...h.firstAlt(h.strs(expect.mustContainFacts)), ...h.firstAlt(h.strs(expect.mustMentionEffects))].join(" ");
  },
};
