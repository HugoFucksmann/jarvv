/**
 * JARVIS Core — Log de eventos por tarea (`data/tasks/<id>.jsonl`).
 *
 * Persiste la secuencia de lotes que pasan por `TaskContext.apply`: cabecera con la identidad,
 * modo, solicitud, inicio y `ContextLimits` vigentes al crearse la tarea, seguida de un registro JSONL
 * por cada `apply` (`{ n, at, ops, meta }` con las operaciones crudas tal como entraron a `apply`).
 *
 * Reproducir es un pliegue puro sobre `create.context` + `apply` con un reloj determinista que
 * devuelve el `at` de cada registro. Un último registro incompleto (p. ej. por corte a mitad de
 * escritura) se descarta al leer; cualquier error en otro punto marca la tarea como ilegible y
 * conserva el archivo en disco sin cargarla a medias.
 */

import fs from "node:fs";
import path from "node:path";

import type { ConfigSource, JarvisConfig } from "./config.ts";
import { create } from "./ctx/index.ts";
import type {
  ApplyRecord,
  ChangeMeta,
  ContextLimits,
  ContextOptions,
  Op,
  TaskContext,
  TaskMode,
} from "./ctx/index.ts";
import { TASK_MODES } from "./ctx/index.ts";
import { taskFolderName } from "./refs/refVault.ts";
import { errorMessage, isRecord } from "./utils.ts";

export const LOG_SCHEMA_VERSION = 1 as const;

/** Nombre de archivo de log perteneciente a Jarvis: `<taskId>.jsonl`. */
export const LOG_FILE = /^task_\d+_[A-Za-z0-9]+\.jsonl$/;

export interface LogHeader {
  readonly v: number;
  readonly id: string;
  readonly mode: TaskMode;
  readonly request: string;
  readonly startedAt: number;
  readonly limits: ContextLimits;
}

export interface LogEntry {
  readonly n: number;
  readonly at: number;
  readonly ops: readonly Op[];
  readonly meta: ChangeMeta | null;
}

export type LogReadResult =
  | {
      readonly ok: true;
      readonly id: string;
      readonly filePath: string;
      readonly header: LogHeader;
      readonly ctx: TaskContext;
    }
  | {
      readonly ok: false;
      readonly id: string;
      readonly filePath: string;
      readonly reason: string;
    };

/** Carpeta de logs de tareas (`data/tasks`), derivada de la carpeta padre de `refsDir`. */
export function tasksDirFromConfig(config: Pick<JarvisConfig, "refsDir" | "tracePath">): string {
  const base =
    typeof config.refsDir === "string" && config.refsDir.trim() !== ""
      ? path.dirname(path.resolve(config.refsDir))
      : path.dirname(path.resolve(config.tracePath || "jarvis-traces.jsonl"));
  return path.join(base, "tasks");
}

export function tasksDirFromSource(getConfig: ConfigSource): string {
  return tasksDirFromConfig(getConfig());
}

/** Ruta del archivo `<id>.jsonl` dentro de `tasksDir`. */
export function taskLogPath(tasksDir: string, taskId: string): string {
  return path.join(tasksDir, `${taskFolderName(taskId)}.jsonl`);
}

/** Escribe de forma síncrona y atómica la cabecera al iniciar una tarea. */
export function writeLogHeaderSync(filePath: string, header: LogHeader): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const line = `${JSON.stringify(header)}\n`;
  fs.writeFileSync(filePath, line, { encoding: "utf8", flag: "wx" });
}

/** Agrega de forma síncrona un registro de `apply` como una línea JSONL completa. */
export function appendLogRecordSync(filePath: string, record: ApplyRecord): void {
  const entry: LogEntry = {
    n: record.n,
    at: record.at,
    ops: record.ops,
    meta: record.meta,
  };
  const line = `${JSON.stringify(entry)}\n`;
  const fd = fs.openSync(filePath, "a");
  try {
    fs.writeSync(fd, line, undefined, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** Crea la cabecera y devuelve el callback síncrono para `ContextOptions.onApply`. */
export function openTaskLog(
  tasksDir: string,
  header: Omit<LogHeader, "v">,
): { readonly filePath: string; readonly onApply: (record: ApplyRecord) => void } {
  const filePath = taskLogPath(tasksDir, header.id);
  writeLogHeaderSync(filePath, { v: LOG_SCHEMA_VERSION, ...header });
  return {
    filePath,
    onApply: (record) => appendLogRecordSync(filePath, record),
  };
}

const OPTIONAL_LIMIT_KEYS = ["recalledKeyMax", "recalledValueMax", "threadValueMax"] as const;

function isLimits(raw: unknown): raw is ContextLimits {
  if (!isRecord(raw)) return false;
  const requiredKeys: (keyof ContextLimits)[] = ["summaryMax", "argsStringMax", "factValueMax", "feedbackMax", "jsonMaxDepth"];
  if (!requiredKeys.every((k) => typeof raw[k] === "number" && Number.isFinite(raw[k]) && raw[k] >= 1)) return false;
  return OPTIONAL_LIMIT_KEYS.every((k) => raw[k] === undefined || (typeof raw[k] === "number" && Number.isFinite(raw[k]) && raw[k] >= 1));
}

function parseHeader(raw: unknown): LogHeader | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.v !== "number" || !Number.isInteger(raw.v) || raw.v < 1) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.mode !== "string" || !(TASK_MODES as readonly string[]).includes(raw.mode)) return null;
  if (typeof raw.request !== "string" || raw.request.length === 0) return null;
  if (typeof raw.startedAt !== "number" || !Number.isFinite(raw.startedAt)) return null;
  if (!isLimits(raw.limits)) return null;
  const limits: ContextLimits = {
    summaryMax: raw.limits.summaryMax,
    argsStringMax: raw.limits.argsStringMax,
    factValueMax: raw.limits.factValueMax,
    feedbackMax: raw.limits.feedbackMax,
    jsonMaxDepth: raw.limits.jsonMaxDepth,
    ...(raw.limits.recalledKeyMax === undefined ? {} : { recalledKeyMax: raw.limits.recalledKeyMax }),
    ...(raw.limits.recalledValueMax === undefined ? {} : { recalledValueMax: raw.limits.recalledValueMax }),
    ...(raw.limits.threadValueMax === undefined ? {} : { threadValueMax: raw.limits.threadValueMax }),
  };
  return {
    v: raw.v,
    id: raw.id,
    mode: raw.mode as TaskMode,
    request: raw.request,
    startedAt: raw.startedAt,
    limits,
  };
}

