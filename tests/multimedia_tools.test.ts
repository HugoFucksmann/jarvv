/**
 * Pruebas unitarias de `jarvis_multimedia` (`play_media`, `media_control`):
 * - Drivers falsos inyectados (`PlayMediaDriver`, `MediaControlDriver`) sin abrir GUI ni cambiar audio real.
 * - Validación de URLs/URIs de YouTube y Spotify, bloqueo de esquemas peligrosos o hosts ajenos,
 *   transporte, seek, volumen 0..100, `now_playing`, fallo explícito en no-Windows y `AbortSignal`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { readToolResult } from "../src/core/tools/result.ts";
import {
  MultimediaProvider,
  type MediaAction,
  type MediaControlDriver,
  type PlayMediaDriver,
  type PlayMediaRequest,
} from "../src/tools/multimedia/multimediaProvider.ts";
import { extractYouTubeVideoId, resolveYouTubeVideoId } from "../src/tools/multimedia/playMedia.ts";

test("jarvis_multimedia: lista play_media y media_control y rechaza desconocidas", async () => {
  const provider = new MultimediaProvider();
  assert.equal(provider.name, "jarvis_multimedia");
  assert.equal(provider.isConnected(), true);
  const tools = await provider.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["play_media", "media_control"],
  );
  assert.equal((await provider.callTool("power", {})).isError, true);
});

test("play_media: resuelve búsquedas en YouTube/Spotify y enlaces directos, y rechaza esquemas/hosts no válidos", async () => {
  const launched: PlayMediaRequest[] = [];
  const fakeDriver: PlayMediaDriver = {
    async play(req) {
      launched.push(req);
    },
  };

  const provider = new MultimediaProvider({ playDriver: fakeDriver });

  // Búsqueda en YouTube Music
  const ytMusic = await provider.callTool("play_media", {
    query: "bohemian rhapsody",
    platform: "youtube",
    mediaType: "music",
  });
  const ytRead = readToolResult(ytMusic);
  assert.ok(ytRead);
  assert.equal(ytMusic.isError, false);
  assert.equal(ytRead.data.platform, "youtube");
  assert.equal(ytRead.data.launchTarget, "https://music.youtube.com/search?q=bohemian%20rhapsody");

  // Búsqueda en Spotify
  const spSearch = await provider.callTool("play_media", {
    query: "lofi beats",
    platform: "spotify",
  });
  assert.equal(spSearch.isError, false);
  assert.equal(readToolResult(spSearch)?.data.launchTarget, "https://open.spotify.com/search/lofi%20beats");

  // Spotify URI directo
  const spUri = await provider.callTool("play_media", { query: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" });
  assert.equal(spUri.isError, false);
  assert.equal(readToolResult(spUri)?.data.isDirectUri, true);
  assert.equal(readToolResult(spUri)?.data.platform, "spotify");

  // URL de YouTube directo
  const ytUrl = await provider.callTool("play_media", { query: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(ytUrl.isError, false);
  assert.equal(readToolResult(ytUrl)?.data.platform, "youtube");
  assert.equal(readToolResult(ytUrl)?.data.isDirectUri, true);
  assert.equal(launched.length, 4);

  // Rechaza esquemas inseguros y dominios ajenos
  for (const bad of ["javascript:alert(1)", "file:///C:/song.mp3", "https://evil.example.com/watch"]) {
    assert.equal((await provider.callTool("play_media", { query: bad })).isError, true);
  }

  // Sin driver en Linux falla explícitamente
  const linuxDefault = new MultimediaProvider({ platform: "linux" });
  assert.equal((await linuxDefault.callTool("play_media", { query: "jazz" })).isError, true);

  // AbortSignal
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool("play_media", { query: "jazz" }, { signal: ac.signal });
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

test("media_control: controla transporte, seek, volumen, silencio y now_playing", async () => {
  const actions: Array<{ action: MediaAction; seconds?: number; level?: number }> = [];
  let active = true;

  let volume = 30;
  let muted = false;

  const fakeControl: MediaControlDriver = {
    async execute({ action, seconds, level }) {
      actions.push({ action, seconds, level });
      if (action === "now_playing") {
        return {
          nowPlaying: active
            ? {
                active: true,
                title: "Time",
                artist: "Pink Floyd",
                album: "The Dark Side of the Moon",
                sourceApp: "Spotify.exe",
                playbackStatus: "Playing",
              }
            : { active: false },
        };
      }
      if (action === "set_volume") {
        volume = level ?? volume;
        return { volumeLevel: volume, muted };
      }
      if (action === "volume_up") {
        volume = Math.min(100, volume + 10);
        return { volumeLevel: volume, muted };
      }
      if (action === "volume_down") {
        volume = Math.max(0, volume - 10);
        return { volumeLevel: volume, muted };
      }
      if (action === "mute") {
        muted = true;
        return { volumeLevel: volume, muted };
      }
      if (action === "unmute") {
        muted = false;
        return { volumeLevel: volume, muted };
      }
      if (action === "toggle_mute") {
        muted = !muted;
        return { volumeLevel: volume, muted };
      }
      return {};
    },
  };

  const provider = new MultimediaProvider({ controlDriver: fakeControl });

  assert.equal((await provider.callTool("media_control", { action: "pause" })).isError, false);
  assert.equal((await provider.callTool("media_control", { action: "next" })).isError, false);

  // Seek con valor por defecto (10s) y explícito
  const seekDef = await provider.callTool("media_control", { action: "seek_forward" });
  assert.equal(readToolResult(seekDef)?.data.seconds, 10);

  const seekCustom = await provider.callTool("media_control", { action: "seek_backward", seconds: 30 });
  assert.equal(readToolResult(seekCustom)?.data.seconds, 30);

  // Volumen exacto y relativo
  const volRes = await provider.callTool("media_control", { action: "set_volume", level: 45 });
  assert.equal(volRes.isError, false);
  assert.equal(readToolResult(volRes)?.data.level, 45);

  const volUp = await provider.callTool("media_control", { action: "volume_up" });
  assert.equal(readToolResult(volUp)?.data.level, 55);

  const volDown = await provider.callTool("media_control", { action: "volume_down" });
  assert.equal(readToolResult(volDown)?.data.level, 45);

  // Mute / unmute idempotentes y toggle_mute
  const muteRes = await provider.callTool("media_control", { action: "mute" });
  assert.equal(readToolResult(muteRes)?.data.muted, true);
  const muteAgain = await provider.callTool("media_control", { action: "mute" });
  assert.equal(readToolResult(muteAgain)?.data.muted, true);
  const unmuteRes = await provider.callTool("media_control", { action: "unmute" });
  assert.equal(readToolResult(unmuteRes)?.data.muted, false);
  const toggleRes = await provider.callTool("media_control", { action: "toggle_mute" });
  assert.equal(readToolResult(toggleRes)?.data.muted, true);

  // now_playing activo e inactivo
  const npActive = await provider.callTool("media_control", { action: "now_playing" });
  assert.equal(readToolResult(npActive)?.data.active, true);
  assert.ok(readToolResult(npActive)?.text.includes("Time by Pink Floyd"));

  active = false;
  const npIdle = await provider.callTool("media_control", { action: "now_playing" });
  assert.equal(readToolResult(npIdle)?.data.active, false);

  // Validaciones
  assert.equal((await provider.callTool("media_control", { action: "set_volume", level: 120 })).isError, true);
  assert.equal((await provider.callTool("media_control", { action: "set_volume" })).isError, true);
  assert.equal((await provider.callTool("media_control", { action: "seek_forward", seconds: 0 })).isError, true);
  assert.equal((await provider.callTool("media_control", { action: "eject" })).isError, true);

  // Sin driver en Linux falla explícitamente
  const linuxDefault = new MultimediaProvider({ platform: "linux" });
  assert.equal((await linuxDefault.callTool("media_control", { action: "pause" })).isError, true);

  // AbortSignal
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool("media_control", { action: "play" }, { signal: ac.signal });
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

test("play_media: resuelve búsquedas de YouTube a watch?v=... y reporta reusedTab", async () => {
  assert.equal(extractYouTubeVideoId('{"videoRenderer":{"videoId":"fJ9rUzIMcZQ"}}'), "fJ9rUzIMcZQ");
  assert.equal(extractYouTubeVideoId("<html>no results</html>"), null);

  const resolvedId = await resolveYouTubeVideoId(
    "bohemian rhapsody",
    undefined,
    (async () =>
      new Response('{"videoRenderer":{"videoId":"fJ9rUzIMcZQ"}}', { status: 200 })) as unknown as typeof fetch,
  );
  assert.equal(resolvedId, "fJ9rUzIMcZQ");

  const failedId = await resolveYouTubeVideoId(
    "bohemian rhapsody",
    undefined,
    (async () => new Response("err", { status: 503 })) as unknown as typeof fetch,
  );
  assert.equal(failedId, null);

  const launched: PlayMediaRequest[] = [];
  let reuseNext = false;
  const provider = new MultimediaProvider({
    youtubeResolver: async (q) => (q === "unknown" ? null : "dQw4w9WgXcQ"),
    playDriver: {
      async play(req) {
        launched.push(req);
        return { reusedTab: reuseNext };
      },
    },
  });

  // Video en YouTube -> watch?v=...
  const vid = await provider.callTool("play_media", { query: "never gonna give you up" });
  const vidRead = readToolResult(vid);
  assert.equal(vid.isError, false);
  assert.equal(vidRead?.data.launchTarget, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(vidRead?.data.isDirectUri, true);
  assert.equal(vidRead?.data.reusedTab, false);

  // Música en YouTube Music reutilizando pestaña existente
  reuseNext = true;
  const mus = await provider.callTool("play_media", {
    query: "never gonna give you up",
    platform: "youtube",
    mediaType: "music",
  });
  const musRead = readToolResult(mus);
  assert.equal(mus.isError, false);
  assert.equal(musRead?.data.launchTarget, "https://music.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(musRead?.data.reusedTab, true);
  assert.ok(musRead?.text.includes("switching youtube tab"));

  // Fallback a búsqueda si resolver devuelve null
  const fb = await provider.callTool("play_media", { query: "unknown", platform: "youtube" });
  assert.equal(readToolResult(fb)?.data.launchTarget, "https://www.youtube.com/results?search_query=unknown");
  assert.equal(readToolResult(fb)?.data.isDirectUri, false);
  assert.equal(launched.length, 3);
});

test("media_control: volumen por porcentajes (volume_up/volume_down con level) y get_volume", async () => {
  let volume = 40;
  const provider = new MultimediaProvider({
    controlDriver: {
      async execute({ action, level }) {
        if (action === "volume_up") {
          volume = Math.min(100, volume + (level ?? 10));
          return { volumeLevel: volume, muted: false };
        }
        if (action === "volume_down") {
          volume = Math.max(0, volume - (level ?? 10));
          return { volumeLevel: volume, muted: false };
        }
        if (action === "get_volume") {
          return { volumeLevel: volume, muted: false };
        }
        return {};
      },
    },
  });

  const up15 = await provider.callTool("media_control", { action: "volume_up", level: 15 });
  assert.equal(up15.isError, false);
  assert.equal(readToolResult(up15)?.data.level, 55);
  assert.equal(readToolResult(up15)?.data.step, 15);

  const down5 = await provider.callTool("media_control", { action: "volume_down", level: 5 });
  assert.equal(down5.isError, false);
  assert.equal(readToolResult(down5)?.data.level, 50);
  assert.equal(readToolResult(down5)?.data.step, 5);

  const getVol = await provider.callTool("media_control", { action: "get_volume" });
  assert.equal(getVol.isError, false);
  assert.equal(readToolResult(getVol)?.data.level, 50);
  assert.equal(readToolResult(getVol)?.data.muted, false);

  // Validación de porcentaje inválido en volume_up/volume_down
  assert.equal((await provider.callTool("media_control", { action: "volume_up", level: 0 })).isError, true);
  assert.equal((await provider.callTool("media_control", { action: "volume_down", level: 101 })).isError, true);
  assert.equal((await provider.callTool("media_control", { action: "volume_up", level: 12.5 })).isError, true);
});
