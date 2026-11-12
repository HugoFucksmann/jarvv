/**
 * eval/core/client/oracle.ts
 *
 * `--client=oracle`. Mock que conoce el `expect` del caso y responde lo que lo satisface.
 * No mide ningún modelo: verifica que el pipeline (carga → request → parseo → graders → scoring)
 * da 100 % con respuestas correctas. Si un caso falla con el oráculo, el bug está en el caso, en un
 * grader o en el parseo, no en el modelo.
 *
 * Limitación: el oráculo responde en los términos de la variante `prod` (claves de pregunta y opciones originales), y
 * `parseConfig` rechaza `--client=oracle` con cualquier otra variante. Con `prod` no hay preguntas adicionales: solo responde
 * las principales (`route`, `selected_tool`, `review`, `ok`/`cumple`).
 */

import type { DecisionRequest, GenerativeRequest } from "../types.ts";
import type { DecisionCallContext } from "./decision.ts";
import type { GenerativeCallContext, PreparedRequest } from "./generative.ts";
import { mockPlanRoute } from "./mock.ts";

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

/** Texto a escribir por cada término (primera alternativa). */
function firstAlt(terms: string[]): string[] {
  return terms.map((t) => splitAlternatives(t)[0]);
}

/** Todas las alternativas de una lista de términos prohibidos (basta que aparezca una para fallar). */
function allAlts(terms: string[]): string[] {
  return terms.flatMap(splitAlternatives);
}

// ───────────────────────── Decisión ─────────────────────────

/** Opción de `criteria` que satisface el expect de la etapa (o undefined si el caso no la fija). */
function targetChoice(stage: string | undefined, expect: Rec, options: string[]): string | undefined {
  switch (stage) {
    case "route":
      return expect.expectedRoute as string | undefined;
    case "tool_choice":
      return typeof expect.expectedTool === "string" ? expect.expectedTool : options[0];
    case "args_review":
      return expect.expectedReview as string | undefined;
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
      // Juez de fragmentos: la pregunta `f<i>` se responde con `expectedRelevant[i]`.
      const frag = ctx?.stage === "fragment_judge" ? /^f(\d+)$/.exec(key) : null;
      const fragWant = frag && Array.isArray(expect.expectedRelevant) ? expect.expectedRelevant[Number(frag[1])] : undefined;
      const want = typeof fragWant === "boolean" && typeof ex.yes !== "boolean" ? fragWant : typeof ex.yes === "boolean" ? ex.yes : key === "ok" ? expect.expectedOk : key === "cumple" ? expect.expectedCumple : true;
      answers[key] = { noul: want === false ? MISS : HIT };
      continue;
    }
    const options = Object.keys(q.criteria);
    const t = typeof ex.choice === "string" ? ex.choice : targetChoice(ctx?.stage, expect, options);
    const pick = t !== undefined && options.includes(t) ? t : options[0];
    const probabilities: Record<string, number> = {};
    // Con una sola opción la probabilidad es 1 (si no, la suma quedaría en 0.99).
    for (const o of options) probabilities[o] = o === pick ? (options.length === 1 ? 1 : HIT) : MISS / Math.max(1, options.length - 1);
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
  const words = firstAlt([...strs(expect.requiredKeywordsInGoal), ...strs(expect.mustReflectFeedback)]);

  const steps = Array.from({ length: count }, (_, i) => ({
    goal: i === 0 ? ["Plan step", ...words].join(" ") : `Plan step ${i + 1}`,
    suggested_mcp: routes[Math.min(i, routes.length - 1)],
    expected_outcome: "Step completed",
  }));
  return JSON.stringify({ steps });
}

/**
 * Valor que cumple el schema de una propiedad (JSON Schema simple): respeta `const`, `enum`, el tipo y los límites
 * numéricos, y rellena los `required` de objetos y los `minItems` de arrays. Sin schema o con tipo desconocido, un string.
 * Mismos valores base que `mock.ts` (0, true, [], {}, "mock"), así los casos que ya pasaban no cambian.
 */
