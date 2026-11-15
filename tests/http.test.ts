/** API HTTP: acceso solo local (Host y Origin), decisiones con ids obligatorios y claves de configuración que solo se editan en el archivo. */

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, mock, test } from "node:test";

import express from "express";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TaskBusyError, TaskManager } from "../src/core/tasks.ts";
import { ConfigManager } from "../src/core/config.ts";
import type { JarvisConfig } from "../src/core/config.ts";
import type { EngineLLM } from "../src/core/contracts.ts";
import type { EngineServices } from "../src/core/engine/services.ts";
import type { DiscoveryEngine } from "../src/core/mcp/discovery.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { MAX_SSE_CLIENTS } from "../src/core/types/limits.ts";
import { createJarvisRouter, withoutLaunchFields } from "../src/server/jarvisRouter.ts";
import { createMcpRouter } from "../src/server/mcpRouter.ts";
import { localOnly } from "../src/server/localOnly.ts";

const calls: string[] = [];
const listeners = new Set<(event: unknown) => void>();
let busy = false;
const fakeTasks = {
  start: (message: string) => {
    if (busy) throw new TaskBusyError("task_1");
    return { id: "task_new", message };
  },
  addEventListener: (listener: (event: unknown) => void) => (listeners.add(listener), () => listeners.delete(listener)),
  list: () => [{ id: "task_1", state: "running" }],
  cancel: (id: string) => (calls.push(`cancel ${id}`), "ok"),
  approveCall: (id: string, wait?: string) => (calls.push(`approve ${id} ${wait}`), "ok"),
  denyCall: (id: string, _reason?: string, wait?: string) => (calls.push(`deny ${id} ${wait}`), "ok"),
  approvePlan: (id: string, wait?: string) => (calls.push(`confirm ${id} ${wait}`), "ok"),
  rejectPlan: (id: string, wait?: string) => (calls.push(`reject ${id} ${wait}`), "ok"),
  modifyPlan: (id: string, _f: string, wait?: string) => (calls.push(`modify ${id} ${wait}`), "ok"),
  answer: (id: string) => (calls.push(`answer ${id}`), "ok"),
} as unknown as TaskManager;

/** Un proveedor de terminal falso para `/api/mcp`: registra lo que le llega. */
const terminalCalls: string[] = [];
let refreshCalls = 0;
const fakeDiscovery = {
  getServer: (name: string) =>
    name === "jarvis_terminal" ? { callTool: async (tool: string) => (terminalCalls.push(tool), { content: [], isError: false }), isConnected: () => true } : undefined,
  discoverAll: async () => {
    refreshCalls++;
    return {};
  },
  getUnavailableServers: () => [],
} as unknown as DiscoveryEngine;

let server: http.Server;
let port = 0;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(localOnly());
  app.use("/api/jarvis", createJarvisRouter(fakeTasks, fakeDiscovery));
  app.use("/api/mcp", createMcpRouter(fakeDiscovery));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.close();
});

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

function request(method: string, path: string, options: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: { ...(payload ? { "Content-Type": "application/json" } : {}), ...options.headers } },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ───────────────────────── Acceso solo local ─────────────────────────

test("Host local: pasa; un Host ajeno (DNS rebinding) o vacío se rechaza", async () => {
  assert.equal((await request("GET", "/api/jarvis/limits")).status, 200);
  assert.equal((await request("GET", "/api/jarvis/limits", { headers: { Host: `localhost:${port}` } })).status, 200);
  assert.equal((await request("GET", "/api/jarvis/limits", { headers: { Host: "evil.example.com" } })).status, 403);
  assert.equal((await request("GET", "/api/jarvis/limits", { headers: { Host: "127.0.0.1.evil.com" } })).status, 403);
  assert.equal((await request("GET", "/api/jarvis/limits", { headers: { Host: "192.168.1.20:3000" } })).status, 403);
});

