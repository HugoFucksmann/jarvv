/**
 * JARVIS Core — Configuration & Persistence Manager
 * Endpoints y límites de Qwen, Decision 2.0 y servidores MCP locales.
 * Persiste en jarvis-config.json; toda lectura o escritura pasa por `normalize`,
 * de modo que el objeto en memoria siempre cumple la forma de `JarvisConfig`.
 */

import fs from "node:fs";
import path from "node:path";
import { isRecord } from "./utils.ts";

export interface StdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  allowedDirectories?: string[];
}

/** Tope de tokens de salida por etapa de Qwen. */
export interface QwenMaxTokens {
  arguments: number;
  plan: number;
  replan: number;
  verify: number;
  final: number;
}

export interface JarvisConfig {
  qwenUrl: string;
  qwenModel: string;
  /**
   * Solo gobierna `final_response`. Las demás etapas lo fijan en código:
   * plan y replan => true; arguments y verify_stage => false.
   */
  thinking: boolean;
  /** Debe coincidir con el contexto real del motor (num_ctx / OLLAMA_CONTEXT_LENGTH). */
  qwenNumCtx: number;
  qwenMaxTokens: QwenMaxTokens;
  qwenTimeoutMs: number;
  /** Timeout de Qwen cuando la etapa usa thinking. */
  qwenThinkingTimeoutMs: number;
  decisionUrl: string;
  /** Motor de decisión activo:
   *  - "eos" → FastAPI local en decisionUrl/v1/decide (sin model)
   *  - "d3"  → Ollama local en decisionUrl/v1/systemone con campo model
   */
  decisionBackend: "eos" | "d3";
  /** Tag del modelo Ollama. Solo aplica cuando decisionBackend === "d3". */
  decisionModel: string;
  /** Ventana de contexto de Decision 2.0 según su contrato. */
  decisionMaxContext: number;
  decisionTimeoutMs: number;
  desktopCommanderMcp: StdioServerConfig;
  freeSearchMcp: StdioServerConfig;
  mcpTimeoutMs: number;
  /** Registro de trazas: una línea JSON por tarea terminada (lo consume el laboratorio; Jarvis nunca lo lee). */
  traceEnabled: boolean;
  /** Archivo del registro de trazas; una ruta relativa se resuelve contra el directorio de trabajo del proceso. */
  tracePath: string;
}

/** Parche parcial: los servidores MCP y qwenMaxTokens se fusionan campo a campo. */
export type ConfigPatch = Partial<
  Omit<JarvisConfig, "desktopCommanderMcp" | "freeSearchMcp" | "qwenMaxTokens">
> & {
  desktopCommanderMcp?: Partial<StdioServerConfig>;
  freeSearchMcp?: Partial<StdioServerConfig>;
  qwenMaxTokens?: Partial<QwenMaxTokens>;
};

const CONFIG_FILE_PATH = path.resolve(process.cwd(), "jarvis-config.json");

const DEFAULT_CONFIG: JarvisConfig = {
  qwenUrl: "http://127.0.0.1:11434",
  qwenModel: "qwen3.5:9b",
  thinking: false,
  qwenNumCtx: 16384,
  qwenMaxTokens: { arguments: 2048, plan: 4096, replan: 4096, verify: 1024, final: 2048 },
  qwenTimeoutMs: 120000,
  qwenThinkingTimeoutMs: 180000,
  decisionUrl: "http://127.0.0.1:8765",
  decisionBackend: "eos",
  decisionModel: "d3:2b",
  decisionMaxContext: 16384,
  decisionTimeoutMs: 30000,
  desktopCommanderMcp: {
    command: "npx",
    args: ["-y", "@wonderwhy-er/desktop-commander"],
    allowedDirectories: [],
  },
  freeSearchMcp: {
    command: "uvx",
    args: ["--from", "free-search-mcp==0.13.1", "--with", "selectolax==0.3.34", "free-search-mcp"],
  },
  mcpTimeoutMs: 30000,
  traceEnabled: true,
  tracePath: "jarvis-traces.jsonl",
};

// ------------------------------------------------------------
// Normalización
// ------------------------------------------------------------

/** Cadena recortada; "" es válido (p. ej. URL sin configurar). */
const text = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v.trim() : fallback;

const nonEmptyText = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;

const positiveInt = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback;

const stringList = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? [...(v as string[])] : undefined;

const stringRecord = (v: unknown): Record<string, string> | undefined =>
  isRecord(v) && Object.values(v).every((x) => typeof x === "string")
    ? { ...(v as Record<string, string>) }
    : undefined;

function normalizeServer(raw: unknown, base: StdioServerConfig): StdioServerConfig {
  const r = isRecord(raw) ? raw : {};
  const server: StdioServerConfig = {
    command: nonEmptyText(r.command, base.command),
    args: stringList(r.args) ?? [...base.args],
  };

  const env = stringRecord(r.env) ?? base.env;
  if (env) server.env = { ...env };

  const cwd = nonEmptyText(r.cwd, base.cwd ?? "");
  if (cwd) server.cwd = cwd;

  const allowed = stringList(r.allowedDirectories) ?? base.allowedDirectories;
  if (allowed) server.allowedDirectories = [...allowed];

  return server;
}

