/**
 * eval/core/case.ts
 *
 * Validación de un caso ya armado (el escenario del dataset más el `request` que generó la variante). Devuelve mensajes sin
 * ubicación: `datasets.ts` les antepone `archivo:línea:`.
 */

import { isRecord } from "./contract.ts";
import { allStageNames, getStage, hasStage } from "./stages/index.ts";
import type { ExpectKind } from "./stages/types.ts";
import type { Case, StageName } from "./types.ts";

/** Tag automático: decisión con una sola opción (producción omitiría la llamada). */
export const PROD_SHORTCUT_TAG = "prod_shortcut";

export type CaseValidation = { ok: true; case: Case } | { ok: false; errors: string[] };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function validateQuestion(key: string, q: unknown, errs: string[]): void {
  const at = `request.questions.${key}`;
  if (!isRecord(q)) {
    errs.push(`${at} debe ser un objeto.`);
    return;
  }
  if (q.type !== "choice" && q.type !== "noul") {
    errs.push(`${at}.type debe ser 'choice' o 'noul'.`);
    return;
  }
  if (typeof q.instructions !== "string") errs.push(`${at}.instructions debe ser string.`);
  if (q.type === "choice") {
    if (!isRecord(q.criteria) || Object.keys(q.criteria).length === 0) {
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
  if (!isRecord(r.questions) || Object.keys(r.questions).length === 0) {
    errs.push("request.questions debe ser un objeto con al menos una pregunta.");
    return;
  }
  for (const [key, q] of Object.entries(r.questions)) validateQuestion(key, q, errs);
}

function validateGenerativeRequest(r: Record<string, unknown>, errs: string[]): void {
  if (typeof r.system !== "string") errs.push("request.system debe ser string.");
  if (typeof r.user !== "string") errs.push("request.user debe ser string.");
  if (typeof r.json !== "boolean") errs.push("request.json debe ser booleano.");
  if (r.schema !== undefined && !isRecord(r.schema)) errs.push("request.schema debe ser un objeto.");
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

function matchesKind(v: unknown, kind: ExpectKind): boolean {
  switch (kind) {
    case "string": return typeof v === "string" && v.length > 0;
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "string[]": return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "boolean[]": return Array.isArray(v) && v.every((x) => typeof x === "boolean");
    case "object": return isRecord(v);
  }
}

/**
 * `expect.answers`: respuesta esperada de preguntas adicionales, por clave. Una pregunta que el request no trae
 * se acepta (puede agregarla una variante); si la trae, el tipo y la opción tienen que ser coherentes.
 */
function validateAnswers(answers: unknown, request: unknown, errs: string[]): void {
  if (answers === undefined) return;
  if (!isRecord(answers)) return; // el tipo ya lo reportó validateExpect
  const keys = Object.keys(answers);
  if (keys.length === 0) {
    errs.push("expect.answers no puede ser un objeto vacío (no generaría ningún check).");
    return;
  }
  const questions = isRecord(request) && isRecord(request.questions) ? request.questions : {};
  for (const key of keys) {
    const at = `expect.answers.${key}`;
    const a = answers[key];
    if (!isRecord(a)) {
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
    if (!isRecord(q)) continue;
    if (q.type === "choice") {
      if (!hasChoice) errs.push(`${at}: la pregunta '${key}' es choice; usá 'choice', no 'yes'.`);
      else if (isNonEmptyString(a.choice) && isRecord(q.criteria) && !Object.hasOwn(q.criteria, a.choice)) {
        errs.push(`${at}.choice '${a.choice}' no está en las opciones de la pregunta (${Object.keys(q.criteria).join(", ")}).`);
      }
    } else if (q.type === "noul" && !hasYes) {
      errs.push(`${at}: la pregunta '${key}' es noul; usá 'yes', no 'choice'.`);
    }
  }
}

/** Lista cerrada de claves: tomada del registro de la etapa (`stages/index.ts`). */
function validateExpect(stage: StageName, expectObj: Record<string, unknown>, errs: string[], request?: unknown): void {
  const spec = getStage(stage).expectSpec;
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
  for (const [key, allowed] of Object.entries(spec.enums ?? {})) {
    const v = expectObj[key];
    if (typeof v === "string" && !allowed.includes(v)) {
      errs.push(`expect.${key} '${v}' no es válido (válidos: ${allowed.join(", ")}).`);
    }
  }
  spec.validate?.(expectObj, errs, request);
  validateAnswers(expectObj.answers, request, errs);
}

function validateMeta(meta: unknown, errs: string[]): void {
  if (!isRecord(meta)) {
    errs.push("meta debe ser un objeto.");
    return;
  }
  if (meta.toolSchema !== undefined && !isRecord(meta.toolSchema)) errs.push("meta.toolSchema debe ser un objeto.");
  if (meta.origin !== undefined) {
    if (!isRecord(meta.origin) || !isNonEmptyString(meta.origin.id)) {
      errs.push("meta.origin debe ser un objeto con 'id' string.");
    } else if (meta.origin.commit !== undefined && typeof meta.origin.commit !== "string") {
      errs.push("meta.origin.commit debe ser string.");
    }
  }
}

/** Una sola opción en la pregunta de atajo declarada por la etapa → tag `prod_shortcut` (si no lo tiene ya). */
function withAutoTags(c: Case): Case {
  const tags = [...(c.tags ?? [])];
  const entry = getStage(c.stage);
  const key = entry.requestType === "decision" ? entry.shortcutQuestion : undefined;
  if (key && c.request.type === "decision") {
    const q = c.request.questions[key];
    if (q && q.type === "choice" && Object.keys(q.criteria).length === 1 && !tags.includes(PROD_SHORTCUT_TAG)) {
      tags.push(PROD_SHORTCUT_TAG);
    }
  }
  return { ...c, tags };
}

export function validateCase(raw: unknown): CaseValidation {
  if (!isRecord(raw)) return { ok: false, errors: ["La línea debe ser un objeto JSON."] };

  const errs: string[] = [];

  const CASE_KEYS = ["id", "stage", "tags", "description", "isRaw", "request", "expect", "meta"];
  for (const k of Object.keys(raw)) {
    if (!CASE_KEYS.includes(k)) errs.push(`clave desconocida '${k}' en el caso (válidas: ${CASE_KEYS.join(", ")}).`);
  }

  if (!isNonEmptyString(raw.id)) errs.push("id ausente o no es un string no vacío.");

  let stage: StageName | undefined;
  if (typeof raw.stage !== "string") {
    errs.push("stage ausente o no es string.");
  } else if (!hasStage(raw.stage)) {
    errs.push(`stage '${raw.stage}' no registrada (válidas: ${allStageNames().join(", ")}).`);
  } else {
    stage = raw.stage;
  }

  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== "string"))) {
    errs.push("tags debe ser un array de strings.");
  }
  if (raw.description !== undefined && typeof raw.description !== "string") errs.push("description debe ser string.");
  if (raw.isRaw !== undefined && typeof raw.isRaw !== "boolean") errs.push("isRaw debe ser booleano.");

  if (!isRecord(raw.request)) {
    errs.push("request ausente o no es un objeto.");
  } else if (stage) {
    const expectedType = getStage(stage).requestType;
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

  if (!isRecord(raw.expect)) errs.push("expect ausente o no es un objeto.");
  else if (stage) validateExpect(stage, raw.expect, errs, raw.request);

  if (raw.meta !== undefined) validateMeta(raw.meta, errs);

  if (errs.length > 0) return { ok: false, errors: errs };
  return { ok: true, case: withAutoTags(raw as unknown as Case) };
}