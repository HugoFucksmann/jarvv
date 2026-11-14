/**
 * JARVIS Core — Primera consulta de decisión de una tarea reactiva (D0): ¿charla, una acción o varias?
 *
 * Funciones puras: las usan el motor y el laboratorio (`eval/`), con los mismos umbrales. Una sola consulta de decisión con dos preguntas sobre la
 * solicitud (`kind`, `choice`: chat / single / multi, de la que solo se usa la probabilidad de `chat`; y `multi`, `noul`). Medido en
 * docs/JARVIS_EVALUACION.md (T1) con un conjunto chico; el dataset del laboratorio (`eval/datasets/D0/`) es la medida que manda.
 */

export const FIRST_QUERY_KINDS = ["chat", "single", "multi"] as const;
export type FirstQueryKind = (typeof FIRST_QUERY_KINDS)[number];

/** Es charla solo con esta probabilidad o más: lo que queda entre 0,5 y 0,7 sigue el flujo de hoy (las preguntas de hechos rondaban 0,51 a 0,65). */
export const FIRST_QUERY_CHAT_APPROVE = 0.7;
/** Pide varias acciones con esta probabilidad o más. */
export const FIRST_QUERY_MULTI_APPROVE = 0.5;

/** Charla, una acción o varias, a partir de la probabilidad de `chat` y la de `multi`. Sin probabilidad de `chat` nunca es charla. */
export function firstQueryKind(chatProbability: number | undefined, multiProbability: number | undefined): FirstQueryKind {
  if (typeof chatProbability === "number" && chatProbability >= FIRST_QUERY_CHAT_APPROVE) return "chat";
  if (typeof multiProbability === "number" && multiProbability >= FIRST_QUERY_MULTI_APPROVE) return "multi";
  return "single";
}