/**
 * Construye la configuración a partir de campos conocidos únicamente:
 * claves legadas o desconocidas (p. ej. `timeoutMs`, `windowsMcp`) se descartan.
 * Un valor ausente o inválido toma el de `base` (defaults al cargar; configuración vigente al actualizar).
 */
function normalize(raw: unknown, base: JarvisConfig = DEFAULT_CONFIG): JarvisConfig {
  const r = isRecord(raw) ? raw : {};
  const t = isRecord(r.qwenMaxTokens) ? r.qwenMaxTokens : {};
  const d = base;

  return {
    qwenUrl: text(r.qwenUrl, d.qwenUrl),
    qwenModel: nonEmptyText(r.qwenModel, d.qwenModel),
    thinking: typeof r.thinking === "boolean" ? r.thinking : d.thinking,
    qwenNumCtx: positiveInt(r.qwenNumCtx, d.qwenNumCtx),
    qwenMaxTokens: {
      arguments: positiveInt(t.arguments, d.qwenMaxTokens.arguments),
      plan: positiveInt(t.plan, d.qwenMaxTokens.plan),
      replan: positiveInt(t.replan, d.qwenMaxTokens.replan),
      verify: positiveInt(t.verify, d.qwenMaxTokens.verify),
      final: positiveInt(t.final, d.qwenMaxTokens.final),
    },
    qwenTimeoutMs: positiveInt(r.qwenTimeoutMs, d.qwenTimeoutMs),
    qwenThinkingTimeoutMs: positiveInt(r.qwenThinkingTimeoutMs, d.qwenThinkingTimeoutMs),
    decisionUrl: text(r.decisionUrl, d.decisionUrl),
    decisionBackend: r.decisionBackend === "d3" ? "d3" : d.decisionBackend,
    decisionModel: nonEmptyText(r.decisionModel, d.decisionModel),
    decisionMaxContext: positiveInt(r.decisionMaxContext, d.decisionMaxContext),
    decisionTimeoutMs: positiveInt(r.decisionTimeoutMs, d.decisionTimeoutMs),
    desktopCommanderMcp: normalizeServer(r.desktopCommanderMcp, d.desktopCommanderMcp),
    freeSearchMcp: normalizeServer(r.freeSearchMcp, d.freeSearchMcp),
    mcpTimeoutMs: positiveInt(r.mcpTimeoutMs, d.mcpTimeoutMs),
    traceEnabled: typeof r.traceEnabled === "boolean" ? r.traceEnabled : d.traceEnabled,
    tracePath: nonEmptyText(r.tracePath, d.tracePath),
  };
}

// ------------------------------------------------------------
// Gestor
// ------------------------------------------------------------

export class ConfigManager {
  private static currentConfig: JarvisConfig = ConfigManager.loadConfig();

  /** Copia profunda: modificarla no altera la configuración activa. */
  static getConfig(): JarvisConfig {
    return structuredClone(this.currentConfig);
  }

  static updateConfig(patch: ConfigPatch): JarvisConfig {
    const cur = this.currentConfig;
    this.currentConfig = normalize({
      ...cur,
      ...patch,
      desktopCommanderMcp: { ...cur.desktopCommanderMcp, ...patch.desktopCommanderMcp },
      freeSearchMcp: { ...cur.freeSearchMcp, ...patch.freeSearchMcp },
      qwenMaxTokens: { ...cur.qwenMaxTokens, ...patch.qwenMaxTokens },
    }, cur);
    this.saveConfig(this.currentConfig);
    return this.getConfig();
  }

  static isConfigured(service: "qwen" | "decision" | "desktop" | "search"): boolean {
    const c = this.currentConfig;
    switch (service) {
      case "qwen":
        return Boolean(c.qwenUrl);
      case "decision":
        return Boolean(c.decisionUrl);
      case "desktop":
        return Boolean(c.desktopCommanderMcp.command);
      case "search":
        return Boolean(c.freeSearchMcp.command);
    }
  }

  private static loadConfig(): JarvisConfig {
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        return normalize(JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf-8")));
      }
    } catch (e) {
      console.warn("[ConfigManager] No se pudo leer el archivo de configuración local. Usando defaults:", e);
    }
    return normalize({});
  }

  /** Escritura atómica: un corte a mitad de escritura no corrompe el archivo vigente. */
  private static saveConfig(cfg: JarvisConfig): void {
    try {
      const tmp = `${CONFIG_FILE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf-8");
      fs.renameSync(tmp, CONFIG_FILE_PATH);
    } catch (e) {
      console.warn("[ConfigManager] Error al guardar configuración en archivo local:", e);
    }
  }
}