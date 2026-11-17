/**
 * eval/core/client/oracle.ts
 *
 * `--client=oracle`. Mock que conoce el `expect` del caso y delega en cada etapa
 * registrada (`stages/index.ts`) para fabricar la respuesta ideal.
 * No mide ningún modelo: verifica que el pipeline (carga → request → parseo → graders → scoring)
 * da 100 % con respuestas correctas. Si un caso falla con el oráculo, el bug está en el caso, en un
 * grader o en el parseo, no en el modelo.
 *
 * Limitación: el oráculo responde en los términos de la variante `prod` (claves de pregunta y opciones originales), y
 * `parseConfig` rechaza `--client=oracle` con cualquier otra variante.
 */

import { isRecord } from "../contract.ts";
import { getStage, hasStage } from "../stages/index.ts";
import type { OracleHelpers } from "../stages/index.ts";
import type { DecisionRequest, GenerativeRequest } from "../types.ts";
import type { DecisionCallContext } from "./decision.ts";
import type { GenerativeCallContext, PreparedRequest } from "./generative.ts";
import { mockPlanRoute } from "./mock.ts";

/** Probabilidad de la opción correcta. Alta para cumplir cualquier `minProbability` razonable. */
const HIT = 0.99;
const MISS = 0.01;

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec => (isRecord(v) ? v : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/**
 * Alternativas de un término de dataset: `a|b` coincide con `a` o con `b`; `\|` es un `|` literal.
 * Siempre devuelve al menos un elemento.
 */
function splitAlternatives(term: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < term.length; i++) {
    const ch = term[i];
    if (ch === "\\" && term[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  const out = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return out.length > 0 ? out : [term];
}

const firstAlt = (terms: string[]): string[] => terms.map((t) => splitAlternatives(t)[0]);
const allAlts = (terms: string[]): string[] => terms.flatMap(splitAlternatives);
const fold = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const oracleHelpers: OracleHelpers = { rec, strs, num, firstAlt, allAlts, fold, mockPlanRoute };

// ───────────────────────── Decisión ─────────────────────────

export function oracleDecisionResponder(_prepared: PreparedRequest, req: DecisionRequest, ctx?: DecisionCallContext): string {
  const expect = rec(ctx?.expect);
  const entry = ctx?.stage && hasStage(ctx.stage) ? getStage(ctx.stage) : undefined;
  const decEntry = entry?.requestType === "decision" ? entry : undefined;

  const answers: Record<string, unknown> = {};
  const extra = rec(expect.answers);
  for (const [key, q] of Object.entries(req.questions)) {
    const ex = rec(extra[key]);
    if (q.type === "noul") {
      const stageWant = decEntry?.oracleAnswer(key, q, expect);
      const want = typeof ex.yes === "boolean" ? ex.yes : typeof stageWant === "boolean" ? stageWant : true;
      answers[key] = { noul: want === false ? MISS : HIT };
      continue;
    }
    const options = Object.keys(q.criteria);
    const stageTarget = decEntry?.oracleAnswer(key, q, expect);
    const t = typeof ex.choice === "string" ? ex.choice : typeof stageTarget === "string" ? stageTarget : undefined;
    const pick = t !== undefined && options.includes(t) ? t : options[0];
    const probabilities: Record<string, number> = {};
    // Con una sola opción la probabilidad es 1 (si no, la suma quedaría en 0.99).
    for (const o of options) probabilities[o] = o === pick ? (options.length === 1 ? 1 : HIT) : MISS / Math.max(1, options.length - 1);
    answers[key] = { choice: pick, probabilities };
  }
  return JSON.stringify({ answers });
}

// ───────────────────────── Generativo ─────────────────────────

export function oracleGenerativeResponder(
  prepared: PreparedRequest,
  _req: GenerativeRequest,
  ctx?: GenerativeCallContext,
): string {
  const expect = rec(ctx?.expect);
  const stage = ctx?.stage;
  if (!stage || !hasStage(stage)) return "{}";
  const entry = getStage(stage);
  if (entry.requestType !== "generative") return "{}";
  return entry.oracleOutput(prepared, ctx, expect, oracleHelpers);
}