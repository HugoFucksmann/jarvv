/**
 * Contextos fijos para las pruebas: un reloj determinista y una tarea con llamadas de todos los tipos que las vistas
 * muestran (lecturas, escrituras, fallos, refs, hechos y entrada del usuario).
 */

import { create } from "../src/core/ctx/index.ts";
import type { CallStatus, JsonObject, TaskContext, TaskMode } from "../src/core/ctx/index.ts";

export function newContext(mode: TaskMode): TaskContext {
  let t = 1_700_000_000_000;
  return create.context(
    { id: "task_fixture", request: "Busca los informes de ventas y guarda un resumen en resumen.txt", mode },
    { now: () => (t += 1000), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
}

type Verdict = "approved" | "rejected";

interface CallSpec {
  readonly route: string;
  readonly tool: string;
  readonly kind: "read" | "write";
  readonly args: JsonObject | null;
  readonly status: CallStatus;
  readonly summary: string | null;
  readonly ref?: string | null;
  readonly verdict?: Verdict;
  readonly reason?: "no_usable_data" | "not_accomplished" | null;
}

function addCall(ctx: TaskContext, stepId: string, spec: CallSpec): string {
  const id = ctx.apply({
    op: "add",
    target: "calls",
    value: {
      stepId,
      route: spec.route,
      tool: spec.tool,
      kind: spec.kind,
      args: spec.args,
      sig: spec.args === null ? null : `sig_${spec.tool}_${JSON.stringify(spec.args).length}`,
      status: spec.status,
      summary: spec.summary,
      ref: spec.ref ?? null,
    },
  }).ids[0];
  if (spec.verdict !== undefined) ctx.apply({ op: "update", target: id, value: { verdict: spec.verdict, reason: spec.reason ?? null } });
  return id;
}

export type Stage = "running" | "step_failed" | "closed";

/**
 * Tarea con dos pasos. `running`: el segundo paso está en curso; `step_failed`: el segundo falló (replan);
 * `closed`: la tarea terminó parcial (para `forFinal` y `forFallback`).
 */
export function buildContext(mode: TaskMode, stage: Stage): TaskContext {
  const ctx = newContext(mode);
  const deliberative = mode === "deliberative";

  let planId: string | null = null;
  if (deliberative) planId = ctx.apply({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }).ids[0];

  const addStep = (instruction: string, route: string | null, expected: string | null): string =>
    ctx.apply({ op: "add", target: "steps", value: { planId, instruction, route: deliberative ? route : null, expected: deliberative ? expected : null } }).ids[0];

  const s1 = addStep("Listar la carpeta Documentos", "files", "Lista de archivos de la carpeta");
  if (deliberative) ctx.apply({ op: "update", target: s1, value: { state: "running" } });

  const ref = ctx.apply({ op: "add", target: "refs", value: { stepId: s1, label: "read_file informe_ventas.txt", size: 48213, where: "data/refs/task_fixture/r1.txt" } }).ids[0];

  addCall(ctx, s1, { route: "files", tool: "list_directory", kind: "read", args: { path: "C:\\Users\\Ana\\Documentos" }, status: "ok", summary: "[FILE] informe_ventas.txt\n[FILE] notas.md\n[DIR] fotos", verdict: "approved" });
  addCall(ctx, s1, { route: "terminal", tool: "start_process", kind: "write", args: { command: "dir /s C:\\Users" }, status: "exception", summary: "spawn error\nnot found: dir" });
  ctx.apply({ op: "update", target: s1, value: { state: "completed" } });

  const s2 = addStep("Leer el informe y guardar un resumen en resumen.txt", "files", "resumen.txt creado");
  if (deliberative) ctx.apply({ op: "update", target: s2, value: { state: "running" } });

  addCall(ctx, s2, {
    route: "files",
    tool: "read_file",
    kind: "read",
    args: { path: "C:\\Users\\Ana\\Documentos\\informe_ventas.txt", offset: 0, length: 100 },
    status: "ok",
    summary: "Informe de ventas 2026\nQ1: 120.000\nQ2: 135.500\nQ3: 98.250\n(truncado)",
    ref,
    verdict: "approved",
  });
  addCall(ctx, s2, { route: "files", tool: "read_file", kind: "read", args: { path: "C:\\Users\\Ana\\Documentos\\no_existe.txt" }, status: "tool_error", summary: "ENOENT: no such file or directory", verdict: "rejected", reason: "no_usable_data" });
  addCall(ctx, s2, { route: "files", tool: "write_file", kind: "write", args: null, status: "args_invalid", summary: "Missing required argument: content" });
  addCall(ctx, s2, { route: "terminal", tool: "start_process", kind: "write", args: { command: "Remove-Item -Recurse C:\\Temp" }, status: "tool_rejected", summary: "Comando bloqueado por la lista de seguridad." });
  addCall(ctx, s2, { route: "files", tool: "list_directory", kind: "read", args: { path: "C:\\Users\\Ana" }, status: "ok", summary: "[DIR] Documentos\n[DIR] Descargas", verdict: "rejected", reason: "not_accomplished" });
  addCall(ctx, s2, { route: "files", tool: "write_file", kind: "write", args: { path: "C:\\Users\\Ana\\Documentos\\resumen.txt", content: "Resumen: Q1 120.000; Q2 135.500; Q3 98.250", mode: "rewrite" }, status: "exception", summary: "EPERM: operation not permitted" });
  addCall(ctx, s2, { route: "terminal", tool: "start_process", kind: "write", args: { command: "mkdir C:\\Users\\Ana\\Documentos\\out" }, status: "user_rejected", summary: "no crees carpetas nuevas" });

  // Dos fallos iguales (se juntan con ×N), tres escrituras aprobadas (efectos: los últimos con resultado, el primero en una línea) y una ref sin leer.
  for (let i = 0; i < 2; i++) {
    addCall(ctx, s2, { route: "files", tool: "read_file", kind: "read", args: { path: "C:\\Users\\Ana\\Documentos\\no_existe.txt" }, status: "tool_error", summary: "ENOENT: no such file or directory", verdict: "rejected", reason: "no_usable_data" });
  }
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    addCall(ctx, s1, { route: "files", tool: "write_file", kind: "write", args: { path: `C:\\Users\\Ana\\Documentos\\${name}`, content: `contenido de ${name}`, mode: "rewrite" }, status: "ok", summary: `Wrote ${name}\nlínea 2 del resultado`, verdict: "approved" });
  }
  ctx.apply({ op: "add", target: "refs", value: { stepId: s2, label: "start_process dir /s", size: 9000, where: "data/refs/task_fixture/r2.txt" } });

  ctx.apply([
    { op: "set", target: "facts.process", value: { value: "4321", stepId: s2 } },
    { op: "set", target: `facts.answer_${s2}_1`, value: { value: "usá la carpeta Documentos", stepId: s2 } },
  ]);

  if (stage !== "running") {
    ctx.apply({ op: "update", target: s2, value: { state: "failed" } });
  }
  if (stage === "closed") {
    addCall(ctx, s2, { route: "files", tool: "write_file", kind: "write", args: { path: "C:\\Users\\Ana\\Documentos\\parcial.txt", content: "x", mode: "rewrite" }, status: "ok", summary: "Wrote 1 byte", verdict: "approved" });
    ctx.apply({ op: "finish", target: "task", value: { state: "partial", stopReason: "no_alternatives" } });
  }
  return ctx;
}
