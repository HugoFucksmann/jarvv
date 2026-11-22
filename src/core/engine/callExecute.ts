/**
 * JARVIS Core — Ejecución de una llamada ya autorizada (`runCall`, fases 9 a 12).
 *
 * Recibe la llamada preparada (`PreparedCall`: argumentos y huella ya calculados, la política ya aplicada) y la lleva hasta el final: despacho a la herramienta
 * compitiendo contra la cancelación → procesar el resultado → guardar la ref si hace falta → registrar la llamada (con el hecho `process`) → verificar.
 *
 * No toma ninguna decisión de autorización: Guard, lista negra, niveles, confirmación y revisión ocurren antes (`callRunner.ts`). Tampoco cierra la tarea:
 * devuelve un `CallOutcome` y quien llama decide.
 */

import type { Op, TaskContext } from "../ctx/index.ts";
import { RefVaultError } from "../refs/refVault.ts";
import { processResult } from "../result/processResult.ts";
import type { ProcessedResult } from "../result/processResult.ts";
import { timeoutOf } from "../tools/manifest.ts";
import { createToolHost } from "../tools/host.ts";
import type { ToolCallOptions } from "../tools/provider.ts";
import { errorMessage } from "../utils.ts";
import { callLabel } from "./args.ts";
import { captureCallTool } from "./capture.ts";
import type { EngineEnv } from "./env.ts";
import { CANCELLED, recordCall, registered, summaryText } from "./callRecord.ts";
import type { PreparedCall, Policy } from "./callRecord.ts";
import type { CallOutcome } from "./outcomes.ts";
import type { CallStatus } from "../ctx/index.ts";
import { factValue } from "./retries.ts";
import { verifyCall } from "./verify.ts";

// ───────────────────────── Cancelación en vuelo ─────────────────────────

type Raced<T> = { readonly kind: "done"; readonly value: T } | { readonly kind: "failed"; readonly error: unknown } | { readonly kind: "cancelled" };

/**
 * Compite la promesa contra la señal de cancelación (`callTool` no recibe señal). Si gana la señal, el resultado tardío
 * se descarta; el rechazo tardío se absorbe para que no quede una promesa rechazada sin manejar.
 */
function raceCancel<T>(promise: Promise<T>, signal: AbortSignal): Promise<Raced<T>> {
  const settled: Promise<Raced<T>> = promise.then(
    (value): Raced<T> => ({ kind: "done", value }),
    (error: unknown): Raced<T> => ({ kind: "failed", error }),
  );
  if (signal.aborted) return Promise.resolve({ kind: "cancelled" });
  return new Promise<Raced<T>>((resolve) => {
    const onAbort = (): void => resolve({ kind: "cancelled" });
    signal.addEventListener("abort", onAbort, { once: true });
    void settled.then((result) => {
      signal.removeEventListener("abort", onAbort);
      resolve(result); // si la señal ganó, `resolve` ya no tiene efecto: el resultado tardío se descarta
    });
  });
}

// ───────────────────────── Hecho `process` ─────────────────────────

const setProcessFact = (value: string | null, stepId: string): Op => ({ op: "set", target: "facts.process", value: { value, stepId } });

/** Separador de los `pid` del hecho `process`. */
const PROCESS_SEPARATOR = ", ";

/** Los `pid` del hecho `process`, en el orden en que se lanzaron. */
export function processPids(value: string | null): string[] {
  return value === null ? [] : value.split(",").map((p) => p.trim()).filter((p) => p !== "");
}

/**
 * Operaciones del hecho `process` a partir de la señal del resultado (`ProcessSignal`). El hecho lista los procesos vivos de la tarea (`4321, 5678`, en
 * el orden en que se lanzaron): el generador de argumentos necesita el `pid` para continuar uno, y con dos procesos en segundo plano el último no alcanza
 * (RC-14). Alta cuando la mutación que lanza el proceso termina `ok` o queda esperando entrada; baja cuando el proceso ya no existe (sin ninguno,
 * `value = null`). Con otros errores el hecho se conserva.
 */
