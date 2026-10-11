/**
 * JARVIS Core — Configuration & Persistence Manager
 * Manages endpoints for Qwen 3.5 9B, Decision 2.0, and local MCP servers.
 * Persists settings safely to local file system so they survive server restarts.
 */

import fs from "node:fs";
import path from "node:path";

export interface StdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  allowedDirectories?: string[];
}

export interface JarvisConfig {
  qwenUrl: string;
  qwenModel: string;
  thinking: boolean;
  decisionUrl: string;
  windowsMcp: StdioServerConfig;
  desktopCommanderMcp: StdioServerConfig;
  freeSearchMcp: StdioServerConfig;
  timeoutMs?: number;
  decisionTimeoutMs: number;
  qwenTimeoutMs: number;
  mcpTimeoutMs: number;
}

const CONFIG_FILE_PATH = path.resolve(process.cwd(), "jarvis-config.json");

const DEFAULT_CONFIG: JarvisConfig = {
  qwenUrl: "http://127.0.0.1:11434",
  qwenModel: "qwen3.5:9b",
  thinking: false,
  decisionUrl: "http://127.0.0.1:8765",
  windowsMcp: {
    command: "uvx",
    args: ["windows-mcp", "serve"],
  },
  desktopCommanderMcp: {
    command: "npx",
    args: ["-y", "@wonderwhy-er/desktop-commander"],
    allowedDirectories: [],
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
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        const fileContent = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
        const parsed = JSON.parse(fileContent);

        if (parsed.qwenModel === "qwen2.5:7b") {
          parsed.qwenModel = "";
        }

        delete parsed.windowsMcpUrl;
        delete parsed.desktopCommanderMcpUrl;
        delete parsed.freeSearchMcpUrl;

        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          thinking: typeof parsed.thinking === "boolean" ? parsed.thinking : DEFAULT_CONFIG.thinking,
          decisionTimeoutMs: parsed.decisionTimeoutMs ?? parsed.timeoutMs ?? DEFAULT_CONFIG.decisionTimeoutMs,
          qwenTimeoutMs: parsed.qwenTimeoutMs ?? DEFAULT_CONFIG.qwenTimeoutMs,
          mcpTimeoutMs: parsed.mcpTimeoutMs ?? parsed.timeoutMs ?? DEFAULT_CONFIG.mcpTimeoutMs,
          windowsMcp: parsed.windowsMcp || DEFAULT_CONFIG.windowsMcp,
          desktopCommanderMcp: {
            ...DEFAULT_CONFIG.desktopCommanderMcp,
            ...(parsed.desktopCommanderMcp || {}),
          },
          freeSearchMcp: parsed.freeSearchMcp || DEFAULT_CONFIG.freeSearchMcp,
        };
      }
    } catch (e) {
      console.warn("[ConfigManager] No se pudo leer el archivo de configuración local. Usando defaults:", e);
    }
    return { ...DEFAULT_CONFIG };
  }

  private static saveConfig(cfg: JarvisConfig): void {
    try {
      fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(cfg, null, 2), "utf-8");
    } catch (e) {
      console.warn("[ConfigManager] Error al guardar configuración en archivo local:", e);
    }
  }
}