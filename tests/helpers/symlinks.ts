/**
 * Los tests que crean symlinks reales solo pueden correr donde el sistema lo permita (en Windows hace falta el modo desarrollador o privilegios de
 * administrador). Sin permiso, `fs.symlinkSync` lanza `EPERM`: en lugar de fallar, esos tests se saltan con el motivo.
 *
 * Uso: `test("nombre", { skip: SYMLINKS_SKIP }, async () => { ... })`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function symlinksAvailable(): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-symlink-probe-"));
  try {
    fs.writeFileSync(path.join(dir, "origen.txt"), "x");
    fs.symlinkSync(path.join(dir, "origen.txt"), path.join(dir, "enlace.txt"), "file");
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") return false;
    throw error;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `false` si se pueden crear symlinks; si no, el motivo para saltar el test. */
export const SYMLINKS_SKIP: string | false = symlinksAvailable()
  ? false
  : "La plataforma o los permisos no permiten crear symlinks en este entorno (en Windows: activar el modo desarrollador)";
