/**
 * Proveedor nativo `jarvis_multimedia` (`play_media`, `media_control`).
 *
 * Aislado de los demás grupos en `src/tools/` y sin integración aún a D1/D2.
 * Todas las dependencias externas (`playDriver`, `controlDriver`, `platform`) entran por opciones.
 */

import type { ToolCallOptions, ToolProvider } from "../../core/tools/provider.ts";
import { toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
import {
  DEFAULT_MEDIA_CONTROL_TIMEOUT_MS,
  DEFAULT_SEEK_SECONDS,
  MAX_SEEK_SECONDS,
  MEDIA_ACTIONS,
  runMediaControl,
  type MediaControlDriver,
} from "./mediaControl.ts";
import {
  DEFAULT_PLAY_MEDIA_TIMEOUT_MS,
  MEDIA_PLATFORMS,
  MEDIA_TYPES,
  runPlayMedia,
  type PlayMediaDriver,
} from "./playMedia.ts";

const MULTIMEDIA_SERVER = "jarvis_multimedia";
const PLAY_MEDIA = "play_media";
const MEDIA_CONTROL = "media_control";

export type { MediaAction, MediaControlDriver, NowPlayingInfo } from "./mediaControl.ts";
export type { MediaPlatform, MediaType, PlayMediaDriver, PlayMediaRequest } from "./playMedia.ts";

const PLAY_MEDIA_TOOL: MCPTool = {
  name: PLAY_MEDIA,
  description: "Search or play music/video on YouTube or Spotify.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Song/video search query, YouTube/Spotify URL, or Spotify URI.",
      },
      platform: {
        type: "string",
        enum: [...MEDIA_PLATFORMS],
        description: "Target platform: 'auto' (default), 'youtube', or 'spotify'.",
      },
      mediaType: {
        type: "string",
        enum: [...MEDIA_TYPES],
        description: "Media type hint: 'auto' (default), 'music', or 'video'.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const MEDIA_CONTROL_TOOL: MCPTool = {
  name: MEDIA_CONTROL,
  description: "Control active media playback (play, pause, next, previous, seek, volume, mute, now_playing).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...MEDIA_ACTIONS],
        description: "Playback or volume action to perform.",
      },
      seconds: {
        type: "integer",
        description: `For seek_forward/seek_backward: seconds to jump (1..${MAX_SEEK_SECONDS}, default ${DEFAULT_SEEK_SECONDS}).`,
      },
      level: {
        type: "integer",
        description: "For set_volume: target volume level 0..100.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
};

const TOOLS: readonly MCPTool[] = [PLAY_MEDIA_TOOL, MEDIA_CONTROL_TOOL];

interface MultimediaProviderOptions {
  readonly playDriver?: PlayMediaDriver;
  readonly controlDriver?: MediaControlDriver;
  readonly platform?: NodeJS.Platform;
  readonly playTimeoutMs?: number;
  readonly controlTimeoutMs?: number;
}

export class MultimediaProvider implements ToolProvider {
  readonly name = MULTIMEDIA_SERVER;
  readonly version = "1.0.0";

  private readonly playDriver: PlayMediaDriver | undefined;
  private readonly controlDriver: MediaControlDriver | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly playTimeoutMs: number;
  private readonly controlTimeoutMs: number;

  constructor(options: MultimediaProviderOptions = {}) {
    this.playDriver = options.playDriver;
    this.controlDriver = options.controlDriver;
    this.platform = options.platform ?? process.platform;
    this.playTimeoutMs = options.playTimeoutMs ?? DEFAULT_PLAY_MEDIA_TIMEOUT_MS;
    this.controlTimeoutMs = options.controlTimeoutMs ?? DEFAULT_MEDIA_CONTROL_TIMEOUT_MS;
  }

  async listTools(): Promise<MCPTool[]> {
    return [...TOOLS];
  }

  isConnected(): boolean {
    return true;
  }

  async reconnect(): Promise<void> {}

  async callTool(name: string, args: Record<string, unknown>, options: ToolCallOptions = {}): Promise<MCPCallResult> {
    switch (name) {
      case PLAY_MEDIA:
        return runPlayMedia(
          args,
          { driver: this.playDriver, platform: this.platform, defaultTimeoutMs: this.playTimeoutMs },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case MEDIA_CONTROL:
        return runMediaControl(
          args,
          { driver: this.controlDriver, platform: this.platform, defaultTimeoutMs: this.controlTimeoutMs },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      default:
        return fail(`Unknown tool: '${name}'.`);
    }
  }
}
