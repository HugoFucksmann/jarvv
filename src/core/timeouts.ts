/**
 * JARVIS Core — Tiempos de espera y plazos, en un solo lugar.
 *
 * `TIMEOUT_DEFAULTS` reúne los valores por defecto de los que se pueden cambiar en `jarvis-config.json` (y que se leen en cada uso, salvo que se diga lo contrario);
 * `FIXED_TIMEOUTS` los que son internos y no se configuran (cada módulo los importa de acá, así el inventario completo está en este archivo y en
 * `docs/configuracion/CONFIGURACION.md` §4). Los valores son los que ya regían antes de centralizarlos.
 *
 * Overrides (`resolve*`, puras y probadas sin red ni modelos):
 * - Por herramienta: `toolTimeoutsMs` con la clave `servidor:herramienta` o `herramienta`. Gana sobre el `timeoutMs` del catálogo (`tools/manifest.ts`) y sobre `mcpTimeoutMs`.
 * - Por modelo: `modelTimeoutsMs` con el tag del modelo (`qwen3.5:4b`); para el modo con razonamiento, `<tag>#thinking`. Gana sobre `qwenTimeoutMs`, `qwenThinkingTimeoutMs`
 *   y `decisionTimeoutMs`.
 *
 * No existe un tope de tiempo de la tarea ni del paso: las tareas se acotan por cantidad (`BUDGET`: pasos, llamadas, rechazos), no por reloj; lo único que corre contra el
 * reloj son las esperas de abajo.
 */

export const TIMEOUT_DEFAULTS = {
  /** Una petición JSON-RPC a un servidor MCP por stdio (`mcpTimeoutMs`). */
  mcpMs: 60_000,
  /** Una llamada a Qwen sin razonamiento (`qwenTimeoutMs`). */
  qwenMs: 120_000,
  /** Una llamada a Qwen con razonamiento (`qwenThinkingTimeoutMs`). */
  qwenThinkingMs: 180_000,
  /** Una consulta al modelo de decisión (`decisionTimeoutMs`). */
  decisionMs: 30_000,
  /** `run_command`: segundos que espera una llamada por omisión (`runCommandDefaultWaitSec`) y tope de `timeoutSec` (`runCommandMaxWaitSec`). */
  runCommandDefaultWaitSec: 30,
  runCommandMaxWaitSec: 300,
  /** `web_search`: tope de cada consulta al juez (`webJudgeTimeoutMs`). */
  webJudgeMs: 20_000,
  /** SSE: cada cuánto se manda un `ping` para mantener abierta la conexión (`sseKeepAliveMs`). */
  sseKeepAliveMs: 15_000,
  /** Al apagar el servidor: cuánto se espera a que terminen las tareas (`shutdownDrainMs`). */
  shutdownDrainMs: 3_000,
} as const;

export const FIXED_TIMEOUTS = {
  /** Margen que se resta al plazo de una llamada para devolver un resultado antes de que la corte quien la espera (`run_command`, `web_search`). */
  safetyMarginMs: 5_000,
  /** Holgura del plazo de la herramienta `run_command` sobre su espera máxima: `(runCommandMaxWaitSec + 15) s`. */
  runCommandSlackSec: 15,
  /** Analizador de comandos de PowerShell del pre-chequeo. */
  analyzerMs: 8_000,
  /** Consulta de las carpetas del usuario (`environment.ts`) y lectura de las páginas de códigos (`codepages.ts`). */
  environmentQueryMs: 8_000,
  codePagesMs: 5_000,
  /** Arranque de PowerShell para un comando de `run_command`. */
  spawnMs: 15_000,
  /** Cortar un árbol de procesos o un proceso; tabla de procesos del sistema. */
  killMs: 5_000,
  processTableMs: 15_000,
  /** Cuánto se conserva un proceso terminado que nadie volvió a leer. */
  retainFinishedMs: 10 * 60_000,
  /** Detección de prompts de un proceso: silencio necesario según la forma de la última línea. */
  promptIdleMs: 1_500,
  weakPromptIdleMs: 5_000,
  terminatedPromptIdleMs: 3_000,
  /** Espera entre reintentos de un fallo de red hacia el LLM. */
  llmBackoffMs: 1_000,
  /** Cuánto vale la tarea anterior como hilo de una continuación. */
  threadTtlMs: 10 * 60_000,
  /** Caché del catálogo de herramientas descubierto en los servidores. */
  toolsCacheTtlMs: 30_000,
  /** Cada cuánto corre la retención de refs y trazas. */
  retentionIntervalMs: 6 * 60 * 60_000,
  /** Telegram: actualización del mensaje de progreso, aviso de «escribiendo…», espera del resultado tras el fin de la tarea y reconexión del SSE. */
  telegramStatusMs: 2_500,
  telegramTypingMs: 4_500,
  telegramResultWaitMs: 30_000,
  telegramReconnectMs: 2_000,
} as const;

type TimeoutSource = {
  readonly mcpTimeoutMs: number;
  readonly qwenTimeoutMs: number;
  readonly qwenThinkingTimeoutMs: number;
  readonly decisionTimeoutMs: number;
  readonly toolTimeoutsMs?: Readonly<Record<string, number>>;
  readonly modelTimeoutsMs?: Readonly<Record<string, number>>;
  readonly runCommandMaxWaitSec?: number;
};

const own = (map: Readonly<Record<string, number>> | undefined, key: string): number | undefined =>
  map !== undefined && Object.hasOwn(map, key) && Number.isFinite(map[key]) && map[key] > 0 ? map[key] : undefined;

/**
 * Override de plazo de una herramienta, o `undefined` si no hay (rige el del catálogo y, sin él, `mcpTimeoutMs`). Orden: `servidor:herramienta`, `herramienta`, y para
 * `run_command` el plazo que sigue a su espera máxima configurada (con el valor por defecto da los 315 s del catálogo).
 */
export function resolveToolTimeoutMs(config: TimeoutSource, server: string, tool: string): number | undefined {
  const explicit = own(config.toolTimeoutsMs, `${server}:${tool}`) ?? own(config.toolTimeoutsMs, tool);
  if (explicit !== undefined) return explicit;
  if (tool === "run_command" && config.runCommandMaxWaitSec !== undefined && config.runCommandMaxWaitSec !== TIMEOUT_DEFAULTS.runCommandMaxWaitSec) {
    return (config.runCommandMaxWaitSec + FIXED_TIMEOUTS.runCommandSlackSec) * 1000;
  }
  return undefined;
}

export type ModelTimeoutKind = "qwen" | "qwenThinking" | "decision";

/** Plazo de una llamada a `model`: el override del modelo (`<tag>#thinking` para el razonamiento) o el de la configuración para ese tipo de llamada. */
export function resolveModelTimeoutMs(config: TimeoutSource, model: string, kind: ModelTimeoutKind): number {
  const override = own(config.modelTimeoutsMs, kind === "qwenThinking" ? `${model}#thinking` : model);
  if (override !== undefined) return override;
  return kind === "qwen" ? config.qwenTimeoutMs : kind === "qwenThinking" ? config.qwenThinkingTimeoutMs : config.decisionTimeoutMs;
}
