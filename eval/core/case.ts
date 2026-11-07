/**
 * eval/core/case.ts
 *
 * Validación de un caso frozen (secciones 5.1 y 10.3). Devuelve mensajes sin ubicación:
 * `datasets.ts` les antepone `archivo:línea:`.
 */

import { EXECUTABLE_ROUTES, isExecutableRoute } from "./contract.ts";
import type { DecisionStage, FrozenCase, GenerativeStage, StageName } from "./types.ts";

/**
 * Etapas conocidas por el eval. Cuando exista el registro de F3 (`stages/index.ts`) será la fuente de
 * verdad; esta lista debe coincidir con él.
 */
export const DECISION_STAGES: readonly DecisionStage[] = ["route", "tool_choice", "args_review", "result_verification"];
export const GENERATIVE_STAGES: readonly GenerativeStage[] = ["plan", "arguments", "final", "question", "pending"];
export const ALL_STAGES: readonly StageName[] = [...DECISION_STAGES, ...GENERATIVE_STAGES];

/** Tag automático de 7.9: decisión con una sola opción (producción omitiría la llamada). */
export const PROD_SHORTCUT_TAG = "prod_shortcut";

/** Pregunta cuya única opción dispara el atajo de producción, por etapa (10.2). */
const SHORTCUT_QUESTION: Partial<Record<StageName, string>> = {
  route: "route",
  tool_choice: "selected_tool",
};

export type CaseValidation = { ok: true; case: FrozenCase } | { ok: false; errors: string[] };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function validateQuestion(key: string, q: unknown, errs: string[]): void {
  const at = `request.questions.${key}`;
  if (!isObj(q)) {
    errs.push(`${at} debe ser un objeto.`);
    return;
  }
  if (q.type !== "choice" && q.type !== "noul") {
    errs.push(`${at}.type debe ser 'choice' o 'noul'.`);
    return;
  }
  if (typeof q.instructions !== "string") errs.push(`${at}.instructions debe ser string.`);
  if (q.type === "choice") {
    if (!isObj(q.criteria) || Object.keys(q.criteria).length === 0) {
      errs.push(`${at}.criteria debe ser un objeto no vacío.`);
    } else {
      for (const [opt, desc] of Object.entries(q.criteria)) {
        if (typeof desc !== "string") errs.push(`${at}.criteria.${opt} debe ser string.`);
      }
    }
  }
}

function validateDecisionRequest(r: Record<string, unknown>, errs: string[]): void {
  if (typeof r.state !== "string") errs.push("request.state debe ser string.");
  if (!isObj(r.questions) || Object.keys(r.questions).length === 0) {
    errs.push("request.questions debe ser un objeto con al menos una pregunta.");
    return;
  }
  for (const [key, q] of Object.entries(r.questions)) validateQuestion(key, q, errs);
}

function validateGenerativeRequest(r: Record<string, unknown>, errs: string[]): void {
  if (typeof r.system !== "string") errs.push("request.system debe ser string.");
  if (typeof r.user !== "string") errs.push("request.user debe ser string.");
  if (typeof r.json !== "boolean") errs.push("request.json debe ser booleano.");
  if (r.schema !== undefined && !isObj(r.schema)) errs.push("request.schema debe ser un objeto.");
  if (r.schemaName !== undefined && typeof r.schemaName !== "string") errs.push("request.schemaName debe ser string.");
  if (!Number.isInteger(r.maxTokens) || (r.maxTokens as number) <= 0) {
    errs.push("request.maxTokens debe ser un entero positivo.");
  }
  if (typeof r.temperature !== "number" || !Number.isFinite(r.temperature)) {
    errs.push("request.temperature debe ser un número.");
  }
  if (typeof r.thinking !== "boolean") errs.push("request.thinking debe ser booleano.");
  if (r.reasoningEffort !== undefined && typeof r.reasoningEffort !== "string") {
    errs.push("request.reasoningEffort debe ser string.");
  }
}

// ───────────────────────── Validación de `expect` por etapa ─────────────────────────

type ExpectKind = "string" | "number" | "boolean" | "string[]" | "object";
interface ExpectSpec {
  keys: Record<string, ExpectKind>;
  /** Al menos una de estas claves debe estar presente (un `expect` sin ningún check no es válido). */
  atLeastOne?: string[];
  required?: string[];
}

