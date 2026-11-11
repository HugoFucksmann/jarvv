/**
 * `run_command`: corte de un proceso y de todo su árbol de hijos (Windows). `taskkill /T /F` es lo que baja también los programas que lanzó el comando;
 * si `taskkill` no se puede ejecutar, se cierra al menos el proceso principal.
 */

import { spawn } from "node:child_process";

export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.once("error", () => {
      try {
        process.kill(pid);
      } catch {
        // ya no existe
      }
      resolve();
    });
    killer.once("close", () => resolve());
  });
}
