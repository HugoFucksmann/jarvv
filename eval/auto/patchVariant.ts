/**
 * eval/auto/patchVariant.ts
 *
 * Variantes de etapas de DECISIÓN armadas por código. El modelo optimizador solo escribe textos (instrucción de cada pregunta,
 * descripción de cada opción y una nota de estado); este módulo valida esos textos y genera el archivo `.ts` de la variante, que
 * envuelve la función de producción (`DECISION_PROMPTS.<fn>`) y reemplaza solo esos textos. El modelo no escribe código.
 */

import { PROMPTS } from "../../src/core/models/prompts.ts";
import { loadDatasets, type RawDatasetCache } from "../core/datasets.ts";
import type { DecisionRequest, StageName } from "../core/types.ts";
import type { Variant } from "../core/variants/types.ts";

export interface PromptPatch {
  /** Pregunta → instrucción nueva. */
  instructions?: Record<string, string>;
  /** Pregunta → opción → descripción nueva (solo preguntas `choice`). */
  criteria?: Record<string, Record<string, string>>;
  /** Línea breve que se antepone al estado. */
  stateNote?: string;
}

export interface QuestionShape {
  key: string;
  type: "choice" | "noul";
  /** Unión de las opciones de esa pregunta en todos los casos (vacío en `noul`). */
  options: string[];
}

/** Parte fija de una instrucción que cambia de un caso a otro: lo de antes y lo de después del texto propio del caso. */
export interface DynamicSplit {
  before: string;
  after: string;
}

export interface DecisionShape {
  questions: QuestionShape[];
  /** Preguntas cuya instrucción incluye texto propio de cada caso (p. ej. el fragmento a juzgar): el texto editable lleva `{{DATA}}` en su lugar. */
  dynamic?: Record<string, DynamicSplit>;
}

/** Marcador del texto propio de cada caso dentro de una instrucción editable. */
export const DATA_MARK = "{{DATA}}";

/** Preguntas `f0`, `f1`… son la misma pregunta repetida: se editan juntas bajo `f*`. */
export function groupOf(key: string): string {
  return /\d+$/.test(key) ? `${key.replace(/\d+$/, "")}*` : key;
}

/**
 * Si los textos difieren entre casos, separa lo fijo (prefijo y sufijo comunes, cortados en un salto de línea o un espacio para no entrar
 * en el texto de un caso) de lo que cambia. Devuelve undefined si todos son iguales.
 */
export function splitDynamic(texts: readonly string[]): DynamicSplit | undefined {
  const unique = [...new Set(texts)];
  if (unique.length < 2) return undefined;
  const minLen = Math.min(...unique.map((x) => x.length));
  let p = 0;
  while (p < minLen && unique.every((x) => x[p] === unique[0][p])) p++;
  let s = 0;
  while (s < minLen - p && unique.every((x) => x[x.length - 1 - s] === unique[0][unique[0].length - 1 - s])) s++;
  const head = unique[0].slice(0, p);
  const nl = head.lastIndexOf("\n");
  const sp = head.lastIndexOf(" ");
  // Si el prefijo es un texto completo (el más corto), no se corta: lo que sigue en los otros es lo propio del caso.
  if (p < minLen) p = nl >= 0 ? nl + 1 : sp >= 0 ? sp + 1 : 0;
  const tail = unique[0].slice(unique[0].length - s);
  const tnl = tail.indexOf("\n");
  const tsp = tail.indexOf(" ");
  if (p + s < minLen || s < minLen) s = tnl >= 0 ? s - tnl : tsp >= 0 ? s - tsp : 0;
  return { before: unique[0].slice(0, p), after: s > 0 ? unique[0].slice(unique[0].length - s) : "" };
}

export const PATCH_LIMITS = { instruction: 1200, criterion: 500, stateNote: 500 } as const;

