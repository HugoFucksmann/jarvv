/**
 * eval/core/contract.ts
 *
 * Helpers y constantes de producción copiados (sin importar `src/`). Sección 2.1.
 *
 * Comparado contra qwen.ts, refResolver.ts, routes.ts, limits.ts y deps.ts: stripThink, parseJsonObject,
 * validateArgs, parsePlanSteps, isWholeRefToken y schemaTypes son copias de la lógica de producción.
 * Diferencias intencionales de firma: `validateArgs` devuelve `string[]` (prod: `string | null`) y
 * `parsePlanSteps` devuelve `null` (prod: `{ error }`). Si producción cambia, actualizar a mano.
 */

// ───────────────────────── Rutas y constantes ─────────────────────────
// Origen: src/core/types/routes.ts, src/core/types/limits.ts, src/core/engine/deps.ts

/** Coincide con el `enum` de `suggested_mcp` del schema de plan (sección 2.1). */
export const EXECUTABLE_ROUTES = ["files", "locate", "terminal", "web"] as const;
export type ExecutableRoute = (typeof EXECUTABLE_ROUTES)[number];

export const FIN = "fin";
export const ASK_USER = "ask_user";

export function isExecutableRoute(v: unknown): v is ExecutableRoute {
  return typeof v === "string" && (EXECUTABLE_ROUTES as readonly string[]).includes(v);
}

/** Reintentos de producción (`limits.ts`, `qwen.ts`). */
export const LLM_TRANSPORT_RETRIES = 1;
export const LLM_TRANSPORT_BACKOFF_MS = 1000;
export const LLM_INVALID_OUTPUT_RETRIES = 1;
export const RETRY_TEMPERATURE = 0.3;
export const RETRY_TOKEN_FACTOR = 1.5;
export const TRUNCATED_ERROR = "la salida se truncó por el límite de tokens";
const MAX_ERROR_NOTE_CHARS = 300;

/** Copia de `retryNote` de `prompts.ts`: se agrega al `user` del reintento. */
export function retryNote(previousError?: string): string {
  if (!previousError) return "";
  const clipped =
    previousError.length > MAX_ERROR_NOTE_CHARS ? previousError.slice(0, MAX_ERROR_NOTE_CHARS - 1) + "…" : previousError;
  const safe = clipped.replace(/<\/?obs>/gi, "[obs]");
  return `\n\nERROR_PREVIO: tu respuesta anterior fue inválida (${safe}). Corrígela y responde de nuevo.`;
}

/** Máximo de pasos de un plan (`limits.ts`). */
export const MAX_STEPS = 15;

/** Opciones válidas de `args_review` (`deps.ts`); coinciden con `ArgsReviewExpect`. */
export const ARGS_REVIEWS = ["approved", "args_invalid", "tool_rejected", "info_missing"] as const;

// ───────────────────────── Constantes propias del eval ─────────────────────────

/** Una pregunta `noul` aprueba solo con `> NOUL_APPROVE`. */
export const NOUL_APPROVE = 0.5;

/** Estimación de tokens: ceil(caracteres / 3). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

// ───────────────────────── Tipos locales ─────────────────────────

/** Sustituye a `MCPTool["inputSchema"]`. */
export interface ToolInputSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: unknown;
}

/** Sustituye al `PlanStep` de producción (distinto del `PlanStep` de salida en `types.ts`). */
export interface ParsedPlanStep {
  id: string;
  instruction: string;
  route: string;
  expectedOutcome: string;
}

// ───────────────────────── Utilidades ─────────────────────────

/** Origen: src/core/utils.ts */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Origen: qwen.ts */
export function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Copia de refResolver.ts. ¿El valor completo es un token de referencia (`{{ref:rX}}` o `ref:rX`)? */
const WHOLE_REF = /^(?:\{\{ref:(r\d+)\}\}|ref:(r\d+))$/i;
export function isWholeRefToken(v: unknown): v is string {
  return typeof v === "string" && WHOLE_REF.test(v.trim());
}

/** Copia de refResolver.ts. Tipos JSON Schema que admite un nodo, incluyendo ramas anyOf/oneOf. */
function collectSchemaTypes(schema: unknown, out: Set<string>): Set<string> {
  if (!isRecord(schema)) return out;
  const t = schema.type;
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) branches.forEach((b) => collectSchemaTypes(b, out));
  }
  return out;
}
export function schemaTypes(schema: unknown): string[] {
  return [...collectSchemaTypes(schema, new Set<string>())];
}

// ───────────────────────── Parseo de salida (qwen.ts) ─────────────────────────

/** Copia de qwen.ts. Quita bloques <think>: cerrados, un </think> huérfano (la apertura iba en el template) y uno sin cierre. */
export function stripThink(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const orphanClose = s.toLowerCase().lastIndexOf("</think>");
  if (orphanClose >= 0) s = s.slice(orphanClose + "</think>".length);
  return s.replace(/<think>[\s\S]*$/i, "").trim();
}

