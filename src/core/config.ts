/**
 * JARVIS Core — Configuración y persistencia.
 * Endpoints y límites del LLM, Decision 2.0 y servidores MCP locales.
 * Persiste en jarvis-config.json; toda lectura o escritura pasa por `normalize`,
 * de modo que el objeto en memoria siempre cumple la forma de `JarvisConfig`.
 */

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODEL_PAUSE_MAX_MS, TIMEOUT_DEFAULTS } from "./timeouts.ts";
import { isRecord } from "./utils.ts";
import type { BlacklistEntry } from "./policy/blacklist.ts";

export interface StdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
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
  /**
   * Cuánto conserva Ollama cargados los modelos desde la última consulta (`keep_alive` de cada request: duración como `30m` o `2h`, `-1` = sin límite, `0` = descargar
   * al terminar). Sin esto rige el valor del servidor (5 minutos por defecto): la primera tarea tras una pausa paga la carga en frío. Se manda a los dos modelos.
   */
  modelKeepAlive: string;
  qwenTimeoutMs: number;
  qwenThinkingTimeoutMs: number;
  decisionUrl: string;
  /** Tag del modelo de decisión en el servidor (Ollama local o una URL remota); viaja en el campo `model`. */
  decisionModel: string;
  /** Ventana de contexto de Decision 2.0 según su contrato. */
  decisionMaxContext: number;
  decisionTimeoutMs: number;
  /** Pausa acumulada máxima (ms) por consulta cuando el LLM o Decision no responden; 0 = sin pausa. */
  modelUnavailablePauseMaxMs: number;
  /** Directorios a los que pueden acceder las herramientas; lista vacía = sin restricción. */
  allowedDirectories: string[];
  freeSearchMcp: StdioServerConfig;
  mcpTimeoutMs: number;
  /** Overrides de plazo (ms) por herramienta: clave `servidor:herramienta` o `herramienta`. Ganan sobre el plazo del catálogo y sobre `mcpTimeoutMs` (`timeouts.ts`). */
  toolTimeoutsMs: Record<string, number>;
  /** Overrides de plazo (ms) por modelo: clave el tag (`qwen3.5:4b`; `<tag>#thinking` para el razonamiento). Ganan sobre `qwenTimeoutMs`, `qwenThinkingTimeoutMs` y `decisionTimeoutMs`. */
  modelTimeoutsMs: Record<string, number>;
  /** `run_command`: segundos que espera una llamada por omisión y tope de su `timeoutSec`. El plazo de la herramienta sigue al tope (tope + 15 s). */
  runCommandDefaultWaitSec: number;
  runCommandMaxWaitSec: number;
  /** `web_search`: tope (ms) de cada consulta al modelo juez. */
  webJudgeTimeoutMs: number;
  /** SSE: intervalo (ms) del `ping` que mantiene abierta la conexión. */
  sseKeepAliveMs: number;
  /** Al apagar el servidor: espera máxima (ms) a que terminen las tareas. */
  shutdownDrainMs: number;
  /** Registro de trazas: una carpeta por tarea terminada más una línea en `index.jsonl` (lo consume el laboratorio; Jarvis nunca lo lee). */
  traceEnabled: boolean;
  /** Carpeta donde se guardan las trazas (una subcarpeta por tarea terminada). Una ruta relativa se resuelve contra el directorio de trabajo. Se cambia solo en `jarvis-config.json`. */
  traceDir: string;
  /** Días que se conservan los resultados crudos (`refsDir`) y las trazas; lo más viejo se borra al arrancar y cada 6 horas. 0 = no se borra nada. Las refs de una tarea retenida en memoria no se tocan. */
  retentionDays: number;
  /** Días que se conservan los logs de eventos de tareas terminales (`data/tasks/*.jsonl`); 0 = no se borran por antigüedad. */
  logRetentionDays: number;
  /** Tope de tamaño total en disco (en MB) compartido entre `refsDir`, las trazas y los logs; si se supera, se borran los más antiguos primero. 0 = sin tope por tamaño. */
  retentionMaxMb: number;
  /** Carpeta de los resultados crudos de las refs; una ruta relativa se resuelve contra el directorio de trabajo del proceso. */
  refsDir: string;
  /** Lista negra de herramientas que modifican el sistema (rechazo `tool_rejected`; ver `policy/blacklist.ts`). */
  blacklist: BlacklistEntry[];
  /**
   * Único switch de aprobación. Los niveles de riesgo (`policy/tiers.ts`) están siempre activos: verde sin confirmación ni revisión; amarillo lo confirma el usuario,
   * o con `autoMode` lo valida la revisión de argumentos (Decisión 3) con umbral estricto; rojo (borrar, sobrescribir, comandos que modifican) siempre lo confirma el
   * usuario. Lo prohibido (Guard, lista negra `blocked`) sigue rechazado. Se lee en cada llamada: se puede cambiar con la tarea en curso.
   */
  autoMode: boolean;
  /**
   * EXPERIMENTAL (apagado por defecto; cambian lo que ve o decide el modelo y hay que medirlos antes de encenderlos). Se leen en cada llamada.
   * - `reviewFullView`: Decisión 3 recibe además las últimas lecturas y los datos del entorno (hoy solo `Target`, `User Input`, `Previous Errors`, `Call` y `Args`).
   * - `reviewReads`: las lecturas también pasan por Decisión 3 (hoy nunca).
   * - `completionCoverageGuard`: Decisión 5 no cierra la tarea si el pedido nombra un archivo que ninguna llamada menciona; cae a la confirmación de siempre.
   */
  reviewFullView: boolean;
  reviewReads: boolean;
  completionCoverageGuard: boolean;
  /** Con la lista de pendientes cubierta (cobertura >= `LIST_COVERAGE_CLOSE`), todos sus ítems cumplidos y ningún paso fallido, la tarea cierra sin consultar a Decisión 5 (`engine/completion.ts`). Encendido por defecto; `false` vuelve a consultarla siempre. */
  closeByListCoverage: boolean;
  /**
   * Modo sombra de la recuperación tras un paso fallido (`engine/recoveryShadow.ts`): tras cada fallo del reactivo calcula qué haría y lo registra en la traza SIN actuar. No cambia
   * lo que hace Jarvis; agrega una consulta a Decisión por fallo cuando las reglas no deciden. Se lee en cada fallo. Encendido por defecto: es el instrumento para medir `recovery` con tareas reales.
   */
  recoveryShadow: boolean;
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

