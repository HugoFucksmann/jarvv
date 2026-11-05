/**
 * Capacidades de herramientas.
 * DOWNLOAD y CONFIGURATION: reservadas; ninguna herramienta del manifest las usa hoy (Guard y
 * NEEDS_APPROVAL ya las contemplan). COMMAND_EXECUTION solo la usa UNKNOWN_TOOL_POLICY (herramientas
 * no catalogadas); start_process es PROCESS_CONTROL.
 */
export type Capability =
  | "READ"
  | "PROCESS_CONTROL"
  | "FILE_READ"
  | "FILE_WRITE"
  | "COMMAND_EXECUTION"
  | "DOWNLOAD"
  | "CONFIGURATION";

export type GuardResult = "ALLOW" | "DENY" | "APPROVAL";

export interface GuardDecision {
  decision: GuardResult;
  reason?: string;
  capability: Capability;
}

export interface ToolPolicy {
  capability: Capability;
  requiresApproval: boolean;
  mutates: boolean;
  emptyIsError: boolean;
  /** Exenta del anti-loop (p. ej. sondeos repetidos de una misma salida). */
  loopExempt: boolean;
}