test("Origin: uno local pasa con CORS; uno ajeno, `null` o un parecido se rechazan, también en POST", async () => {
  const ok = await request("GET", "/api/jarvis/limits", { headers: { Origin: "http://localhost:5173" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["access-control-allow-origin"], "http://localhost:5173");
  for (const origin of ["http://evil.com", "null", "http://localhost.evil.com", "https://127.0.0.1.evil.com", "file://"]) {
    const get = await request("GET", "/api/jarvis/limits", { headers: { Origin: origin } });
    assert.equal(get.status, 403, `GET ${origin}`);
    const post = await request("POST", "/api/jarvis/approve", { headers: { Origin: origin }, body: { taskId: "task_1", waitId: "w1" } });
    assert.equal(post.status, 403, `POST ${origin}`);
  }
  assert.equal(calls.length, 0, "ningún rechazo llegó a las rutas");
});

test("OPTIONS responde 200 solo para un origen local", async () => {
  assert.equal((await request("OPTIONS", "/api/jarvis/approve", { headers: { Origin: "http://localhost:3000" } })).status, 200);
  assert.equal((await request("OPTIONS", "/api/jarvis/approve", { headers: { Origin: "http://evil.com" } })).status, 403);
});

// ───────────────────────── Decisiones con ids obligatorios ─────────────────────────

test("aprobar, rechazar, confirmar y modificar exigen taskId y waitId: sin ellos no se resuelve nada", async () => {
  calls.length = 0;
  for (const [path, body] of [
    ["/api/jarvis/approve", {}],
    ["/api/jarvis/approve", { taskId: "task_1" }],
    ["/api/jarvis/approve", { waitId: "w1" }],
    ["/api/jarvis/deny", { reason: "no" }],
    ["/api/jarvis/confirm-plan", {}],
    ["/api/jarvis/reject-plan", { taskId: "task_1" }],
    ["/api/jarvis/modify-plan", { feedback: "otro", taskId: "task_1" }],
  ] as const) {
    const res = await request("POST", path, { body });
    assert.equal(res.status, 400, `${path} ${JSON.stringify(body)}`);
  }
  assert.deepEqual(calls, []);
});

test("con taskId y waitId se resuelve la espera indicada", async () => {
  calls.length = 0;
  const ids = { taskId: "task_7", waitId: "approval_9" };
  assert.equal((await request("POST", "/api/jarvis/approve", { body: ids })).status, 200);
  assert.equal((await request("POST", "/api/jarvis/deny", { body: { ...ids, reason: "no" } })).status, 200);
  assert.equal((await request("POST", "/api/jarvis/confirm-plan", { body: ids })).status, 200);
  assert.equal((await request("POST", "/api/jarvis/reject-plan", { body: ids })).status, 200);
  assert.equal((await request("POST", "/api/jarvis/modify-plan", { body: { ...ids, feedback: "otro" } })).status, 200);
  assert.deepEqual(calls, ["approve task_7 approval_9", "deny task_7 approval_9", "confirm task_7 approval_9", "reject task_7 approval_9", "modify task_7 approval_9"]);
});

test("cancelar y responder una pregunta conservan el atajo de la última tarea", async () => {
  calls.length = 0;
  assert.equal((await request("POST", "/api/jarvis/cancel", { body: {} })).status, 200);
  assert.equal((await request("POST", "/api/jarvis/user-answer", { body: { answer: "la primera" } })).status, 200);
  assert.deepEqual(calls, ["cancel task_1", "answer task_1"]);
});

// ───────────────────────── Configuración ─────────────────────────

test("el parche de /config descarta lo que solo se edita en el archivo y conserva el resto", () => {
  const patch = withoutLaunchFields({
    autoMode: true,
    retentionDays: 7,
    refsDir: "C:\\Users\\Ana\\Documents",
    tracePath: "C:\\Users\\Ana\\Documents.jsonl",
    desktopCommanderMcp: { command: "calc.exe", args: ["-x"], env: { A: "1" }, cwd: "C:\\", allowedDirectories: ["C:\\Users"] },
    freeSearchMcp: { command: "evil" },
  });
  assert.deepEqual(patch, { autoMode: true, retentionDays: 7, desktopCommanderMcp: { allowedDirectories: ["C:\\Users"] }, freeSearchMcp: {} });
});

test("SSE: los eventos llegan como `data:`, y al cerrar el cliente se da de baja el suscriptor (sin fuga)", async () => {
  const received = await new Promise<string>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/jarvis/events", headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      assert.match(String(res.headers["content-type"]), /text\/event-stream/);
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        if (chunk.includes("data:")) {
          req.destroy();
          resolve(chunk);
        }
      });
      setTimeout(() => [...listeners].forEach((listener) => listener({ type: "task_updated", taskId: "task_1" })), 50);
    });
    req.on("error", (error) => (error as NodeJS.ErrnoException).code === "ECONNRESET" || reject(error));
    req.end();
  });
  assert.equal(received.trim(), 'data: {"type":"task_updated","taskId":"task_1"}');
  for (let i = 0; i < 50 && listeners.size > 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(listeners.size, 0);
});

test("POST /process responde 409 con mensaje claro cuando ya hay una tarea activa (e ignora sessionKey), y vuelve a aceptar al liberarse", async () => {
  busy = true;
  const conflict = await request("POST", "/api/jarvis/process", { body: { message: "hola", sessionKey: "telegram:1" } });
  assert.equal(conflict.status, 409);
  assert.match(JSON.parse(conflict.body).error, /interfaz web.*\/cancel/i);
  busy = false;
  assert.equal((await request("POST", "/api/jarvis/process", { body: { message: "hola", sessionKey: "telegram:1" } })).status, 200);
});

