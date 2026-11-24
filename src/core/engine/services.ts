/**
 * JARVIS Core — Composición de los servicios del motor.
 *
 * Crea, una sola vez, el almacén de refs, el alcance de la regla B del Guard y la lista negra compilada. Es lo único del
 * motor que conoce la configuración; los contratos están en `../contracts.ts`.
 */

import os from "node:os";
import path from "node:path";

import type { ConfigSource, JarvisConfig } from "../config.ts";
import { getUserEnvironment, type UserEnvironment } from "../environment.ts";
import type { MemoryProvider } from "../../memory/index.ts";
import { compileBlacklist, type Blacklist } from "../policy/blacklist.ts";
import type { ProtectedPaths } from "../policy/guard.ts";
import { createRefVault, type RefVault } from "../refs/refVault.ts";
import { tasksDirFromConfig } from "../taskLog.ts";
import { resolveToolTimeoutMs } from "../timeouts.ts";

// ───────────────────────── Composición ─────────────────────────

export interface EngineServices {
  readonly vault: RefVault;
  readonly guardScope: ProtectedPaths;
  /** Lista negra de herramientas que modifican el sistema, compilada desde la configuración (estática o en vivo). */
  readonly blacklist: Blacklist | (() => Blacklist);
  /** Datos de esta PC; inyectable para que una prueba o el eval no consulte el sistema. */
  readonly environment: () => Promise<UserEnvironment>;
  readonly autoMode: () => boolean;
  readonly reviewReads?: () => boolean;
  readonly completionCoverageGuard?: () => boolean;
  /** Modo sombra de `recovery` (config `recoveryShadow`, leída en cada fallo): registra qué haría, no actúa. */
  readonly recoveryShadow?: () => boolean;
  /** Override de plazo (ms) por herramienta desde la configuración, leído en cada llamada. */
  readonly toolTimeoutMs?: (server: string, tool: string) => number | undefined;
  /** Directorios permitidos leídos en vivo desde la configuración en cada llamada. */
  readonly allowedDirectories?: () => readonly string[];
  /** Proveedor de memoria de hechos que eligió la raíz de composición (`src/memory`); omitido = sin memoria. El motor no elige la implementación. */
  readonly memoryProvider?: MemoryProvider;
  /** Tope de pausa (ms) ante modelo no disponible, leído en vivo de la configuración. */
  readonly modelUnavailablePauseMaxMs?: () => number;
}

/** El archivo de la memoria de hechos (`data/memory.json`): junto a `refsDir`. Lo protege Guard; qué proveedor lo lee lo decide la raíz de composición. */
export function memoryFileOf(config: Pick<JarvisConfig, "refsDir">): string {
  return path.join(path.dirname(path.resolve(config.refsDir)), "memory.json");
}

/** Opciones que decide la raíz de composición. */
export interface EngineServicesOptions {
  /** Proveedor de memoria de hechos (`createJsonMemoryProvider(memoryFileOf(config))` en `server.tsx`). Omitido = sin memoria. */
  readonly memoryProvider?: MemoryProvider;
}

/**
 * Crea una sola vez el almacén de refs (con `refsDir`) y el alcance del Guard (refs, logs de tareas, carpeta del proyecto y archivo de memoria).
 * La raíz de composición lo llama una vez y comparte el resultado entre tareas.
 */
export function createEngineServices(getConfig: ConfigSource, options: EngineServicesOptions = {}): EngineServices {
  const config = getConfig();
  const refsDir = path.resolve(config.refsDir);
  const tasksDir = tasksDirFromConfig(config);
  const memoryFile = memoryFileOf(config);

  let cachedBlacklistRaw: string | null = null;
  let cachedBlacklist: Blacklist | null = null;
  const getBlacklist = (): Blacklist => {
    const raw = getConfig().blacklist;
    const serialized = JSON.stringify(raw);
    if (cachedBlacklist !== null && cachedBlacklistRaw === serialized) return cachedBlacklist;
    cachedBlacklistRaw = serialized;
    cachedBlacklist = compileBlacklist(raw);
    return cachedBlacklist;
  };

  return {
    vault: createRefVault({ dir: refsDir }),
    guardScope: {
      protectedDirs: [refsDir, tasksDir, process.cwd()],
      protectedFiles: [memoryFile],
      relativeBases: [process.cwd()],
      commandBases: [os.homedir()],
      homeDirs: [os.homedir()],
    },
    blacklist: getBlacklist,
    environment: getUserEnvironment,
    autoMode: () => getConfig().autoMode,
    reviewReads: () => getConfig().reviewReads,
    completionCoverageGuard: () => getConfig().completionCoverageGuard,
    recoveryShadow: () => getConfig().recoveryShadow,
    toolTimeoutMs: (server, tool) => resolveToolTimeoutMs(getConfig(), server, tool),
    allowedDirectories: () => getConfig().allowedDirectories,
    ...(options.memoryProvider === undefined ? {} : { memoryProvider: options.memoryProvider }),
    modelUnavailablePauseMaxMs: () => getConfig().modelUnavailablePauseMaxMs,
  };
}