/**
 * eval/real/sandbox.ts
 *
 * Sandbox temporal auto-limpiable para los modos reales (`--source=real-stage` ejecutable
 * y `--source=real-task` encadenado):
 * - Directorio temporal aislado con `home`, `desktop`, `documents`, `downloads`, `refsDir` y `tracesDir`.
 * - `DiskView` acotado estrictamente al sandbox.
 * - `ProtectedPaths` (`guardScope`) apuntando a `refsDir` y bases del sandbox.
 * - Los 3 servidores MCP de `DESTINATIONS` (`desktop_commander`, `jarvis_terminal`, `jarvis_web`)
 *   respaldados por fixtures seguros dentro del sandbox.
 * - Lista negra reforzada en nivel `blocked` (`homeDirs` del sandbox + reglas explícitas) que
 *   rechaza determinísticamente comandos y herramientas de eliminación peligrosas sin delegarlos a D3.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { IDiscoveryEngine } from "../../src/core/contracts.ts";
import type { DiskView } from "../../src/core/engine/postcondition.ts";
import type { CommandAnalyzer } from "../../src/core/engine/precheck.ts";
import type { UserEnvironment } from "../../src/core/environment.ts";
import type { IMCPServer } from "../../src/core/mcp/types.ts";
import { blacklistMatch, compileBlacklist } from "../../src/core/policy/blacklist.ts";
import type { Blacklist, BlacklistEntry, ListHit } from "../../src/core/policy/blacklist.ts";
import { isPathInside } from "../../src/core/policy/guard.ts";
import type { ProtectedPaths } from "../../src/core/policy/guard.ts";
import { createRefVault } from "../../src/core/refs/refVault.ts";
import type { RefVault } from "../../src/core/refs/refVault.ts";
import type { MCPCallResult, MCPTool } from "../../src/core/types.ts";

export interface SandboxFixtures {
  /** Archivos iniciales: clave relativa a `home` (p. ej. `documents/notas.txt`) o ruta dentro del sandbox. */
  files?: Record<string, string>;
  /** Respuestas simuladas por comando o subcadena para `jarvis_terminal:run_command`. */
  commands?: Record<string, { text: string; isError?: boolean }>;
  /** Respuestas simuladas para `jarvis_web:web_search` (por consulta exacta o subcadena). */
  webSearches?: Record<string, { text: string; isError?: boolean }>;
  /** Lista negra adicional específica del caso. */
  extraBlacklist?: readonly BlacklistEntry[];
}

