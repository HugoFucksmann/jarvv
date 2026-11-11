/**
 * Vista de progreso de una tarea para Telegram: se alimenta con las operaciones de los eventos `change` de la API y se dibuja como
 * un mensaje HTML (pasos, llamadas con lo que hacen y su resultado). No conoce a Telegram: solo recibe operaciones y devuelve texto.
 */

import type { NormalizedOp } from "../core/ctx/index.ts";
import { esc } from "./format.ts";

interface CallView {
  id: string;
  tool: string;
  kind: string;
  status: string;
  verdict: string | null;
  /** Qué hace la llamada (comando, consulta, ruta…), recortado. */
  detail: string | null;
  /** Primera línea del resultado, recortada. */
  summary: string | null;
}

interface StepView {
  n: number;
  instruction: string | null;
  route: string | null;
  state: string;
  superseded: boolean;
  calls: CallView[];
}

const ROUTES: Record<string, string> = { web: "Web", terminal: "Terminal y procesos", files: "Archivos" };
const STEP_ICON: Record<string, string> = { pending: "⏳", running: "🔄", completed: "✅", failed: "❌" };
const STEPS_SHOWN = 12;
const CALLS_SHOWN = 4;
const STATUS_MAX = 4000; // los mensajes de Telegram admiten 4096

const clip = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** Lo más útil de los argumentos de una llamada para mostrarlo en una línea (comando, consulta, ruta o URL). */
function callDetail(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  for (const key of ["command", "query", "need", "url", "urls", "path", "pid", "input"]) {
    const v = a[key];
    if (typeof v === "string" && v.trim()) return clip(v, 70);
    if (typeof v === "number") return `${key} ${v}`;
    if (Array.isArray(v) && v.length) return clip(String(v[0]), 70);
  }
  return null;
}

/** Primera línea del resumen de una llamada, sin el prefijo `status:`. */
function callSummary(summary: string | null): string | null {
  const first = summary?.split(/\r?\n/).find((l) => l.trim());
  return first ? clip(first.replace(/^status:\s*/i, ""), 90) : null;
}

function callIcon(c: CallView): string {
  if (c.verdict === "approved") return "✓";
  if (c.verdict === "rejected") return "✗";
  return c.status === "ok" ? "…" : "⚠️";
}

export class Progress {
  private readonly steps = new Map<string, StepView>();

  /** Aplica una operación del evento `change`; devuelve true si cambió algo que se dibuja. */
  apply(op: Readonly<NormalizedOp>): boolean {
    if (op.op === "add" && op.target === "steps") {
      const v = op.value;
      this.steps.set(v.id, {
        n: this.steps.size + 1,
        instruction: v.instruction,
        route: v.route,
        state: v.state,
        superseded: v.superseded,
        calls: [],
      });
      return true;
    }
    if (op.op === "add" && op.target === "calls") {
      const v = op.value;
      const step = this.steps.get(v.stepId);
      if (!step) return false;
      step.calls.push({
        id: v.id,
        tool: v.tool,
        kind: v.kind,
        status: v.status,
        verdict: v.verdict,
        detail: callDetail(v.args),
        summary: callSummary(v.summary),
      });
      return true;
    }
    if (op.op === "update") {
      // El destino de un `update` es el id del elemento (`s1`, `c1`).
      const patch = op.value;
      const step = this.steps.get(op.target);
      if (step && "state" in patch) {
        if (patch.state) step.state = patch.state;
        if (patch.superseded) step.superseded = true;
        return true;
      }
      if ("verdict" in patch) {
        for (const s of this.steps.values()) {
          const call = s.calls.find((c) => c.id === op.target);
          if (call) {
            call.verdict = patch.verdict;
            return true;
          }
        }
      }
    }
    return false;
  }

  render(header: string): string {
    const lines = [`<b>${esc(header)}</b>`];
    for (const s of [...this.steps.values()].slice(-STEPS_SHOWN)) {
      const title = s.instruction ?? (s.calls.length ? `Llamada a ${s.calls.map((c) => c.tool).join(", ")}` : `Iteración #${s.n}`);
      const route = s.route ? ` · ${esc(ROUTES[s.route] ?? s.route)}` : "";
      const line = `${STEP_ICON[s.state] ?? "•"} ${s.n}. ${esc(title)}${route}`;
      lines.push(s.superseded ? `<s>${line}</s> (descartado)` : line);
      for (const c of s.calls.slice(-CALLS_SHOWN)) {
        const head = `    └ ${c.kind === "write" ? "✏️ " : ""}<code>${esc(c.tool)}</code> ${callIcon(c)}`;
        lines.push(c.detail ? `${head} ${esc(c.detail)}` : head);
        if (c.summary) lines.push(`        <i>${esc(c.summary)}</i>`);
      }
    }
    return lines.join("\n").slice(0, STATUS_MAX);
  }
}
