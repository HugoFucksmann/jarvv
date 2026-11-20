/**
 * `jarvis_multimedia`: herramienta `play_media`.
 *
 * Busca o abre música o video en YouTube / YouTube Music / Spotify:
 * - Acepta una búsqueda en texto o un enlace directo `https://...` de YouTube / Spotify o URI `spotify:...`.
 * - Valida que cualquier URL externa use exclusivamente hosts permitidos de YouTube/Spotify cuando
 *   es enlace de streaming (o rechaza esquemas inseguros `javascript:`, `file:`, `data:`).
 * - Usa `PlayMediaDriver` inyectable; por defecto en Windows abre vía `Start-Process` pasando
 *   el destino por variable de entorno `$env:JARVIS_MEDIA_TARGET` (sin interpolación en PowerShell).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_PLAY_MEDIA_TIMEOUT_MS = 8_000;
export const MEDIA_PLATFORMS = ["auto", "youtube", "spotify"] as const;
export type MediaPlatform = (typeof MEDIA_PLATFORMS)[number];

export const MEDIA_TYPES = ["auto", "music", "video"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface PlayMediaRequest {
  readonly query: string;
  readonly platform: Exclude<MediaPlatform, "auto">;
  readonly mediaType: MediaType;
  readonly launchTarget: string;
  readonly isDirectUri: boolean;
  readonly signal?: AbortSignal;
}

export interface PlayMediaDriver {
  play(req: PlayMediaRequest): Promise<{ readonly title?: string; readonly launchedTarget?: string } | void>;
}

export interface PlayMediaDeps {
  readonly driver?: PlayMediaDriver;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

const PS_LAUNCH_TARGET = "Start-Process -FilePath $env:JARVIS_MEDIA_TARGET";

export function createDefaultPlayMediaDriver(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_PLAY_MEDIA_TIMEOUT_MS,
): PlayMediaDriver {
  return {
    async play(req: PlayMediaRequest): Promise<void> {
      if (platform !== "win32") {
        throw new Error(`Playing media requires Windows (current platform: ${platform}).`);
      }
      await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_LAUNCH_TARGET], {
        timeout: timeoutMs,
        windowsHide: true,
        signal: req.signal,
        env: { ...process.env, JARVIS_MEDIA_TARGET: req.launchTarget },
      });
    },
  };
}

const SPOTIFY_URI_RE = /^spotify:(track|album|artist|playlist|show|episode):[A-Za-z0-9]+$/;

function isYouTubeHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "youtube.com" || h === "www.youtube.com" || h === "m.youtube.com" || h === "music.youtube.com" || h === "youtu.be";
}

function isSpotifyHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "open.spotify.com" || h === "play.spotify.com";
}

function buildTarget(
  query: string,
  platformPref: MediaPlatform,
  mediaType: MediaType,
):
  | { readonly ok: true; readonly platform: Exclude<MediaPlatform, "auto">; readonly launchTarget: string; readonly isDirectUri: boolean }
  | { readonly ok: false; readonly message: string } {
  if (SPOTIFY_URI_RE.test(query)) {
    return { ok: true, platform: "spotify", launchTarget: query, isDirectUri: true };
  }

  // ¿Es una URL explícita?
  if (/^[a-z][a-z0-9+.-]*:/i.test(query)) {
    let parsed: URL;
    try {
      parsed = new URL(query);
    } catch {
      return { ok: false, message: `Invalid media URL: '${query}'.` };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, message: `Unsupported URL scheme '${parsed.protocol}' for play_media.` };
    }
    if (isYouTubeHost(parsed.hostname)) {
      return { ok: true, platform: "youtube", launchTarget: parsed.toString(), isDirectUri: true };
    }
    if (isSpotifyHost(parsed.hostname)) {
      return { ok: true, platform: "spotify", launchTarget: parsed.toString(), isDirectUri: true };
    }
    return {
      ok: false,
      message: `URL host '${parsed.hostname}' is not a supported YouTube or Spotify domain; use open_on_screen for arbitrary URLs.`,
    };
  }

  const chosenPlatform: Exclude<MediaPlatform, "auto"> =
    platformPref !== "auto" ? platformPref : mediaType === "music" ? "youtube" : "youtube";

  if (chosenPlatform === "spotify") {
    return {
      ok: true,
      platform: "spotify",
      launchTarget: `https://open.spotify.com/search/${encodeURIComponent(query)}`,
      isDirectUri: false,
    };
  }

  if (mediaType === "music") {
    return {
      ok: true,
      platform: "youtube",
      launchTarget: `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
      isDirectUri: false,
    };
  }

  return {
    ok: true,
    platform: "youtube",
    launchTarget: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    isDirectUri: false,
  };
}

export async function runPlayMedia(
  rawArgs: Record<string, unknown>,
  deps: PlayMediaDeps = {},
  options: { readonly signal?: AbortSignal } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.query !== "string" || rawArgs.query.trim() === "") {
    return fail("'query' is required: song/video name, YouTube URL, or Spotify link/URI.");
  }
  const query = rawArgs.query.trim();
  if (query.length > 300 || query.includes("\0")) {
    return fail("'query' is invalid or exceeds 300 characters.");
  }

  let platformPref: MediaPlatform = "auto";
  if (rawArgs.platform !== undefined && rawArgs.platform !== null) {
    if (typeof rawArgs.platform !== "string" || !(MEDIA_PLATFORMS as readonly string[]).includes(rawArgs.platform)) {
      return fail(`'platform' must be one of: ${MEDIA_PLATFORMS.join(", ")}.`);
    }
    platformPref = rawArgs.platform as MediaPlatform;
  }

  let mediaType: MediaType = "auto";
  if (rawArgs.mediaType !== undefined && rawArgs.mediaType !== null) {
    if (typeof rawArgs.mediaType !== "string" || !(MEDIA_TYPES as readonly string[]).includes(rawArgs.mediaType)) {
      return fail(`'mediaType' must be one of: ${MEDIA_TYPES.join(", ")}.`);
    }
    mediaType = rawArgs.mediaType as MediaType;
  }

  const target = buildTarget(query, platformPref, mediaType);
  if (!target.ok) return fail(target.message);

  const driver =
    deps.driver ??
    createDefaultPlayMediaDriver(deps.platform ?? process.platform, deps.defaultTimeoutMs ?? DEFAULT_PLAY_MEDIA_TIMEOUT_MS);

  try {
    const out = await driver.play({
      query,
      platform: target.platform,
      mediaType,
      launchTarget: target.launchTarget,
      isDirectUri: target.isDirectUri,
      signal: options.signal,
    });
    if (options.signal?.aborted) return cancelledResult();

    const launched = out?.launchedTarget ?? target.launchTarget;
    const label = out?.title ?? query;
    const text = `status: ok · opening ${target.platform} (${mediaType}) for '${label}' -> ${launched}`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        query,
        platform: target.platform,
        mediaType,
        launchTarget: launched,
        isDirectUri: target.isDirectUri,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Could not launch media: ${errorMessage(error)}`);
  }
}
