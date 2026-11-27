/**
 * `jarvis_multimedia`: herramienta `play_media`.
 *
 * Busca y reproduce música o video en YouTube / YouTube Music / Spotify:
 * - Acepta una búsqueda en texto o un enlace directo `https://...` de YouTube / Spotify o URI `spotify:...`.
 * - Para búsquedas en YouTube / YouTube Music, resuelve el primer resultado orgánico (`watch?v=<id>`)
 *   para reproducirlo directamente en lugar de abrir solo la página de búsqueda (con fallback a búsqueda).
 * - En Windows, si ya hay una pestaña de YouTube / YouTube Music abierta en el navegador, la reutiliza
 *   cambiando de tema en la misma pestaña sin abrir una ventana/pestaña nueva.
 * - Valida que cualquier URL externa use exclusivamente hosts permitidos de YouTube/Spotify cuando
 *   es enlace de streaming (o rechaza esquemas inseguros `javascript:`, `file:`, `data:`).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { effectiveTimeoutMs } from "../../core/tools/filePaths.ts";
import { cancelledResult, toolResult, toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_PLAY_MEDIA_TIMEOUT_MS = 10_000;
const YOUTUBE_RESOLVE_TIMEOUT_MS = 3_500;
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
  // biome-ignore lint/suspicious/noConfusingVoidType: un driver sin nada que informar no devuelve valor.
  play(req: PlayMediaRequest): Promise<{ readonly title?: string; readonly launchedTarget?: string; readonly reusedTab?: boolean } | void>;
}

export type YouTubeVideoResolver = (query: string, signal?: AbortSignal) => Promise<string | null>;

interface PlayMediaDeps {
  readonly driver?: PlayMediaDriver;
  readonly youtubeResolver?: YouTubeVideoResolver;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
}

const YOUTUBE_SEARCH_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const VIDEO_RENDERER_RE = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/;

/** Extrae el primer `videoId` orgánico de resultados de YouTube (`ytInitialData`). */
export function extractYouTubeVideoId(html: string): string | null {
  const match = VIDEO_RENDERER_RE.exec(html);
  return match?.[1] ?? null;
}