const EXPECT_SPECS: Record<StageName, ExpectSpec> = {
  route: {
    keys: { expectedAction: "string", expectedRoute: "string", minProbability: "number", answers: "object" },
    required: ["expectedAction"],
  },
  tool_choice: {
    keys: { expectedTool: "string", expectedAction: "string", minProbability: "number", answers: "object" },
    atLeastOne: ["expectedTool", "expectedAction"],
  },
  args_review: {
    keys: { expectedReview: "string", minProbability: "number", answers: "object" },
    required: ["expectedReview"],
  },
  result_verification: {
    keys: { expectedOk: "boolean", expectedCumple: "boolean", minOkProb: "number", minCumpleProb: "number", answers: "object" },
    required: ["expectedOk", "expectedCumple"],
  },
  plan: {
    keys: {
      minSteps: "number", maxSteps: "number", allowedRoutes: "string[]", requiredRoutes: "string[]",
      firstRoute: "string", requiredKeywordsInGoal: "string[]", forbiddenKeywordsInGoal: "string[]",
      forbiddenRepeatedGoals: "string[]", forbiddenExecutedEffects: "string[]", mustReflectFeedback: "string[]",
    },
    atLeastOne: [
      "minSteps", "maxSteps", "allowedRoutes", "requiredRoutes", "firstRoute", "requiredKeywordsInGoal",
      "forbiddenKeywordsInGoal", "forbiddenRepeatedGoals", "forbiddenExecutedEffects", "mustReflectFeedback",
    ],
  },
  arguments: {
    keys: { requiredFields: "string[]", exactFieldValues: "object", allowedRefTokens: "string[]", forbiddenHardcodedValues: "string[]" },
    atLeastOne: ["requiredFields", "exactFieldValues", "allowedRefTokens", "forbiddenHardcodedValues"],
  },
  final: {
    keys: { mustContainFacts: "string[]", mustMentionEffects: "string[]", forbiddenHallucinations: "string[]" },
    atLeastOne: ["mustContainFacts", "mustMentionEffects", "forbiddenHallucinations"],
  },
  question: {
    keys: { maxChars: "number", mustContainKeywords: "string[]", forbiddenKeywords: "string[]", singleQuestionOnly: "boolean" },
    atLeastOne: ["maxChars", "mustContainKeywords", "forbiddenKeywords", "singleQuestionOnly"],
  },
  pending: {
    keys: { expectEmpty: "boolean", maxItems: "number", requiredKeywordsInFirst: "string[]", forbiddenKeywords: "string[]" },
    atLeastOne: ["expectEmpty", "maxItems", "requiredKeywordsInFirst", "forbiddenKeywords"],
  },
};

const ENUM_VALUES: Partial<Record<StageName, Record<string, readonly string[]>>> = {
  route: { expectedAction: ["route", "fin", "ask_user"] },
  tool_choice: { expectedAction: ["tool", "ask_user"] },
  args_review: { expectedReview: ["approved", "args_invalid", "tool_rejected", "info_missing"] },
};

function matchesKind(v: unknown, kind: ExpectKind): boolean {
  switch (kind) {
    case "string": return typeof v === "string" && v.length > 0;
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "string[]": return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "object": return isObj(v);
  }
}

/**
 * `expect.answers`: respuesta esperada de preguntas adicionales, por clave. Una pregunta que el request no trae
 * se acepta (puede agregarla una variante); si la trae, el tipo y la opción tienen que ser coherentes.
 */
function validateAnswers(answers: unknown, request: unknown, errs: string[]): void {
  if (answers === undefined) return;
  if (!isObj(answers)) return; // el tipo ya lo reportó validateExpect
  const keys = Object.keys(answers);
  if (keys.length === 0) {
    errs.push("expect.answers no puede ser un objeto vacío (no generaría ningún check).");
    return;
  }
  const questions = isObj(request) && isObj(request.questions) ? request.questions : {};
  for (const key of keys) {
    const at = `expect.answers.${key}`;
    const a = answers[key];
    if (!isObj(a)) {
      errs.push(`${at} debe ser un objeto con 'choice' o 'yes'.`);
      continue;
    }
    for (const k of Object.keys(a)) {
      if (!["choice", "yes", "minProbability"].includes(k)) errs.push(`${at}.${k} no es una clave válida (válidas: choice, yes, minProbability).`);
    }
    const hasChoice = a.choice !== undefined;
    const hasYes = a.yes !== undefined;
    if (hasChoice === hasYes) {
      errs.push(`${at} necesita exactamente una de 'choice' (pregunta choice) o 'yes' (pregunta noul).`);
      continue;
    }
    if (hasChoice && !isNonEmptyString(a.choice)) errs.push(`${at}.choice debe ser un string no vacío.`);
    if (hasYes && typeof a.yes !== "boolean") errs.push(`${at}.yes debe ser booleano.`);
    if (a.minProbability !== undefined) {
      if (typeof a.minProbability !== "number" || !Number.isFinite(a.minProbability) || a.minProbability < 0 || a.minProbability > 1) {
        errs.push(`${at}.minProbability debe ser un número entre 0 y 1.`);
      } else if (a.yes === false) {
        errs.push(`${at}.minProbability contradice yes=false (la probabilidad medida es la de 'sí').`);
      }
    }
    const q = questions[key];
    if (!isObj(q)) continue;
    if (q.type === "choice") {
      if (!hasChoice) errs.push(`${at}: la pregunta '${key}' es choice; usá 'choice', no 'yes'.`);
      else if (isNonEmptyString(a.choice) && isObj(q.criteria) && !Object.hasOwn(q.criteria, a.choice)) {
        errs.push(`${at}.choice '${a.choice}' no está en las opciones de la pregunta (${Object.keys(q.criteria).join(", ")}).`);
      }
    } else if (q.type === "noul" && !hasYes) {
      errs.push(`${at}: la pregunta '${key}' es noul; usá 'yes', no 'choice'.`);
    }
  }
}

