/** Etapas que consultan a un modelo (`src/core/types/stages.ts`), con su decisión (D0–D5) y qué modelo las corre. */

export type StageKind = "decision" | "generative";

interface StageInfo {
  label: string;
  /** Nombre corto de la decisión, si la etapa es una. */
  code?: string;
  /** Abreviatura de 3 letras para el riel lateral encogido. */
  short?: string;
  kind: StageKind;
}

const STAGES: Record<string, StageInfo> = {
  probe: { label: "Sonda", short: "Snd", kind: "decision" },
  continuation: { label: "Continuación", short: "Cnt", kind: "decision" },
  first_query: { label: "Clasificación inicial", code: "D0", kind: "decision" },
  route: { label: "Ruta", code: "D1", kind: "decision" },
  tool: { label: "Herramienta", code: "D2", kind: "decision" },
  review: { label: "Revisión de args", code: "D3", kind: "decision" },
  verify: { label: "Verificación", code: "D4", kind: "decision" },
  completion: { label: "Cierre", code: "D5", kind: "decision" },
  args: { label: "Argumentos", short: "Arg", kind: "generative" },
  question: { label: "Pregunta", short: "Prg", kind: "generative" },
  plan: { label: "Plan", short: "Pln", kind: "generative" },
  final: { label: "Respuesta final", short: "Fin", kind: "generative" },
  pending: { label: "Pendientes", short: "Pnd", kind: "generative" },
};

export function stageInfo(stage: string): StageInfo {
  return STAGES[stage] ?? { label: stage, kind: "generative" };
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}
