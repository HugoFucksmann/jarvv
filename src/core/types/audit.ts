/**
 * JARVIS Core — Iteraciones y auditoría de modelos.
 */

export type ModelType = "EOS_0_8B" | "QWEN_3_5_9B";

export type ModelStage =
  | "DECISION_ONE"
  | "DECISION_TWO"
  | "STEP_VERIFICATION"
  | "PLAN_GENERATION"
  | "ARGUMENT_GENERATION"
  | "STAGE_VERIFICATION"
  | "REPLAN"
  | "FINAL_RESPONSE";

/** Intervalo medido: cuándo empezó una llamada (a un modelo o a una herramienta) y cuánto tardó, incluido el reintento de transporte. */
export interface TimeSpan {
  startedAt: number;
  durationMs: number;
}

export interface ModelIterationMetrics {
  /** Duración del intercambio con el modelo (TimeSpan.durationMs). */
  latencyMs?: number;
  tokens?: {
    input?: number;
    output?: number;
  };
  /** Diferencia entre las dos probabilidades más altas de una decisión de Eos (la señal real de decisión). */
  margin?: number;
  signals?: Record<string, unknown>;
  verdict?: string;
  isStepSuccess?: boolean;
}

export interface ModelIteration {
  id: string;
  taskId: string;
  model: ModelType;
  stage: ModelStage;
  stepId?: string;
  stepSeq?: number;
  stepTitle?: string;
  timestamp: number;
  input: Record<string, unknown> | string;
  output: Record<string, unknown> | string;
  rawInput?: string;
  rawOutput?: string;
  /**
   * `true` si hubo un intercambio real con el modelo (aunque su salida no se usara); `false` si la iteración la
   * produjo un atajo determinista (p. ej. Decision #2 con una sola herramienta) o no llegó a ejecutarse. Único criterio
   * para contar llamadas a modelos: lo usan la traza y los resúmenes.
   */
  invoked?: boolean;
  metrics?: ModelIterationMetrics;
  error?: string;
}