test("POST /cancel libera el cupo aunque la ejecución esté colgada y permite iniciar otra tarea", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-http-cancel-"));
  const getConfig = (): JarvisConfig => ({ traceEnabled: false, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d", autoMode: false }) as JarvisConfig;
  const services: EngineServices = {
    vault: createRefVault({ dir: path.join(root, "refs") }),
    guardScope: { protectedDirs: [], relativeBases: [root] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
    autoMode: () => false,
  };
  let hang = true;
  const llm: EngineLLM = {
    generateArgumentsFromView: async () => { throw new Error("unused"); },
    generateQuestion: async () => { throw new Error("unused"); },
    generatePendingFromView: () => (hang ? new Promise(() => undefined) : Promise.resolve({ pending: [], rawInput: "", rawOutput: "" })),
    generatePlanFromView: async () => { throw new Error("unused"); },
    generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
  };
  const discovery = { getServer: () => undefined, getDiscoveredTools: async () => [], getUnavailableServers: () => ({}), validateToolExists: async () => false };
  const decision = {
    chooseRoute: async () => { throw new Error("unused"); },
    chooseTool: async () => { throw new Error("unused"); },
    reviewArgs: async () => { throw new Error("unused"); },
    verifyResult: async () => { throw new Error("unused"); },
    checkCompletion: async () => { throw new Error("unused"); },
  };
  const realTasks = new TaskManager({ decision, discovery, llm }, getConfig, services, { cancelGraceMs: 30 });
  const app = express();
  app.use(express.json());
  app.use("/api/jarvis", createJarvisRouter(realTasks, fakeDiscovery));
  const local = http.createServer(app);
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const localPort = (local.address() as AddressInfo).port;
  const postLocal = (p: string, body: unknown): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({ host: "127.0.0.1", port: localPort, method: "POST", path: p, headers: { "Content-Type": "application/json" } }, (res) => {
        let out = "";
        res.on("data", (c: Buffer) => (out += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: out }));
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
    });

  try {
    const first = await postLocal("/api/jarvis/process", { message: "se cuelga" });
    assert.equal(first.status, 200);
    await new Promise((r) => setTimeout(r, 15));

    const rejected = await postLocal("/api/jarvis/process", { message: "segunda" });
    assert.equal(rejected.status, 409);

    const cancelled = await postLocal("/api/jarvis/cancel", {});
    assert.equal(cancelled.status, 200);

    hang = false;
    const second = await postLocal("/api/jarvis/process", { message: "destrabada" });
    assert.equal(second.status, 200);
    await realTasks.drain(3000);
  } finally {
    local.closeAllConnections?.();
    local.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP real: /cancel idempotente y 404, hilo global ignora sessionKey y /tasks/:id/trace y /refs responden según estado", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-http-real-"));
  const getConfig = (): JarvisConfig => ({ traceEnabled: true, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d", autoMode: false }) as JarvisConfig;
  const vault = createRefVault({ dir: path.join(root, "refs") });
  const services: EngineServices = {
    vault,
    guardScope: { protectedDirs: [], relativeBases: [root] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
    autoMode: () => false,
  };
  let releasePending!: () => void;
  let blockPending = true;
  const seenPrev: unknown[] = [];
  const llm: EngineLLM = {
    generateArgumentsFromView: async () => { throw new Error("unused"); },
    generateQuestion: async () => { throw new Error("unused"); },
    generatePendingFromView: async () => {
      if (blockPending) await new Promise<void>((r) => { releasePending = r; });
      return { pending: [], rawInput: "", rawOutput: "" };
    },
    generatePlanFromView: async () => { throw new Error("unused"); },
    generateFinalFromView: async () => ({ response: "Respuesta HTTP.", rawInput: "", rawOutput: "" }),
  };
  const discovery = { getServer: () => undefined, getDiscoveredTools: async () => [], getUnavailableServers: () => ({}), validateToolExists: async () => false };
  const decision = {
    continuation: async (input: { previous: unknown }) => {
      seenPrev.push(input.previous);
      return { follows: 0, rawInput: "", rawOutput: "" };
    },
    chooseRoute: async () => { throw new Error("unused"); },
    chooseTool: async () => { throw new Error("unused"); },
    reviewArgs: async () => { throw new Error("unused"); },
    verifyResult: async () => { throw new Error("unused"); },
    checkCompletion: async () => { throw new Error("unused"); },
  };
  const realTasks = new TaskManager({ decision, discovery, llm }, getConfig, services);
  const app = express();
  app.use(express.json());
  app.use("/api/jarvis", createJarvisRouter(realTasks, fakeDiscovery));
  const local = http.createServer(app);
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const localPort = (local.address() as AddressInfo).port;
  const call = (method: string, p: string, body?: unknown): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({ host: "127.0.0.1", port: localPort, method, path: p, headers: payload ? { "Content-Type": "application/json" } : undefined }, (res) => {
        let out = "";
        res.on("data", (c: Buffer) => (out += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: out }));
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });

  const cfgMock = mock.method(ConfigManager, "getConfig", getConfig);

  try {
    // Sin tareas activas: /cancel sin taskId es idempotente (200) y con taskId desconocido da 404.
    assert.equal((await call("POST", "/api/jarvis/cancel", {})).status, 200);
    assert.equal((await call("POST", "/api/jarvis/cancel", { taskId: "task_no_existe" })).status, 404);

    // Primera tarea con sessionKey de la web UI: mientras corre, su traza aún no existe (404).
    const firstRes = await call("POST", "/api/jarvis/process", { message: "desde web", sessionKey: "ui:tab1" });
    assert.equal(firstRes.status, 200);
    const firstId = (JSON.parse(firstRes.body) as { task: { task: { id: string } } }).task.task.id;
    await new Promise((r) => setTimeout(r, 15));
    assert.equal((await call("GET", `/api/jarvis/tasks/${firstId}/trace?format=summary`)).status, 404);
    assert.equal((await call("GET", `/api/jarvis/tasks/${firstId}/trace?format=invalido`)).status, 400);

    blockPending = false;
    releasePending();
    await realTasks.drain(3000);

    // Cancelar una tarea ya terminada (y /cancel sin taskId cuando solo hay terminadas) sigue siendo idempotente (200).
    assert.equal((await call("POST", "/api/jarvis/cancel", { taskId: firstId })).status, 200);
    assert.equal((await call("POST", "/api/jarvis/cancel", {})).status, 200);

    // Traza disponible al terminar; ref desconocida devuelve 404 y tarea desconocida también.
    const traceRes = await call("GET", `/api/jarvis/tasks/${firstId}/trace?format=summary`);
    assert.equal(traceRes.status, 200);
    assert.match(String(traceRes.headers["content-type"]), /text\/markdown/);
    assert.equal((await call("GET", `/api/jarvis/tasks/${firstId}/refs/r1`)).status, 404);
    assert.equal((await call("GET", "/api/jarvis/tasks/task_no_existe/refs/r1")).status, 404);

    // Segunda tarea desde otro sessionKey ("telegram:99"): comparte el hilo global único.
    const secondRes = await call("POST", "/api/jarvis/process", { message: "desde telegram", sessionKey: "telegram:99" });
    assert.equal(secondRes.status, 200);
    await realTasks.drain(3000);
    assert.deepEqual(seenPrev, [{ request: "desde web", answer: "Respuesta HTTP." }]);
  } finally {
    cfgMock.mock.restore();
    local.closeAllConnections?.();
    local.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SSE: pasado el tope de conexiones abiertas responde 429, y al cerrarse una se acepta otra", async () => {
  const open = (): Promise<{ status: number; close: () => void }> =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/jarvis/events" }, (res) => resolve({ status: res.statusCode ?? 0, close: () => req.destroy() }));
      req.on("error", (error) => (error as NodeJS.ErrnoException).code === "ECONNRESET" || reject(error));
      req.end();
    });
  const clients = [];
  for (let i = 0; i < MAX_SSE_CLIENTS; i++) clients.push(await open());
  assert.ok(clients.every((c) => c.status === 200));
  const refused = await open();
  assert.equal(refused.status, 429);
  clients[0].close();
  let again = 429;
  for (let i = 0; i < 50 && again !== 200; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const next = await open();
    again = next.status;
    clients.push(next);
  }
  assert.equal(again, 200);
  for (const c of clients) c.close();
});

test("RC-07: /api/mcp no ejecuta run_command, ni siquiera un comando de solo lectura (sin tarea nadie cerraría el proceso)", async () => {
  for (const args of [{ command: "Get-Process" }, { command: "Remove-Item C:\\x" }, { pid: 4 }]) {
    const reply = await request("POST", "/api/mcp/jarvis_terminal/call", { body: { name: "run_command", args } });
    assert.equal(reply.status, 403, JSON.stringify(args));
  }
  assert.deepEqual(terminalCalls, [], "nada llegó al proveedor");
});

test("P-13: /refresh-discovery solo acepta POST y rechaza GET", async () => {
  refreshCalls = 0;
  const getReply = await request("GET", "/api/jarvis/refresh-discovery");
  assert.equal(getReply.status, 404);
  assert.equal(refreshCalls, 0);
  const postReply = await request("POST", "/api/jarvis/refresh-discovery");
  assert.equal(postReply.status, 200);
  assert.equal(refreshCalls, 1);
});
