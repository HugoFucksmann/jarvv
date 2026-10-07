/**
 * MCP Protocol Transport — Real Stdio / JSON-RPC Transport Client
 * Connects to local MCP servers running on the user's system via stdio.
 * 
 * Implements:
 * - JSON-RPC 2.0 protocol over stdio (newline-delimited messages).
 * - Persistent child process per MCP server across requests.
 * - Request correlation via JSON-RPC IDs.
 * - Chunk buffering and line framing on stdout.
 * - Stderr logging without corrupting JSON-RPC stream.
 * - tools/list
 * - tools/call
 * - prompts/list
 * - resources/templates/list
 * - resources/read
 * - Reconnection, session persistence, and clean process termination.
 */

import { MCPTool, MCPCallResult } from "../types.ts";
import { MCPPrompt, MCPResourceTemplate } from "./types.ts";
import { spawn, type ChildProcess } from "node:child_process";

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
  /** Set when the process exits fatally before initialization completes (e.g. ImportError).
   *  Prevents infinite retry loops. Cleared only by an explicit reconnect(). */
  private permanentFailure: MCPTransportError | null = null;

  constructor(
    public readonly serverName: string,
    public readonly config: StdioConfig,
    private readonly timeoutMs: number = 30000
  ) {}

  isConnected(): boolean {
    return this.connected && this.childProcess !== null && !this.childProcess.killed;
  }

  /** Returns the permanent failure error if this transport has crashed unrecoverably, or null. */
  getPermanentFailure(): MCPTransportError | null {
    return this.permanentFailure;
  }

  private async startProcess(): Promise<ChildProcess> {
    // If this transport has permanently failed, surface the original error immediately
    // without attempting to restart the process. Call reconnect() to retry.
    if (this.permanentFailure) {
      throw this.permanentFailure;
    }

    if (this.childProcess && !this.childProcess.killed && this.connected) {
      return this.childProcess;
    }

    if (!this.config.command || !this.config.command.trim()) {
      throw new MCPTransportError(
        this.serverName,
        `El comando stdio para '${this.serverName}' no está configurado.`
      );
    }

    const command = this.config.command;
    const args = this.config.args || [];
    const env = {
      ...process.env,
      ...(this.config.env || {}),
    };

    // Track whether initialization completed successfully
    let initCompleted = false;

    try {
      const child = spawn(command, args, {
        env,
        cwd: this.config.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      });

      this.childProcess = child;
      this.stdoutBuffer = "";
      this.connected = true;

      // Frame incoming stdout by newlines (\n or \r\n) with buffer preservation for chunked messages
      child.stdout?.on("data", (chunk: Buffer | string) => {
        this.handleStdoutData(chunk.toString());
      });

      // Capture stderr without corrupting the JSON-RPC pipe
      child.stderr?.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        this.stderrLines.push(text);
        if (this.stderrLines.length > 50) {
          this.stderrLines.shift();
        }
      });

      child.on("error", (err: Error) => {
        this.connected = false;
        this.initialized = false;
        const transportErr = new MCPTransportError(this.serverName, `Fallo en proceso hijo: ${err.message}`, err);
        if (!initCompleted) {
          // Process failed before initialization — mark as permanently failed
          this.permanentFailure = transportErr;
          console.error(`[MCP '${this.serverName}'] Fallo permanente al iniciar proceso: ${err.message}`);
        }
        this.rejectAllPending(transportErr);
      });

      child.on("exit", (code, signal) => {
        this.connected = false;
        this.initialized = false;
        const lastStderr = this.stderrLines.slice(-5).join("\n").trim();
        const reason = `El proceso MCP '${this.serverName}' terminó (código: ${code}, señal: ${signal}). ${
          lastStderr ? `Stderr: ${lastStderr}` : ""
        }`;
        const transportErr = new MCPTransportError(this.serverName, reason);
        if (!initCompleted && code !== 0) {
          // Process exited with error before initialization completed — permanent failure
          this.permanentFailure = transportErr;
          console.error(
            `[MCP '${this.serverName}'] Fallo permanente (exit ${code}). No se reintentará hasta reconnect(). Stderr: ${
              lastStderr || "(sin stderr)"
            }`
          );
        }
        this.rejectAllPending(transportErr);
        this.childProcess = null;
      });

      // Perform MCP initialization handshake if not yet initialized
      if (!this.initialized) {
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
          // If server is lightweight and does not implement 'initialize', proceed gracefully
        }
        this.initialized = true;
        initCompleted = true;
      } else {
        initCompleted = true;
      }

      return child;
    } catch (err: any) {
      this.connected = false;
      this.initialized = false;
      const transportErr = new MCPTransportError(
        this.serverName,
        `No fue posible iniciar el proceso MCP '${command} ${args.join(" ")}': ${err.message}`,
        err
      );
      if (!initCompleted) {
        this.permanentFailure = transportErr;
        console.error(`[MCP '${this.serverName}'] Fallo permanente al iniciar: ${err.message}`);
      }
      throw transportErr;
    }
  }

  private handleStdoutData(data: string): void {
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    // Keep the last incomplete segment in buffer
    this.stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: any;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        // Non-JSON line from server output (banner/log), ignore
        continue;
      }

      // Check if message is a JSON-RPC response with id
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

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new MCPTransportError(
            this.serverName,
            `Timeout de ${this.timeoutMs}ms esperando respuesta stdio para '${method}' (id: ${id}).`
          )
        );
      }, this.timeoutMs);

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
    // Clear any permanent failure state before attempting reconnect
    this.permanentFailure = null;
    this.stderrLines = [];
    await this.close();
    await this.listTools();
  }

  async close(): Promise<void> {
    this.connected = false;
    this.initialized = false;
    this.stdoutBuffer = "";
    this.rejectAllPending(new MCPTransportError(this.serverName, "Transporte cerrado por reconexión o terminación."));

    if (this.childProcess && !this.childProcess.killed) {
      try {
        this.childProcess.kill("SIGTERM");
      } catch {
        // Ignore kill errors
      }
      this.childProcess = null;
    }
  }
}