/** Todos los requests de decisión de la etapa, armados con los prompts de `variant` (o los de producción). */
export function collectDecisionRequests(
  stage: StageName,
  datasetPaths: string[],
  variant?: Variant,
  rawCache?: RawDatasetCache,
): DecisionRequest[] {
  const out: DecisionRequest[] = [];
  for (const ds of loadDatasets(datasetPaths, { stages: [stage] }, variant, rawCache)) {
    for (const c of ds.cases) if (c.request.type === "decision") out.push(c.request);
  }
  return out;
}

/** Preguntas y opciones que existen en la etapa (unión sobre todos los casos; `f0`, `f1`… se agrupan en `f*`). */
export function shapeFromRequests(requests: readonly DecisionRequest[]): DecisionShape {
  const byKey = new Map<string, QuestionShape>();
  const texts = new Map<string, string[]>();
  for (const req of requests) {
    for (const [rawKey, q] of Object.entries(req.questions)) {
      const key = groupOf(rawKey);
      const entry = byKey.get(key) ?? { key, type: q.type, options: [] };
      if (q.type === "choice") {
        for (const opt of Object.keys(q.criteria)) if (!entry.options.includes(opt)) entry.options.push(opt);
      }
      byKey.set(key, entry);
      const list = texts.get(key);
      if (list) list.push(q.instructions);
      else texts.set(key, [q.instructions]);
    }
  }
  const dynamic: Record<string, DynamicSplit> = {};
  for (const [key, list] of texts) {
    const split = splitDynamic(list);
    if (split) dynamic[key] = split;
  }
  return { questions: [...byKey.values()], ...(Object.keys(dynamic).length > 0 ? { dynamic } : {}) };
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkText(value: unknown, max: number, where: string, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${where}: debe ser un texto no vacío.`);
    return null;
  }
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > max) {
    errors.push(`${where}: tiene ${text.length} caracteres y el máximo es ${max}.`);
    return null;
  }
  return text;
}

/**
 * Valida lo que escribió el modelo contra las preguntas y opciones reales de la etapa. Los errores van en español y se le devuelven
 * tal cual en el pedido de reparación.
 */
export function patchFromRaw(
  raw: { instructions?: unknown; criteria?: unknown; state_note?: unknown },
  shape: DecisionShape,
): { patch?: PromptPatch; errors: string[] } {
  const errors: string[] = [];
  const patch: PromptPatch = {};
  const keys = shape.questions.map((q) => q.key);
  const known = (key: string): QuestionShape | undefined => shape.questions.find((q) => q.key === key);

  if (raw.instructions !== undefined && raw.instructions !== null) {
    if (!isRec(raw.instructions)) {
      errors.push("`instructions` debe ser un objeto {pregunta: texto}.");
    } else {
      for (const [key, value] of Object.entries(raw.instructions)) {
        if (!known(key)) {
          errors.push(`instructions.${key}: la pregunta no existe (preguntas válidas: ${keys.join(", ")}).`);
          continue;
        }
        const text = checkText(value, PATCH_LIMITS.instruction, `instructions.${key}`, errors);
        if (text !== null && shape.dynamic?.[key] && text.split(DATA_MARK).length !== 2) {
          errors.push(`instructions.${key}: debe contener \`${DATA_MARK}\` exactamente una vez, donde va el texto propio de cada caso (como en el texto actual).`);
        } else if (text !== null) {
          patch.instructions ??= {};
          patch.instructions[key] = text;
        }
      }
    }
  }

  if (raw.criteria !== undefined && raw.criteria !== null) {
    if (!isRec(raw.criteria)) {
      errors.push("`criteria` debe ser un objeto {pregunta: {opción: texto}}.");
    } else {
      for (const [key, options] of Object.entries(raw.criteria)) {
        const q = known(key);
        if (!q) {
          errors.push(`criteria.${key}: la pregunta no existe (preguntas válidas: ${keys.join(", ")}).`);
          continue;
        }
        if (q.type !== "choice") {
          errors.push(`criteria.${key}: la pregunta no tiene opciones; solo se puede cambiar su instrucción.`);
          continue;
        }
        if (!isRec(options)) {
          errors.push(`criteria.${key}: debe ser un objeto {opción: texto}.`);
          continue;
        }
        for (const [option, value] of Object.entries(options)) {
          if (!q.options.includes(option)) {
            errors.push(`criteria.${key}.${option}: la opción no existe (opciones válidas: ${q.options.join(", ")}).`);
            continue;
          }
          const text = checkText(value, PATCH_LIMITS.criterion, `criteria.${key}.${option}`, errors);
          if (text !== null) {
            patch.criteria ??= {};
            patch.criteria[key] ??= {};
            patch.criteria[key][option] = text;
          }
        }
      }
    }
  }

  if (raw.state_note !== undefined && raw.state_note !== null && raw.state_note !== "") {
    const text = checkText(raw.state_note, PATCH_LIMITS.stateNote, "state_note", errors);
    if (text !== null) patch.stateNote = text;
  }

  if (errors.length === 0 && patch.instructions === undefined && patch.criteria === undefined && patch.stateNote === undefined) {
    errors.push("La variante no cambia nada: escribí al menos una instrucción, una descripción de opción o `state_note`.");
  }
  return errors.length > 0 ? { errors } : { patch, errors };
}

