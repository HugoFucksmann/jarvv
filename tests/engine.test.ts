/**
 * `runTask` de punta a punta con dobles en lugar de los modelos y los servidores MCP: cubre el ejecutor de llamadas
 * (descubrir → elegir → argumentos → Guard → confirmación → despacho → verificar) y el cierre de la tarea.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { EngineDeps } from "../src/core/contracts.ts";
import type { TaskContext } from "../src/core/ctx/index.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { Waiting } from "../src/core/engine/runtime.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import type { MCPCallResult, MCPTool } from "../src/core/types.ts";
import { newContext } from "./fixtures.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;
const schema = { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, mode: { type: "string" }, command: { type: "string" } } };
const tool = (name: string): MCPTool => ({ name, description: name, inputSchema: schema });
const TOOLS = ["list_directory", "write_file", "start_process"].map(tool);

interface Scenario {
  readonly request: string;
  /** Herramienta que el doble de Decisión 2 elige y los argumentos que el doble del modelo propone. */
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly onWait?: (waiting: Waiting, runtime: TaskRuntime) => void;
  readonly autoMode?: boolean;
  /** Texto que devuelve la herramienta (por defecto, un listado de archivos). */
  readonly result?: string;
  /** Se invoca al verificar el resultado de la llamada (para cancelar la tarea en ese punto). */
  readonly onVerify?: (runtime: TaskRuntime) => void;
  /** Resultado de la herramienta en su `n`-ésima ejecución (0, 1…); por defecto `result`. */
  readonly resultFor?: (n: number) => MCPCallResult;
  /** Respuestas de la verificación (D4) para la `n`-ésima llamada verificada; por defecto aprueba. */
  readonly verifyFor?: (n: number) => { ok: number; cumple: number };
  /** El modelo de pendientes devuelve siempre el mismo ítem (no confirma que no falte nada): el reactivo reintenta con pasos nuevos del mismo criterio. */
  readonly pendingAlways?: boolean;
}

interface Outcome {
  readonly ctx: TaskContext;
  readonly dispatched: { readonly tool: string; readonly args: Record<string, unknown> }[];
  readonly reviews: number;
}

