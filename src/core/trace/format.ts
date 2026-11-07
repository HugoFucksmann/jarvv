/**
 * JARVIS Core — Formato de la traza por tarea (versión 3).
 *
 * Funciones puras que arman, a partir de lo que reunió el registrador, los tres archivos de la carpeta de una tarea:
 * - `summary.md`: lo que se lee o se pega a un agente (línea de tiempo, alertas, refs con un fragmento).
 * - `trace.json`: la traza liviana (contexto completo, consultas con la salida ya interpretada, herramientas con un
 *   fragmento del resultado). Sin las entradas crudas de los modelos, que son el 95 % de los bytes y se repiten.
 * - `full.json.gz` (lo arma el registrador): la traza completa con entradas y salidas crudas, comprimida.
 *
 * Nada de acá toca el contexto ni el motor: solo lee lo ya registrado. Un resultado grande no se copia: ya vive en una ref
 * (`data/refs/…`) y la traza guarda su id, tamaño y un fragmento. Las refs `rN` son las del contexto; este módulo no crea ninguna.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";

import type { Call, ContextData, Ref } from "../ctx/index.ts";
import type { ModelRecord, ToolRecord, WaitRecord } from "./recorder.ts";

/** Versión del formato de la traza. `full.json.gz` conserva la forma de la versión 2 (`snapshot`, `models`, `tools`, `waits`) más `kind: "full"`. */
export const TRACE_FORMAT_VERSION = 3;

/** Caracteres del resultado de una herramienta que se conservan en `trace.json`. */
const TOOL_RESULT_HEAD_CHARS = 500;
/** Caracteres de una ref que se conservan como fragmento. */
const REF_HEAD_CHARS = 300;

// ───────────────────────── Consultas a modelos ─────────────────────────

export interface SlimQuery {
  seq: number;
  stage: string;
  step: string | null;
  n: number;
  startedAt: number;
  durationMs: number;
  model: string | null;
  tokens: { input: number | null; output: number | null } | null;
  finishReason: string | null;
  /** Opciones que se le ofrecieron (rutas, herramientas o resultados de la revisión); solo las consultas de decisión. */
  offered: string[] | null;
  /** Salida ya interpretada: `answers` de una decisión (con probabilidades) o el contenido del modelo generativo. */
  output: unknown;
  error: string | null;
  link: ModelRecord["link"];
  inputChars: number | null;
  /** Huella corta de la entrada cruda: dos consultas con la misma huella vieron lo mismo. */
  inputHash: string | null;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** `answers` de una decisión con las probabilidades redondeadas (4 decimales). */
function compactAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(answers)) {
    const a = asRecord(raw);
    if (a === null) continue;
    const probs = asRecord(a.probabilities);
    out[key] =
      a.type === "choice"
        ? { choice: a.choice, p: probs === null ? null : Object.fromEntries(Object.entries(probs).map(([k, v]) => [k, typeof v === "number" ? round4(v) : v])) }
        : { noul: typeof a.noul === "number" ? round4(a.noul) : a.noul };
  }
  return out;
}

function offeredOf(input: unknown): string[] | null {
  const q = asRecord(asRecord(input)?.questions);
  if (q === null) return null;
  // Una decisión con una pregunta de opciones ofrece las claves de `criteria`; una de verificación, las preguntas.
  for (const key of ["route", "selected_tool", "review"]) {
    const criteria = asRecord(asRecord(q[key])?.criteria);
    if (criteria !== null) return Object.keys(criteria);
  }
  return Object.keys(q);
}

