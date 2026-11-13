/** Etapas que consultan a un modelo (`src/core/types/stages.ts`), con su decisión (D1–D4) y qué modelo las corre. */

export type StageKind = "decision" | "generative";

interface StageInfo {
  label: string;
  /** Nombre corto de la decisión, si la etapa es una. */
  code?: string;
  kind: StageKind;
}

const STAGES: Record<string, StageInfo> = {
  route: { label: "Ruta", code: "D1", kind: "decision" },
  tool: { label: "Herramienta", code: "D2", kind: "decision" },
  review: { label: "Revisión de args", code: "D3", kind: "decision" },
  verify: { label: "Verificación", code: "D4", kind: "decision" },
  completion: { label: "Cierre", kind: "decision" },
  args: { label: "Argumentos", kind: "generative" },
  question: { label: "Pregunta", kind: "generative" },
  plan: { label: "Plan", kind: "generative" },
  final: { label: "Respuesta final", kind: "generative" },
  pending: { label: "Pendientes", kind: "generative" },
};

export function stageInfo(stage: string): StageInfo {
  return STAGES[stage] ?? { label: stage, kind: "generative" };
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}