interface ConfigChangeEvent {
  readonly prev: JarvisConfig;
  readonly next: JarvisConfig;
}

type ConfigChangeListener = (event: ConfigChangeEvent) => void;

/**
 * Campos de un servidor MCP que definen QUÉ proceso lanza Jarvis. Solo se cambian editando `jarvis-config.json` y reiniciando:
 * la API HTTP (`POST /config`) los ignora, para que un cliente local no pueda fijar el ejecutable que se lanzará al arrancar.
 */
export const LAUNCH_ONLY_KEYS = ["command", "args", "env", "cwd"] as const;

/**
 * Claves de primer nivel que dicen DÓNDE escribe o borra Jarvis (`refsDir`, `traceDir`: la retención y las trazas actúan sobre esas carpetas). `tracePath` es el nombre
 * anterior de `traceDir` (se sigue leyendo del archivo, ver `legacyTraceDir`) y también se ignora por HTTP.
 * Igual que `LAUNCH_ONLY_KEYS`, solo se cambian editando `jarvis-config.json`.
 */
export const FILE_ONLY_KEYS = ["refsDir", "traceDir", "tracePath"] as const;

/** Parche parcial: los servidores MCP y qwenMaxTokens se fusionan campo a campo. */
export type ConfigPatch = Partial<
  Omit<JarvisConfig, "freeSearchMcp" | "qwenMaxTokens">
> & {
  freeSearchMcp?: Partial<StdioServerConfig>;
  qwenMaxTokens?: Partial<QwenMaxTokens>;
};

/** `keep_alive` válido para Ollama: `-1`, `0` o una duración con unidad (`30m`, `2h`, `90s`); lo demás cae al valor por defecto. */
export const isKeepAlive = (v: unknown): v is string => typeof v === "string" && /^(?:-1|0|\d+(?:\.\d+)?(?:ms|s|m|h))$/.test(v.trim());
const keepAlive = (v: unknown, fallback: string): string => (isKeepAlive(v) ? v.trim() : fallback);

/** Un mapa `clave → milisegundos` (overrides de plazo): descarta lo que no sea un entero positivo y las claves vacías. */
export function timeoutMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) return out;
  for (const [key, value] of Object.entries(v)) {
    if (key.trim() !== "" && typeof value === "number" && Number.isInteger(value) && value > 0) out[key.trim()] = value;
  }
  return out;
}

const CONFIG_FILE_PATH = path.resolve(process.cwd(), "jarvis-config.json");