/**
 * Archivo `.ts` de la variante: llama a la función de producción y reemplaza solo los textos del parche. Los textos se incrustan
 * con `JSON.stringify`, así que nada de lo que escriba el modelo se interpreta como código.
 */
export function buildPatchedVariantSource(opts: { promptKey: string; variantName: string; patch: PromptPatch; dynamic?: Record<string, DynamicSplit> }): string {
  const { promptKey, variantName, patch, dynamic } = opts;
  return `import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

// Variante generada por código: la salida de producción (DECISION_PROMPTS.${promptKey}) con estos textos reemplazados.
interface Patch {
  instructions?: Record<string, string>;
  criteria?: Record<string, Record<string, string>>;
  stateNote?: string;
}

const PATCH: Patch = ${JSON.stringify(patch, null, 2)};

// Preguntas cuya instrucción lleva texto propio de cada caso: lo fijo de producción (antes y después) y el marcador donde va ese texto.
const DYNAMIC: Record<string, { before: string; after: string }> = ${JSON.stringify(dynamic ?? {}, null, 2)};
const DATA_MARK = "${DATA_MARK}";
const groupOf = (key: string): string => (/\\d+$/.test(key) ? \`\${key.replace(/\\d+$/, "")}*\` : key);

// Conserva la marca final entre corchetes que producción agrega a una opción (por ejemplo \`[the last attempt on this route failed]\`).
const MARKER = /\\s*(\\[[^\\]]*\\])\\s*$/;

function ${promptKey}(data: Parameters<typeof DECISION_PROMPTS.${promptKey}>[0]): DecisionInput {
  const base = DECISION_PROMPTS.${promptKey}(data);
  const questions: DecisionInput["questions"] = {};
  for (const [key, question] of Object.entries(base.questions)) {
    const next = { ...question };
    const group = groupOf(key);
    const instructions = PATCH.instructions?.[group];
    const split = DYNAMIC[group];
    if (instructions !== undefined && split === undefined) next.instructions = instructions;
    if (instructions !== undefined && split !== undefined && question.instructions.startsWith(split.before) && question.instructions.endsWith(split.after)) {
      const data = question.instructions.slice(split.before.length, question.instructions.length - split.after.length);
      next.instructions = instructions.replace(DATA_MARK, () => data);
    }
    const criteria = PATCH.criteria?.[group];
    if (next.type === "choice" && criteria !== undefined) {
      const merged: Record<string, string> = { ...next.criteria };
      for (const [option, text] of Object.entries(criteria)) {
        if (!(option in merged)) continue;
        const marker = MARKER.exec(merged[option]);
        merged[option] = marker ? \`\${text} \${marker[1]}\` : text;
      }
      next.criteria = merged;
    }
    questions[key] = next;
  }
  const state = PATCH.stateNote === undefined ? base.state : \`\${PATCH.stateNote}\\n\${base.state}\`;
  return { ...base, state, questions };
}

const ${variantName}: Variant = {
  name: "${variantName}",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { ${promptKey} } },
};
export default ${variantName};
`;
}