/** Copia de qwen.ts. Índice de la llave que cierra la abierta en `start`, respetando strings y escapes; -1 si no cierra. */
export function closingBraceIndex(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Copia de qwen.ts. Primer objeto JSON de llaves balanceadas que se pueda parsear como objeto. */
export function extractJsonObject(s: string): Record<string, unknown> | null {
  for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
    const end = closingBraceIndex(s, start);
    if (end < 0) continue;
    try {
      const parsed: unknown = JSON.parse(s.slice(start, end + 1));
      if (isRecord(parsed)) return parsed;
    } catch {
      // Llaves balanceadas que no son JSON: seguir con la siguiente llave.
    }
  }
  return null;
}

/**
 * Copia de qwen.ts. Objeto JSON de la salida del modelo, sin bloques <think>. Orden: JSON directo del texto
 * completo, JSON directo del bloque ```json y objeto de llaves balanceadas (primero en el bloque, luego en el
 * texto). Un JSON válido que no sea objeto (p. ej. un arreglo) devuelve null.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripThink(raw);
  if (!cleaned) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const fencedBody = fenced ? fenced[1].trim() : "";

  for (const candidate of [cleaned, fencedBody].filter(Boolean)) {
    try {
      const value: unknown = JSON.parse(candidate);
      return isRecord(value) ? value : null;
    } catch {
      // No es JSON directo: probar el siguiente candidato.
    }
  }

  for (const candidate of [fencedBody, cleaned].filter(Boolean)) {
    const found = extractJsonObject(candidate);
    if (found) return found;
  }
  return null;
}

// ───────────────────────── Validación de argumentos (qwen.ts) ─────────────────────────

/** */
export function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** `integer` exige entero; `number` cualquier número finito. */
export function matchesType(v: unknown, type: string): boolean {
  switch (type) {
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "string":
    case "boolean":
      return typeof v === type;
    case "array":
      return Array.isArray(v);
    case "object":
      return isRecord(v);
    case "null":
      return v === null;
    default:
      return true;
  }
}

/**
 * Copia de qwen.ts (solo nivel superior): requeridos presentes y no nulos, `additionalProperties: false`,
 * `enum` y tipo de cada propiedad declarada. Un token de referencia completo se acepta en cualquier propiedad.
 * No valida anidados ni resuelve $ref/$defs. Devuelve la lista de problemas (vacía = válido).
 */
export function validateArgs(args: Record<string, unknown>, schema: ToolInputSchema): string[] {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const problems: string[] = [];

  const missing = (schema.required ?? []).filter((k) => args[k] === undefined || args[k] === null);
  if (missing.length > 0) problems.push(`faltan campos requeridos: ${missing.join(", ")}`);

  for (const [key, value] of Object.entries(args)) {
    if (isWholeRefToken(value)) continue;
    if (!Object.hasOwn(props, key)) {
      if (schema.additionalProperties === false) problems.push(`parámetro no definido en el schema: ${key}`);
      continue;
    }
    const prop = props[key];
    if (isRecord(prop) && Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      problems.push(`${key}: valor fuera del enum`);
      continue;
    }
    const types = schemaTypes(prop);
    if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
      problems.push(`${key}: se esperaba ${types.join("|")} y se recibió ${typeName(value)}`);
    }
  }
  return problems;
}

// ───────────────────────── Plan (qwen.ts) ─────────────────────────

/**
 * Copia de qwen.ts (devuelve null en vez de `{ error }`). Convierte `steps` crudos a `PlanStep[]`. `firstId` numera desde ese valor; con
 * `allowEmpty=false` un arreglo vacío es inválido. Devuelve null si algo no cumple.
 */
export function parsePlanSteps(raw: unknown, firstId: number, allowEmpty: boolean): ParsedPlanStep[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return allowEmpty ? [] : null;
  if (raw.length > MAX_STEPS) return null; // igual que qwen.ts: más de MAX_STEPS es salida inválida
  const out: ParsedPlanStep[] = [];
  for (const [i, s] of raw.entries()) {
    if (!isRecord(s)) return null;
    const { goal, suggested_mcp, expected_outcome } = s;
    if (!nonEmptyString(goal) || !isExecutableRoute(suggested_mcp) || !nonEmptyString(expected_outcome)) return null;
    out.push({
      id: `s${firstId + i}`,
      instruction: goal.trim(),
      route: suggested_mcp,
      expectedOutcome: expected_outcome.trim(),
    });
  }
  return out;
}

/** Copia exacta de `planViewSchema` de qwen.ts (sección 2.1). */
export function buildPlanSchema(maxSteps: number): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            goal: { type: "string" },
            suggested_mcp: { type: "string", enum: [...EXECUTABLE_ROUTES] },
            expected_outcome: { type: "string" },
          },
          required: ["goal", "suggested_mcp", "expected_outcome"],
          additionalProperties: false,
        },
        maxItems: maxSteps,
        minItems: 1,
      },
    },
    required: ["steps"],
    additionalProperties: false,
  };
}