const DEFAULT_CONFIG: JarvisConfig = {
  qwenUrl: "http://127.0.0.1:11434",
  qwenModel: "qwen3.5:4b",
  thinking: false,
  qwenNumCtx: 16384,
  qwenMaxTokens: { arguments: 2048, plan: 4096, replan: 4096, final: 2048 },
  modelKeepAlive: "30m",
  qwenTimeoutMs: TIMEOUT_DEFAULTS.qwenMs,
  qwenThinkingTimeoutMs: TIMEOUT_DEFAULTS.qwenThinkingMs,
  decisionUrl: "http://127.0.0.1:11434",
  decisionModel: "d3:2b",
  decisionMaxContext: 16384,
  decisionTimeoutMs: TIMEOUT_DEFAULTS.decisionMs,
  modelUnavailablePauseMaxMs: DEFAULT_MODEL_PAUSE_MAX_MS,
  allowedDirectories: [],
  freeSearchMcp: {
    // `mcp/free-search/constraints.txt` fija las ~90 dependencias transitivas (las genera `uv pip compile` desde `requirements.in`); sin él `uvx`
    // las resuelve por rangos y dos arranques en fechas distintas podrían traer versiones distintas. La ruta es relativa a la raíz del proyecto.
    command: "uvx",
    args: ["--from", "free-search-mcp==0.18.0", "--with", "selectolax==0.3.34", "--constraints", "mcp/free-search/constraints.txt", "free-search-mcp"],
    // Sin el carril de agentes: con una sesión de Codex firmada en la PC, `auto` mandaría las búsquedas también a ChatGPT y gastaría su cuota.
    env: { SEARCH_MCP_AGENT_ENGINES: "off" },
  },
  mcpTimeoutMs: TIMEOUT_DEFAULTS.mcpMs,
  toolTimeoutsMs: {},
  modelTimeoutsMs: {},
  runCommandDefaultWaitSec: TIMEOUT_DEFAULTS.runCommandDefaultWaitSec,
  runCommandMaxWaitSec: TIMEOUT_DEFAULTS.runCommandMaxWaitSec,
  webJudgeTimeoutMs: TIMEOUT_DEFAULTS.webJudgeMs,
  sseKeepAliveMs: TIMEOUT_DEFAULTS.sseKeepAliveMs,
  shutdownDrainMs: TIMEOUT_DEFAULTS.shutdownDrainMs,
  traceEnabled: true,
  traceDir: "jarvis-traces",
  refsDir: "data/refs",
  retentionDays: 10,
  logRetentionDays: 30,
  retentionMaxMb: 250,
  blacklist: [],
  autoMode: false,
  reviewFullView: false,
  reviewReads: false,
  completionCoverageGuard: false,
  closeByListCoverage: true,
  recoveryShadow: true,
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

/**
 * Nombre anterior de `traceDir`: `tracePath` era un archivo (`jarvis-traces.jsonl`) que nunca se escribía y cuya ruta sin extensión daba la carpeta.
 * Un `jarvis-config.json` viejo sigue funcionando: la carpeta es esa misma ruta sin la extensión.
 */
export const legacyTraceDir = (tracePath: unknown, fallback: string): string => {
  if (typeof tracePath !== "string" || tracePath.trim() === "") return fallback;
  const file = tracePath.trim();
  const ext = path.extname(file);
  return ext === "" ? file : file.slice(0, -ext.length);
};

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
    const level = raw.level === "blocked" || raw.level === "sensitive" ? raw.level : undefined;
    out.push({ tool: raw.tool.trim(), reason: raw.reason.trim(), ...(pattern === undefined ? {} : { pattern }), ...(level === undefined ? {} : { level }) });
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
    modelKeepAlive: keepAlive(r.modelKeepAlive, d.modelKeepAlive),
    qwenTimeoutMs: positiveInt(r.qwenTimeoutMs, d.qwenTimeoutMs),
    qwenThinkingTimeoutMs: positiveInt(r.qwenThinkingTimeoutMs, d.qwenThinkingTimeoutMs),
    decisionUrl: text(r.decisionUrl, d.decisionUrl),
    decisionModel: nonEmptyText(r.decisionModel, d.decisionModel),
    decisionMaxContext: positiveInt(r.decisionMaxContext, d.decisionMaxContext),
    decisionTimeoutMs: positiveInt(r.decisionTimeoutMs, d.decisionTimeoutMs),
    modelUnavailablePauseMaxMs: nonNegativeInt(r.modelUnavailablePauseMaxMs, d.modelUnavailablePauseMaxMs),
    allowedDirectories: stringList(r.allowedDirectories) ?? [...d.allowedDirectories],
    freeSearchMcp: normalizeServer(r.freeSearchMcp, d.freeSearchMcp),
    mcpTimeoutMs: positiveInt(r.mcpTimeoutMs, d.mcpTimeoutMs),
    toolTimeoutsMs: timeoutMap(r.toolTimeoutsMs),
    modelTimeoutsMs: timeoutMap(r.modelTimeoutsMs),
    runCommandDefaultWaitSec: positiveInt(r.runCommandDefaultWaitSec, d.runCommandDefaultWaitSec),
    runCommandMaxWaitSec: positiveInt(r.runCommandMaxWaitSec, d.runCommandMaxWaitSec),
    webJudgeTimeoutMs: positiveInt(r.webJudgeTimeoutMs, d.webJudgeTimeoutMs),
    sseKeepAliveMs: positiveInt(r.sseKeepAliveMs, d.sseKeepAliveMs),
    shutdownDrainMs: positiveInt(r.shutdownDrainMs, d.shutdownDrainMs),
    traceEnabled: typeof r.traceEnabled === "boolean" ? r.traceEnabled : d.traceEnabled,
    traceDir: nonEmptyText(r.traceDir, legacyTraceDir(r.tracePath, d.traceDir)),
    refsDir: nonEmptyText(r.refsDir, d.refsDir),
    retentionDays: nonNegativeInt(r.retentionDays, d.retentionDays),
    logRetentionDays: nonNegativeInt(r.logRetentionDays, d.logRetentionDays),
    retentionMaxMb: nonNegativeInt(r.retentionMaxMb, d.retentionMaxMb),
    blacklist: blacklistEntries(r.blacklist) ?? d.blacklist.map((e) => ({ ...e })),
    autoMode: typeof r.autoMode === "boolean" ? r.autoMode : d.autoMode,
    reviewFullView: typeof r.reviewFullView === "boolean" ? r.reviewFullView : d.reviewFullView,
    reviewReads: typeof r.reviewReads === "boolean" ? r.reviewReads : d.reviewReads,
    completionCoverageGuard: typeof r.completionCoverageGuard === "boolean" ? r.completionCoverageGuard : d.completionCoverageGuard,
    closeByListCoverage: typeof r.closeByListCoverage === "boolean" ? r.closeByListCoverage : d.closeByListCoverage,
    recoveryShadow: typeof r.recoveryShadow === "boolean" ? r.recoveryShadow : d.recoveryShadow,
    webSearchUseJudge: typeof r.webSearchUseJudge === "boolean" ? r.webSearchUseJudge : d.webSearchUseJudge,
    voiceEnabled: typeof r.voiceEnabled === "boolean" ? r.voiceEnabled : d.voiceEnabled,
    telegramVoice: typeof r.telegramVoice === "boolean" ? r.telegramVoice : d.telegramVoice,
    voiceUrl: httpUrl(r.voiceUrl, d.voiceUrl),
    voiceName: nonEmptyText(r.voiceName, d.voiceName),
  };
}

