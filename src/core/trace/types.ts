/**
 * JARVIS Core — Registros de la traza (lo que `recorder.ts` acumula y `format.ts` da formato).
 *
 * Aparte de `recorder.ts` para que `format.ts` no importe del archivo que lo importa.
 */

import type { Waiting } from "../engine/runtime.ts";
import type { StageId } from "../types.ts";

/** A qué quedó enlazada una consulta: como máximo una de las claves. */
export interface ModelLink {
  call: string | null;
  plan: string | null;
  fact: string | null;
  result: boolean;
}

export interface ModelRecord {
  /** Orden de la consulta en la tarea (por el inicio de cada una). */
  seq: number;
  stage: StageId;
  /** Paso en curso cuando empezó la consulta; `null` en el plan, la lista de pendientes y la respuesta final. */
  step: string | null;
  /** Versión del contexto al empezar la consulta. */
  n: number;
  startedAt: number;
  durationMs: number;
  input: string | null;
  output: string | null;
  error: string | null;
  link: ModelLink;
}

export interface ToolRecord {
  /** Llamada registrada para esta ejecución; `null` si no llegó a registrarse. */
  call: string | null;
  mcp: string;
  tool: string;
  args: Record<string, unknown>;
  startedAt: number;
  durationMs: number;
  /** Resultado crudo, recortado; `null` si hay `ref` o si la herramienta lanzó. */
  result: string | null;
  /** Largo del resultado crudo serializado como JSON (incluye la envoltura del protocolo). */
  resultChars: number | null;
  ref: string | null;
  /** Largo del texto guardado en la ref (`size` de la ref); `null` sin ref. Difiere de `resultChars` por la envoltura JSON. */
  refSize: number | null;
  error: string | null;
}

/** Una espera del usuario: de que la tarea se detuvo a que se resolvió (o se cerró la tarea). */
export interface WaitRecord {
  kind: Waiting["kind"];
  /** Versión del contexto cuando empezó la espera. */
  n: number;
  startedAt: number;
  endedAt: number;
}
