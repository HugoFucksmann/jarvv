/**
 * JARVIS Core — Configuración y persistencia.
 * Endpoints y límites del LLM, Decision 2.0 y servidores MCP locales.
 * Persiste en jarvis-config.json; toda lectura o escritura pasa por `normalize`,
 * de modo que el objeto en memoria siempre cumple la forma de `JarvisConfig`.
 */

import fs from "node:fs";
import path from "node:path";
import { isRecord } from "./utils.ts";
import type { BlacklistEntry } from "./policy/blacklist.ts";

export interface StdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  allowedDirectories?: string[];
}

/** Tope de tokens de salida por etapa del LLM. */
export interface QwenMaxTokens {
  arguments: number;
  plan: number;
  replan: number;
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
  qwenThinkingTimeoutMs: number;
  decisionUrl: string;
  /** Tag del modelo de decisión en el servidor (Ollama local o una URL remota); viaja en el campo `model`. */
  decisionModel: string;
  /** Ventana de contexto de Decision 2.0 según su contrato. */
  decisionMaxContext: number;
  decisionTimeoutMs: number;
  desktopCommanderMcp: StdioServerConfig;
  freeSearchMcp: StdioServerConfig;
  mcpTimeoutMs: number;
  /** Registro de trazas: una carpeta por tarea terminada más una línea en `index.jsonl` (lo consume el laboratorio; Jarvis nunca lo lee). */
  traceEnabled: boolean;
  /** Solo fija la ubicación: las trazas van a la carpeta homónima sin extensión (`jarvis-traces.jsonl` → `jarvis-traces/`); el archivo `.jsonl` no se escribe. Una ruta relativa se resuelve contra el directorio de trabajo del proceso. */
  tracePath: string;
  /** Días que se conservan los resultados crudos (`refsDir`) y las trazas; lo más viejo se borra al arrancar y cada 6 horas. 0 = no se borra nada. Las refs de una tarea retenida en memoria no se tocan. */
  retentionDays: number;
  /** Carpeta de los resultados crudos de las refs; una ruta relativa se resuelve contra el directorio de trabajo del proceso. */
  refsDir: string;
  /** Lista negra de herramientas que modifican el sistema (rechazo `tool_rejected`; ver `policy/blacklist.ts`). */
  blacklist: BlacklistEntry[];
  /**
   * Modo automático: las operaciones que piden aprobación (escrituras y comandos) no se la piden al usuario y las valida la revisión de
   * argumentos (Decisión 3). Lo prohibido (Guard, lista negra) sigue rechazado. Se lee en cada llamada: se puede cambiar con la tarea en curso.
   */
  autoMode: boolean;
  /**
   * `web_search`: puntuar los fragmentos con el modelo de decisión (2B). Apagado, el estado y los fragmentos salen solo del orden léxico (BM25). Se lee en cada llamada.
   * Empieza encendido: en la evaluación (scripts/validate/web_eval/RESULTADOS.md) sin el modelo la tool responde algo en 4 de 5 preguntas sin respuesta; con él, en 1 de 5.
   */
  webSearchUseJudge: boolean;
  /** Voz (TTS local, servidor compatible con OpenAI: `scripts/phonon_server.py`). La interfaz lee en voz alta cada respuesta final. Se lee en cada respuesta. */
  voiceEnabled: boolean;
  /** Además de texto, Telegram responde con una nota de voz (necesita `ffmpeg` en el PATH). */
  telegramVoice: boolean;
  /** URL base del servidor TTS (solo http o https). */
  voiceUrl: string;
  /** Voz del servidor TTS (`GET /v1/audio/voices` las lista); "default" usa la predeterminada. */
  voiceName: string;
}

/** Origen de la configuración vigente: quien construye un motor se lo pasa (la raíz de composición decide de dónde sale). Se llama en cada uso, así un cambio en caliente se respeta. */
export type ConfigSource = () => JarvisConfig;

/**
 * Campos de un servidor MCP que definen QUÉ proceso lanza Jarvis. Solo se cambian editando `jarvis-config.json` y reiniciando:
 * la API HTTP (`POST /config`) los ignora, para que un cliente local no pueda fijar el ejecutable que se lanzará al arrancar.
 */
export const LAUNCH_ONLY_KEYS = ["command", "args", "env", "cwd"] as const;

/**
 * Claves de primer nivel que dicen DÓNDE escribe o borra Jarvis (`refsDir`, `tracePath`: la retención y las trazas actúan sobre esas carpetas).
 * Igual que `LAUNCH_ONLY_KEYS`, solo se cambian editando `jarvis-config.json`.
 */
