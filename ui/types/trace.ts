/**
 * Forma de `GET /api/jarvis/tasks/:id/trace?format=json|full` (solo lo que usa el visor de consultas).
 * `json` trae las consultas ya interpretadas; `full` suma la entrada y la salida crudas de cada una (se unen por `seq`).
 */

export interface TraceLink {
  call: string | null;
  plan: string | null;
  fact: string | null;
  result: boolean;
}

export interface SlimQuery {
  seq: number;
  stage: string;
  step: string | null;
  n: number;
  startedAt: number;
  durationMs: number;
  model: string | null;
  tokens: { input: number | null; output: number | null } | null;
  finishReason: string | null;
  offered: string[] | null;
  /** Decisión: `{ pregunta: { choice, p } | { noul } }`. Generativo: el contenido ya interpretado. */
  output: unknown;
  error: string | null;
  link: TraceLink;
  inputChars: number | null;
  inputHash: string | null;
}

export interface SlimTrace {
  taskId: string;
  durationMs: number;
  queries: SlimQuery[];
}

export interface FullModelRecord {
  seq: number;
  input: string | null;
  output: string | null;
}

export interface FullTrace {
  models: FullModelRecord[];
}

export interface TraceQuery extends SlimQuery {
  rawInput: string | null;
  rawOutput: string | null;
}
