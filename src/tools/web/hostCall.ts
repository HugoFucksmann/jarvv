/**
 * `web_search`: llamadas al `ToolHost` con plazo, cancelación y detección de presupuesto agotado.
 *
 * Dos fallos pasaban desapercibidos:
 *
 * - **Plazo.** `host.call` recibía solo la señal de la tarea: nada hacía cumplir el plazo de la herramienta, así que un Free Search colgado dejaba la búsqueda esperando hasta que
 *   la tarea entera se cancelara. Pasarle una señal con plazo no basta (un `ToolHost` puede ignorarla), por eso además la llamada compite contra un temporizador: al vencer, la
 *   búsqueda falla de forma clara aunque el host siga sin responder, y la señal que recibió el host se cancela para que lo abandone si coopera.
 * (Las clases de error usan solo sintaxis borrable —sin propiedades de parámetro—, como el resto del módulo: el código corre con el modo nativo de TypeScript de Node.)
 *
 * - **Presupuesto.** Cuando la tarea agota su presupuesto de herramientas, el host contesta con un texto que empieza por «Tool budget used up», como si fuera un resultado
 *   cualquiera. Sin detectarlo, ese texto se leería como una página o como un formato desconocido, y el motivo real se perdería.
 */

import type { MCPCallResult } from "../../core/types.ts";
import type { ToolCallOptions, ToolRef } from "../../core/tools/provider.ts";

/** El host de herramientas, tal como lo recibe `callTool` (se deriva de `ToolCallOptions` para no depender de un tipo que `core` quizá no exporte). */
type ToolHost = NonNullable<ToolCallOptions["host"]>;

/** El plazo de la búsqueda venció sin que Free Search respondiera. */
export class DeadlineError extends Error {
  readonly tool: string;
  readonly limitMs: number;
  constructor(tool: string, limitMs: number) {
    super(`timed out after ${Math.round(limitMs / 1000)} s waiting for Free Search (${tool}): the service did not answer in time`);
    this.name = "DeadlineError";
    this.tool = tool;
    this.limitMs = limitMs;
  }
}

/** La tarea agotó su presupuesto de herramientas: el host no llegó a ejecutar la llamada. */
export class ToolBudgetError extends Error {
  readonly tool: string;
  readonly detail: string;
  constructor(tool: string, detail: string) {
    super(`Tool budget used up while calling ${tool}: ${detail}`);
    this.name = "ToolBudgetError";
    this.tool = tool;
    this.detail = detail;
  }
}

/** Free Search respondió algo que no es el JSON esperado (no es JSON, o cambió su esquema). Es una ruptura del contrato, no «sin resultados». */
export class FormatError extends Error {
  readonly tool: string;
  readonly detail: string;
  /** La respuesta recibida, para el rastro: lo que no se reconoce no se interpreta, pero tiene que poder inspeccionarse. */
  readonly text: string;
  constructor(tool: string, detail: string, text: string) {
    super(`unrecognized format from ${tool}: ${detail}`);
    this.name = "FormatError";
    this.tool = tool;
    this.detail = detail;
    this.text = text;
  }
}

const BUDGET_PREFIX = /^\s*tool budget used up/i;
const BUDGET_DETAIL_MAX = 200;

/** El texto del host si es el aviso de presupuesto agotado (que no depende de `isError`); si no, `undefined`. */
export function toolBudgetMessage(text: string): string | undefined {
  if (!BUDGET_PREFIX.test(text)) return undefined;
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > BUDGET_DETAIL_MAX ? `${clean.slice(0, BUDGET_DETAIL_MAX).trimEnd()}…` : clean;
}

export interface DeadlineOptions {
  /** Cancelación de la tarea (no es el plazo): si se activa, la llamada se abandona con el motivo de la señal. */
  readonly signal?: AbortSignal;
  /** Instante (ms desde la época) en que vence la búsqueda. */
  readonly deadline: number;
  /** Duración total del plazo, solo para el mensaje. */
  readonly limitMs: number;
}

/**
 * Llama al host y la abandona si vence el plazo o se cancela la tarea, aunque el host ignore su señal. Al vencer, lanza `DeadlineError`; al cancelarse, lanza el motivo de la
 * señal de la tarea (el llamador distingue una de otra). El temporizador y el oyente se liberan siempre, y una respuesta tardía del host no queda como rechazo sin atender.
 */
export async function callWithDeadline(host: ToolHost, ref: ToolRef, args: Record<string, unknown>, options: DeadlineOptions): Promise<MCPCallResult> {
  const { signal, deadline, limitMs } = options;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DeadlineError(ref.tool, limitMs);
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DeadlineError(ref.tool, limitMs);
      controller.abort(error);
      reject(error);
    }, remaining);
    if (signal !== undefined) {
      onAbort = () => {
        controller.abort(signal.reason);
        reject(signal.reason ?? new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  guard.catch(() => {}); // si la llamada gana la carrera, `guard` nunca se rechaza; si pierde, `Promise.race` ya lo atendió

  try {
    const call = Promise.resolve(host.call(ref, args, { signal: controller.signal }));
    call.catch(() => {}); // una respuesta o un error tardío del host, una vez perdida la carrera, no es un rechazo sin atender
    return await Promise.race([call, guard]);
  } finally {
    clearTimeout(timer);
    if (signal !== undefined && onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}
