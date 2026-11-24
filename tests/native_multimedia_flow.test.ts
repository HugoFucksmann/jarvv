/**
 * El grupo `multimedia` de punta a punta: el motor real con `MultimediaProvider` real y drivers falsos (no se abre ningún reproductor). Reproducir y controlar la
 * reproducción son verdes: corren solas con los niveles encendidos; con los niveles apagados piden confirmación como cualquier escritura.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { IMCPServer } from "../src/core/mcp/types.ts";
import { MultimediaProvider, type MediaAction, type MediaControlDriver, type PlayMediaDriver, type PlayMediaRequest } from "../src/tools/multimedia/multimediaProvider.ts";
import { runNative, type NativeOptions } from "./helpers/native_flow.ts";

async function run(tool: string, args: Record<string, unknown>, options: NativeOptions = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-media-flow-")));
  const played: PlayMediaRequest[] = [];
  const controlled: MediaAction[] = [];
  const playDriver: PlayMediaDriver = {
    async play(req) {
      played.push(req);
    },
  };
  const controlDriver: MediaControlDriver = {
    async execute({ action }) {
      controlled.push(action);
      return action === "now_playing" ? { nowPlaying: { active: true, title: "Time", artist: "Pink Floyd", sourceApp: "Spotify.exe", playbackStatus: "Playing" } } : {};
    },
  };
  try {
    const provider = new MultimediaProvider({ playDriver, controlDriver }) as unknown as IMCPServer;
    const outcome = await runNative({ jarvis_multimedia: provider }, root, "multimedia", tool, args, options);
    return { outcome, played, controlled };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("play_media: es verde, se despacha sin confirmación y el driver recibe la búsqueda", async () => {
  const { outcome, played } = await run("play_media", { query: "Pink Floyd Time", platform: "youtube" });
  assert.equal(outcome.state, "completed", JSON.stringify(outcome));
  assert.equal(outcome.approvals, 0);
  assert.equal(played.length, 1);
  assert.equal(played[0].platform, "youtube");
});

test("media_control: pausar, subir el volumen y ver qué suena corren sin confirmación", async () => {
  for (const args of [{ action: "pause" }, { action: "volume_up" }, { action: "now_playing" }] as const) {
    const { outcome, controlled } = await run("media_control", { ...args });
    assert.equal(outcome.state, "completed", JSON.stringify(outcome));
    assert.equal(outcome.approvals, 0, args.action);
    assert.deepEqual(controlled, [args.action]);
  }
});

test("multimedia: reproducir es verde, no pide aprobación aun sin modo automático y reproduce", async () => {
  const out = await run("play_media", { query: "jazz" }, { autoMode: false, approve: false });
  assert.equal(out.outcome.approvals, 0);
  assert.equal(out.played.length, 1);
});

test("play_media: un esquema peligroso se rechaza dentro de la herramienta y la tarea no cuenta una reproducción", async () => {
  const { outcome, played } = await run("play_media", { query: "javascript:alert(1)" });
  assert.deepEqual(played, []);
  assert.notEqual(outcome.calls[0]?.status, "ok");
});