/** Lista cerrada de claves: un typo (`expectedRoutes`) o un `expect` sin checks se rechaza al cargar. */
function validateExpect(stage: StageName, expectObj: Record<string, unknown>, errs: string[], request?: unknown): void {
  const spec = EXPECT_SPECS[stage];
  for (const key of Object.keys(expectObj)) {
    if (!(key in spec.keys)) {
      errs.push(`expect.${key} no es una clave válida para la etapa '${stage}' (válidas: ${Object.keys(spec.keys).join(", ")}).`);
    }
  }
  for (const key of spec.required ?? []) {
    if (expectObj[key] === undefined) errs.push(`expect.${key} es obligatorio para la etapa '${stage}'.`);
  }
  if (spec.atLeastOne && !spec.atLeastOne.some((k) => expectObj[k] !== undefined)) {
    errs.push(`expect sin checks para la etapa '${stage}': definí al menos uno de ${spec.atLeastOne.join(", ")}.`);
  }
  for (const [key, kind] of Object.entries(spec.keys)) {
    const v = expectObj[key];
    if (v === undefined) continue;
    if (!matchesKind(v, kind)) errs.push(`expect.${key} debe ser ${kind}.`);
    else if (kind === "string[]" && (v as string[]).length === 0) errs.push(`expect.${key} no puede ser un array vacío.`);
  }
  for (const [key, allowed] of Object.entries(ENUM_VALUES[stage] ?? {})) {
    const v = expectObj[key];
    if (typeof v === "string" && !allowed.includes(v)) {
      errs.push(`expect.${key} '${v}' no es válido (válidos: ${allowed.join(", ")}).`);
    }
  }
  // Valores semánticos (un typo como "file" cargaría bien y fallaría siempre).
  const checkRoute = (key: string, v: unknown): void => {
    if (typeof v === "string" && !isExecutableRoute(v)) {
      errs.push(`expect.${key} '${v}' no es una ruta ejecutable (válidas: ${EXECUTABLE_ROUTES.join(", ")}).`);
    }
  };
  const checkRouteList = (key: string, v: unknown): void => {
    if (Array.isArray(v)) v.forEach((r) => checkRoute(`${key}[]`, r));
  };
  if (stage === "route") checkRoute("expectedRoute", expectObj.expectedRoute);
  if (stage === "plan") {
    checkRoute("firstRoute", expectObj.firstRoute);
    checkRouteList("allowedRoutes", expectObj.allowedRoutes);
    checkRouteList("requiredRoutes", expectObj.requiredRoutes);
  }
  for (const key of ["minProbability", "minOkProb", "minCumpleProb"]) {
    const v = expectObj[key];
    if (typeof v === "number" && Number.isFinite(v) && (v < 0 || v > 1)) {
      errs.push(`expect.${key} debe estar entre 0 y 1 (recibido: ${v}).`);
    }
  }
  for (const key of ["minSteps", "maxSteps", "maxChars", "maxItems"]) {
    const v = expectObj[key];
    if (typeof v === "number" && Number.isFinite(v) && (!Number.isInteger(v) || v < 1)) {
      errs.push(`expect.${key} debe ser un entero >= 1 (recibido: ${v}).`);
    }
  }
  if (
    typeof expectObj.minSteps === "number" && typeof expectObj.maxSteps === "number" &&
    expectObj.minSteps > expectObj.maxSteps
  ) {
    errs.push(`expect.minSteps (${expectObj.minSteps}) no puede ser mayor que expect.maxSteps (${expectObj.maxSteps}).`);
  }
  if (isObj(expectObj.exactFieldValues) && Object.keys(expectObj.exactFieldValues).length === 0) {
    errs.push("expect.exactFieldValues no puede ser un objeto vacío (no generaría ningún check).");
  }
  // Para `noul` la probabilidad es la de "sí": un mínimo solo tiene sentido si lo esperado es true.
  if (stage === "result_verification") {
    if (expectObj.minOkProb !== undefined && expectObj.expectedOk === false) {
      errs.push("expect.minOkProb contradice expectedOk=false (la probabilidad medida es la de 'sí').");
    }
    if (expectObj.minCumpleProb !== undefined && expectObj.expectedCumple === false) {
      errs.push("expect.minCumpleProb contradice expectedCumple=false (la probabilidad medida es la de 'sí').");
    }
  }
  validateAnswers(expectObj.answers, request, errs);
  // Coherencias entre claves.
  if (stage === "pending" && expectObj.expectEmpty === true && expectObj.requiredKeywordsInFirst !== undefined) {
    errs.push("expect.requiredKeywordsInFirst contradice expectEmpty=true (una lista vacía no tiene primer pendiente).");
  }
  if (stage === "route" && expectObj.expectedRoute !== undefined && expectObj.expectedAction !== "route") {
    errs.push("expect.expectedRoute solo aplica con expectedAction 'route'.");
  }
  if (stage === "route" && expectObj.expectedAction === "route" && expectObj.expectedRoute === undefined) {
    errs.push("expect.expectedRoute es obligatorio con expectedAction 'route'.");
  }
  if (stage === "tool_choice" && expectObj.expectedTool !== undefined && expectObj.expectedAction === "ask_user") {
    errs.push("expect.expectedTool y expectedAction 'ask_user' son excluyentes.");
  }
}

