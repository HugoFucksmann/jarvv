/**
 * MCP Protocol Transport — Real Stdio / JSON-RPC Transport Client
 * Connects to local MCP servers running on the user's system via stdio.
 * 
 * Implements:
 * - JSON-RPC 2.0 protocol over stdio (newline-delimited messages).
 * - Persistent child process per MCP server across requests.
 * - Atomic initialization promise to eliminate race conditions on concurrent starts.
 * - Request correlation via JSON-RPC IDs.
 * - Chunk buffering and line framing on stdout (decodificación UTF-8 en streaming).
 * - Stderr logging without corrupting JSON-RPC stream.
 * - Process tree termination (taskkill on Windows) to prevent zombie processes.
 * - Reconnection, session persistence, and clean process termination.
 * - Aislamiento por proceso: los eventos de un proceso cerrado o reemplazado se ignoran y
 *   nunca afectan a peticiones ni al estado del proceso vigente.
 */

import { MCPTool, MCPCallResult } from "../types.ts";
import { MCPPrompt, MCPResourceTemplate } from "./types.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { ConfigManager } from "../config.ts";

export interface StdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export class MCPTransportError extends Error {
  constructor(public readonly serverName: string, message: string, public readonly cause?: unknown) {
    super(`[MCP Server '${serverName}' Transport Error] ${message}`);
    this.name = "MCPTransportError";
  }
}

export interface IMCPTransport {
  readonly serverName: string;
  readonly config: StdioConfig;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult>;
  listPrompts?(): Promise<MCPPrompt[]>;
  listResourceTemplates?(): Promise<MCPResourceTemplate[]>;
  readResource?(uri: string): Promise<string>;
  isConnected(): boolean;
  reconnect(): Promise<void>;
  close?(): Promise<void>;
}