export function slimQuery(model: ModelRecord): SlimQuery {
  const input = parseJson(model.input);
  const output = asRecord(parseJson(model.output));
  let interpreted: unknown = model.output;
  let modelName: string | null = null;
  let tokens: SlimQuery["tokens"] = null;
  let finishReason: string | null = null;

  const choices = output?.choices;
  if (Array.isArray(choices)) {
    // Modelo generativo (formato OpenAI): solo el contenido, sin el envoltorio.
    const first = asRecord(choices[0]);
    const content = asRecord(first?.message)?.content;
    interpreted = typeof content === "string" ? (parseJson(content) ?? content) : content;
    finishReason = typeof first?.finish_reason === "string" ? first.finish_reason : null;
    modelName = typeof output?.model === "string" ? output.model : null;
    const usage = asRecord(output?.usage);
    tokens = usage === null ? null : { input: Number(usage.prompt_tokens ?? NaN) || null, output: Number(usage.completion_tokens ?? NaN) || null };
  } else if (asRecord(output?.answers) !== null) {
    // Modelo de decisión.
    interpreted = compactAnswers(output?.answers as Record<string, unknown>);
    modelName = typeof output?.model === "string" ? output.model : null;
    const usage = asRecord(output?.usage);
    tokens = usage === null ? null : { input: Number(usage.input_tokens ?? NaN) || null, output: Number(usage.output_tokens ?? NaN) || null };
  }

  return {
    seq: model.seq,
    stage: model.stage,
    step: model.step,
    n: model.n,
    startedAt: model.startedAt,
    durationMs: model.durationMs,
    model: modelName,
    tokens,
    finishReason,
    offered: model.stage === "route" || model.stage === "tool" || model.stage === "review" || model.stage === "verify" ? offeredOf(input) : null,
    output: interpreted,
    error: model.error,
    link: model.link,
    inputChars: model.input === null ? null : model.input.length,
    inputHash: model.input === null ? null : createHash("sha1").update(model.input).digest("hex").slice(0, 12),
  };
}

// ───────────────────────── Herramientas y refs ─────────────────────────

export interface SlimTool extends Omit<ToolRecord, "result"> {
  /** Principio del resultado crudo; el resto está en la ref o en `full.json.gz`. */
  resultHead: string | null;
}

export function slimTool(tool: ToolRecord): SlimTool {
  const { result, ...rest } = tool;
  return { ...rest, resultHead: result === null ? null : result.slice(0, TOOL_RESULT_HEAD_CHARS) };
}

export interface RefInfo extends Pick<Ref, "id" | "stepId" | "label" | "size" | "where"> {
  /** Principio del contenido (puede faltar si el archivo ya no existe). */
  head: string | null;
}

function readHead(file: string): string | null {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(REF_HEAD_CHARS * 4);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytes).toString("utf8").slice(0, REF_HEAD_CHARS);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function refInfos(refs: readonly Ref[]): RefInfo[] {
  return refs.map((r) => ({ id: r.id, stepId: r.stepId, label: r.label, size: r.size, where: r.where, head: readHead(r.where) }));
}

// ───────────────────────── Metadatos ─────────────────────────

export interface TraceMeta {
  formatVersion: number;
  /** Commit del repositorio (sin indicar si hay cambios sin confirmar), si se pudo leer. */
  gitSha: string | null;
  models: { generative: string; decision: string };
  platform: string;
  node: string;
  /** Rutas del usuario que vio el modelo de argumentos (bloque `ENV`). */
  environment: Record<string, string> | null;
  /** Schema de cada herramienta que vio el modelo de argumentos, tal como lo vio. */
  toolSchemas: Record<string, unknown>;
}

