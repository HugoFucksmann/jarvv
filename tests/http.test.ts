/** API HTTP: acceso solo local (Host y Origin), decisiones con ids obligatorios y claves de configuración que solo se editan en el archivo. */

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import express from "express";

import type { TaskManager } from "../src/core/tasks.ts";
import type { DiscoveryEngine } from "../src/core/mcp/discovery.ts";
import { MAX_ACTIVE_TASKS, MAX_SSE_CLIENTS } from "../src/core/types/limits.ts";
import { createJarvisRouter, withoutLaunchFields } from "../src/server/jarvisRouter.ts";
import { localOnly } from "../src/server/localOnly.ts";

const calls: string[] = [];
const listeners = new Set<(event: unknown) => void>();
let active = 0;
const fakeTasks = {
  activeCount: () => active,
  start: (message: string) => ({ id: "task_new", message }),
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

let server: http.Server;
let port = 0;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(localOnly());
  app.use("/api/jarvis", createJarvisRouter(fakeTasks, {} as DiscoveryEngine));
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

test("POST /process responde 429 con el tope de tareas en curso y vuelve a aceptar al liberarse una", async () => {
  active = MAX_ACTIVE_TASKS;
  assert.equal((await request("POST", "/api/jarvis/process", { body: { message: "hola" } })).status, 429);
  active = MAX_ACTIVE_TASKS - 1;
  assert.equal((await request("POST", "/api/jarvis/process", { body: { message: "hola" } })).status, 200);
  active = 0;
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