async function run(s: Scenario): Promise<Outcome> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-test-"));
  const dispatched: { tool: string; args: Record<string, unknown> }[] = [];
  let reviews = 0;
  let pendingCalls = 0;
  let verified = 0;

  const server: IMCPServer = {
    name: "desktop_commander",
    version: "test",
    listTools: async () => TOOLS,
    callTool: async (name, args): Promise<MCPCallResult> => {
      const n = dispatched.filter((d) => d.tool === name).length;
      dispatched.push({ tool: name, args });
      if (s.resultFor !== undefined && name !== "force_terminate") return s.resultFor(n);
      return { content: [{ type: "text", text: name === "force_terminate" ? "terminated" : (s.result ?? "[FILE] a.txt\n[FILE] b.txt") }] };
    },
    isConnected: () => true,
    reconnect: async () => undefined,
  };

  const deps: EngineDeps = {
    discovery: {
      getServer: (name) => (name === "desktop_commander" ? server : undefined),
      getDiscoveredTools: async () => TOOLS,
      getUnavailableServers: () => ({}),
      validateToolExists: async () => true,
    },
    decision: {
      chooseRoute: async (input) => ({ action: "route", route: input.routes.includes("terminal") && s.tool === "start_process" ? "terminal" : "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === s.tool) ?? input.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async () => {
        reviews++;
        return { review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" };
      },
      verifyResult: async () => {
        s.onVerify?.(runtime);
        return { answers: s.verifyFor?.(verified++) ?? { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" };
      },
    },
    llm: {
      generateArgumentsFromView: async () => ({ args: s.args, rawInput: "", rawOutput: "", timing: TIMING }),
      generateQuestion: async () => ({ question: "¿cuál?", rawInput: "", rawOutput: "" }),
      // La primera consulta trae el pendiente; al vaciarse, el modelo confirma que no falta nada.
      generatePendingFromView: async () => ({ pending: s.pendingAlways === true || pendingCalls++ === 0 ? [s.request] : [], rawInput: "", rawOutput: "" }),
      generatePlanFromView: async () => {
        throw new Error("no se usa en reactivo");
      },
      generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
    },
    vault: createRefVault({ dir }),
    guardScope: { protectedDirs: [path.join(dir, "protegida")], relativeBases: [dir] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
    autoMode: () => s.autoMode ?? false,
  };

  const ctx = newContext("reactive");
  let runtime!: TaskRuntime;
  runtime = new TaskRuntime({ onChange: (waiting) => waiting !== null && s.onWait !== undefined && queueMicrotask(() => s.onWait!(waiting, runtime)) });
  await runTask(ctx, runtime, deps);
  fs.rmSync(dir, { recursive: true, force: true });
  return { ctx, dispatched, reviews };
}

test("lectura: se despacha, se verifica y la tarea se completa con respuesta del modelo", async () => {
  const { ctx, dispatched } = await run({ request: "Listar C:\\Users\\Ana\\Documentos", tool: "list_directory", args: { path: "C:\\Users\\Ana\\Documentos" } });
  assert.equal(ctx.task.state, "completed");
  assert.equal(ctx.result?.origin, "model");
  assert.equal(dispatched.length, 1);
  const calls = ctx.find("calls", {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "ok");
  assert.equal(calls[0].verdict, "approved");
});

test("Guard: un comando catastrófico cierra la tarea con security_denied y no se despacha", async () => {
  const { ctx, dispatched } = await run({ request: "Formatear el disco", tool: "start_process", args: { command: "format c:" } });
  assert.equal(ctx.task.stopReason, "security_denied");
  assert.equal(dispatched.length, 0);
  assert.equal(ctx.find("calls", {})[0].status, "denied");
});

test("escritura: el usuario la rechaza, no se despacha, y al segundo rechazo el paso falla (no se insiste sin fin)", async () => {
  const { ctx, dispatched } = await run({
    request: "Guardar hola en C:\\x\\a.txt",
    tool: "write_file",
    args: { path: "C:\\x\\a.txt", content: "hola", mode: "rewrite" },
    // Un doble que insiste con la misma escritura y un usuario que siempre dice que no: el tope de rechazos corta el paso.
    onWait: (waiting, runtime) => {
      if (waiting.kind === "approval") runtime.resolveApproval(waiting.request.id, false, "no escribas nada");
    },
  });
  assert.equal(dispatched.length, 0);
  const rejected = ctx.find("calls", { status: "user_rejected" });
  assert.equal(rejected.length, 2, "dos rechazos y el paso falla");
  assert.equal(rejected[0].summary, "no escribas nada");
  assert.equal(ctx.find("steps", { state: "failed" }).length, 1);
  assert.equal(ctx.isClosed(), true);
});

test("escritura aprobada por el usuario: se despacha, no pasa por la revisión D3 y queda como efecto", async () => {
  const { ctx, dispatched, reviews } = await run({
    request: "Guardar hola en C:\\x\\a.txt",
    tool: "write_file",
    args: { path: "C:\\x\\a.txt", content: "hola", mode: "rewrite" },
    onWait: (waiting, runtime) => {
      if (waiting.kind === "approval") runtime.resolveApproval(waiting.request.id, true);
    },
  });
  assert.equal(dispatched.length, 1);
  assert.equal(reviews, 0);
  assert.equal(ctx.find("calls", { status: "ok" }).length, 1);
});

test("modo automático: una escritura sin confirmación pasa por la revisión D3", async () => {
  const { dispatched, reviews } = await run({ request: "Guardar hola en C:\\x\\a.txt", tool: "write_file", args: { path: "C:\\x\\a.txt", content: "hola", mode: "rewrite" }, autoMode: true });
  assert.equal(reviews, 1);
  assert.equal(dispatched.length, 1);
});

test("start_process de solo lectura: no pide confirmación, se registra como lectura y no pasa por D3", async () => {
  let asked = false;
  const { ctx, dispatched, reviews } = await run({
    request: "Listar C:\Users\Ana\Documents con PowerShell",
    tool: "start_process",
    args: { command: "Get-ChildItem C:\Users\Ana\Documents" },
    autoMode: true,
    onWait: (waiting) => {
      if (waiting.kind === "approval") asked = true;
    },
  });
  assert.equal(asked, false);
  assert.equal(reviews, 0);
  assert.equal(dispatched.length, 1);
  const call = ctx.find("calls", {})[0];
  assert.equal(call.kind, "read");
  assert.equal(call.status, "ok");
});

test("start_process que escribe: sigue siendo una escritura que pide confirmación", async () => {
  let asked = false;
  const { ctx, dispatched } = await run({
    request: "Borrar C:\Users\Ana\Documents\viejo.txt",
    tool: "start_process",
    args: { command: "Remove-Item C:\Users\Ana\Documents\viejo.txt" },
    onWait: (waiting, runtime) => {
      if (waiting.kind !== "approval") return;
      asked = true;
      runtime.resolveApproval(waiting.request.id, true);
    },
  });
  assert.equal(asked, true);
  assert.equal(dispatched.length, 1);
  assert.equal(ctx.find("calls", {})[0].kind, "write");
});

const STARTED = "Process started with PID 4321 (shell: powershell)\nesperando...";
const READ_CMD = { command: "Get-Date" };

test("procesos: si la tarea se cancela con un proceso en segundo plano activo, se cierra (force_terminate)", async () => {
  const { dispatched } = await run({ request: "Mostrar la fecha", tool: "start_process", args: READ_CMD, result: STARTED, onVerify: (runtime) => runtime.cancel() });
  const closed = dispatched.filter((d) => d.tool === "force_terminate");
  assert.equal(closed.length, 1);
  assert.deepEqual(closed[0].args, { pid: 4321 });
});

test("procesos: si la tarea se completa, el proceso en segundo plano se deja (puede ser lo pedido)", async () => {
  const { ctx, dispatched } = await run({ request: "Mostrar la fecha", tool: "start_process", args: READ_CMD, result: STARTED });
  assert.equal(ctx.task.state, "completed");
  assert.equal(dispatched.filter((d) => d.tool === "force_terminate").length, 0);
});

test("procesos: un proceso que ya terminó no se vuelve a cerrar", async () => {
  const done = "Process started with PID 4321 (shell: powershell)\nlisto\n✅ Process 4321 has finished execution";
  const { dispatched } = await run({ request: "Mostrar la fecha", tool: "start_process", args: READ_CMD, result: done, onVerify: (runtime) => runtime.cancel() });
  assert.equal(dispatched.filter((d) => d.tool === "force_terminate").length, 0);
});

test("ruta sensible: pide confirmación aunque esté encendido el modo automático, y si se rechaza no se despacha", async () => {
  let asked: string | null = null;
  const { dispatched } = await run({
    request: "Listar C:\\Users\\Ana\\.ssh",
    tool: "list_directory",
    args: { path: "C:\\Users\\Ana\\.ssh" },
    autoMode: true,
    onWait: (waiting, runtime) => {
      if (waiting.kind !== "approval") return;
      asked = waiting.request.reason;
      runtime.cancel();
    },
  });
  assert.match(asked ?? "", /ssh-keys/);
  assert.equal(dispatched.length, 0);
});

test("ruta sensible aprobada por el usuario: se despacha", async () => {
  const { dispatched } = await run({
    request: "Listar C:\\Users\\Ana\\.ssh",
    tool: "list_directory",
    args: { path: "C:\\Users\\Ana\\.ssh" },
    autoMode: true,
    onWait: (waiting, runtime) => {
      if (waiting.kind === "approval") runtime.resolveApproval(waiting.request.id, true);
    },
  });
  assert.equal(dispatched.filter((d) => d.tool === "list_directory").length, 1);
});

test("start_process de solo lectura sobre una ruta sensible: ya no se permite sin confirmar", async () => {
  let asked = false;
  const { dispatched } = await run({
    request: "Leer C:\\Users\\Ana\\.ssh\\config",
    tool: "start_process",
    args: { command: "Get-Content C:\\Users\\Ana\\.ssh\\config" },
    autoMode: true,
    onWait: (waiting, runtime) => {
      if (waiting.kind !== "approval") return;
      asked = true;
      runtime.cancel();
    },
  });
  assert.equal(asked, true);
  assert.equal(dispatched.length, 0);
});

// ───────────────────────── Topes y repeticiones, de punta a punta ─────────────────────────

const REJECT = { ok: 0.01, cumple: 0.01 };
const LIST = { path: "C:\\Users\\Ana\\Documents" };
const DOCS = "Listar C:\\Users\\Ana\\Documents";

test("topes: el modelo repite los mismos argumentos tras un rechazo: no se vuelve a ejecutar ni en el paso ni en los pasos que piden lo mismo", async () => {
  const { ctx, dispatched } = await run({ request: DOCS, tool: "list_directory", args: LIST, verifyFor: () => REJECT, pendingAlways: true });
  assert.equal(dispatched.filter((d) => d.tool === "list_directory").length, 1, "las repeticiones bloqueadas no llegan a la herramienta");
  const calls = ctx.find("calls", {});
  assert.equal(calls[0].status, "ok");
  assert.equal(calls[0].verdict, "rejected");
  assert.ok(calls.slice(1).every((c) => c.status === "loop_blocked"), "todo lo demás son repeticiones bloqueadas");
  assert.deepEqual(ctx.find("calls", { stepId: calls[0].stepId }).map((c) => c.status), ["ok", "loop_blocked", "loop_blocked"], "dos bloqueos fallan el paso");
  assert.ok(ctx.find("steps", { state: "failed" }).length >= 2, "los pasos siguientes (mismo criterio) fallan igual, acotados por las escalaciones");
});

// Un `tool_error` se rechaza sin consultar a D4 (no hay datos que juzgar): solo se verifica el resultado del reintento.
test("repetición: un fallo pasajero de una lectura se reintenta una vez con los mismos argumentos", async () => {
  const { ctx, dispatched } = await run({
    request: DOCS,
    tool: "list_directory",
    args: LIST,
    resultFor: (n) => (n === 0 ? { content: [{ type: "text", text: "EBUSY: resource busy" }], isError: true } : { content: [{ type: "text", text: "[FILE] a.txt" }] }),
  });
  assert.equal(dispatched.filter((d) => d.tool === "list_directory").length, 2, "el reintento idéntico se ejecutó");
  assert.deepEqual(ctx.find("calls", {}).map((c) => c.status), ["tool_error", "ok"]);
  assert.equal(ctx.find("steps", {})[0].state, "completed");
});

test("repetición: un segundo fallo pasajero idéntico en el mismo paso ya no se reintenta (un reintento por paso)", async () => {
  const { ctx } = await run({
    request: DOCS,
    tool: "list_directory",
    args: LIST,
    resultFor: () => ({ content: [{ type: "text", text: "EBUSY: resource busy" }], isError: true }),
    pendingAlways: true,
  });
  const first = ctx.find("steps", {})[0];
  const statuses = ctx.find("calls", { stepId: first.id }).map((c) => c.status);
  assert.deepEqual(statuses.slice(0, 3), ["tool_error", "tool_error", "loop_blocked"], "ejecución, un reintento y después bloqueo");
});
