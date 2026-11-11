/**
 * JARVIS Core — Puerto de puntuación de fragmentos para las herramientas que leen texto ajeno (`web_search`).
 *
 * Una herramienta no recibe el contexto de la tarea, solo su brief (`need`) y los fragmentos locales: el juez los puntúa con el modelo de decisión (2B) y devuelve
 * una probabilidad por fragmento. No genera texto: lo único que sale de un fragmento hostil es un número entre 0 y 1.
 * Lo implementa `models/decision.ts`; la herramienta solo conoce esta interfaz.
 */

export interface FragmentScores {
  /** Probabilidad de que cada fragmento responda la pregunta, en el mismo orden que se enviaron. */
  readonly probabilities: readonly number[];
  /** Entrada y salida crudas de las consultas al modelo, para la traza (`_meta`). */
  readonly rawInput: string;
  readonly rawOutput: string;
  readonly durationMs: number;
}

export interface FragmentJudge {
  score(need: string, fragments: readonly string[], signal?: AbortSignal): Promise<FragmentScores>;
}