function processFactOps(ctx: TaskContext, stepId: string, policy: Policy, processed: ProcessedResult): Op[] {
  const current = processPids(factValue(ctx, "process"));
  const signal = processed.process;
  if (signal === undefined) return [];
  const pid = String(signal.pid);
  if (signal.active) {
    const started = processed.status === "ok" || processed.status === "waiting_input";
    return started && policy.mutates && !current.includes(pid) ? [setProcessFact([...current, pid].join(PROCESS_SEPARATOR), stepId)] : [];
  }
  if (!current.includes(pid)) return [];
  const rest = current.filter((p) => p !== pid);
  return [setProcessFact(rest.length > 0 ? rest.join(PROCESS_SEPARATOR) : null, stepId)];
}

// ───────────────────────── Despacho, registro y verificación ─────────────────────────

export async function executeAndRecord(env: EngineEnv, call: PreparedCall): Promise<CallOutcome> {
  const { ctx, runtime, deps } = env;
  const { stepId, mcp, server, policy, resolved } = call;
  const toolName = call.tool.name;

  // 9. Despacho: compite contra la cancelación.
  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
  const callOptions: ToolCallOptions = {
    signal: runtime.signal,
    taskId: ctx.task.id,
    timeoutMs: deps.toolTimeoutMs?.(mcp, toolName) ?? timeoutOf(mcp, toolName),
    ...(server.dependencies === undefined ? {} : { host: createToolHost(deps.discovery, server.dependencies, (target) => captureCallTool(target, env.sink), ctx.task.id) }),
  };
  const raced = await raceCancel(captureCallTool(server, env.sink)(toolName, resolved, callOptions), runtime.signal);

  if (raced.kind === "cancelled") {
    if (ctx.isClosed()) return CANCELLED;
    const callId = recordCall(ctx, call, "interrupted");
    return { kind: "cancelled", callId };
  }
  if (ctx.isClosed()) return CANCELLED;

  const finishWithVerification = async (callId: string, status: CallStatus, waiting?: { readonly prompt?: string; readonly pid?: string }): Promise<CallOutcome> => {
    const verification = await verifyCall(env, callId);
    switch (verification.kind) {
      case "verified":
        return registered(callId, status, verification.verdict, verification.reason, waiting);
      case "skipped":
        return registered(callId, status, null, null, waiting);
      case "close":
        return { kind: "close", stopReason: verification.stopReason, callId };
      case "cancelled":
        return { kind: "cancelled", callId };
    }
  };

  if (raced.kind === "failed") {
    // `callTool` lanzó: la herramienta no produjo resultado. `exception` es de quien ejecuta (el procesador no lo produce).
    const summary = summaryText(errorMessage(raced.error)) ?? "La herramienta lanzó una excepción.";
    return finishWithVerification(recordCall(ctx, call, "exception", summary), "exception");
  }

  // 10. Procesar el resultado.
  const processed = processResult(mcp, toolName, raced.value, resolved);

  // 11. Con `ref` (el resumen no contiene el resultado completo): disco → `add ref` → `add call` con `ref = rN`.
  let ref: string | null = null;
  let vaultFailed = false;
  if (processed.truncated && processed.fullText.length > 0) {
    try {
      const stored = await deps.vault.put(ctx.task.id, processed.fullText);
      if (ctx.isClosed()) return CANCELLED;
      ref = ctx.apply({
        op: "add",
        target: "refs",
        value: { stepId, label: callLabel(toolName, resolved, processed.fullText), size: stored.size, where: stored.where },
      }).ids[0];
    } catch (error) {
      if (!(error instanceof RefVaultError)) throw error;
      // D7: la herramienta ya se ejecutó. La llamada se registra sin `ref` (el resumen queda incompleto), con el error.
      console.error(`[Engine] no se pudo guardar el resultado completo de '${toolName}': ${error.message}`);
      vaultFailed = true;
    }
  }
  if (ctx.isClosed()) return CANCELLED;

  const factOps = processFactOps(ctx, stepId, policy, processed);
  const errorOps: Op[] = vaultFailed ? [{ op: "add", target: "errors", value: { stepId, kind: "service_unavailable" } }] : [];
  const callId = recordCall(ctx, call, processed.status, processed.summary, ref, [...errorOps, ...factOps]);
  if (vaultFailed) return { kind: "close", stopReason: "unrecoverable", callId };

  // 12. Verificar (segundo `apply`: `verdict` y `reason` juntos).
  return finishWithVerification(callId, processed.status, { prompt: processed.prompt, pid: processed.process?.pid });
}