export class ConfigManager {
  private static currentConfig: JarvisConfig = ConfigManager.loadConfig();
  private static readonly changeListeners = new Set<ConfigChangeListener>();

  /** Suscribe un oyente a los cambios de configuración (`updateConfig`). Devuelve la función para desuscribirse. */
  static onChange(listener: ConfigChangeListener): () => void {
    ConfigManager.changeListeners.add(listener);
    return () => {
      ConfigManager.changeListeners.delete(listener);
    };
  }

  /** Copia profunda: modificarla no altera la configuración activa. */
  static getConfig(): JarvisConfig {
    return structuredClone(ConfigManager.currentConfig);
  }

  static updateConfig(patch: ConfigPatch): JarvisConfig {
    const prev = ConfigManager.currentConfig;
    const next = normalize({
      ...prev,
      ...patch,
      freeSearchMcp: { ...prev.freeSearchMcp, ...patch.freeSearchMcp },
      qwenMaxTokens: { ...prev.qwenMaxTokens, ...patch.qwenMaxTokens },
    }, prev);
    ConfigManager.currentConfig = next;
    ConfigManager.saveConfig(next);
    for (const listener of [...ConfigManager.changeListeners]) {
      try {
        listener({ prev: structuredClone(prev), next: structuredClone(next) });
      } catch (error) {
        console.error("[ConfigManager] un suscriptor de onChange falló:", error);
      }
    }
    return ConfigManager.getConfig();
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