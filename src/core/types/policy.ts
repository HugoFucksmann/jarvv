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
  /** Con `APPROVAL`: la confirmación del usuario es obligatoria aunque `autoMode` esté encendido (rutas sensibles). */
  mandatory?: boolean;
  capability: Capability;
}

/** Política de repetición de una herramienta (ver `RepeatPolicy` en `ctx/derive.ts`, que el contexto define por su cuenta). */
export type RepeatPolicy = "strict" | "retry_failed" | "allow";

export interface ToolPolicy {
  capability: Capability;
  requiresApproval: boolean;
  mutates: boolean;
  emptyIsError: boolean;
  /** Qué hacer con una llamada idéntica a una ya ejecutada (`strict`, `retry_failed`, `allow`); ver `isRepeat` en `ctx/derive.ts`. */
  repeat: RepeatPolicy;
}