export async function resolveYouTubeVideoId(
  query: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YOUTUBE_RESOLVE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetchFn(url, { headers: YOUTUBE_SEARCH_HEADERS, signal: controller.signal });
    if (!res.ok) return null;
    const html = await res.text();
    return extractYouTubeVideoId(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const BROWSER_NAV_CSHARP = [
  "using System;",
  "using System.Collections.Generic;",
  "using System.Diagnostics;",
  "using System.Runtime.InteropServices;",
  "using System.Text;",
  "using System.Threading;",
  "using System.Windows.Automation;",
  "using System.Windows.Forms;",
  "public static class JarvisBrowserNav {",
  "  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);",
  '  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);',
  '  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);',
  '  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);',
  '  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
  '  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);',
  '  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
  '  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);',
  '  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
  '  private static readonly string[] Browsers = { "chrome", "msedge", "brave", "firefox", "opera", "vivaldi" };',
  "  private static string ReadTitle(IntPtr hWnd) {",
  "    var sb = new StringBuilder(512);",
  "    GetWindowText(hWnd, sb, sb.Capacity);",
  "    return sb.ToString();",
  "  }",
  "  private static List<IntPtr> GetBrowserWindows() {",
  "    var pids = new HashSet<uint>();",
  "    foreach (var name in Browsers) {",
  "      foreach (var p in Process.GetProcessesByName(name)) { pids.Add((uint)p.Id); }",
  "    }",
  "    var list = new List<IntPtr>();",
  "    if (pids.Count == 0) return list;",
  "    EnumWindows((hWnd, _) => {",
  "      if (!IsWindowVisible(hWnd)) return true;",
  "      uint pid; GetWindowThreadProcessId(hWnd, out pid);",
  "      if (pids.Contains(pid)) list.Add(hWnd);",
  "      return true;",
  "    }, IntPtr.Zero);",
  "    return list;",
  "  }",
  "  private static void FocusWindow(IntPtr hWnd) {",
  "    if (IsIconic(hWnd)) ShowWindow(hWnd, 9);",
  "    IntPtr fg = GetForegroundWindow();",
  "    uint dummy;",
  "    uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;",
  "    uint curThread = GetCurrentThreadId();",
  "    if (fgThread != 0 && fgThread != curThread) AttachThreadInput(curThread, fgThread, true);",
  "    SetForegroundWindow(hWnd);",
  "    if (fgThread != 0 && fgThread != curThread) AttachThreadInput(curThread, fgThread, false);",
  "  }",
  "  private static AutomationElement FindYouTubeTab(AutomationElement root) {",
  "    var tabs = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem));",
  "    foreach (AutomationElement tab in tabs) {",
  "      string name = tab.Current.Name ?? string.Empty;",
  '      if (name.IndexOf("YouTube", StringComparison.OrdinalIgnoreCase) >= 0) return tab;',
  "    }",
  "    return null;",
  "  }",
  "  private static AutomationElement FindAddressBar(AutomationElement root) {",
  "    var edits = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));",
  "    foreach (AutomationElement edit in edits) {",
  "      if (!edit.Current.IsKeyboardFocusable) continue;",
  "      object pat;",
  "      if (!edit.TryGetCurrentPattern(ValuePattern.Pattern, out pat)) continue;",
  "      var vp = (ValuePattern)pat;",
  "      string val = vp.Current.Value ?? string.Empty;",
  '      if (val.IndexOf("youtube.com", StringComparison.OrdinalIgnoreCase) >= 0 || val.IndexOf("youtu.be", StringComparison.OrdinalIgnoreCase) >= 0) return edit;',
  "    }",
  "    return null;",
  "  }",
  "  public static bool TryNavigateYouTube(string targetUrl) {",
  "    var windows = GetBrowserWindows();",
  "    if (windows.Count == 0) return false;",
  "    IntPtr targetHwnd = IntPtr.Zero;",
  "    foreach (var h in windows) {",
  '      if (ReadTitle(h).IndexOf("YouTube", StringComparison.OrdinalIgnoreCase) >= 0) { targetHwnd = h; break; }',
  "    }",
  "    if (targetHwnd == IntPtr.Zero) {",
  "      foreach (var h in windows) {",
  "        try {",
  "          var root = AutomationElement.FromHandle(h);",
  "          var tab = FindYouTubeTab(root);",
  "          if (tab != null) {",
  "            object sel;",
  "            if (tab.TryGetCurrentPattern(SelectionItemPattern.Pattern, out sel)) {",
  "              ((SelectionItemPattern)sel).Select();",
  "              Thread.Sleep(120);",
  "              targetHwnd = h;",
  "              break;",
  "            }",
  "          }",
  "        } catch {}",
  "      }",
  "    }",
  "    if (targetHwnd == IntPtr.Zero) return false;",
  "    try {",
  "      FocusWindow(targetHwnd);",
  "      Thread.Sleep(80);",
  "      var root = AutomationElement.FromHandle(targetHwnd);",
  "      var bar = FindAddressBar(root);",
  "      if (bar == null) return false;",
  "      var vp = (ValuePattern)bar.GetCurrentPattern(ValuePattern.Pattern);",
  "      vp.SetValue(targetUrl);",
  "      bar.SetFocus();",
  "      Thread.Sleep(50);",
  '      SendKeys.SendWait("{ENTER}");',
  "      return true;",
  "    } catch { return false; }",
  "  }",
  "}",
].join(" ");

const PS_LAUNCH_OR_REUSE = [
  "$target = $env:JARVIS_MEDIA_TARGET",
  "if ($env:JARVIS_MEDIA_REUSE -eq '1') {",
  "  try {",
  "    Add-Type -AssemblyName UIAutomationClient",
  "    Add-Type -AssemblyName UIAutomationTypes",
  "    Add-Type -AssemblyName System.Windows.Forms",
  `    if (-not ('JarvisBrowserNav' -as [type])) { Add-Type -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,System.Windows.Forms -TypeDefinition '${BROWSER_NAV_CSHARP}' }`,
  "    if ([JarvisBrowserNav]::TryNavigateYouTube($target)) { Write-Output 'reused'; exit 0 }",
  "  } catch {}",
  "}",
  "Start-Process -FilePath $target",
  "Write-Output 'opened'",
].join("; ");

function createDefaultPlayMediaDriver(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_PLAY_MEDIA_TIMEOUT_MS,
): PlayMediaDriver {
  return {
    async play(req: PlayMediaRequest) {
      if (platform !== "win32") {
        throw new Error(`Playing media requires Windows (current platform: ${platform}).`);
      }
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", PS_LAUNCH_OR_REUSE],
        {
          timeout: timeoutMs,
          windowsHide: true,
          signal: req.signal,
          env: {
            ...process.env,
            JARVIS_MEDIA_TARGET: req.launchTarget,
            JARVIS_MEDIA_REUSE: req.platform === "youtube" ? "1" : "0",
          },
        },
      );
      return { reusedTab: stdout.trim() === "reused" };
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
    platformPref !== "auto" ? platformPref : "youtube";

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
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
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

  let launchTarget = target.launchTarget;
  let resolvedDirect = target.isDirectUri;
  const effectivePlatform = deps.platform ?? process.platform;
  const resolver = deps.youtubeResolver ?? (!deps.driver && effectivePlatform === "win32" ? resolveYouTubeVideoId : undefined);
  if (target.platform === "youtube" && !target.isDirectUri && resolver) {
    const videoId = await resolver(query, options.signal);
    if (options.signal?.aborted) return cancelledResult();
    if (videoId) {
      const host = mediaType === "music" ? "music.youtube.com" : "www.youtube.com";
      launchTarget = `https://${host}/watch?v=${videoId}`;
      resolvedDirect = true;
    }
  }

  const timeoutMs = effectiveTimeoutMs(deps.defaultTimeoutMs ?? DEFAULT_PLAY_MEDIA_TIMEOUT_MS, options.timeoutMs);
  const driver = deps.driver ?? createDefaultPlayMediaDriver(deps.platform ?? process.platform, timeoutMs);

  try {
    const out = await driver.play({
      query,
      platform: target.platform,
      mediaType,
      launchTarget,
      isDirectUri: resolvedDirect,
      signal: options.signal,
    });
    if (options.signal?.aborted) return cancelledResult();

    const launched = out?.launchedTarget ?? launchTarget;
    const label = out?.title ?? query;
    const reusedTab = out?.reusedTab === true;
    const verb = reusedTab ? `switching ${target.platform} tab to` : `opening ${target.platform}`;
    const text = `status: ok · ${verb} (${mediaType}) for '${label}' -> ${launched}`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        query,
        platform: target.platform,
        mediaType,
        launchTarget: launched,
        isDirectUri: resolvedDirect,
        reusedTab,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Could not launch media: ${errorMessage(error)}`);
  }
}
