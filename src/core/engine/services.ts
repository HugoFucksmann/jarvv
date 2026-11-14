/**
 * JARVIS Core — Composición de los servicios del motor.
 *
 * Crea, una sola vez, el almacén de refs, el alcance de la regla B del Guard y la lista negra compilada. Es lo único del
 * motor que conoce la configuración; los contratos están en `../contracts.ts`.
 */

import path from "node:path";

import type { ConfigSource } from "../config.ts";
import { getUserEnvironment, type UserEnvironment } from "../environment.ts";
import { createMemoryReader, type MemoryFact } from "../memory.ts";
import { compileBlacklist, type Blacklist } from "../policy/blacklist.ts";
import { isPathInside, type ProtectedPaths } from "../policy/guard.ts";
import { createRefVault, type RefVault } from "../refs/refVault.ts";

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
  /** Hechos del usuario de `data/memory.json` (junto a `refsDir`), con caché por fecha de modificación. */
  readonly memory?: () => readonly MemoryFact[];
}

let coherenceWarned = false;

/**
 * Aviso de coherencia: si Desktop Commander restringe los directorios (`allowedDirectories` no vacío; vacío = sin
 * restricción) y `refsDir` queda fuera, el modelo no podrá leer las refs con la lectura normal. Se avisa una sola vez.
 */
function warnIfRefsOutsideAllowed(refsDir: string, allowedDirectories: readonly string[]): void {
  if (coherenceWarned || allowedDirectories.length === 0) return;
  if (allowedDirectories.some((dir) => isPathInside(path.resolve(dir), refsDir))) return;
  coherenceWarned = true;
  console.warn(
    `[Engine] refsDir (${refsDir}) queda fuera de allowedDirectories de Desktop Commander: el modelo no podrá leer las refs ` +
    "con la lectura de archivos. Agregue esa carpeta a allowedDirectories o cambie refsDir.",
  );
}

/**
 * Crea una sola vez el almacén de refs (con `refsDir`) y el alcance de la regla B del Guard, y emite el aviso de
 * coherencia. La raíz de composición lo llama una vez y comparte el resultado entre tareas.
 *
 * Las rutas relativas que el modelo escriba se resuelven contra dos bases (D27): el directorio de trabajo de Jarvis y el
 * `cwd` de Desktop Commander si está configurado. No se comprobó contra qué base resuelve Desktop Commander las suyas.
 */
export function createEngineServices(getConfig: ConfigSource): EngineServices {
  const config = getConfig();
  const refsDir = path.resolve(config.refsDir);
  const desktop = config.desktopCommanderMcp;
  warnIfRefsOutsideAllowed(refsDir, desktop.allowedDirectories ?? []);

  const bases = new Set<string>([process.cwd()]);
  if (desktop.cwd) bases.add(path.resolve(desktop.cwd));

  return {
    vault: createRefVault({ dir: refsDir }),
    guardScope: { protectedDirs: [refsDir], relativeBases: [...bases] },
    blacklist: compileBlacklist(config.blacklist),
    environment: getUserEnvironment,
    autoMode: () => getConfig().autoMode,
    approvalTiers: () => getConfig().approvalTiers,
    memory: createMemoryReader(path.join(path.dirname(refsDir), "memory.json")),
  };
}