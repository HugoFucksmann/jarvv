/**
 * JARVIS Core — Procesos en segundo plano que lanzó la tarea.
 *
 * `start_process` puede dejar un proceso corriendo (un servidor, un REPL, un `ping -t`). El hecho `process` del contexto solo recuerda el
 * último; aquí se lleva la cuenta de TODOS los que siguen activos y, si la tarea no termina bien (cancelada, fallida o parcial), se les
 * pide a Desktop Commander que los cierre (`force_terminate`). Si la tarea se completa, se dejan: pudo ser justo lo pedido (levantar un
 * servidor). Al apagar el servidor de Jarvis, el transporte baja de todos modos el árbol de procesos de Desktop Commander.
 */

import type { ProcessedResult } from "../result/processResult.ts";
import { errorMessage } from "../utils.ts";
import type { EngineEnv } from "./env.ts";

/** Cuánto se espera a que el servidor confirme el cierre de cada proceso. */
const TERMINATE_TIMEOUT_MS = 5000;

/**
 * Actualiza la cuenta con el resultado de una llamada: un proceso nuevo y activo entra; uno que terminó, o una interacción que dice
 * `not_found` sobre su `pid`, sale. `started`: la llamada es la que lanza procesos (escritura de la familia de procesos).
 */
export function trackProcess(processes: Set<string>, processed: ProcessedResult, started: boolean, args: Record<string, unknown>): void {
  const signal = processed.process;
  if (signal !== undefined) {
    const pid = String(signal.pid);
    if (!signal.active) processes.delete(pid);
    else if (processed.status === "ok" && started) processes.add(pid);
    return;
  }
  if (processed.status === "not_found" && args.pid !== undefined) processes.delete(String(args.pid));
}

/** Cierra los procesos que siguen activos. Nunca lanza: un fallo se informa. Devuelve los `pid` que se intentaron cerrar. */
export async function terminateProcesses(env: EngineEnv): Promise<string[]> {
  const pids = [...env.processes];
  env.processes.clear();
  if (pids.length === 0) return [];
  const server = env.deps.discovery.getServer("desktop_commander");
  if (server === undefined) return pids;

  await Promise.allSettled(
    pids.map(async (pid) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`sin respuesta tras ${TERMINATE_TIMEOUT_MS} ms`)), TERMINATE_TIMEOUT_MS);
        });
        await Promise.race([server.callTool("force_terminate", { pid: Number(pid) }), timeout]);
        console.log(`[Engine] proceso ${pid} cerrado al terminar la tarea.`);
      } catch (error) {
        console.warn(`[Engine] no se pudo cerrar el proceso ${pid}: ${errorMessage(error)}`);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }),
  );
  return pids;
}