function validateMeta(meta: unknown, errs: string[]): void {
  if (!isObj(meta)) {
    errs.push("meta debe ser un objeto.");
    return;
  }
  if (meta.toolSchema !== undefined && !isObj(meta.toolSchema)) errs.push("meta.toolSchema debe ser un objeto.");
  if (meta.origin !== undefined) {
    if (!isObj(meta.origin) || !isNonEmptyString(meta.origin.id)) {
      errs.push("meta.origin debe ser un objeto con 'id' string.");
    } else if (meta.origin.commit !== undefined && typeof meta.origin.commit !== "string") {
      errs.push("meta.origin.commit debe ser string.");
    }
  }
}

/** Una sola opción en la pregunta de ruta/herramienta → tag `prod_shortcut` (si no lo tiene ya). */
function withAutoTags(c: FrozenCase): FrozenCase {
  const tags = [...(c.tags ?? [])];
  const key = SHORTCUT_QUESTION[c.stage];
  if (key && c.request.type === "decision") {
    const q = c.request.questions[key];
    if (q && q.type === "choice" && Object.keys(q.criteria).length === 1 && !tags.includes(PROD_SHORTCUT_TAG)) {
      tags.push(PROD_SHORTCUT_TAG);
    }
  }
  return { ...c, tags };
}

export function validateCase(raw: unknown): CaseValidation {
  if (!isObj(raw)) return { ok: false, errors: ["La línea debe ser un objeto JSON."] };

  const errs: string[] = [];

  const CASE_KEYS = ["id", "stage", "tags", "description", "isRaw", "request", "expect", "meta"];
  for (const k of Object.keys(raw)) {
    if (!CASE_KEYS.includes(k)) errs.push(`clave desconocida '${k}' en el caso (válidas: ${CASE_KEYS.join(", ")}).`);
  }

  if (!isNonEmptyString(raw.id)) errs.push("id ausente o no es un string no vacío.");

  let stage: StageName | undefined;
  if (typeof raw.stage !== "string") {
    errs.push("stage ausente o no es string.");
  } else if (!(ALL_STAGES as readonly string[]).includes(raw.stage)) {
    errs.push(`stage '${raw.stage}' no registrada (válidas: ${ALL_STAGES.join(", ")}).`);
  } else {
    stage = raw.stage as StageName;
  }

  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== "string"))) {
    errs.push("tags debe ser un array de strings.");
  }
  if (raw.description !== undefined && typeof raw.description !== "string") errs.push("description debe ser string.");
  if (raw.isRaw !== undefined && typeof raw.isRaw !== "boolean") errs.push("isRaw debe ser booleano.");

  if (!isObj(raw.request)) {
    errs.push("request ausente o no es un objeto.");
  } else if (stage) {
    const expectedType = (DECISION_STAGES as readonly string[]).includes(stage) ? "decision" : "generative";
    if (raw.request.type !== expectedType) {
      errs.push(
        `request.type '${String(raw.request.type)}' no corresponde a la etapa '${stage}' (se esperaba '${expectedType}').`,
      );
    } else if (expectedType === "decision") {
      validateDecisionRequest(raw.request, errs);
    } else {
      validateGenerativeRequest(raw.request, errs);
    }
  }

  if (!isObj(raw.expect)) errs.push("expect ausente o no es un objeto.");
  else if (stage) validateExpect(stage, raw.expect, errs, raw.request);

  if (raw.meta !== undefined) validateMeta(raw.meta, errs);

  if (errs.length > 0) return { ok: false, errors: errs };
  return { ok: true, case: withAutoTags(raw as unknown as FrozenCase) };
}