function valueFor(schema: unknown, bad: (s: string) => boolean = () => false, depth = 0): unknown {
  const s = rec(schema);
  if ("const" in s) return s.const;
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    // Primer valor del enum que el caso no prohíbe (`forbiddenHardcodedValues`); si todos están prohibidos, el primero.
    return s.enum.find((e) => !(typeof e === "string" && bad(e))) ?? s.enum[0];
  }
  const t = s.type;
  const type = Array.isArray(t) ? t.find((x) => x !== "null") : t;
  // Sin `type` pero con ramas `anyOf`/`oneOf`: se toma la primera que no sea `null` (si no, saldría siempre un string).
  if (type === undefined && depth < 4) {
    const branches = [...(Array.isArray(s.anyOf) ? s.anyOf : []), ...(Array.isArray(s.oneOf) ? s.oneOf : [])];
    const branch = branches.find((b) => rec(b).type !== "null");
    if (branch !== undefined) return valueFor(branch, bad, depth + 1);
  }
  switch (type) {
    case "number":
    case "integer": {
      let n = 0;
      const min = num(s.minimum);
      const exMin = num(s.exclusiveMinimum);
      const max = num(s.maximum);
      if (min !== undefined && n < min) n = min;
      if (exMin !== undefined && n <= exMin) n = exMin + 1;
      if (max !== undefined && n > max) n = max;
      return type === "integer" ? Math.ceil(n) : n;
    }
    case "boolean":
      return true;
    case "array": {
      const minItems = num(s.minItems) ?? 0;
      if (minItems <= 0 || depth >= 4) return [];
      return Array.from({ length: minItems }, () => valueFor(s.items, bad, depth + 1));
    }
    case "object": {
      const out: Rec = {};
      if (depth >= 4) return out;
      const props = rec(s.properties);
      for (const key of strs(s.required)) out[key] = valueFor(props[key], bad, depth + 1);
      return out;
    }
    default:
      return "mock";
  }
}

function oracleArgs(ctx: GenerativeCallContext | undefined, expect: Rec): string {
  const schema = rec(ctx?.toolSchema);
  const props = rec(schema.properties);
  // Mismo criterio que el grader de `arguments` para `forbiddenHardcodedValues`: sin distinguir mayúsculas ni `\` / `/`.
  const foldPath = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  const forbidden = strs(expect.forbiddenHardcodedValues).map(foldPath).filter((w) => w.length > 0);
  const bad = (v: string) => forbidden.some((w) => foldPath(v).includes(w));
  const args: Rec = {};
  // Parámetros `required` del schema de la herramienta, con un valor del tipo correcto.
  for (const key of strs(schema.required)) args[key] = valueFor(props[key], bad);
  // Campos que el caso exige aunque el schema los deje opcionales: también con su tipo (antes siempre "value",
  // que fallaba la validación en parámetros `number` o con `enum`). Si el campo no existe en el schema, se mantiene "value".
  for (const f of strs(expect.requiredFields)) {
    if (args[f] === undefined) args[f] = props[f] === undefined ? "value" : valueFor(props[f], bad);
  }
  Object.assign(args, rec(expect.exactFieldValues));
  return JSON.stringify(args);
}

/** Minúsculas y sin tildes: comparación conservadora (si algo coincide así, coincide con cualquier criterio más estricto). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Una sola pregunta que cumple el `expect`: contiene `mustContainKeywords`, no contiene ninguna `forbiddenKeywords` y cabe en
 * `maxChars`. Se prueba una lista de candidatas en orden (la primera es la de siempre) y se usa la primera válida.
 */
function oracleQuestion(expect: Rec): string {
  const kws = firstAlt(strs(expect.mustContainKeywords));
  const forbidden = allAlts(strs(expect.forbiddenKeywords)).map(fold).filter((w) => w.length > 0);
  const max = num(expect.maxChars);
  const candidates =
    kws.length > 0
      ? [`¿Podrías indicarme ${kws.join(" ")}?`, `¿${kws.join(" ")}?`]
      : [
        "¿Cuál es el nombre del archivo?",
        "¿Qué nombre debo usar?",
        "¿Dónde lo guardo?",
        "¿Puedes darme más detalles?",
        "¿Podrías aclararme eso?",
        // Casos con pedido en inglés: prohíben las palabras en español.
        "Could you give me more details?",
        "Which one do you mean?",
      ];
  const valid = (t: string) => !forbidden.some((w) => fold(t).includes(w)) && (max === undefined || t.length <= max);
  const text = candidates.find(valid) ?? candidates[0];
  return max !== undefined && text.length > max ? text.slice(0, Math.max(1, max - 1)) + "?" : text;
}

/** Lista vacía si el caso la espera vacía; si no, un pendiente con las palabras clave que pide el `expect`. */
function oraclePending(expect: Rec): string {
  if (expect.expectEmpty === true) return JSON.stringify({ pending: [] });
  return JSON.stringify({ pending: [["Next action", ...firstAlt(strs(expect.requiredKeywordsInFirst))].join(" ")] });
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
      return ["Listo.", ...firstAlt(strs(expect.mustContainFacts)), ...firstAlt(strs(expect.mustMentionEffects))].join(" ");
    case "question":
      return oracleQuestion(expect);
    case "pending":
      return oraclePending(expect);
    default:
      return "{}";
  }
}