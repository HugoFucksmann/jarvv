/**
 * JARVIS Core — Sondas de verificación por herramienta.
 *
 * El `cumple` genérico de Decisión 4 no ve los fallos que son una incoherencia entre lo pedido y un ARGUMENTO de la llamada (`mode: append` para «al principio»,
 * `pattern: app*.log` para «todos los .log», la hoja por defecto para «la hoja Ventas») ni una propiedad que la herramienta no devuelve (un listado sin fechas para
 * «los más recientes»): puntuaba esos casos malos entre 0,83 y 0,99. Una sonda es una pregunta (o dos) `noul` hecha solo para la herramienta que corresponde, con
 * un estado armado así: lo pedido junto a lo hecho, y la semántica de la herramienta explicada en lenguaje llano. Medido con d3:2b (`docs/evaluacion/analisis/PREGUNTAS_DECISION.md`):
 * la misma pregunta sin ese estado separaba 0,07 a 0,27; con él, 0,6 a 0,9.
 *
 * Cada herramienta declara sus sondas en el catálogo (`tools/manifest.ts`). Las sondas aplican por herramienta y por tipo de archivo, nunca por palabras del pedido.
 * Si una falla, la llamada queda rechazada con el motivo cerrado de la sonda (`reason`), cuyo texto fijo llega a `FAIL` del generador de argumentos; dudar es
 * rechazar: el paso reintenta y el tope de rechazos de la verificación lo corta. El motor (`engine/probes.ts`) hace las consultas y compone el resultado.
 */

import type { VerdictReason } from "../ctx/index.ts";

/** Lo que una sonda sabe de la llamada evaluada: los datos que llegan a producción, no una versión simplificada. */
export interface ProbeCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>> | null;
  /** Resumen del resultado, tal como lo registró el motor (recortado). */
  readonly summary: string | null;
  /** La solicitud del usuario (reactivo) o la instrucción del paso (deliberativo). */
  readonly request: string;
  /** La instrucción del paso evaluado. */
  readonly step: string;
}

interface ProbeQuestion {
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
}

/** Una consulta `noul`. `badWhenTrue`: la afirmativa es lo malo. `gate`: si la respuesta es < `GATE_MIN`, la sonda no aplica a este caso y pasa. */
interface ProbeStage {
  readonly state: string;
  readonly question: ProbeQuestion;
  readonly badWhenTrue?: boolean;
  readonly gate?: boolean;
}

export interface Probe {
  /** Identificador estable (traza y mediciones). */
  readonly id: string;
  /** Motivo cerrado con que se rechaza la llamada; su texto fijo está en `ctx/views/messages.ts`. */
  readonly reason: VerdictReason;
  /** La probabilidad de «bien» mínima de cada etapa (sin compuerta) para pasar. */
  readonly threshold: number;
  applies(call: ProbeCall): boolean;
  stages(call: ProbeCall): readonly ProbeStage[];
}

/** Una etapa con compuerta que da menos que esto deja la sonda sin aplicar. */
export const GATE_MIN = 0.6;
