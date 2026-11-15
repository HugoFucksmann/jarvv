/**
 * Invariantes de estado, configuración y transporte (Fase 2 de auditoría).
 *
 * - Invariante 9: Hilo (`previousTask`): único y global (compartido entre canales) con vencimiento de 10 min (`THREAD_TTL_MS`).
 * - Invariante 10: `memory.ts`: caché por `mtimeMs` (no relee disco si `mtimeMs` no cambia) y archivo corrupto/ausente devuelve `[]`.
 * - Invariante 11: `DEFAULT_CONFIG` sin `jarvis-config.json`: `autoMode === false` y `approvalTiers === false` (proceso aislado).
 * - Extra auditoría B: `transport.ts`: limpia el listener de `abort` tras vencer el backoff en reintento HTTP 503.
 * - Extra auditoría A: `TerminalProvider.start()` tope `MAX_HELPERS_ATTEMPTS` (documentado con `test.skip` por falta de seam `spawn` y plataforma).
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mock, test } from "node:test";
import { promisify } from "node:util";

import type { JarvisConfig } from "../src/core/config.ts";
import type { EngineLLM } from "../src/core/contracts.ts";
import type { EngineServices } from "../src/core/engine/services.ts";
import { THREAD_TTL_MS } from "../src/core/engine/thread.ts";
import { createMemoryReader } from "../src/core/memory.ts";
import { postJson } from "../src/core/models/transport.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { TaskManager } from "../src/core/tasks.ts";

const execFileAsync = promisify(execFile);

function makeTaskManager(root: string, onContinuation?: (input: { previous: unknown }) => void): TaskManager {
  const getConfig = (): JarvisConfig =>
    ({ traceEnabled: false, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d", autoMode: false }) as JarvisConfig;
  const services: EngineServices = {
    vault: createRefVault({ dir: path.join(root, "refs") }),
    guardScope: { protectedDirs: [], relativeBases: [root] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
    autoMode: () => false,
  };
  const llm: EngineLLM = {
    generateArgumentsFromView: async () => { throw new Error("unused"); },
    generateQuestion: async () => { throw new Error("unused"); },
    generatePendingFromView: async () => ({ pending: [], rawInput: "", rawOutput: "" }),
    generatePlanFromView: async () => { throw new Error("unused"); },
    generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
  };
  return new TaskManager(
    {
      llm,
      discovery: { getServer: () => undefined, getDiscoveredTools: async () => [], getUnavailableServers: () => ({}), validateToolExists: async () => false },
      decision: {
        continuation: async (input) => {
          onContinuation?.(input);
          return { follows: 0, rawInput: "", rawOutput: "" };
        },
        chooseRoute: async () => { throw new Error("unused"); },
        chooseTool: async () => { throw new Error("unused"); },
        reviewArgs: async () => { throw new Error("unused"); },
        verifyResult: async () => { throw new Error("unused"); },
        checkCompletion: async () => { throw new Error("unused"); },
      },
    },
    getConfig,
    services,
  );
}

test("Invariante 9: previousTask es único y global, y vence a los 10 min (THREAD_TTL_MS)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-inv9-"));
  let clock = 1_700_000_000_000;
  const dateMock = mock.method(Date, "now", () => clock);

  try {
    const seen: { req: string }[] = [];
    const tm = makeTaskManager(root, (input) => seen.push({ req: (input.previous as { request: string }).request }));

    tm.start("Pedido uno", "reactive");
    await tm.drain(3000);
    assert.equal(seen.length, 0, "la primera tarea no tiene previa");

    // Dentro del TTL (< 10 min) la siguiente tarea ve la previa global
    clock += THREAD_TTL_MS - 1;
    tm.start("Pedido dos", "reactive");
    await tm.drain(3000);
    assert.deepEqual(seen, [{ req: "Pedido uno" }]);

    // Vencido el TTL (>= 10 min) la entrada caduca
    seen.length = 0;
    clock += THREAD_TTL_MS;
    tm.start("Pedido tres expirado", "reactive");
    await tm.drain(3000);
    assert.equal(seen.length, 0, "transcurridos 10 minutos exactos el hilo expira");
  } finally {
    dateMock.mock.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Invariante 10: memory.ts cachea por mtimeMs (no relee disco si no cambia) y JSON corrupto vuelve a []", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-inv10-"));
  const file = path.join(dir, "memory.json");
  let readCalls = 0;
  const origReadFileSync = fs.readFileSync;
  const readSpy = mock.method(fs, "readFileSync", ((p: fs.PathOrFileDescriptor, opts?: unknown) => {
    if (p === file) readCalls++;
    return (origReadFileSync as (...a: unknown[]) => unknown)(p, opts);
  }) as typeof fs.readFileSync);

  try {
    fs.writeFileSync(file, JSON.stringify({ facts: [{ key: "carpeta jarvis", value: "/tmp/j" }] }));
    const read = createMemoryReader(file);

    assert.equal(read().length, 1);
    assert.equal(readCalls, 1);
    // Misma mtimeMs: hit de caché sin leer el archivo de nuevo
    assert.equal(read().length, 1);
    assert.equal(read().length, 1);
    assert.equal(readCalls, 1);

    // Corrupción posterior: limpia caché y devuelve []
    fs.writeFileSync(file, "{corrupt json");
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    assert.deepEqual(read(), []);
    assert.equal(readCalls, 2);

    // Tope MAX_FACTS (200) y longitud de clave (>80)
    const over = Array.from({ length: 210 }, (_, i) => ({ key: `clave_${i}`, value: `v${i}` }));
    over.push({ key: "k".repeat(81), value: "demasiado larga" });
    fs.writeFileSync(file, JSON.stringify(over));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 10_000));
    assert.equal(read().length, 200);
  } finally {
    readSpy.mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Invariante 11: sin jarvis-config.json, DEFAULT_CONFIG arranca con autoMode=false y approvalTiers=false", async () => {
  const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-inv11-"));
  const configUrl = pathToFileURL(path.resolve("src/core/config.ts")).href;
  const tsxBin = path.resolve("node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

  try {
    const script = `import { ConfigManager } from ${JSON.stringify(configUrl)}; const c = ConfigManager.getConfig(); console.log(JSON.stringify({ autoMode: c.autoMode, approvalTiers: c.approvalTiers }));`;
    const { stdout } = await execFileAsync(tsxBin, ["--input-type=module", "-e", script], { cwd: emptyCwd });
    const parsed = JSON.parse(stdout.trim()) as { autoMode: boolean; approvalTiers: boolean };
    assert.equal(parsed.autoMode, false);
    assert.equal(parsed.approvalTiers, false);
    assert.equal(fs.existsSync(path.join(emptyCwd, "jarvis-config.json")), false);
  } finally {
    fs.rmSync(emptyCwd, { recursive: true, force: true });
  }
});

test("Extra auditoría (transport.ts): limpia el listener de abort al vencer el backoff de HTTP 503", async () => {
  const originalFetch = globalThis.fetch;
  const origAdd = AbortSignal.prototype.addEventListener;
  const origRemove = AbortSignal.prototype.removeEventListener;

  const addedListeners: EventListenerOrEventListenerObject[] = [];
  const removedListeners: EventListenerOrEventListenerObject[] = [];

  AbortSignal.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
    if (type === "abort" && typeof listener === "function" && listener.name === "onAbort") {
      addedListeners.push(listener);
    }
    return origAdd.call(this, type, listener as EventListenerOrEventListenerObject, opts);
  };
  AbortSignal.prototype.removeEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
    if (type === "abort" && typeof listener === "function" && listener.name === "onAbort") {
      removedListeners.push(listener);
    }
    return origRemove.call(this, type, listener as EventListenerOrEventListenerObject, opts);
  };

  let attempt = 0;
  globalThis.fetch = (async () => {
    attempt++;
    if (attempt === 1) return new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });
    return new Response("{\"ok\":true}", { status: 200, statusText: "OK" });
  }) as typeof fetch;

  try {
    const ac = new AbortController();
    const res = await postJson({
      url: "http://127.0.0.1:1/test",
      body: "{}",
      timeoutMs: 5000,
      signal: ac.signal,
    });
    assert.equal(res.status, 200);
    assert.equal(attempt, 2);
    assert.equal(addedListeners.length, 1, "se registró exactamente un listener onAbort en el backoff");
    assert.equal(removedListeners.length, 1, "se desregistró onAbort al vencer el timer del backoff");
    assert.equal(removedListeners[0], addedListeners[0]);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.prototype.addEventListener = origAdd;
    AbortSignal.prototype.removeEventListener = origRemove;
  }
});

test.skip("Extra auditoría (TerminalProvider.start): tope MAX_HELPERS_ATTEMPTS=3 cuando helpersFile deja de existir (requiere Windows y seam inyectable para child_process.spawn en TerminalOptions: src/tools/terminal/terminalProvider.ts:59,369-375,414)", () => {
  // No es posible testearlo en proceso en Linux ni sin tocar `src/tools/terminal/terminalProvider.ts`,
  // porque `callTool` rechaza fuera de win32 (L297) y `spawnProcess` llama directamente a `spawn("powershell.exe", ...)` (L414).
});
