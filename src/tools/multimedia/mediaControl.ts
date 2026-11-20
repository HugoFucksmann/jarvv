/**
 * `jarvis_multimedia`: herramienta `media_control`.
 *
 * Controla la reproducción y volumen del sistema:
 * - Transporte: `play`, `pause`, `toggle`, `next`, `previous`
 * - Desplazamiento: `seek_forward`, `seek_backward` (`seconds`, por defecto `10`)
 * - Volumen: `volume_up`, `volume_down`, `set_volume` (`level`: 0..100), `mute`, `unmute`, `toggle_mute`
 * - Consulta: `now_playing` (título, artista, álbum, estado, fuente)
 *
 * Usa `MediaControlDriver` inyectable para pruebas deterministas; en Windows emplea WinRT
 * `GlobalSystemMediaTransportControlsSessionManager` + interfaz CoreAudio/AppCommand sin shell
 * interpolada y limpiando subprocesos ante timeout o `AbortSignal`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { effectiveTimeoutMs } from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage, isRecord } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_MEDIA_CONTROL_TIMEOUT_MS = 8_000;
export const DEFAULT_SEEK_SECONDS = 10;
export const MAX_SEEK_SECONDS = 600;
export const DEFAULT_VOLUME_STEP = 10;

export const MEDIA_ACTIONS = [
  "play",
  "pause",
  "toggle",
  "next",
  "previous",
  "seek_forward",
  "seek_backward",
  "volume_up",
  "volume_down",
  "set_volume",
  "mute",
  "unmute",
  "toggle_mute",
  "now_playing",
] as const;
export type MediaAction = (typeof MEDIA_ACTIONS)[number];

export interface NowPlayingInfo {
  readonly active: boolean;
  readonly title?: string;
  readonly artist?: string;
  readonly album?: string;
  readonly sourceApp?: string;
  readonly playbackStatus?: string;
}

export interface MediaControlDriver {
  execute(
    params: {
      readonly action: MediaAction;
      readonly seconds?: number;
      readonly level?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ readonly nowPlaying?: NowPlayingInfo; readonly volumeLevel?: number; readonly muted?: boolean }>;
}

export interface MediaControlDeps {
  readonly driver?: MediaControlDriver;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

const PS_UTF8_PREFIX = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)";

const PS_MEDIA_SESSION_SCRIPT = [
  PS_UTF8_PREFIX,
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
  "function Await($op, $type) { $m = $asTaskGeneric.MakeGenericMethod($type); $t = $m.Invoke($null, @($op)); $t.Wait(); return $t.Result }",
  "[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]",
  "$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])",
  "$session = $mgr.GetCurrentSession()",
  "if ($null -eq $session) { [pscustomobject]@{ active = $false } | ConvertTo-Json -Compress; exit 0 }",
  "$act = $env:JARVIS_MEDIA_ACTION",
  "if ($act -eq 'play') { [void](Await ($session.TryPlayAsync()) ([bool])) }",
  "elseif ($act -eq 'pause') { [void](Await ($session.TryPauseAsync()) ([bool])) }",
  "elseif ($act -eq 'toggle') { [void](Await ($session.TryTogglePlayPauseAsync()) ([bool])) }",
  "elseif ($act -eq 'next') { [void](Await ($session.TrySkipNextAsync()) ([bool])) }",
  "elseif ($act -eq 'previous') { [void](Await ($session.TrySkipPreviousAsync()) ([bool])) }",
  "elseif ($act -eq 'seek_forward' -or $act -eq 'seek_backward') {",
  "  $tl = $session.GetTimelineProperties()",
  "  $delta = [TimeSpan]::FromSeconds([int]$env:JARVIS_MEDIA_SECONDS).Ticks",
  "  $pos = $tl.Position.Ticks + $(if ($act -eq 'seek_forward') { $delta } else { -$delta })",
  "  if ($pos -lt 0) { $pos = 0 }",
  "  [void](Await ($session.TryChangePlaybackPositionAsync([long]$pos)) ([bool]))",
  "}",
  "$props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])",
  "$pb = $session.GetPlaybackInfo()",
  "[pscustomobject]@{ active = $true; title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle; sourceApp = $session.SourceAppUserModelId; playbackStatus = $pb.PlaybackStatus.ToString() } | ConvertTo-Json -Compress",
].join("; ");

const CORE_AUDIO_CSHARP = [
  "using System;",
  "using System.Runtime.InteropServices;",
  '[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]',
  "internal class JarvisMMDeviceEnumerator {}",
  '[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  "internal interface IJarvisMMDeviceEnumerator {",
  "  [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);",
  "  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IJarvisMMDevice ppEndpoint);",
  "}",
  '[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  "internal interface IJarvisMMDevice {",
  "  [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);",
  "}",
  '[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  "internal interface IJarvisAudioEndpointVolume {",
  "  [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);",
  "  [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);",
  "  [PreserveSig] int GetChannelCount(out uint pnChannelCount);",
  "  [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);",
  "  [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);",
  "  [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);",
  "  [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);",
  "  [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);",
  "  [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);",
  "  [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);",
  "  [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);",
  "  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);",
  "  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);",
  "}",
  "public static class JarvisCoreAudio {",
  "  private static void CheckHr(int hr) { if (hr != 0) Marshal.ThrowExceptionForHR(hr); }",
  "  public static int[] Apply(string action, int targetLevel, float stepFraction) {",
  "    IJarvisMMDeviceEnumerator de = null;",
  "    IJarvisMMDevice dev = null;",
  "    object obj = null;",
  "    IJarvisAudioEndpointVolume epv = null;",
  "    try {",
  "      de = (IJarvisMMDeviceEnumerator)(new JarvisMMDeviceEnumerator());",
  "      int hr = de.GetDefaultAudioEndpoint(0, 1, out dev);",
  "      if (hr != 0 || dev == null) hr = de.GetDefaultAudioEndpoint(0, 0, out dev);",
  "      CheckHr(hr);",
  "      Guid iid = typeof(IJarvisAudioEndpointVolume).GUID;",
  "      CheckHr(dev.Activate(ref iid, 23, IntPtr.Zero, out obj));",
  "      epv = (IJarvisAudioEndpointVolume)obj;",
  "      Guid ctx = Guid.Empty;",
  "      float cur = 0f;",
  "      bool muted = false;",
  '      if (action == "set_volume") {',
  "        float next = Math.Max(0f, Math.Min(1f, targetLevel / 100f));",
  "        CheckHr(epv.SetMasterVolumeLevelScalar(next, ref ctx));",
  '      } else if (action == "volume_up" || action == "volume_down") {',
  "        CheckHr(epv.GetMasterVolumeLevelScalar(out cur));",
  '        float delta = action == "volume_up" ? stepFraction : -stepFraction;',
  "        float next = Math.Max(0f, Math.Min(1f, cur + delta));",
  "        CheckHr(epv.SetMasterVolumeLevelScalar(next, ref ctx));",
  '      } else if (action == "mute") {',
  "        CheckHr(epv.SetMute(true, ref ctx));",
  '      } else if (action == "unmute") {',
  "        CheckHr(epv.SetMute(false, ref ctx));",
  '      } else if (action == "toggle_mute") {',
  "        CheckHr(epv.GetMute(out muted));",
  "        CheckHr(epv.SetMute(!muted, ref ctx));",
  "      }",
  "      CheckHr(epv.GetMasterVolumeLevelScalar(out cur));",
  "      CheckHr(epv.GetMute(out muted));",
  "      return new int[] { (int)Math.Round(cur * 100f), muted ? 1 : 0 };",
  "    } finally {",
  "      if (epv != null) Marshal.ReleaseComObject(epv);",
  "      else if (obj != null) Marshal.ReleaseComObject(obj);",
  "      if (dev != null) Marshal.ReleaseComObject(dev);",
  "      if (de != null) Marshal.ReleaseComObject(de);",
  "    }",
  "  }",
  "}",
].join(" ");

const PS_VOLUME_SCRIPT = [
  PS_UTF8_PREFIX,
  "if (-not ('JarvisCoreAudio' -as [type])) { Add-Type -TypeDefinition '" + CORE_AUDIO_CSHARP + "' }",
  "$r = [JarvisCoreAudio]::Apply($env:JARVIS_MEDIA_ACTION, [int]$env:JARVIS_MEDIA_LEVEL, [float]::Parse($env:JARVIS_MEDIA_STEP, [System.Globalization.CultureInfo]::InvariantCulture))",
  "[pscustomobject]@{ level = $r[0]; muted = ($r[1] -eq 1) } | ConvertTo-Json -Compress",
].join("; ");

const VOLUME_ACTIONS: ReadonlySet<MediaAction> = new Set([
  "volume_up",
  "volume_down",
  "set_volume",
  "mute",
  "unmute",
  "toggle_mute",
]);

export function createDefaultMediaControlDriver(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_MEDIA_CONTROL_TIMEOUT_MS,
): MediaControlDriver {
  return {
    async execute({ action, seconds, level, signal }) {
      if (platform !== "win32") {
        throw new Error(`Media control requires Windows (current platform: ${platform}).`);
      }

      if (VOLUME_ACTIONS.has(action)) {
        const { stdout } = await execFileAsync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", PS_VOLUME_SCRIPT],
          {
            timeout: timeoutMs,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            signal,
            env: {
              ...process.env,
              JARVIS_MEDIA_ACTION: action,
              JARVIS_MEDIA_LEVEL: String(level ?? 50),
              JARVIS_MEDIA_STEP: String(DEFAULT_VOLUME_STEP / 100),
            },
          },
        );
        const trimmed = stdout.trim();
        if (trimmed !== "") {
          const parsed: unknown = JSON.parse(trimmed);
          if (isRecord(parsed)) {
            return {
              ...(typeof parsed.level === "number" && Number.isFinite(parsed.level)
                ? { volumeLevel: parsed.level }
                : level !== undefined
                  ? { volumeLevel: level }
                  : {}),
              ...(typeof parsed.muted === "boolean"
                ? { muted: parsed.muted }
                : action === "mute"
                  ? { muted: true }
                  : action === "unmute"
                    ? { muted: false }
                    : {}),
            };
          }
        }
        return {
          ...(level !== undefined ? { volumeLevel: level } : {}),
          ...(action === "mute" ? { muted: true } : action === "unmute" ? { muted: false } : {}),
        };
      }

      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", PS_MEDIA_SESSION_SCRIPT],
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          signal,
          env: {
            ...process.env,
            JARVIS_MEDIA_ACTION: action,
            JARVIS_MEDIA_SECONDS: String(seconds ?? DEFAULT_SEEK_SECONDS),
          },
        },
      );

      const trimmed = stdout.trim();
      if (!trimmed) return { nowPlaying: { active: false } };
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) return { nowPlaying: { active: false } };
      return {
        nowPlaying: {
          active: parsed.active === true,
          ...(typeof parsed.title === "string" && parsed.title ? { title: parsed.title } : {}),
          ...(typeof parsed.artist === "string" && parsed.artist ? { artist: parsed.artist } : {}),
          ...(typeof parsed.album === "string" && parsed.album ? { album: parsed.album } : {}),
          ...(typeof parsed.sourceApp === "string" && parsed.sourceApp ? { sourceApp: parsed.sourceApp } : {}),
          ...(typeof parsed.playbackStatus === "string" && parsed.playbackStatus
            ? { playbackStatus: parsed.playbackStatus }
            : {}),
        },
      };
    },
  };
}

export async function runMediaControl(
  rawArgs: Record<string, unknown>,
  deps: MediaControlDeps = {},
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.action !== "string" || !(MEDIA_ACTIONS as readonly string[]).includes(rawArgs.action)) {
    return fail(`'action' is required and must be one of: ${MEDIA_ACTIONS.join(", ")}.`);
  }
  const action = rawArgs.action as MediaAction;

  let seconds: number | undefined;
  if (action === "seek_forward" || action === "seek_backward") {
    seconds = DEFAULT_SEEK_SECONDS;
    if (rawArgs.seconds !== undefined && rawArgs.seconds !== null) {
      if (
        typeof rawArgs.seconds !== "number" ||
        !Number.isInteger(rawArgs.seconds) ||
        rawArgs.seconds < 1 ||
        rawArgs.seconds > MAX_SEEK_SECONDS
      ) {
        return fail(`'seconds' must be an integer between 1 and ${MAX_SEEK_SECONDS}.`);
      }
      seconds = rawArgs.seconds;
    }
  }

  let level: number | undefined;
  if (action === "set_volume") {
    if (typeof rawArgs.level !== "number" || !Number.isInteger(rawArgs.level) || rawArgs.level < 0 || rawArgs.level > 100) {
      return fail("'level' (integer 0..100) is required when action is 'set_volume'.");
    }
    level = rawArgs.level;
  }

  const timeoutMs = effectiveTimeoutMs(deps.defaultTimeoutMs ?? DEFAULT_MEDIA_CONTROL_TIMEOUT_MS, options.timeoutMs);
  const driver = deps.driver ?? createDefaultMediaControlDriver(deps.platform ?? process.platform, timeoutMs);

  try {
    const out = await driver.execute({ action, seconds, level, signal: options.signal });
    if (options.signal?.aborted) return cancelledResult();

    if (action === "now_playing") {
      const np = out.nowPlaying;
      if (!np || !np.active) {
        const text = "status: ok · no active media session playing";
        return toolResult({
          text,
          raw: text,
          data: { state: "ok", action, active: false, truncated: false },
        });
      }
      const parts = [np.title || "Unknown title", ...(np.artist ? [`by ${np.artist}`] : []), ...(np.album ? [`[${np.album}]`] : [])];
      const text = `status: ok · now playing: ${parts.join(" ")}${np.playbackStatus ? ` (${np.playbackStatus})` : ""}${np.sourceApp ? ` · ${np.sourceApp}` : ""}`;
      return toolResult({
        text,
        raw: text,
        data: { state: "ok", action, active: true, nowPlaying: np, truncated: false },
      });
    }

    const resolvedLevel = out.volumeLevel ?? level;
    let detail = "";
    if (action === "seek_forward" || action === "seek_backward") {
      detail = ` (${seconds}s)`;
    } else if (action === "mute" || action === "unmute" || action === "toggle_mute") {
      const muteParts: string[] = [];
      if (out.muted !== undefined) muteParts.push(out.muted ? "muted" : "unmuted");
      if (resolvedLevel !== undefined) muteParts.push(`${resolvedLevel}%`);
      if (muteParts.length > 0) detail = ` (${muteParts.join(", ")})`;
    } else if (resolvedLevel !== undefined) {
      detail = ` (${resolvedLevel}%${out.muted ? ", muted" : ""})`;
    }
    const text = `status: ok · media_control '${action}'${detail}`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        action,
        ...(seconds !== undefined ? { seconds } : {}),
        ...(out.volumeLevel !== undefined ? { level: out.volumeLevel } : level !== undefined ? { level } : {}),
        ...(out.muted !== undefined ? { muted: out.muted } : {}),
        ...(out.nowPlaying !== undefined ? { nowPlaying: out.nowPlaying } : {}),
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Media control '${action}' failed: ${errorMessage(error)}`);
  }
}
