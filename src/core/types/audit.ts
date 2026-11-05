/** Intervalo medido: cuándo empezó una llamada (a un modelo o a una herramienta) y cuánto tardó, incluido el reintento de transporte. */
export interface TimeSpan {
  startedAt: number;
  durationMs: number;
}
