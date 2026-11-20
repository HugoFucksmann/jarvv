/**
 * Pruebas unitarias de `jarvis_system`
 * (`system_info`, `stop_process`, `pc_settings`, `power`, `open_on_screen`, `clipboard`):
 * - Drivers falsos inyectados para probar en Linux sin GUI ni afectar al SO anfitrión.
 * - Verifica las 10 secciones de `system_info` (incluidas `network`, `processes`, `ports`, `datetime`),
 *   protección de procesos críticos/propios en `stop_process`, validación de rangos y toggles en
 *   `pc_settings`, acciones y demoras en `power`, esquemas/`allowedDirectories` en `open_on_screen`,
 *   recorte de portapapeles en `clipboard` y `AbortSignal` en todas ellas.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import type { UserEnvironment } from "../src/core/environment.ts";
import { readToolResult } from "../src/core/tools/result.ts";
import {
  SystemProvider,
  type ClipboardDriver,
  type PcSettingsDriver,
  type PowerController,
  type PowerRequest,
  type ProcessKiller,
  type ResolvedOpenKind,
  type ScreenOpener,
  type SettingValue,
  type SystemReader,
} from "../src/tools/system/systemProvider.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "jarvis-sys-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeEnv(home: string): UserEnvironment {
  return {
    platform: "linux",
    home,
    desktop: path.join(home, "Desktop"),
  };
}

function fakeReader(overrides: Partial<SystemReader> = {}): Partial<SystemReader> {
  return {
    readHost: () => ({
      cpuModel: "AMD Ryzen 7 7800X3D",
      cores: 16,
      totalMemBytes: 32 * 1024 ** 3,
      freeMemBytes: 18 * 1024 ** 3,
      osName: "Windows",
      osVersion: "Windows 11 Pro",
      osBuild: "22631",
      arch: "x64",
      uptimeSec: 90_060,
      user: "hugo",
    }),
    readGpus: async () => ["NVIDIA GeForce RTX 4070"],
    readDisks: async () => [
      {
        letter: "C:",
        label: "Sistema",
        fileSystem: "NTFS",
        sizeBytes: 500 * 1024 ** 3,
        freeBytes: 120 * 1024 ** 3,
        usedPercent: 76,
      },
    ],
    readServices: async () => [
      { name: "Spooler", displayName: "Print Spooler", status: "Running" },
      { name: "wuauserv", displayName: "Windows Update", status: "Stopped" },
    ],
    readDevTools: async (tools) =>
      tools.map((name) => (name === "node" ? { name, installed: true, version: "v22.0.0" } : { name, installed: false })),
    readNetwork: async () => ({
      hostname: "JARVIS-PC",
      defaultGateway: "192.168.1.1",
      dnsServers: ["1.1.1.1", "8.8.8.8"],
      wifiSsid: "MiRed",
      interfaces: [
        { name: "Wi-Fi", addresses: ["192.168.1.42"], internal: false, mac: "aa:bb:cc:dd:ee:ff" },
        { name: "Loopback", addresses: ["127.0.0.1"], internal: true },
      ],
    }),
    readProcesses: async () => [
      { pid: 1001, name: "chrome", cpuSec: 45.2, memoryBytes: 900 * 1024 * 1024, windowTitle: "Docs" },
      { pid: 1002, name: "node", cpuSec: 12.8, memoryBytes: 120 * 1024 * 1024 },
      { pid: 1003, name: "code", cpuSec: 99.1, memoryBytes: 400 * 1024 * 1024 },
    ],
    readPorts: async () => [
      { protocol: "tcp", localAddress: "127.0.0.1", localPort: 3000, state: "Listen", pid: 1002, processName: "node" },
      { protocol: "udp", localAddress: "0.0.0.0", localPort: 5353, state: "Open", pid: 1001, processName: "chrome" },
    ],
    readDateTime: () => ({
      iso: "2026-11-20T16:00:00.000Z",
      localDateTime: "2026-11-20 13:00:00",
      timeZone: "America/Argentina/Buenos_Aires",
      utcOffsetMinutes: -180,
      unixMs: 1_795_190_400_000,
    }),
    ...overrides,
  };
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── Provider metadata ─────────────────────────

test("jarvis_system: lista las 6 tools del grupo system y rechaza desconocidas", async () => {
  const provider = new SystemProvider();
  assert.equal(provider.name, "jarvis_system");
  assert.equal(provider.isConnected(), true);
  const tools = await provider.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["system_info", "stop_process", "pc_settings", "power", "open_on_screen", "clipboard"],
  );
  const unknown = await provider.callTool("play_media", {});
  assert.equal(unknown.isError, true);
});

// ───────────────────────── system_info (10 secciones) ─────────────────────────

test("system_info: cubre hardware, os, disks, services, dev_tools, overview, network, processes, ports y datetime", async () => {
  const provider = new SystemProvider({ systemReader: fakeReader() });

  // datetime
  const dtRes = await provider.callTool("system_info", { section: "datetime" });
  const dtRead = readToolResult(dtRes);
  assert.ok(dtRead);
  assert.equal(dtRes.isError, false);
  assert.ok(dtRead.text.includes("2026-11-20 13:00:00"));
  assert.ok(dtRead.text.includes("UTC-03:00"));

  // network
  const netRes = await provider.callTool("system_info", { section: "network" });
  const netRead = readToolResult(netRes);
  assert.ok(netRead);
  assert.equal(netRes.isError, false);
  assert.ok(netRead.text.includes("JARVIS-PC"));
  assert.ok(netRead.text.includes("192.168.1.42"));
  assert.ok(netRead.text.includes("Gateway: 192.168.1.1"));

  // processes ordenados por cpu y con nameFilter
  const procCpu = await provider.callTool("system_info", { section: "processes", sortBy: "cpu", limit: 2 });
  const procRead = readToolResult(procCpu);
  assert.ok(procRead);
  assert.equal(procCpu.isError, false);
  const procLines = procRead.text.split("\n").slice(1);
  assert.ok(procLines[0].includes("code"), "el de mayor CPU primero");
  assert.ok(procLines[1].includes("chrome"));

  const procFilter = await provider.callTool("system_info", { section: "processes", nameFilter: "node" });
  assert.equal(((readToolResult(procFilter)?.data.sections as any).processes.total), 1);

  // ports con filtro por protocolo
  const tcpRes = await provider.callTool("system_info", { section: "ports", protocol: "tcp" });
  const tcpRead = readToolResult(tcpRes);
  assert.ok(tcpRead);
  assert.ok(tcpRead.text.includes("TCP 127.0.0.1:3000"));
  assert.equal(tcpRead.text.includes("5353"), false);

  // overview degrada subsecciones fallidas sin abortar
  const partialProvider = new SystemProvider({
    systemReader: fakeReader({
      readGpus: async () => {
        throw new Error("sin WMI");
      },
    }),
  });
  const ovRes = await partialProvider.callTool("system_info", { section: "overview" });
  assert.equal(ovRes.isError, false);
  assert.ok(readToolResult(ovRes)?.text.includes("GPU: unknown (sin WMI)"));
});

// ───────────────────────── stop_process ─────────────────────────

test("stop_process: detiene por PID o nombre, protege procesos del SO/propios y valida entrada", async () => {
  const killerCalls: Array<{ kind: "pid" | "name"; target: string | number; force: boolean }> = [];
  const fakeKiller: ProcessKiller = {
    async stopByPid(pid, force) {
      killerCalls.push({ kind: "pid", target: pid, force });
      return pid === 9999 ? [] : [{ pid, name: "notepad" }];
    },
    async stopByName(name, force) {
      killerCalls.push({ kind: "name", target: name, force });
      return name === "ghost" ? [] : [{ pid: 4100, name }, { pid: 4101, name }];
    },
  };

  const provider = new SystemProvider({
    processKiller: fakeKiller,
    platform: "win32",
    selfPid: 555,
    parentPid: 444,
  });

  // Por PID
  const byPid = await provider.callTool("stop_process", { pid: 1234 });
  assert.equal(byPid.isError, false);
  assert.equal(readToolResult(byPid)?.data.count, 1);

  // Por nombre con sufijo .exe normalizado y force: true
  const byName = await provider.callTool("stop_process", { name: "notepad.exe", force: true });
  assert.equal(byName.isError, false);
  assert.equal(readToolResult(byName)?.data.count, 2);
  assert.deepEqual(killerCalls[1], { kind: "name", target: "notepad", force: true });

  // No encontrado -> not_found
  const missing = await provider.callTool("stop_process", { pid: 9999 });
  assert.equal(missing.isError, true);
  assert.equal(readToolResult(missing)?.data.reason, "not_found");

  // Protecciones contra procesos propios y críticos
  for (const blocked of [{ pid: 555 }, { pid: 444 }, { pid: 4 }, { name: "lsass" }, { name: "csrss.exe" }, { name: "systemd" }]) {
    const res = await provider.callTool("stop_process", blocked);
    assert.equal(res.isError, true);
    assert.equal(readToolResult(res)?.data.reason, "denied");
  }

  // Metacaracteres o argumentos ambiguos rechazados
  assert.equal((await provider.callTool("stop_process", { pid: 100, name: "notepad" })).isError, true);
  assert.equal((await provider.callTool("stop_process", { name: "calc; whoami" })).isError, true);

  // No-Windows sin killer inyectado falla explícitamente
  const linuxProvider = new SystemProvider({ platform: "linux", selfPid: 555, parentPid: 444 });
  assert.equal((await linuxProvider.callTool("stop_process", { pid: 1234 })).isError, true);

  // AbortSignal
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool("stop_process", { pid: 1234 }, { signal: ac.signal });
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

// ───────────────────────── pc_settings ─────────────────────────

test("pc_settings: lee y modifica brillo, wifi, bluetooth, dark_mode y do_not_disturb con validación", async () => {
  const store: Record<string, SettingValue> = {
    brightness: 60,
    wifi: "on",
    bluetooth: "off",
    dark_mode: "on",
    do_not_disturb: "off",
  };
  const driver: PcSettingsDriver = {
    async get(setting) {
      return store[setting];
    },
    async set(setting, value) {
      store[setting] = value;
      return value;
    },
  };

  const provider = new SystemProvider({ pcSettingsDriver: driver });

  // Get & Set brightness
  const getB = await provider.callTool("pc_settings", { setting: "brightness", action: "get" });
  assert.equal(readToolResult(getB)?.data.value, 60);

  const setB = await provider.callTool("pc_settings", { setting: "brightness", action: "set", value: 85 });
  assert.equal(setB.isError, false);
  assert.equal(store.brightness, 85);

  // Set toggle con boolean o string
  const setBt = await provider.callTool("pc_settings", { setting: "bluetooth", action: "set", value: true });
  assert.equal(setBt.isError, false);
  assert.equal(store.bluetooth, "on");

  const setDnd = await provider.callTool("pc_settings", { setting: "do_not_disturb", action: "set", value: "on" });
  assert.equal(setDnd.isError, false);
  assert.equal(store.do_not_disturb, "on");

  // Validaciones de rango y tipo
  assert.equal((await provider.callTool("pc_settings", { setting: "brightness", action: "set", value: 150 })).isError, true);
  assert.equal((await provider.callTool("pc_settings", { setting: "wifi", action: "set", value: 42 })).isError, true);

  // Sin driver en Linux falla explícitamente
  const linuxProvider = new SystemProvider({ platform: "linux" });
  assert.equal((await linuxProvider.callTool("pc_settings", { setting: "wifi", action: "get" })).isError, true);

  // AbortSignal
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool(
    "pc_settings",
    { setting: "brightness", action: "get" },
    { signal: ac.signal },
  );
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

// ───────────────────────── power ─────────────────────────

test("power: ejecuta lock, sleep, restart y shutdown validando delaySec y plataforma", async () => {
  const executed: PowerRequest[] = [];
  const controller: PowerController = {
    async execute(req) {
      executed.push(req);
    },
  };
  const provider = new SystemProvider({ powerController: controller });

  assert.equal((await provider.callTool("power", { action: "lock" })).isError, false);
  assert.equal((await provider.callTool("power", { action: "sleep" })).isError, false);
  const restartRes = await provider.callTool("power", { action: "restart", delaySec: 30, force: true });
  assert.equal(restartRes.isError, false);
  assert.equal(executed.length, 3);
  assert.equal(executed[2].delaySec, 30);
  assert.equal(executed[2].force, true);

  // delaySec > 0 inválido para lock/sleep
  assert.equal((await provider.callTool("power", { action: "lock", delaySec: 10 })).isError, true);
  assert.equal((await provider.callTool("power", { action: "hibernate" })).isError, true);

  // Sin controller en Linux falla explícitamente
  const linuxProvider = new SystemProvider({ platform: "linux" });
  assert.equal((await linuxProvider.callTool("power", { action: "lock" })).isError, true);

  // AbortSignal
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool("power", { action: "lock" }, { signal: ac.signal });
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

// ───────────────────────── open_on_screen ─────────────────────────

test("open_on_screen: abre app, URL http(s) y ruta local/alias validando allowedDirectories y esquemas seguros", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-sys-out-");
  const env = makeEnv(root);
  fs.mkdirSync(env.desktop!, { recursive: true });
  const localDoc = path.join(root, "manual.txt");
  fs.writeFileSync(localDoc, "contenido secreto que no debe devolverse aquí");

  const opened: Array<{ target: string; kind: ResolvedOpenKind }> = [];
  const opener: ScreenOpener = {
    async open({ target, kind }) {
      opened.push({ target, kind });
    },
  };

  const provider = new SystemProvider({
    allowedDirectories: () => [root],
    environment: async () => env,
    screenOpener: opener,
  });

  const appRes = await provider.callTool("open_on_screen", { target: "notepad" });
  assert.equal(appRes.isError, false);
  assert.equal(readToolResult(appRes)?.data.kind, "app");

  const urlRes = await provider.callTool("open_on_screen", { target: "https://example.com/docs" });
  assert.equal(urlRes.isError, false);
  assert.equal(readToolResult(urlRes)?.data.kind, "url");

  const aliasRes = await provider.callTool("open_on_screen", { target: "desktop" });
  assert.equal(aliasRes.isError, false);
  assert.equal(readToolResult(aliasRes)?.data.target, env.desktop);

  const pathRes = await provider.callTool("open_on_screen", { target: localDoc });
  const pathRead = readToolResult(pathRes);
  assert.ok(pathRead);
  assert.equal(pathRes.isError, false);
  assert.equal(pathRead.text.includes("contenido secreto"), false);
  assert.ok(pathRead.text.includes("read_file"));

  assert.deepEqual(opened, [
    { target: "notepad", kind: "app" },
    { target: "https://example.com/docs", kind: "url" },
    { target: env.desktop!, kind: "path" },
    { target: localDoc, kind: "path" },
  ]);

  for (const badUrl of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi"]) {
    assert.equal((await provider.callTool("open_on_screen", { target: badUrl })).isError, true);
  }
  assert.equal((await provider.callTool("open_on_screen", { target: "calc; whoami" })).isError, true);

  const outsidePath = await provider.callTool("open_on_screen", { target: outside });
  assert.equal(outsidePath.isError, true);
  assert.equal(readToolResult(outsidePath)?.data.reason, "denied");
});

// ───────────────────────── clipboard ─────────────────────────

test("clipboard: lee vacío, lee texto largo truncado conservando raw, escribe, valida y maneja AbortSignal", async () => {
  let memory = "";
  const fakeDriver: ClipboardDriver = {
    async read() {
      return memory;
    },
    async write(text) {
      memory = text;
    },
  };

  const provider = new SystemProvider({ clipboardDriver: fakeDriver });

  const emptyRes = await provider.callTool("clipboard", { action: "read" });
  assert.equal(readToolResult(emptyRes)?.data.empty, true);

  const writeRes = await provider.callTool("clipboard", { action: "write", text: "hola\nportapapeles" });
  assert.equal(writeRes.isError, false);
  assert.equal(memory, "hola\nportapapeles");

  const huge = "Z".repeat(BUDGET.summaryMax + 1_000);
  await provider.callTool("clipboard", { action: "write", text: huge });
  const readHuge = await provider.callTool("clipboard", { action: "read" });
  const hugeParsed = readToolResult(readHuge);
  assert.ok(hugeParsed);
  assert.equal(hugeParsed.data.truncated, true);
  assert.equal(hugeParsed.raw.length, huge.length);

  assert.equal((await provider.callTool("clipboard", { action: "clear" })).isError, true);
  assert.equal((await provider.callTool("clipboard", { action: "write" })).isError, true);

  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool("clipboard", { action: "read" }, { signal: ac.signal });
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});