export class StdioMcpTransport implements IMCPTransport {
  private childProcess: ChildProcess | null = null;
  private connected = false;
  private initialized = false;
  private initPromise: Promise<ChildProcess> | null = null;
  private requestId = 0;
  private stdoutBuffer = "";
  private pendingRequests = new Map<
    number | string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timer: ReturnType<typeof setTimeout>;
      method: string;
    }
  >();
  private stderrLines: string[] = [];
  /** Set when the process exits fatally before initialization completes. */
  private permanentFailure: MCPTransportError | null = null;

  constructor(
    public readonly serverName: string,
    public readonly config: StdioConfig,
    private readonly timeoutMs: number = 30000
  ) { }

  isConnected(): boolean {
    return this.connected && this.initialized && this.childProcess !== null && !this.childProcess.killed;
  }

  private getLastStderr(): string {
    const raw = this.stderrLines.slice(-5).join("").trim();
    if (!raw) return "";
    return raw.replace(/\r?\n\s*/g, " | ").slice(0, 300);
  }

  private getTimeoutMs(): number {
    try {
      const config = ConfigManager.getConfig();
      return config.mcpTimeoutMs ?? this.timeoutMs ?? 30000;
    } catch {
      return this.timeoutMs ?? 30000;
    }
  }

  getPermanentFailure(): MCPTransportError | null {
    return this.permanentFailure;
  }

  private async startProcess(): Promise<ChildProcess> {
    if (this.permanentFailure) {
      throw this.permanentFailure;
    }

    if (this.childProcess && !this.childProcess.killed && this.connected && this.initialized) {
      return this.childProcess;
    }

    if (this.initPromise) {
      return await this.initPromise;
    }

    this.initPromise = (async () => {
      if (!this.config.command || !this.config.command.trim()) {
        const err = new MCPTransportError(
          this.serverName,
          `El comando stdio para '${this.serverName}' no está configurado.`
        );
        this.permanentFailure = err;
        throw err;
      }

      const command = this.config.command;
      const args = this.config.args || [];
      const env = {
        ...process.env,
        ...(this.config.env || {}),
      };

      let initCompleted = false;
      let started: ChildProcess | null = null;
      /**
       * El proceso que arrancó esta inicialización ya no es el vigente (cerrado, reemplazado o
       * terminado). Su manejador de eventos ya limpió el estado compartido, así que no debe tocarlo.
       */
      const superseded = () => started !== null && this.childProcess !== started;

      try {
        const child = spawn(command, args, {
          env,
          cwd: this.config.cwd,
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });

        started = child;
        this.childProcess = child;
        this.stdoutBuffer = "";
        this.connected = true;

        // Decodificación en streaming: un carácter multibyte partido entre dos chunks no se corrompe.
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");

        child.stdout?.on("data", (chunk: string) => {
          if (this.childProcess !== child) return;
          this.handleStdoutData(chunk);
        });

        child.stderr?.on("data", (chunk: string) => {
          if (this.childProcess !== child) return;
          this.stderrLines.push(chunk);
          if (this.stderrLines.length > 50) {
            this.stderrLines.shift();
          }
        });

        // Sin listener, un EPIPE al escribir en un proceso que ya no lee se eleva como excepción no controlada.
        // La petición afectada se rechaza por el callback de escritura o por su timeout.
        child.stdin?.on("error", (err: Error) => {
          if (this.childProcess === child) {
            console.error(`[MCP] ${this.serverName} stdin: ${err.message}`);
          }
        });

        child.on("error", (err: Error) => {
          if (this.childProcess !== child) return;
          this.connected = false;
          this.initialized = false;
          this.initPromise = null;
          const lastStderr = this.getLastStderr();
          if (lastStderr) {
            console.error(`[MCP] ${this.serverName} stderr: ${lastStderr}`);
          }
          const transportErr = new MCPTransportError(this.serverName, `Fallo en proceso hijo: ${err.message}`, err);
          if (!initCompleted) {
            this.permanentFailure = transportErr;
          }
          this.rejectAllPending(transportErr);
        });

        child.on("exit", (code, signal) => {
          if (this.childProcess !== child) return;
          this.connected = false;
          this.initialized = false;
          this.childProcess = null;
          this.initPromise = null;
          const lastStderr = this.getLastStderr();
          if (code !== 0 && code !== null && lastStderr) {
            console.error(`[MCP] ${this.serverName} stderr: ${lastStderr}`);
          }
          const reason = `El proceso MCP '${this.serverName}' terminó (código: ${code}, señal: ${signal}).`;
          const transportErr = new MCPTransportError(this.serverName, reason);
          if (!initCompleted && code !== 0) {
            this.permanentFailure = transportErr;
          }
          this.rejectAllPending(transportErr);
        });

        // Handshake obligatorio antes de permitir tráfico externo
        try {
          await this.rawRpcCall("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
              name: "jarvis-core",
              version: "1.0.0",
            },
          });
          this.sendNotification("notifications/initialized", {});
        } catch {
          // Tolera servidores que omiten initialize (error RPC o timeout).
          // Un proceso que murió o fue cerrado durante el handshake se detecta justo debajo.
        }

        if (this.permanentFailure) {
          throw this.permanentFailure;
        }
        if (this.childProcess !== child) {
          const lastStderr = this.getLastStderr();
          throw new MCPTransportError(
            this.serverName,
            `El proceso MCP terminó o fue cerrado durante la inicialización.${lastStderr ? ` stderr: ${lastStderr}` : ""}`
          );
        }

        this.initialized = true;
        initCompleted = true;

        return child;
      } catch (err: any) {
        const transportErr = err instanceof MCPTransportError
          ? err
          : new MCPTransportError(
            this.serverName,
            `No fue posible iniciar el proceso MCP '${command} ${args.join(" ")}': ${err.message}`,
            err
          );
        if (superseded()) {
          throw transportErr;
        }
        this.connected = false;
        this.initialized = false;
        this.initPromise = null;
        if (!initCompleted) {
          this.permanentFailure = transportErr;
          console.error(`[MCP '${this.serverName}'] Fallo permanente al iniciar: ${err.message}`);
        }
        throw transportErr;
      } finally {
        if (!this.initialized && !superseded()) {
          this.initPromise = null;
        }
      }
    })();

    return await this.initPromise;
  }

  private handleStdoutData(data: string): void {
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: any;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }

      // Petición o notificación originada en el servidor: no es la respuesta a ninguna petición del
      // cliente, aunque su `id` coincida con el de una pendiente.
      if (msg && typeof msg === "object" && typeof msg.method === "string") {
        continue;
      }

      if (msg && typeof msg === "object" && typeof msg.id !== "undefined") {
        const reqId = msg.id;
        let pending = this.pendingRequests.get(reqId);
        if (!pending && typeof reqId === "string" && !isNaN(Number(reqId))) {
          pending = this.pendingRequests.get(Number(reqId));
        } else if (!pending && typeof reqId === "number") {
          pending = this.pendingRequests.get(String(reqId));
        }

        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(reqId);
          this.pendingRequests.delete(typeof reqId === "string" ? Number(reqId) : String(reqId));

          if (msg.error) {
            const lastStderr = this.getLastStderr();
            if (lastStderr) {
              console.error(`[MCP] ${this.serverName} stderr: ${lastStderr}`);
            }
            pending.reject(
              new MCPTransportError(
                this.serverName,
                `Error RPC en '${pending.method}' (${msg.error.code}): ${msg.error.message}`
              )
            );
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private sendNotification(method: string, params: Record<string, unknown> = {}): void {
    if (!this.childProcess || !this.childProcess.stdin || this.childProcess.stdin.destroyed) {
      return;
    }
    const payload = {
      jsonrpc: "2.0",
      method,
      params,
    };
    try {
      this.childProcess.stdin.write(JSON.stringify(payload) + "\n", "utf8");
    } catch {
      // Ignore notification write error
    }
  }

  private async rawRpcCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.childProcess || !this.childProcess.stdin || this.childProcess.stdin.destroyed) {
      throw new MCPTransportError(this.serverName, "El stream stdin del proceso MCP no está disponible o fue cerrado.");
    }

    const id = ++this.requestId;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    const currentTimeoutMs = this.getTimeoutMs();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const lastStderr = this.getLastStderr();
        if (lastStderr) {
          console.error(`[MCP] ${this.serverName} stderr: ${lastStderr}`);
        }
        reject(
          new MCPTransportError(
            this.serverName,
            `Timeout de ${currentTimeoutMs}ms esperando respuesta stdio para '${method}' (id: ${id}).`
          )
        );
      }, currentTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer, method });

      try {
        const line = JSON.stringify(payload) + "\n";
        this.childProcess!.stdin!.write(line, "utf8", (err) => {
          if (err) {
            clearTimeout(timer);
            this.pendingRequests.delete(id);
            reject(new MCPTransportError(this.serverName, `Error escribiendo a stdin: ${err.message}`, err));
          }
        });
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new MCPTransportError(this.serverName, `Error enviando mensaje por stdio: ${err.message}`, err));
      }
    });
  }

  private async rpcCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.startProcess();
    return await this.rawRpcCall<T>(method, params);
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.rpcCall<{ tools: MCPTool[] }>("tools/list");
    if (!result || !Array.isArray(result.tools)) {
      throw new MCPTransportError(this.serverName, "tools/list no devolvió una lista válida de herramientas.");
    }
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const result = await this.rpcCall<MCPCallResult>("tools/call", {
      name,
      arguments: args,
    });
    if (!result || typeof result !== "object") {
      throw new MCPTransportError(this.serverName, `tools/call a '${name}' devolvió un resultado malformado.`);
    }
    return result;
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    try {
      const result = await this.rpcCall<{ prompts: MCPPrompt[] }>("prompts/list");
      return result?.prompts || [];
    } catch {
      return [];
    }
  }

  async listResourceTemplates(): Promise<MCPResourceTemplate[]> {
    try {
      const result = await this.rpcCall<{ resourceTemplates: MCPResourceTemplate[] }>("resources/templates/list");
      return result?.resourceTemplates || [];
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<string> {
    const result = await this.rpcCall<{ contents: Array<{ text?: string }> }>("resources/read", { uri });
    return result?.contents?.[0]?.text || "";
  }

  async reconnect(): Promise<void> {
    this.permanentFailure = null;
    this.initPromise = null;
    this.stderrLines = [];
    await this.close();
    await this.listTools();
  }

  async close(): Promise<void> {
    this.connected = false;
    this.initialized = false;
    this.initPromise = null;
    this.stdoutBuffer = "";
    this.rejectAllPending(new MCPTransportError(this.serverName, "Transporte cerrado por reconexión o terminación."));

    if (this.childProcess && !this.childProcess.killed) {
      const pid = this.childProcess.pid;
      if (pid && process.platform === "win32") {
        try {
          // En Windows, termina el árbol de procesos completo (/T) forzadamente (/F) para evitar huérfanos de cmd.exe
          spawn("taskkill", ["/pid", pid.toString(), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } catch {
          try {
            this.childProcess.kill("SIGKILL");
          } catch { }
        }
      } else {
        try {
          this.childProcess.kill("SIGTERM");
        } catch {
          // Ignore kill errors
        }
      }
      this.childProcess = null;
    }
  }
}