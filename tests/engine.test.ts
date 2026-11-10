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

  const server: IMCPServer = {
    name: "desktop_commander",
    version: "test",
    listTools: async () => TOOLS,
    callTool: async (name, args): Promise<MCPCallResult> => {
      dispatched.push({ tool: name, args });
      return { content: [{ type: "text", text: "[FILE] a.txt\n[FILE] b.txt" }] };
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
      verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generateArgumentsFromView: async () => ({ args: s.args, rawInput: "", rawOutput: "", timing: TIMING }),
      generateQuestion: async () => ({ question: "¿cuál?", rawInput: "", rawOutput: "" }),
      // La primera consulta trae el pendiente; al vaciarse, el modelo confirma que no falta nada.
      generatePendingFromView: async () => ({ pending: pendingCalls++ === 0 ? [s.request] : [], rawInput: "", rawOutput: "" }),
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
