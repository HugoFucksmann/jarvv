import type { CallDto, StepDto, TaskDto } from "../types/api.ts";
import { getRouteLabel } from "../utils/routeLabels.ts";

export interface StepView {
  id: string;
  state: StepDto["state"];
  title: string;
  /** Qué está haciendo o qué hizo, en una línea. */
  detail: string;
}

function describeCall(call: CallDto): string {
  if (call.summary) return call.summary;
  return call.tool.replace(/_/g, " ");
}

function detailFor(step: StepDto, calls: CallDto[]): string {
  const last = calls[calls.length - 1];
  if (step.state === "running") {
    return last ? `${describeCall(last)}…` : `${getRouteLabel(step.route)}…`;
  }
  if (step.state === "failed") return last?.summary ?? "No se pudo completar";
  if (last) return describeCall(last);
  return step.expected ?? "";
}

/** Sin la descripción cuando repite el título. */
function dedupe(title: string, detail: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[….\s]+$/u, "");
  return norm(detail) === norm(title) ? "" : detail;
}

/** Pasos vigentes (sin los reemplazados por un replan), listos para mostrar. */
export function buildSteps(task: TaskDto): StepView[] {
  return task.steps
    .filter((s) => !s.superseded)
    .map((step, i) => {
      const calls = task.calls.filter((c) => c.stepId === step.id);
      const title = step.instruction || calls[calls.length - 1]?.tool.replace(/_/g, " ") || `Paso ${i + 1}`;
      return { id: step.id, state: step.state, title, detail: dedupe(title, detailFor(step, calls)) };
    });
}

export function isTerminal(state?: string): boolean {
  return state === "completed" || state === "partial" || state === "failed" || state === "cancelled";
}

/** Frase corta para la cabecera colapsada. */
export function headline(task: TaskDto, steps: StepView[]): string {
  if (task.waiting) {
    return task.waiting.kind === "approval"
      ? "Necesita tu aprobación"
      : task.waiting.kind === "question"
        ? "Tiene una pregunta"
        : "Revisa el plan";
  }
  if (task.paused) return "Pausada: modelo no disponible, reintentando…";
  if (isTerminal(task.task.state)) {
    if (!task.result) return "Redactando respuesta…";
    return task.task.state === "completed"
      ? "Listo"
      : task.task.state === "cancelled"
        ? "Cancelada"
        : task.task.state === "partial"
          ? "Terminó parcialmente"
          : "Falló";
  }
  const running = steps.find((s) => s.state === "running");
  if (running) return running.title;
  return steps.length === 0 ? "Pensando…" : "Trabajando…";
}