export interface EvalSandbox {
  readonly root: string;
  readonly environment: UserEnvironment;
  readonly refsDir: string;
  readonly tracesDir: string;
  readonly guardScope: ProtectedPaths;
  readonly disk: DiskView;
  readonly vault: RefVault;
  readonly blacklist: Blacklist;
  readonly discovery: IDiscoveryEngine;
  readonly analyzeCommand: CommandAnalyzer;
  /** Registro de llamadas que efectivamente llegaron a ejecutarse en cada servidor. */
  readonly executedCalls: Array<{ server: string; tool: string; args: Record<string, unknown> }>;
  /** Resuelve una ruta relativa (`documents/a.txt`) al interior de `home`. */
  resolveSandboxPath(relOrAbs: string): string;
  /** Evalúa la lista negra fijando `homeDirs` al sandbox (además de las reglas compiladas). */
  checkBlacklist(mcp: string, tool: string, mutates: boolean, args: Record<string, unknown>): ListHit | null;
  /** Limpia el directorio temporal completo. */
  cleanup(): void;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normPathForRegex(p: string): string {
  return escapeRegExp(resolve(p).toLowerCase().replace(/\\/g, "/"));
}

/**
 * Compila reglas de lista negra en nivel `blocked` para bloquear de forma determinista
 * comandos y herramientas de eliminación peligrosas incluso cuando `autoMode === true`.
 */
export function compileSandboxBlacklist(env: UserEnvironment, extra: readonly BlacklistEntry[] = []): Blacklist {
  const folderAlternation = [env.home, env.desktop, env.documents, env.downloads]
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .map(normPathForRegex)
    .join("|");

  const entries: BlacklistEntry[] = [
    {
      tool: "delete_file",
      reason: "File deletion tool is deterministically blocked in eval sandbox.",
      level: "blocked",
    },
    {
      tool: "desktop_commander:delete_file",
      reason: "File deletion tool is deterministically blocked in eval sandbox.",
      level: "blocked",
    },
    {
      tool: "jarvis_terminal:run_command",
      pattern:
        "(?:^|[\"';&|`(\\s])(?:rm|rmdir|rd|del|erase|ri|remove-item|unlink|shred|sdelete)\\b[^;&|\\n]*(?:\\s-[a-z]*[rf][a-z]*|\\s--(?:recursive|force)|\\s/(?:s|q)\\b|\\s-recurse\\b|\\s-force\\b|\\*)",
      reason: "Destructive or recursive delete commands are deterministically blocked in eval sandbox.",
      level: "blocked",
    },
    {
      tool: "jarvis_terminal:run_command",
      pattern: "(?:^|[\"';&|`(\\s])find\\b[^;&|\\n]*\\s-delete\\b",
      reason: "Recursive find -delete is deterministically blocked in eval sandbox.",
      level: "blocked",
    },
    {
      tool: "jarvis_terminal:run_command",
      pattern: `(?:^|["';&|\`(\\s])(?:rm|rmdir|rd|del|erase|ri|remove-item|unlink|shred|sdelete)\\b[^;&|\\n]*(?:${folderAlternation ? `${folderAlternation}|` : ""}(?:^|[\\s/"'])(?:desktop|documents|downloads)(?:/|$|\\s))`,
      reason: "Deleting sandbox user folders or files inside them via terminal is blocked.",
      level: "blocked" as const,
    },
    ...extra,
  ];

  return compileBlacklist(entries);
}

const FILE_TOOLS: MCPTool[] = [
  {
    name: "read_file",
    description: "Read a local file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number" },
        length: { type: "number" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_multiple_files",
    description: "Read multiple files.",
    inputSchema: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: "Write a file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        mode: { type: "string", enum: ["rewrite", "append"] },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "create_directory",
    description: "Create directory.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_directory",
    description: "List directory.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, depth: { type: "number" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "move_file",
    description: "Move file.",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" }, destination: { type: "string" } },
      required: ["source", "destination"],
      additionalProperties: false,
    },
  },
  {
    name: "start_search",
    description: "Search files.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, pattern: { type: "string" }, searchType: { type: "string" } },
      required: ["path", "pattern"],
      additionalProperties: false,
    },
  },
];

const TERMINAL_TOOLS: MCPTool[] = [
  {
    name: "run_command",
    description: "Run a command.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        pid: { type: "number" },
        input: { type: "string" },
        timeoutSec: { type: "number" },
        cwd: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_processes",
    description: "List processes.",
    inputSchema: {
      type: "object",
      properties: { all: { type: "boolean" } },
      additionalProperties: false,
    },
  },
];

const WEB_TOOLS: MCPTool[] = [
  {
    name: "web_search",
    description: "Search the web.",
    inputSchema: {
      type: "object",
      properties: {
        need: { type: "string" },
        urls: { type: "array", items: { type: "string" } },
        freshness: { type: "string" },
        domains: { type: "array", items: { type: "string" } },
      },
      required: ["need"],
      additionalProperties: false,
    },
  },
];

const textResult = (text: string, isError = false): MCPCallResult => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

