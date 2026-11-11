/**
 * `run_command`: corte de un proceso y de todo su árbol de hijos (Windows). `taskkill /T /F` es lo que baja también los programas que lanzó el comando;
 * si `taskkill` no se puede ejecutar o no termina a tiempo, se cierra al menos el proceso principal. Nunca espera más de `KILL_TIMEOUT_MS`.
 */

import { spawn } from "node:child_process";

export const KILL_TIMEOUT_MS = 5000;

function killMain(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    // ya no existe
  }
}

export function killTree(pid: number, timeoutMs = KILL_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (fallback: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (fallback) killMain(pid);
      resolve();
    };
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      killer.kill();
      finish(true);
    }, timeoutMs);
    timer.unref();
    killer.once("error", () => finish(true));
    killer.once("close", () => finish(false));
  });
}
