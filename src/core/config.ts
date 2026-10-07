/**
 * JARVIS Core — Configuration & Persistence Manager
 * Manages endpoints for Qwen 3.5 9B, Decision 2.0, and local MCP servers.
 * Persists settings to localStorage so they survive page reloads.
 */

export interface StdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface JarvisConfig {
  qwenUrl: string;
  qwenModel: string;
  decisionUrl: string;
  windowsMcp: StdioServerConfig;
  desktopCommanderMcp: StdioServerConfig;
  freeSearchMcp: StdioServerConfig;
  timeoutMs?: number;
  decisionTimeoutMs: number;
  qwenTimeoutMs: number;
  mcpTimeoutMs: number;
}

const STORAGE_KEY = "jarvis_core_config_v1";

const DEFAULT_CONFIG: JarvisConfig = {
  qwenUrl: "http://127.0.0.1:11434",
  qwenModel: "qwen3.5:9b",
  decisionUrl: "http://127.0.0.1:8765",
  windowsMcp: {
    command: "uvx",
    args: ["windows-mcp", "serve"],
  },
  desktopCommanderMcp: {
    command: "npx",
    args: ["-y", "@wonderwhy-er/desktop-commander"],
  },
  freeSearchMcp: {
    command: "uvx",
    args: ["--from", "free-search-mcp==0.13.1", "--with", "selectolax==0.3.34", "free-search-mcp"],
  },
  timeoutMs: 30000,
  decisionTimeoutMs: 30000,
  qwenTimeoutMs: 60000,
  mcpTimeoutMs: 30000,
};

export class ConfigManager {
  private static currentConfig: JarvisConfig = this.loadConfig();

  static getConfig(): JarvisConfig {
    return { ...this.currentConfig };
  }

  static updateConfig(partial: Partial<JarvisConfig>): JarvisConfig {
    this.currentConfig = {
      ...this.currentConfig,
      ...partial,
    };
    this.saveConfig(this.currentConfig);
    return { ...this.currentConfig };
  }

  static isConfigured(service: "qwen" | "decision" | "windows" | "desktop" | "search"): boolean {
    switch (service) {
      case "qwen":
        return Boolean(this.currentConfig.qwenUrl.trim());
      case "decision":
        return Boolean(this.currentConfig.decisionUrl.trim());
      case "windows":
        return Boolean(this.currentConfig.windowsMcp?.command?.trim());
      case "desktop":
        return Boolean(this.currentConfig.desktopCommanderMcp?.command?.trim());
      case "search":
        return Boolean(this.currentConfig.freeSearchMcp?.command?.trim());
      default:
        return false;
    }
  }

  private static loadConfig(): JarvisConfig {
    if (typeof localStorage !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.qwenModel === "qwen2.5:7b") {
            parsed.qwenModel = "";
          }
          // Migrate away from deprecated HTTP URLs if present
          delete parsed.windowsMcpUrl;
          delete parsed.desktopCommanderMcpUrl;
          delete parsed.freeSearchMcpUrl;

          return {
            ...DEFAULT_CONFIG,
            ...parsed,
            decisionTimeoutMs: parsed.decisionTimeoutMs ?? parsed.timeoutMs ?? DEFAULT_CONFIG.decisionTimeoutMs,
            qwenTimeoutMs: parsed.qwenTimeoutMs ?? DEFAULT_CONFIG.qwenTimeoutMs,
            mcpTimeoutMs: parsed.mcpTimeoutMs ?? parsed.timeoutMs ?? DEFAULT_CONFIG.mcpTimeoutMs,
            windowsMcp: parsed.windowsMcp || DEFAULT_CONFIG.windowsMcp,
            desktopCommanderMcp: parsed.desktopCommanderMcp || DEFAULT_CONFIG.desktopCommanderMcp,
            freeSearchMcp: parsed.freeSearchMcp || DEFAULT_CONFIG.freeSearchMcp,
          };
        }
      } catch (e) {
        console.warn("Failed to load JARVIS config from localStorage:", e);
      }
    }
    return { ...DEFAULT_CONFIG };
  }

  private static saveConfig(cfg: JarvisConfig): void {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch (e) {
        console.warn("Failed to persist JARVIS config to localStorage:", e);
      }
    }
  }
}