export function createEvalSandbox(fixtures: SandboxFixtures = {}): EvalSandbox {
  const root = mkdtempSync(join(tmpdir(), "jarvis-eval-sandbox-"));
  const home = join(root, "home");
  const desktop = join(home, "Desktop");
  const documents = join(home, "Documents");
  const downloads = join(home, "Downloads");
  const refsDir = join(root, "protected_refs");
  const tracesDir = join(root, "traces");

  for (const dir of [home, desktop, documents, downloads, refsDir, tracesDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const environment: UserEnvironment = {
    platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
    home,
    desktop,
    documents,
    downloads,
  };

  const guardScope: ProtectedPaths = {
    protectedDirs: [refsDir],
    relativeBases: [home, desktop, documents, downloads],
  };

  const resolveSandboxPath = (relOrAbs: string): string => {
    const trimmed = relOrAbs.trim();
    const resolved = trimmed.startsWith("/") ? resolve(trimmed) : resolve(home, trimmed);
    return resolved;
  };

  // Sembrar archivos iniciales dentro de `home`.
  for (const [rawPath, content] of Object.entries(fixtures.files ?? {})) {
    const target = resolveSandboxPath(rawPath);
    if (!isPathInside(home, target)) {
      throw new Error(`Sandbox fixture '${rawPath}' escapa de home (${home}).`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }

  const inSandbox = (p: string): boolean => isPathInside(root, resolve(p));
  const inWorkspace = (p: string): boolean => isPathInside(home, resolve(p));

  const disk: DiskView = {
    exists: (p) => inSandbox(p) && existsSync(resolve(p)),
    isDirectory: (p) => inSandbox(p) && existsSync(resolve(p)) && statSync(resolve(p)).isDirectory(),
    size: (p) => (inSandbox(p) && existsSync(resolve(p)) ? statSync(resolve(p)).size : 0),
    readFile: (p, maxBytes = 400_000) => {
      const target = resolve(p);
      if (!inSandbox(target) || !existsSync(target) || statSync(target).isDirectory()) return null;
      return readFileSync(target, "utf8").slice(0, maxBytes);
    },
  };

  const vault = createRefVault({ dir: refsDir });
  const blacklist = compileSandboxBlacklist(environment, fixtures.extraBlacklist);
  const executedCalls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = [];

  const checkAllowedWorkspace = (rawPath: string): string | null => {
    const abs = resolveSandboxPath(rawPath);
    if (!inWorkspace(abs) && !isPathInside(refsDir, abs)) {
      return `Acceso denegado fuera del sandbox: '${rawPath}'`;
    }
    return null;
  };

  const readTextWindow = (abs: string, offset?: unknown, length?: unknown): string => {
    const full = readFileSync(abs, "utf8");
    const hasOffset = typeof offset === "number" && Number.isFinite(offset);
    const hasLength = typeof length === "number" && Number.isFinite(length);
    if (!hasOffset && !hasLength) return full;
    const lines = full.split("\n");
    const start = Math.max(0, typeof offset === "number" ? Math.floor(offset) : 0);
    const count = typeof length === "number" ? Math.max(1, Math.floor(length)) : lines.length;
    return lines.slice(start, start + count).join("\n");
  };

  const desktopCommander: IMCPServer = {
    name: "desktop_commander",
    version: "1.0.0-sandbox",
    isConnected: () => true,
    reconnect: async () => undefined,
    listTools: async () => FILE_TOOLS,
    callTool: async (tool, args) => {
      executedCalls.push({ server: "desktop_commander", tool, args });
      switch (tool) {
        case "read_file": {
          const rawPath = String(args.path ?? "");
          const err = checkAllowedWorkspace(rawPath);
          if (err) return textResult(err, true);
          const abs = resolveSandboxPath(rawPath);
          if (!existsSync(abs) || statSync(abs).isDirectory()) {
            return textResult(`No existe el archivo '${rawPath}'.`, true);
          }
          return textResult(readTextWindow(abs, args.offset, args.length));
        }
        case "read_multiple_files": {
          const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
          const out: string[] = [];
          for (const rawPath of paths) {
            const err = checkAllowedWorkspace(rawPath);
            if (err) return textResult(err, true);
            const abs = resolveSandboxPath(rawPath);
            if (!existsSync(abs) || statSync(abs).isDirectory()) return textResult(`No existe '${rawPath}'.`, true);
            out.push(`=== ${rawPath} ===\n${readFileSync(abs, "utf8")}`);
          }
          return textResult(out.join("\n\n"));
        }
        case "write_file": {
          const rawPath = String(args.path ?? "");
          const abs = resolveSandboxPath(rawPath);
          if (!inWorkspace(abs)) return textResult(`Escritura denegada fuera de home del sandbox: '${rawPath}'.`, true);
          mkdirSync(dirname(abs), { recursive: true });
          const content = String(args.content ?? "");
          if (args.mode === "append" && existsSync(abs)) {
            writeFileSync(abs, readFileSync(abs, "utf8") + content, "utf8");
          } else {
            writeFileSync(abs, content, "utf8");
          }
          return textResult(`Successfully wrote to ${abs}`);
        }
        case "create_directory": {
          const rawPath = String(args.path ?? "");
          const abs = resolveSandboxPath(rawPath);
          if (!inWorkspace(abs)) return textResult(`Carpeta denegada fuera de home del sandbox: '${rawPath}'.`, true);
          mkdirSync(abs, { recursive: true });
          return textResult(`Successfully created directory ${abs}`);
        }
        case "list_directory": {
          const rawPath = String(args.path ?? home);
          const abs = resolveSandboxPath(rawPath);
          if (!inWorkspace(abs) || !existsSync(abs) || !statSync(abs).isDirectory()) {
            return textResult(`No existe el directorio '${rawPath}'.`, true);
          }
          const entries = readdirSync(abs, { withFileTypes: true }).map((e) => (e.isDirectory() ? `[DIR] ${e.name}` : `[FILE] ${e.name}`));
          return textResult(entries.length > 0 ? entries.join("\n") : "Directorio vacío.");
        }
        case "move_file": {
          const src = resolveSandboxPath(String(args.source ?? ""));
          const dst = resolveSandboxPath(String(args.destination ?? ""));
          if (!inWorkspace(src) || !inWorkspace(dst)) return textResult("Ruta fuera del sandbox.", true);
          if (!existsSync(src)) return textResult(`Origen inexistente: ${src}`, true);
          const finalDst = existsSync(dst) && statSync(dst).isDirectory() ? join(dst, basename(src)) : dst;
          mkdirSync(dirname(finalDst), { recursive: true });
          renameSync(src, finalDst);
          return textResult(`Moved ${src} to ${finalDst}`);
        }
        case "start_search": {
          const rawPath = String(args.path ?? home);
          const abs = resolveSandboxPath(rawPath);
          const pattern = String(args.pattern ?? "").toLowerCase();
          if (!inWorkspace(abs) || !existsSync(abs)) return textResult("Ruta inexistente.", true);
          const matches: string[] = [];
          const walk = (d: string): void => {
            for (const entry of readdirSync(d, { withFileTypes: true })) {
              const p = join(d, entry.name);
              if (entry.isDirectory()) walk(p);
              else if (entry.name.toLowerCase().includes(pattern)) matches.push(p);
            }
          };
          walk(abs);
          return textResult(matches.length > 0 ? matches.join("\n") : "No files found.");
        }
        default:
          return textResult(`Herramienta '${tool}' no soportada en desktop_commander sandbox.`, true);
      }
    },
  };

  const jarvisTerminal: IMCPServer = {
    name: "jarvis_terminal",
    version: "1.0.0-sandbox",
    isConnected: () => true,
    reconnect: async () => undefined,
    listTools: async () => (fixtures.commands ? TERMINAL_TOOLS : TERMINAL_TOOLS),
    callTool: async (tool, args) => {
      executedCalls.push({ server: "jarvis_terminal", tool, args });
      if (tool === "list_processes") {
        return textResult("No hay procesos activos.");
      }
      if (tool === "run_command") {
        const cmd = String(args.command ?? "");
        const commands = fixtures.commands ?? {};
        const direct = commands[cmd];
        if (direct) return textResult(direct.text, direct.isError === true);
        const partial = Object.entries(commands).find(([k]) => cmd.includes(k));
        if (partial) return textResult(partial[1].text, partial[1].isError === true);
        return textResult(`Salida simulada en sandbox para: ${cmd}`);
      }
      return textResult(`Herramienta '${tool}' no implementada en sandbox.`, true);
    },
  };

  const jarvisWeb: IMCPServer = {
    name: "jarvis_web",
    version: "1.0.0-sandbox",
    isConnected: () => true,
    reconnect: async () => undefined,
    listTools: async () => (fixtures.webSearches && Object.keys(fixtures.webSearches).length > 0 ? WEB_TOOLS : []),
    callTool: async (tool, args) => {
      executedCalls.push({ server: "jarvis_web", tool, args });
      if (tool === "web_search") {
        const need = String(args.need ?? "");
        const searches = fixtures.webSearches ?? {};
        const direct = searches[need];
        if (direct) return textResult(direct.text, direct.isError === true);
        const partial = Object.entries(searches).find(([k]) => need.toLowerCase().includes(k.toLowerCase()));
        if (partial) return textResult(partial[1].text, partial[1].isError === true);
        return textResult("Sin resultados en fixture web.", true);
      }
      return textResult(`Herramienta '${tool}' no implementada en sandbox.`, true);
    },
  };

  const servers: Record<string, IMCPServer> = {
    desktop_commander: desktopCommander,
    jarvis_terminal: jarvisTerminal,
    jarvis_web: jarvisWeb,
  };

  const discovery: IDiscoveryEngine = {
    getServer: (name) => servers[name],
    getDiscoveredTools: async (name) => (servers[name] ? servers[name].listTools() : []),
    getUnavailableServers: () => ({}),
    validateToolExists: async (name, toolName) => {
      const s = servers[name];
      if (!s) return false;
      const list = await s.listTools();
      return list.some((t) => t.name === toolName);
    },
    notifyTaskEnd: async () => undefined,
  };

  return {
    root,
    environment,
    refsDir,
    tracesDir,
    guardScope,
    disk,
    vault,
    blacklist,
    discovery,
    analyzeCommand: async () => null,
    executedCalls,
    resolveSandboxPath,
    checkBlacklist: (mcp, tool, mutates, args) => blacklistMatch(blacklist, mcp, tool, mutates, args, [home]),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