function parseEntry(raw: unknown): LogEntry | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.n !== "number" || !Number.isInteger(raw.n) || raw.n < 1) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null;
  if (!Array.isArray(raw.ops) || raw.ops.length === 0) return null;
  if (raw.meta !== null && raw.meta !== undefined && !isRecord(raw.meta)) return null;
  return {
    n: raw.n,
    at: raw.at,
    ops: raw.ops as readonly Op[],
    meta: (raw.meta ?? null) as ChangeMeta | null,
  };
}

/**
 * Conversión de versiones viejas de esquema del log al vigente (`LOG_SCHEMA_VERSION`).
 * Las versiones desconocidas o futuras devuelven `null` para que el log se marque como ilegible.
 */
export function convertLogSchema(
  header: LogHeader,
  entries: readonly LogEntry[],
): { readonly header: LogHeader; readonly entries: readonly LogEntry[] } | null {
  if (header.v === LOG_SCHEMA_VERSION) {
    return { header, entries };
  }
  return null;
}

function taskIdFromFileName(filePath: string): string {
  const base = path.basename(filePath);
  return base.endsWith(".jsonl") ? base.slice(0, -".jsonl".length) : base;
}

/**
 * Lee y reproduce un archivo de log de tarea.
 * Nunca escribe al disco ni invoca `onApply`.
 */
export function readTaskLog(
  filePath: string,
  extraOptions: Partial<Pick<ContextOptions, "onListenerError">> & { readonly attachLiveWriter?: boolean } = {},
): LogReadResult {
  const fallbackId = taskIdFromFileName(filePath);
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return { ok: false, id: fallbackId, filePath, reason: `no se pudo leer el log: ${errorMessage(error)}` };
  }

  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) {
    return { ok: false, id: fallbackId, filePath, reason: "archivo de log vacío" };
  }

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(lines[0]);
  } catch (error) {
    return { ok: false, id: fallbackId, filePath, reason: `cabecera JSON inválida: ${errorMessage(error)}` };
  }
  const rawHeader = parseHeader(parsedHeader);
  if (!rawHeader) {
    return { ok: false, id: fallbackId, filePath, reason: "cabecera de log inválida o incompleta" };
  }

  const rawEntries: LogEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      if (isLast) break; // Un último registro incompleto se descarta al leer (§5).
      return { ok: false, id: rawHeader.id, filePath, reason: `registro JSON corrupto en línea ${i + 1}` };
    }
    const entry = parseEntry(parsed);
    if (!entry) {
      if (isLast) break;
      return { ok: false, id: rawHeader.id, filePath, reason: `registro de log inválido en línea ${i + 1}` };
    }
    rawEntries.push(entry);
  }

  const converted = convertLogSchema(rawHeader, rawEntries);
  if (!converted) {
    return {
      ok: false,
      id: rawHeader.id,
      filePath,
      reason: `versión de esquema de log no soportada (${rawHeader.v})`,
    };
  }

  const { header, entries } = converted;
  let clock = header.startedAt;
  let replaying = true;
  try {
    const ctx = create.context(
      { id: header.id, request: header.request, mode: header.mode },
      {
        ...header.limits,
        onListenerError: extraOptions.onListenerError,
        ...(extraOptions.attachLiveWriter
          ? {
              onApply: (record) => {
                if (!replaying) appendLogRecordSync(filePath, record);
              },
            }
          : {}),
        now: () => (replaying ? clock : Date.now()),
      },
    );
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.n !== ctx.n + 1) {
        return {
          ok: false,
          id: header.id,
          filePath,
          reason: `versión discontinua en registro ${i + 1}: esperaba n=${ctx.n + 1}, recibió n=${entry.n}`,
        };
      }
      clock = entry.at;
      ctx.apply(entry.ops, entry.meta ?? undefined);
    }
    replaying = false;
    return { ok: true, id: header.id, filePath, header, ctx };
  } catch (error) {
    return {
      ok: false,
      id: header.id,
      filePath,
      reason: `falló la reproducción del log: ${errorMessage(error)}`,
    };
  }
}

/** Indica si el log es legible y corresponde a una tarea terminal cerrada. */
export function isTaskLogTerminal(filePath: string): boolean {
  const result = readTaskLog(filePath);
  return result.ok && result.ctx.isClosed();
}

export interface TaskLogFileInfo {
  readonly taskId: string;
  readonly filePath: string;
}

/** Lista los archivos `.jsonl` propios de Jarvis dentro de `tasksDir`. */
export function listTaskLogFiles(tasksDir: string): TaskLogFileInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(tasksDir);
  } catch {
    return [];
  }
  const files: TaskLogFileInfo[] = [];
  for (const name of names) {
    if (!LOG_FILE.test(name)) continue;
    const filePath = path.join(tasksDir, name);
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile()) continue;
      files.push({ taskId: taskIdFromFileName(filePath), filePath });
    } catch {
      // Ignora entradas que desaparecieron en carrera.
    }
  }
  files.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return files;
}
