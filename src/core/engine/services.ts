/**
 * JARVIS Core — Composición de los servicios del motor.
 *
 * Crea, una sola vez, el almacén de refs, el alcance de la regla B del Guard y la lista negra compilada. Es lo único del
 * motor que conoce la configuración; los contratos están en `../contracts.ts`.
 */

import os from "node:os";
import path from "node:path";

import type { ConfigSource } from "../config.ts";
import { getUserEnvironment, type UserEnvironment } from "../environment.ts";
import { createJsonMemoryProvider, createMemoryReader, type MemoryFact, type MemoryProvider } from "../memory.ts";
import { compileBlacklist, type Blacklist } from "../policy/blacklist.ts";
import type { ProtectedPaths } from "../policy/guard.ts";
import { createRefVault, type RefVault } from "../refs/refVault.ts";
import { tasksDirFromConfig } from "../taskLog.ts";
import { resolveToolTimeoutMs } from "../timeouts.ts";

// ───────────────────────── Composición ─────────────────────────

export interface EngineServices {
  readonly vault: RefVault;
  readonly guardScope: ProtectedPaths;
  /** Lista negra de herramientas que modifican el sistema, compilada desde la configuración. */
  readonly blacklist: Blacklist;
  /** Datos de esta PC; inyectable para que una prueba o el eval no consulte el sistema. */
  readonly environment: () => Promise<UserEnvironment>;
  readonly autoMode: () => boolean;
  /** Aprobación por niveles (`approvalTiers` de la configuración, leída en cada llamada). */
  readonly approvalTiers?: () => boolean;
  readonly reviewReads?: () => boolean;
  readonly completionCoverageGuard?: () => boolean;
  /** Override de plazo (ms) por herramienta desde la configuración, leído en cada llamada. */
  readonly toolTimeoutMs?: (server: string, tool: string) => number | undefined;
  /** Carpeta de trabajo de las herramientas de archivos (`desktopCommanderMcp.cwd`, o la del proceso). */
  readonly toolBaseDir?: () => string;
  /** Directorios permitidos leídos en vivo desde la configuración en cada llamada. */
  readonly allowedDirectories?: () => readonly string[];
  /** Hechos del usuario de `data/memory.json` (junto a `refsDir`), con caché por fecha de modificación. */
  readonly memory?: () => readonly MemoryFact[];
  /** Proveedor desacoplado de memoria de hechos (`src/memory`). */
  readonly memoryProvider?: MemoryProvider;
  /** Tope de pausa (ms) ante modelo no disponible, leído en vivo de la configuración. */
  readonly modelUnavailablePauseMaxMs?: () => number;
}

/**
 * Crea una sola vez el almacén de refs (con `refsDir`) y el alcance del Guard (refs, logs de tareas, carpeta del proyecto y archivo de memoria).
 * La raíz de composición lo llama una vez y comparte el resultado entre tareas.
 */
export function createEngineServices(getConfig: ConfigSource): EngineServices {
  const config = getConfig();
  const refsDir = path.resolve(config.refsDir);
  const tasksDir = tasksDirFromConfig(config);
  const memoryFile = path.join(path.dirname(refsDir), "memory.json");
  const desktop = config.desktopCommanderMcp;

  const bases = new Set<string>([process.cwd()]);
  if (desktop.cwd) bases.add(path.resolve(desktop.cwd));

  return {
    vault: createRefVault({ dir: refsDir }),
    guardScope: {
      protectedDirs: [refsDir, tasksDir, process.cwd()],
      protectedFiles: [memoryFile],
      relativeBases: [...bases],
      commandBases: [os.homedir()],
    },
    blacklist: compileBlacklist(config.blacklist),
    environment: getUserEnvironment,
    autoMode: () => getConfig().autoMode,
    approvalTiers: () => getConfig().approvalTiers,
    reviewReads: () => getConfig().reviewReads,
    completionCoverageGuard: () => getConfig().completionCoverageGuard,
    toolTimeoutMs: (server, tool) => resolveToolTimeoutMs(getConfig(), server, tool),
    toolBaseDir: () => getConfig().desktopCommanderMcp.cwd ?? process.cwd(),
    allowedDirectories: () => getConfig().desktopCommanderMcp.allowedDirectories ?? [],
    memory: createMemoryReader(memoryFile),
    memoryProvider: createJsonMemoryProvider(memoryFile),
    modelUnavailablePauseMaxMs: () => getConfig().modelUnavailablePauseMaxMs,
  };
}