const MARK_RE = /\s*\[[^\]]*\]\s*$/;

/**
 * Los textos vigentes de una variante (instrucciones y descripciones de TODAS las opciones que aparecen en los casos), tal como los recibe
 * el modelo evaluado. La marca dinámica final entre corchetes (por ejemplo «[the last attempt ... failed]») no es parte del texto base.
 */
export function patchFromRequests(requests: readonly DecisionRequest[]): PromptPatch {
  const texts: Record<string, string[]> = {};
  const criteria: Record<string, Record<string, string>> = {};
  for (const req of requests) {
    for (const [rawKey, q] of Object.entries(req.questions)) {
      const key = groupOf(rawKey);
      texts[key] ??= [];
      texts[key].push(q.instructions);
      if (q.type !== "choice") continue;
      for (const [option, text] of Object.entries(q.criteria)) {
        criteria[key] ??= {};
        const bucket = criteria[key];
        // Preferir una aparición sin marca; si solo hay con marca, se la quita.
        if (bucket[option] === undefined || (MARK_RE.test(bucket[option]) && !MARK_RE.test(text))) bucket[option] = text.replace(MARK_RE, "");
      }
    }
  }
  const instructions: Record<string, string> = {};
  for (const [key, list] of Object.entries(texts)) {
    const split = splitDynamic(list);
    instructions[key] = split ? `${split.before}${DATA_MARK}${split.after}` : list[0];
  }
  return { instructions, ...(Object.keys(criteria).length > 0 ? { criteria } : {}) };
}

/** Parche final = textos base con los cambios encima (lo que el modelo no escribe queda como en el base). */
export function mergePatch(base: PromptPatch, change: PromptPatch): PromptPatch {
  const instructions = { ...base.instructions, ...change.instructions };
  const criteria: Record<string, Record<string, string>> = {};
  for (const key of new Set([...Object.keys(base.criteria ?? {}), ...Object.keys(change.criteria ?? {})])) {
    criteria[key] = { ...base.criteria?.[key], ...change.criteria?.[key] };
  }
  const stateNote = change.stateNote ?? base.stateNote;
  return {
    ...(Object.keys(instructions).length > 0 ? { instructions } : {}),
    ...(Object.keys(criteria).length > 0 ? { criteria } : {}),
    ...(stateNote !== undefined ? { stateNote } : {}),
  };
}

/**
 * La nota de estado que una variante generada antepone al estado de producción, si la tiene. Se detecta comparando el estado del primer
 * caso contra el de producción; una variante escrita a mano con otro formato de estado no tiene nota.
 */
export function deriveStateNote(variantRequests: readonly DecisionRequest[], prodRequests: readonly DecisionRequest[]): string | undefined {
  const v = variantRequests[0];
  const p = prodRequests[0];
  if (!v || !p || v.state === p.state || !v.state.endsWith(`\n${p.state}`)) return undefined;
  const note = v.state.slice(0, v.state.length - p.state.length - 1);
  return note.trim() === "" ? undefined : note;
}

/** Los textos de `patch` en líneas legibles (lo que ve el optimizador). */
export function formatPatchTexts(patch: PromptPatch): string {
  const lines: string[] = [];
  for (const [key, text] of Object.entries(patch.instructions ?? {})) lines.push(`instructions.${key}: ${JSON.stringify(text)}`);
  for (const [key, options] of Object.entries(patch.criteria ?? {})) {
    for (const [option, text] of Object.entries(options)) lines.push(`criteria.${key}.${option}: ${JSON.stringify(text)}`);
  }
  if (patch.stateNote !== undefined) lines.push(`state_note: ${JSON.stringify(patch.stateNote)}`);
  return lines.length > 0 ? lines.join("\n") : "(sin textos)";
}

