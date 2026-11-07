/**
 * eval/core/client/oracle.ts
 *
 * `--client=oracle`. Mock que conoce el `expect` del caso y responde lo que lo satisface.
 * No mide ningún modelo: verifica que el pipeline (carga → request → parseo → graders → scoring)
 * da 100 % con respuestas correctas. Si un caso falla con el oráculo, el bug está en el caso, en un
 * grader o en el parseo, no en el modelo.
 *
 * Limitación: el oráculo responde en los términos de la variante `prod` (claves de pregunta y opciones
 * originales). Con variantes que renombran preguntas u opciones (`labelMap`, `answerMap`) cae a la primera
 * opción; sirve para validar casos, no variantes.
 */

import type { DecisionRequest, GenerativeRequest } from "../types.ts";
import type { DecisionCallContext } from "./decision.ts";
import type { GenerativeCallContext, PreparedRequest } from "./generative.ts";
import { mockArgsFor, mockPlanRoute } from "./mock.ts";

/** Probabilidad de la opción correcta. Alta para cumplir cualquier `minProbability` razonable. */
const HIT = 0.99;
const MISS = 0.01;

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {};
}
function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

// ───────────────────────── Decisión ─────────────────────────

/** Opción de `criteria` que satisface el expect de la etapa (o undefined si el caso no la fija). */
function targetChoice(stage: string | undefined, expect: Rec, options: string[]): string | undefined {
  switch (stage) {
    case "route":
      return expect.expectedAction === "route" ? (expect.expectedRoute as string | undefined) : (expect.expectedAction as string | undefined);
    case "tool_choice":
      if (typeof expect.expectedTool === "string") return expect.expectedTool;
      if (expect.expectedAction === "ask_user") return "ask_user";
      // `tool` sin herramienta concreta: cualquiera salvo ask_user.
      return options.find((o) => o !== "ask_user");
    case "args_review":
      return expect.expectedReview as string | undefined;
    case "result_verification":
      // Variantes con una pregunta `choice` de cuatro vías (`matches`, `mismatch`, `failed`, `unconfirmed`).
      return expect.expectedCumple === true ? "matches" : expect.expectedOk === false ? "failed" : "mismatch";
    default:
      return undefined;
  }
}

export function oracleDecisionResponder(_prepared: PreparedRequest, req: DecisionRequest, ctx?: DecisionCallContext): string {
  const expect = rec(ctx?.expect);
  const answers: Record<string, unknown> = {};
  const extra = rec(expect.answers);
  for (const [key, q] of Object.entries(req.questions)) {
    // Pregunta adicional con respuesta esperada explícita (`expect.answers`): se responde eso.
    const ex = rec(extra[key]);
    if (q.type === "noul") {
      const review = ctx?.stage === "args_review" ? expect.expectedReview : undefined;
      // Variantes de `args_review` con preguntas binarias: la respuesta "buena" sale de la etiqueta esperada.
      // `args_invalid` aquí es una pregunta de problema (sí = hay problema); `args_grounded` es de bienestar (sí = todo bien).
      const fromReview = key === "args_grounded" ? review !== "args_invalid" : key === "args_invalid" ? review === "args_invalid" : key === "needs_user" ? review === "info_missing" : undefined;
      // Variantes de `result_verification` con preguntas sí/no por dimensión.
      const fromVerify = key === "effect_ok" ? expect.expectedOk !== false : key === "target_ok" || key === "content_ok" ? expect.expectedCumple === true : undefined;
      const want = typeof ex.yes === "boolean" ? ex.yes : fromReview !== undefined ? fromReview : fromVerify !== undefined ? fromVerify : key === "ok" ? expect.expectedOk : key === "cumple" ? expect.expectedCumple : true;
      answers[key] = { noul: want === false ? MISS : HIT };
      continue;
    }
    const options = Object.keys(q.criteria);
    const t = typeof ex.choice === "string" ? ex.choice : targetChoice(ctx?.stage, expect, options);
    const pick = t !== undefined && options.includes(t) ? t : options[0];
    const probabilities: Record<string, number> = {};
    for (const o of options) probabilities[o] = o === pick ? HIT : MISS / Math.max(1, options.length - 1);
    answers[key] = { choice: pick, probabilities };
  }
  return JSON.stringify({ answers });
}

// ───────────────────────── Generativo ─────────────────────────

function oraclePlan(prepared: PreparedRequest, expect: Rec): string {
  const minSteps = num(expect.minSteps) ?? 1;
  const maxSteps = num(expect.maxSteps) ?? Infinity;
  const allowed = strs(expect.allowedRoutes);
  const required = strs(expect.requiredRoutes);
  const first = typeof expect.firstRoute === "string" ? expect.firstRoute : undefined;

  const routes: string[] = [];
  if (first) routes.push(first);
  for (const r of required) if (!routes.includes(r)) routes.push(r);
  if (routes.length === 0) routes.push(allowed[0] ?? mockPlanRoute(prepared));

  const count = Math.min(maxSteps, Math.max(minSteps, routes.length, 1));
  const words = [...strs(expect.requiredKeywordsInGoal), ...strs(expect.mustReflectFeedback)];

  const steps = Array.from({ length: count }, (_, i) => ({
    goal: i === 0 ? ["Plan step", ...words].join(" ") : `Plan step ${i + 1}`,
    suggested_mcp: routes[Math.min(i, routes.length - 1)],
    expected_outcome: "Step completed",
  }));
  return JSON.stringify({ steps });
}

function oracleArgs(ctx: GenerativeCallContext | undefined, expect: Rec): string {
  const args = JSON.parse(mockArgsFor(ctx?.toolSchema)) as Rec;
  for (const f of strs(expect.requiredFields)) if (args[f] === undefined) args[f] = "value";
  Object.assign(args, rec(expect.exactFieldValues));
  return JSON.stringify(args);
}

function oracleQuestion(expect: Rec): string {
  const kws = strs(expect.mustContainKeywords);
  const text = kws.length > 0 ? `¿Podrías indicarme ${kws.join(" ")}?` : "¿Cuál es el nombre del archivo?";
  const max = num(expect.maxChars);
  return max !== undefined && text.length > max ? text.slice(0, Math.max(1, max - 1)) + "?" : text;
}

/** Lista vacía si el caso la espera vacía; si no, un pendiente con las palabras clave que pide el `expect`. */
function oraclePending(expect: Rec): string {
  if (expect.expectEmpty === true) return JSON.stringify({ pending: [] });
  return JSON.stringify({ pending: [["Next action", ...strs(expect.requiredKeywordsInFirst)].join(" ")] });
}

export function oracleGenerativeResponder(
  prepared: PreparedRequest,
  _req: GenerativeRequest,
  ctx?: GenerativeCallContext,
): string {
  const expect = rec(ctx?.expect);
  switch (ctx?.stage) {
    case "plan":
      return oraclePlan(prepared, expect);
    case "arguments":
      return oracleArgs(ctx, expect);
    case "final":
      return ["Listo.", ...strs(expect.mustContainFacts), ...strs(expect.mustMentionEffects)].join(" ");
    case "question":
      return oracleQuestion(expect);
    case "pending":
      return oraclePending(expect);
    default:
      return "{}";
  }
}
