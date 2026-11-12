/**
 * `run_command`, `list_processes` y `stop_process`: corte de un proceso y de todo su árbol de hijos (Windows), la lista de procesos del sistema y qué
 * procesos no se cortan nunca.
 *
 * Corte de un árbol: `taskkill /T /F` es lo que baja también los programas que lanzó el comando;
 * si `taskkill` no se puede ejecutar, no termina a tiempo o termina con error (salvo 128: el proceso ya no existía), se cierra al menos el proceso principal. Nunca espera más de `KILL_TIMEOUT_MS`.
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
    // Código 128: el proceso ya no existía (no hay nada que cerrar). Cualquier otro código distinto de 0 (o ninguno): taskkill falló.
    killer.once("close", (code) => finish(code !== 0 && code !== 128));
  });
}

// ───────────────────────── Procesos del sistema ─────────────────────────

export interface SystemProcess {
  readonly pid: number;
  readonly parentPid: number;
  readonly name: string;
  /** Memoria en uso (working set), en bytes. */
  readonly memoryBytes: number;
}

/**
 * Comando fijo (no lleva nada del modelo) que lista los procesos: pid, padre, memoria y nombre, separados por tabuladores (`[char]9`: sin comillas
 * dobles, que la línea de comandos de Windows escaparía).
 */
const PROCESS_TABLE_COMMAND =
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { '{0}{4}{1}{4}{2}{4}{3}' -f $_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize, $_.Name, [char]9 }";

/** Los procesos de la PC (Windows, `Win32_Process`). Lanza si no se pudieron leer. Sin la línea de comandos: puede llevar secretos. */
export function systemProcesses(timeoutMs = 15_000): Promise<SystemProcess[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", PROCESS_TABLE_COMMAND], {
      windowsHide: true,
      // stderr se descarta: no se lee, y un pipe sin consumidor puede llenarse y bloquear a PowerShell.
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`la lista de procesos no llegó en ${timeoutMs / 1000} s.`));
    }, timeoutMs);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`no se pudo leer la lista de procesos (código ${code}).`));
      const out: SystemProcess[] = [];
      for (const line of Buffer.concat(chunks).toString("utf8").split(/\r?\n/)) {
        const [pid, parent, memory, ...name] = line.split("\t");
        const p = Number(pid);
        if (!Number.isInteger(p) || name.length === 0) continue;
        out.push({ pid: p, parentPid: Number(parent) || 0, memoryBytes: Number(memory) || 0, name: name.join("\t").trim() });
      }
      resolve(out);
    });
  });
}

/** Procesos del sistema que no se cortan nunca: cortarlos cuelga o reinicia Windows. En minúsculas, sin `.exe`. */
const CRITICAL_PROCESSES = new Set([
  "system", "system idle process", "secure system", "registry", "memory compression", "smss", "csrss", "wininit", "winlogon", "services", "lsass",
  "lsaiso", "fontdrvhost", "dwm",
]);

/** De quién es un proceso lanzado por `run_command`: de quien pide cortar (su tarea, o lo que dejó una tarea ya terminada) o de otra tarea en curso. */
export type RootOwner = "caller" | "other_task";

/**
 * ¿Por qué no se puede cortar este proceso? `null` si se puede. No se cortan los procesos críticos de Windows, ni Jarvis, ni los procesos de los que
 * cuelga Jarvis (la terminal que lo lanzó), ni los que lanzó Jarvis por su cuenta (sus servidores de herramientas), ni lo que cuelga de un proceso de
 * `run_command` de otra tarea en curso. Lo que cuelga de un proceso de `run_command` de quien pide (`roots`: `caller`) sí se puede cortar.
 */
export function protectedReason(target: SystemProcess, table: readonly SystemProcess[], roots: ReadonlyMap<number, RootOwner>, self: number = process.pid): string | null {
  const name = target.name.toLowerCase().replace(/\.exe$/, "");
  if (target.pid <= 4 || CRITICAL_PROCESSES.has(name)) return `'${target.name}' is a critical Windows process.`;
  if (target.pid === self) return "It is Jarvis itself.";
  const byPid = new Map(table.map((p) => [p.pid, p]));
  // Ancestros de Jarvis: si se corta uno, cae Jarvis.
  for (let p = byPid.get(self), guard = 0; p !== undefined && guard < 64; p = byPid.get(p.parentPid), guard++) {
    if (p.pid === target.pid) return "Jarvis runs inside it.";
    if (p.parentPid === p.pid) break;
  }
  // Hacia arriba desde el proceso: el primer proceso de `run_command` o Jarvis que aparezca decide de quién es.
  for (let p: SystemProcess | undefined = target, guard = 0; p !== undefined && guard < 64; p = byPid.get(p.parentPid), guard++) {
    const owner = roots.get(p.pid);
    if (owner === "caller") return null;
    if (owner === "other_task") return "It belongs to another task that is still running.";
    if (p.parentPid === self) return "It was started by Jarvis itself (one of its tool servers).";
    if (p.parentPid === p.pid || p.parentPid === 0) break;
  }
  return null;
}

/** Corta un proceso (solo ese, no su árbol) con `taskkill /F`; `true` si `taskkill` terminó bien. */
export function killProcess(pid: number, timeoutMs = KILL_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/F"], { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      killer.kill();
      resolve(false);
    }, timeoutMs);
    timer.unref();
    killer.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    killer.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}