export const FILE_ONLY_KEYS = ["refsDir", "tracePath"] as const;

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
  qwenModel: "qwen3.5:4b",
  thinking: false,
  qwenNumCtx: 16384,
  qwenMaxTokens: { arguments: 2048, plan: 4096, replan: 4096, final: 2048 },
  qwenTimeoutMs: 120000,
  qwenThinkingTimeoutMs: 180000,
  decisionUrl: "http://127.0.0.1:11434",
  decisionModel: "d3:2b",
  decisionMaxContext: 16384,
  decisionTimeoutMs: 30000,
  desktopCommanderMcp: {
    // Desktop Commander es una dependencia del proyecto (`package.json`, versión exacta; el lockfile fija el resto) y se lanza con `node` directo:
    // arranca en ~1,4 s contra ~2,7 s con `npx`, no consulta el registro y no depende de la red. La ruta es relativa al directorio de trabajo de
    // Jarvis (la raíz del proyecto). Para subir la versión: `npm install --save-exact --ignore-scripts @wonderwhy-er/desktop-commander@<x>` (sin scripts: el `postinstall` del paquete manda
    // una estadística de instalación; el binario de `rg` viene en un paquete por plataforma y no necesita script) y probar.
    command: "node",
    args: ["node_modules/@wonderwhy-er/desktop-commander/dist/index.js"],
    allowedDirectories: [],
  },
  freeSearchMcp: {
    // `mcp/free-search/constraints.txt` fija las ~90 dependencias transitivas (las genera `uv pip compile` desde `requirements.in`); sin él `uvx`
    // las resuelve por rangos y dos arranques en fechas distintas podrían traer versiones distintas. La ruta es relativa a la raíz del proyecto.
    command: "uvx",
    args: ["--from", "free-search-mcp==0.18.0", "--with", "selectolax==0.3.34", "--constraints", "mcp/free-search/constraints.txt", "free-search-mcp"],
    // Sin el carril de agentes: con una sesión de Codex firmada en la PC, `auto` mandaría las búsquedas también a ChatGPT y gastaría su cuota.
    env: { SEARCH_MCP_AGENT_ENGINES: "off" },
  },
  mcpTimeoutMs: 60000,
  traceEnabled: true,
  tracePath: "jarvis-traces.jsonl",
  refsDir: "data/refs",
  retentionDays: 30,
  blacklist: [],
  autoMode: false,
  webSearchUseJudge: true,
  voiceEnabled: false,
  telegramVoice: false,
  voiceUrl: "http://127.0.0.1:8880",
  voiceName: "default",
};

/** Cadena recortada; "" es válido (p. ej. URL sin configurar). */
const text = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v.trim() : fallback;

const nonEmptyText = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;

const positiveInt = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback;

const nonNegativeInt = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

const stringList = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? [...(v as string[])] : undefined;

const stringRecord = (v: unknown): Record<string, string> | undefined =>
  isRecord(v) && Object.values(v).every((x) => typeof x === "string")
    ? { ...(v as Record<string, string>) }
    : undefined;

/** Entradas válidas de la lista negra (`tool` y `reason` con texto; `pattern` opcional); las demás se descartan. */
function blacklistEntries(v: unknown): BlacklistEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: BlacklistEntry[] = [];
  for (const raw of v) {
    if (!isRecord(raw) || typeof raw.tool !== "string" || !raw.tool.trim() || typeof raw.reason !== "string" || !raw.reason.trim()) continue;
    const pattern = typeof raw.pattern === "string" && raw.pattern.trim() ? raw.pattern : undefined;
    out.push({ tool: raw.tool.trim(), reason: raw.reason.trim(), ...(pattern === undefined ? {} : { pattern }) });
  }
  return out;
}

/** URL http(s) sin espacios; cualquier otra cosa (`file:`, vacío…) toma el valor de respaldo. */
const httpUrl = (v: unknown, fallback: string): string => {
  if (typeof v !== "string") return fallback;
  const value = v.trim().replace(/\/+$/, "");
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : fallback;
  } catch {
    return fallback;
  }
};

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
      final: positiveInt(t.final, d.qwenMaxTokens.final),
    },
    qwenTimeoutMs: positiveInt(r.qwenTimeoutMs, d.qwenTimeoutMs),
    qwenThinkingTimeoutMs: positiveInt(r.qwenThinkingTimeoutMs, d.qwenThinkingTimeoutMs),
    decisionUrl: text(r.decisionUrl, d.decisionUrl),
    decisionModel: nonEmptyText(r.decisionModel, d.decisionModel),
    decisionMaxContext: positiveInt(r.decisionMaxContext, d.decisionMaxContext),
    decisionTimeoutMs: positiveInt(r.decisionTimeoutMs, d.decisionTimeoutMs),
    desktopCommanderMcp: normalizeServer(r.desktopCommanderMcp, d.desktopCommanderMcp),
    freeSearchMcp: normalizeServer(r.freeSearchMcp, d.freeSearchMcp),
    mcpTimeoutMs: positiveInt(r.mcpTimeoutMs, d.mcpTimeoutMs),
    traceEnabled: typeof r.traceEnabled === "boolean" ? r.traceEnabled : d.traceEnabled,
    tracePath: nonEmptyText(r.tracePath, d.tracePath),
    refsDir: nonEmptyText(r.refsDir, d.refsDir),
    retentionDays: nonNegativeInt(r.retentionDays, d.retentionDays),
    blacklist: blacklistEntries(r.blacklist) ?? d.blacklist.map((e) => ({ ...e })),
    autoMode: typeof r.autoMode === "boolean" ? r.autoMode : d.autoMode,
    webSearchUseJudge: typeof r.webSearchUseJudge === "boolean" ? r.webSearchUseJudge : d.webSearchUseJudge,
    voiceEnabled: typeof r.voiceEnabled === "boolean" ? r.voiceEnabled : d.voiceEnabled,
    telegramVoice: typeof r.telegramVoice === "boolean" ? r.telegramVoice : d.telegramVoice,
    voiceUrl: httpUrl(r.voiceUrl, d.voiceUrl),
    voiceName: nonEmptyText(r.voiceName, d.voiceName),
  };
}

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