export function formatCurrentTexts(requests: readonly DecisionRequest[], stateNote?: string): string {
  if (requests.length === 0) return "(sin casos)";
  return formatPatchTexts({ ...patchFromRequests(requests), ...(stateNote !== undefined ? { stateNote } : {}) });
}

/** Descripción de lo que se puede cambiar: preguntas y opciones válidas. */
export function formatShape(shape: DecisionShape): string {
  return shape.questions
    .map((q) => {
      const base = q.type === "choice" ? `- ${q.key} (opciones: ${q.options.join(", ")})` : `- ${q.key} (sin opciones: solo instrucción)`;
      const group = q.key.endsWith("*") ? " Se aplica por igual a cada pregunta numerada de ese grupo." : "";
      const data = shape.dynamic?.[q.key] ? ` Su instrucción lleva \`${DATA_MARK}\` donde va el texto propio de cada caso: conservalo exactamente una vez.` : "";
      return `${base}.${group}${data}`;
    })
    .join("\n");
}

// ───────────────────────── Etapas generativas: solo el texto SYSTEM ─────────────────────────

/** Máximo del texto SYSTEM que puede escribir el modelo (el de producción más largo ronda los 2500 caracteres). */
export const SYSTEM_TEXT_MAX = 6000;

/** El texto SYSTEM vigente de una etapa generativa: el de `variant` si lo redefine, o el de producción. */
export function currentSystemText(promptKey: string, variant?: Variant): string {
  const own = (variant?.prompts as { PROMPTS?: Record<string, { SYSTEM?: unknown }> } | undefined)?.PROMPTS?.[promptKey]?.SYSTEM;
  if (typeof own === "string") return own;
  const prod = (PROMPTS as unknown as Record<string, { SYSTEM?: unknown }>)[promptKey]?.SYSTEM;
  return typeof prod === "string" ? prod : "";
}

/** Valida el texto SYSTEM que escribió el modelo. */
export function systemFromRaw(raw: unknown, current: string, requiredText: readonly string[] = []): { system?: string; error?: string } {
  if (typeof raw !== "string" || raw.trim() === "") return { error: "`system` debe ser un texto no vacío." };
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (text.length > SYSTEM_TEXT_MAX) return { error: `\`system\` tiene ${text.length} caracteres y el máximo es ${SYSTEM_TEXT_MAX}.` };
  if (text === current.trim()) return { error: "`system` es igual al texto vigente: escribí una versión que cambie algo." };
  const missing = requiredText.filter((r) => !text.includes(r));
  if (missing.length > 0) return { error: `\`system\` debe conservar el formato de respuesta exigido: falta ${missing.map((m) => `«${m}»`).join(", ")}.` };
  return { system: text };
}

/**
 * Archivo `.ts` de una variante generativa: la vista de producción (`PROMPTS.<promptKey>`) con otro texto `SYSTEM`. El texto se incrusta con
 * `JSON.stringify`: nada de lo que escriba el modelo se interpreta como código.
 */
export function buildSystemVariantSource(opts: { promptKey: string; variantName: string; system: string }): string {
  const { promptKey, variantName, system } = opts;
  return `import { PROMPTS } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

// Variante generada por código: la vista de producción (PROMPTS.${promptKey}) con otro texto SYSTEM.
const SYSTEM: string = ${JSON.stringify(system)};

const ${variantName}: Variant = {
  name: "${variantName}",
  mode: "prompt",
  prompts: { PROMPTS: { ${promptKey}: { ...PROMPTS.${promptKey}, SYSTEM } } },
};
export default ${variantName};
`;
}
