/**
 * El grupo `system` de punta a punta: el motor real (`runTask`) con `SystemProvider` real y drivers falsos (nada toca la PC), y dobles solo para los modelos.
 * Comprueba la aprobación por niveles de cada tool: lo verde corre solo, lo amarillo pide confirmación sin modo automático, lo rojo siempre la pide.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { IMCPServer } from "../src/core/mcp/types.ts";
import {
  SystemProvider,
  type ClipboardDriver,
  type PcSettingsDriver,
  type PowerController,
  type PowerRequest,
  type ProcessKiller,
  type ScreenOpener,
  type SystemReader,
} from "../src/tools/system/systemProvider.ts";
import { runNative, type NativeOptions } from "./helpers/native_flow.ts";

interface Fakes {
  readonly clipboard: string[];
  clipboardText: string;
  readonly power: PowerRequest[];
  readonly killed: string[];
  readonly opened: { target: string; kind: string }[];
  readonly settings: Record<string, unknown>;
}

function build(root: string): { fakes: Fakes; providers: Record<string, IMCPServer> } {
  const fakes: Fakes = { clipboard: [], clipboardText: "texto copiado", power: [], killed: [], opened: [], settings: { brightness: 60 } };
  const clipboardDriver: ClipboardDriver = {
    async read() {
      return fakes.clipboardText;
    },
    async write(text) {
      fakes.clipboard.push(text);
      fakes.clipboardText = text;
    },
  };
  const powerController: PowerController = {
    async execute(req) {
      fakes.power.push(req);
    },
  };
  const processKiller: ProcessKiller = {
    async stopByPid(pid) {
      fakes.killed.push(`pid:${pid}`);
      return [{ pid, name: "notepad" }];
    },
    async stopByName(name) {
      fakes.killed.push(`name:${name}`);
      return [{ pid: 4100, name }];
    },
  };
  const screenOpener: ScreenOpener = {
    async open({ target, kind }) {
      fakes.opened.push({ target, kind });
    },
  };
  const pcSettingsDriver: PcSettingsDriver = {
    async get(setting) {
      return fakes.settings[setting] as never;
    },
    async set(setting, value) {
      fakes.settings[setting] = value;
      return value;
    },
  };
  const systemReader: Partial<SystemReader> = {
    readDateTime: () => ({ iso: "2026-11-20T16:00:00.000Z", localDateTime: "2026-11-20 13:00:00", timeZone: "America/Argentina/Buenos_Aires", utcOffsetMinutes: -180, unixMs: 1_795_190_400_000 }),
  };
  const provider = new SystemProvider({
    environment: async () => ({ platform: "windows", home: root }),
    platform: "win32",
    clipboardDriver,
    powerController,
    processKiller,
    screenOpener,
    pcSettingsDriver,
    systemReader,
    selfPid: 1,
    parentPid: 2,
  });
  return { fakes, providers: { jarvis_system: provider as unknown as IMCPServer } };
}

async function run(tool: string, args: Record<string, unknown>, options: NativeOptions = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-system-flow-")));
  try {
    const { fakes, providers } = build(root);
    const outcome = await runNative(providers, root, "system", tool, args, options);
    return { outcome, fakes };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("system_info: una lectura se despacha sin confirmación y la tarea se completa", async () => {
  const { outcome } = await run("system_info", { section: "datetime" });
  assert.equal(outcome.state, "completed", JSON.stringify(outcome));
  assert.equal(outcome.approvals, 0);
  assert.deepEqual(outcome.dispatched, ["system_info"]);
});

test("portapapeles: leer es verde (sin confirmación); escribir es amarillo (pide al usuario sin modo automático, y no con él)", async () => {
  const read = await run("clipboard", { action: "read" });
  assert.equal(read.outcome.state, "completed", JSON.stringify(read.outcome));
  assert.equal(read.outcome.approvals, 0);
  assert.equal(read.fakes.clipboard.length, 0);

  const refused = await run("clipboard", { action: "write", text: "nuevo" }, { approve: false });
  assert.equal(refused.outcome.approvals >= 1, true, "amarillo sin autoMode pide al usuario");
  assert.deepEqual(refused.fakes.clipboard, [], "rechazada: no se escribe");

  const accepted = await run("clipboard", { action: "write", text: "nuevo" }, { approve: true });
  assert.equal(accepted.outcome.state, "completed", JSON.stringify(accepted.outcome));
  assert.deepEqual(accepted.fakes.clipboard, ["nuevo"]);

  const auto = await run("clipboard", { action: "write", text: "auto" }, { autoMode: true });
  assert.equal(auto.outcome.approvals, 0, "con autoMode el amarillo no pide al usuario (lo revisa Decisión 3)");
  assert.deepEqual(auto.fakes.clipboard, ["auto"]);
});

test("energía: apagar y reiniciar son «blocked» como su comando: con niveles o modo automático se rechazan; sin ellos se le pregunta al usuario", async () => {
  for (const action of ["shutdown", "restart"]) {
    for (const options of [{ tiers: true }, { tiers: false, autoMode: true }] as const) {
      const rejected = await run("power", { action }, { ...options, approve: true });
      assert.equal(rejected.outcome.approvals, 0, `${action}: no se le pregunta al usuario, se rechaza`);
      assert.deepEqual(rejected.fakes.power, [], `${action}: no se ejecuta`);
      assert.equal(rejected.outcome.calls[0]?.status, "tool_rejected", action);
    }
    const asked = await run("power", { action }, { tiers: false, autoMode: false, approve: false });
    assert.equal(asked.outcome.approvals >= 1, true, `${action}: sin niveles ni modo automático se pregunta`);
    assert.deepEqual(asked.fakes.power, []);
  }
  const accepted = await run("power", { action: "restart", delaySec: 30 }, { tiers: false, autoMode: false, approve: true });
  assert.equal(accepted.fakes.power.length, 1, "con la confirmación del usuario, sin niveles, se ejecuta");
  assert.equal(accepted.fakes.power[0].action, "restart");
  const lock = await run("power", { action: "lock" }, { approve: true });
  assert.equal(lock.outcome.approvals >= 1, true, "bloquear es amarillo: pide al usuario sin modo automático");
  assert.equal(lock.fakes.power[0]?.action, "lock");
});

test("procesos: cortar un proceso es rojo; aprobado, el driver recibe el nombre o el pid", async () => {
  const refused = await run("stop_process", { name: "notepad" }, { approve: false });
  assert.equal(refused.outcome.approvals >= 1, true);
  assert.deepEqual(refused.fakes.killed, []);
  const byName = await run("stop_process", { name: "notepad" }, { approve: true });
  assert.equal(byName.outcome.state, "completed", JSON.stringify(byName.outcome));
  assert.deepEqual(byName.fakes.killed, ["name:notepad"]);
  const byPid = await run("stop_process", { pid: 4100 }, { approve: true });
  assert.deepEqual(byPid.fakes.killed, ["pid:4100"]);
});

test("abrir en pantalla: una URL es verde y se abre sola; una aplicación es amarilla y pide confirmación", async () => {
  const url = await run("open_on_screen", { target: "https://example.com/pagina" });
  assert.equal(url.outcome.state, "completed", JSON.stringify(url.outcome));
  assert.equal(url.outcome.approvals, 0);
  assert.deepEqual(url.fakes.opened, [{ target: "https://example.com/pagina", kind: "url" }]);

  const app = await run("open_on_screen", { target: "notepad" }, { approve: false });
  assert.equal(app.outcome.approvals >= 1, true);
  assert.deepEqual(app.fakes.opened, [], "rechazada: no se abre");
  const accepted = await run("open_on_screen", { target: "notepad" }, { approve: true });
  assert.equal(accepted.fakes.opened[0]?.kind, "app");
});

test("ajustes de la PC: leer es verde; cambiar es amarillo y queda guardado al aprobar", async () => {
  const get = await run("pc_settings", { setting: "brightness", action: "get" });
  assert.equal(get.outcome.state, "completed", JSON.stringify(get.outcome));
  assert.equal(get.outcome.approvals, 0);
  const set = await run("pc_settings", { setting: "brightness", action: "set", value: 30 }, { approve: true });
  assert.equal(set.outcome.approvals >= 1, true);
  assert.equal(set.fakes.settings.brightness, 30);
  const refused = await run("pc_settings", { setting: "brightness", action: "set", value: 10 }, { approve: false });
  assert.equal(refused.fakes.settings.brightness, 60, "rechazado: el ajuste no cambia");
});