function readGitSha(): string | null {
  try {
    const head = fs.readFileSync(".git/HEAD", "utf8").trim();
    if (!head.startsWith("ref:")) return head.slice(0, 10);
    const ref = head.slice(4).trim();
    try {
      return fs.readFileSync(`.git/${ref}`, "utf8").trim().slice(0, 10);
    } catch {
      const packed = fs.readFileSync(".git/packed-refs", "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
      return packed === undefined ? null : packed.slice(0, 10);
    }
  } catch {
    return null;
  }
}

/** Del texto de entrada del modelo de argumentos: el bloque `ENV` y el schema de la herramienta. */
function argsContext(models: readonly ModelRecord[]): { environment: Record<string, string> | null; toolSchemas: Record<string, unknown> } {
  let environment: Record<string, string> | null = null;
  const toolSchemas: Record<string, unknown> = {};
  for (const m of models) {
    if (m.stage !== "args" || m.input === null) continue;
    const messages = asRecord(parseJson(m.input))?.messages;
    if (!Array.isArray(messages)) continue;
    const user = messages.map(asRecord).find((x) => x?.role === "user")?.content;
    if (typeof user !== "string") continue;
    if (environment === null) {
      const block = /ENV:\n<obs>\n([\s\S]*?)\n<\/obs>/.exec(user)?.[1];
      if (block !== undefined) {
        environment = Object.fromEntries(block.split("\n").map((l) => l.split("=")).filter((p) => p.length >= 2).map((p) => [p[0], p.slice(1).join("=")]));
      }
    }
    const tool = /TOOL: ([\w-]+)/.exec(user)?.[1];
    const schema = /SCHEMA: (.*)/.exec(user)?.[1];
    if (tool !== undefined && schema !== undefined && !(tool in toolSchemas)) {
      toolSchemas[tool] = parseJson(schema) ?? schema;
    }
  }
  return { environment, toolSchemas };
}

export function buildMeta(models: readonly ModelRecord[], generative: string, decision: string): TraceMeta {
  const { environment, toolSchemas } = argsContext(models);
  return {
    formatVersion: TRACE_FORMAT_VERSION,
    gitSha: readGitSha(),
    models: { generative, decision },
    platform: process.platform,
    node: process.version,
    environment,
    toolSchemas,
  };
}

// ───────────────────────── Resumen legible ─────────────────────────

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** `choice p%` o `ok/cumple` de las consultas ligadas a una llamada. */
function linkedNotes(call: Call, queries: readonly SlimQuery[]): string[] {
  const notes: string[] = [];
  for (const q of queries) {
    if (q.link.call !== call.id) continue;
    const out = asRecord(q.output);
    if (out === null) continue;
    if (q.stage === "route" || q.stage === "tool" || q.stage === "review") {
      const a = asRecord(out.route ?? out.selected_tool ?? out.review);
      const p = asRecord(a?.p);
      const choice = typeof a?.choice === "string" ? a.choice : null;
      const prob = choice !== null && p !== null && typeof p[choice] === "number" ? Math.round(100 * (p[choice] as number)) : null;
      if (choice !== null) notes.push(`${{ route: "D1", tool: "D2", review: "D3" }[q.stage]} ${choice}${prob === null ? "" : ` ${prob}%`}`);
    } else if (q.stage === "verify") {
      const parts = Object.entries(out).map(([k, v]) => `${k} ${typeof asRecord(v)?.noul === "number" ? (asRecord(v)?.noul as number).toFixed(2) : "?"}`);
      if (parts.length > 0) notes.push(`D4 ${parts.join(" · ")}`);
    }
  }
  return notes;
}

export interface SummaryInput {
  snapshot: ContextData;
  startedAt: number;
  endedAt: number;
  meta: TraceMeta;
  queries: readonly SlimQuery[];
  tools: readonly ToolRecord[];
  waits: readonly WaitRecord[];
  refs: readonly RefInfo[];
}

export function buildSummary(input: SummaryInput): string {
  const { snapshot: s, queries, tools, waits, refs, meta } = input;
  const task = s.task;
  const total = input.endedAt - input.startedAt;
  const md: string[] = [];
  md.push(`# Traza: ${oneLine(task.request, 120)}`, "");
  md.push(
    `- Tarea \`${task.id}\` · modo **${task.mode}** · estado **${task.state}**${task.stopReason ? ` (${task.stopReason})` : ""} · ${seconds(total)}`,
    `- ${s.steps.length} pasos · ${s.calls.length} llamadas · ${queries.length} consultas a modelos (${meta.models.generative} y ${meta.models.decision})`,
    `- Código ${meta.gitSha ?? "?"} · formato v${meta.formatVersion} · \`trace.json\` (liviana) y \`full.json.gz\` (completa, con entradas crudas)`,
    "",
  );

  // Alertas: lo que suele indicar un problema, antes de leer nada más.
  const count = new Map<string, number>();
  for (const c of s.calls) count.set(c.status, (count.get(c.status) ?? 0) + 1);
  const alerts: string[] = [];
  for (const status of ["loop_blocked", "args_invalid", "info_missing", "tool_rejected", "tool_error", "exception", "user_rejected", "denied"]) {
    const n = count.get(status);
    if (n !== undefined && n > 0) alerts.push(`${n} llamada(s) \`${status}\``);
  }
  const rejected = s.calls.filter((c) => c.verdict === "rejected").length;
  if (rejected > 0) alerts.push(`${rejected} llamada(s) rechazadas por la verificación`);
  const steps = s.steps.filter((x) => !x.superseded);
  const last = steps[steps.length - 1];
  if (task.state === "completed" && last !== undefined && last.state === "failed") {
    alerts.push("**cierre sospechoso**: la tarea figura `completed` pero el último paso falló");
  }
  const writes = s.calls.filter((c) => c.kind === "write" && c.verdict === "approved").length;
  if (task.state === "completed" && writes === 0) alerts.push("la tarea figura `completed` sin ninguna escritura aprobada (solo lecturas)");
  const errored = queries.filter((q) => q.error !== null).length;
  if (errored > 0) alerts.push(`${errored} consulta(s) a modelos con error`);
  md.push("## Alertas", "", ...(alerts.length === 0 ? ["Ninguna."] : alerts.map((a) => `- ${a}`)), "");

  md.push("## Pasos y llamadas", "");
  const toolByCall = new Map(tools.filter((t) => t.call !== null).map((t) => [t.call as string, t]));
  for (const step of s.steps) {
    const tags = [step.state, step.superseded ? "reemplazado" : null, step.route ? `ruta ${step.route}` : null].filter(Boolean).join(", ");
    md.push(`### ${step.id} · ${tags} · ${oneLine(step.instruction ?? "(sin instrucción)", 140)}`);
    if (step.expected) md.push(`Esperado: ${oneLine(step.expected, 160)}`);
    md.push("");
    for (const c of s.calls.filter((x) => x.stepId === step.id)) {
      const t = toolByCall.get(c.id);
      const verdict = c.verdict === null ? "" : ` · ${c.verdict}${c.reason ? ` (${c.reason})` : ""}`;
      const notes = linkedNotes(c, queries);
      const note = c.summary ? ` — ${oneLine(c.summary, 180)}` : "";
      md.push(`- \`${c.id}\` ${c.route}/${c.tool} (${c.kind}) **${c.status}**${verdict}${t ? ` · ${seconds(t.durationMs)}` : ""}${notes.length > 0 ? ` · ${notes.join(" · ")}` : ""}`);
      md.push(`  - args: \`${oneLine(JSON.stringify(c.args), 200)}\`${note ? `\n  - ${note.slice(3)}` : ""}${c.ref ? `\n  - resultado completo en \`${c.ref}\`` : ""}`);
    }
    md.push("");
  }

  const pendingOut = queries.filter((q) => q.stage === "pending");
  if (pendingOut.length > 0) {
    md.push("## Lista de pendientes por vuelta", "");
    for (const q of pendingOut) {
      const o = asRecord(q.output);
      const list = Array.isArray(o?.pending) ? (o?.pending as unknown[]).map((x) => oneLine(String(x), 100)) : null;
      md.push(`- #${q.seq}: ${list === null ? oneLine(JSON.stringify(q.output), 160) : list.length === 0 ? "(vacía)" : list.join(" | ")}`);
    }
    md.push("");
  }

  if (waits.length > 0) {
    md.push("## Esperas del usuario", "", ...waits.map((w) => `- ${w.kind}: ${seconds(w.endedAt - w.startedAt)}`), "");
  }

  if (refs.length > 0) {
    md.push("## Refs (resultados grandes guardados aparte)", "", "| ref | paso | contenido | tamaño | archivo |", "|---|---|---|---|---|");
    for (const r of refs) md.push(`| ${r.id} | ${r.stepId} | ${r.label} | ${r.size} | ${r.where} |`);
    md.push("");
    for (const r of refs) if (r.head !== null) md.push(`**${r.id}** empieza con:`, "", "```", r.head, "```", "");
  }

  // Tiempo por etapa de modelo.
  const byStage = new Map<string, { n: number; ms: number }>();
  for (const q of queries) {
    const cur = byStage.get(q.stage) ?? { n: 0, ms: 0 };
    byStage.set(q.stage, { n: cur.n + 1, ms: cur.ms + q.durationMs });
  }
  md.push("## Consultas por etapa", "", ...[...byStage.entries()].map(([k, v]) => `- ${k}: ${v.n} · ${seconds(v.ms)}`), "");

  if (s.result !== null) md.push("## Respuesta final", "", ...s.result.text.split("\n").map((l) => `> ${l}`), "");
  return `${md.join("\n")}\n`;
}

// ───────────────────────── Índice ─────────────────────────

export function indexEntry(input: SummaryInput, folder: string): Record<string, unknown> {
  const s = input.snapshot;
  const statuses: Record<string, number> = {};
  for (const c of s.calls) statuses[c.status] = (statuses[c.status] ?? 0) + 1;
  return {
    taskId: s.task.id,
    folder,
    startedAt: new Date(input.startedAt).toISOString(),
    durationMs: input.endedAt - input.startedAt,
    mode: s.task.mode,
    state: s.task.state,
    stopReason: s.task.stopReason ?? null,
    request: oneLine(s.task.request, 160),
    steps: s.steps.length,
    calls: s.calls.length,
    queries: input.queries.length,
    statuses,
    refs: input.refs.length,
  };
}

/** `AAAAMMDD-HHMMSS_<id>`, en hora local, para que las carpetas se ordenen por fecha. */
export function folderName(startedAt: number, taskId: string): string {
  const d = new Date(startedAt);
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}_${taskId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}
