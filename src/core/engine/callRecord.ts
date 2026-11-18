/**
 * JARVIS Core — Registro de una llamada en el contexto (compartido por las fases de `runCall`).
 *
 * Una llamada se registra UNA sola vez, al terminar el intento, con su `status` final y sin `verdict` (el veredicto lo escribe `verifyCall` después). Acá viven
 * lo que comparten las fases que registran o devuelven un `CallOutcome`: la llamada preparada (`PreparedCall`), el borrador (`CallDraft`), `register`,
 * `recordCall` y los constructores de resultado (`registered`, `fromFailure`).
 */

import { BUDGET } from "../budget.ts";
import type { CallKind, CallStatus, JsonObject, Op, TaskContext, VerdictReason } from "../ctx/index.ts";
import type { IMCPServer } from "../mcp/types.ts";
import type { getToolPolicy } from "../tools/manifest.ts";
import type { MCPTool } from "../types.ts";
import type { ExecutableRoute } from "../types/routes.ts";
import { clipWithin } from "./args.ts";
import { closeOnFailure } from "./failures.ts";
import type { ModelFailureKind } from "./failures.ts";
import type { EngineEnv } from "./env.ts";
import type { CallOutcome } from "./outcomes.ts";

export type Policy = ReturnType<typeof getToolPolicy>;

export const CANCELLED: CallOutcome = { kind: "cancelled", callId: null };

/** Resumen de un texto fijo o de un error: recortado al tope; `null` si no hay texto (nunca `""`). */
export function summaryText(text: string | null | undefined): string | null {
  const clean = text?.trim();
  return clean ? clipWithin(clean, BUDGET.summaryMax) : null;
}

export const registered = (
  callId: string,
  status: CallStatus,
  verdict: "approved" | "rejected" | null = null,
  reason: VerdictReason | null = null,
  waiting?: { readonly prompt?: string; readonly pid?: string },
): CallOutcome => ({
  kind: "registered",
  callId,
  status,
  verdict,
  reason,
  ...(waiting?.prompt === undefined ? {} : { prompt: waiting.prompt }),
  ...(waiting?.pid === undefined ? {} : { pid: waiting.pid }),
});

/** Fallo de un modelo o de la infraestructura → cierre (o cancelación) con la llamada registrada, si la hay. */
export function fromFailure(env: Pick<EngineEnv, "ctx" | "state">, stepId: string, failure: ModelFailureKind, detail: unknown, callId: string | null = null): CallOutcome {
  const closure = closeOnFailure(env, stepId, failure, detail);
  return closure.kind === "cancelled" ? { kind: "cancelled", callId } : { kind: "close", stopReason: closure.stopReason, callId };
}

// ───────────────────────── Registro de la llamada ─────────────────────────

export interface CallDraft {
  readonly stepId: string;
  readonly route: ExecutableRoute;
  readonly tool: string;
  readonly kind: CallKind;
  readonly args: JsonObject | null;
  readonly sig: string | null;
  readonly status: CallStatus;
  readonly summary: string | null;
  readonly ref: string | null;
}

/** Agrega la llamada (y las operaciones extra del mismo lote) y devuelve su id. La llamada es siempre la primera `add`. */
export function register(ctx: TaskContext, draft: CallDraft, extra: readonly Op[] = []): string {
  return ctx.apply([{ op: "add", target: "calls", value: { ...draft } }, ...extra]).ids[0];
}

/**
 * Una llamada con sus argumentos ya generados y su huella: lo que las fases posteriores a «argumentos» necesitan para registrarla y ejecutarla. `resolved` son los
 * argumentos que se ejecutan; `recorded`, los mismos con los strings recortados (lo que queda en el contexto); `kind` ya tiene en cuenta que un comando de solo lectura
 * es una lectura.
 */
export interface PreparedCall {
  readonly stepId: string;
  readonly route: ExecutableRoute;
  readonly mcp: string;
  readonly server: IMCPServer;
  /** La herramienta elegida (su nombre es `tool.name`; la revisión de argumentos necesita el objeto entero). */
  readonly tool: MCPTool;
  readonly policy: Policy;
  readonly kind: CallKind;
  readonly resolved: Record<string, unknown>;
  readonly recorded: JsonObject;
  readonly sig: string;
}

/** Registra la llamada preparada con el `status` dado: con sus `args` y `sig`, sin `ref` salvo que se indique. */
export function recordCall(ctx: TaskContext, call: PreparedCall, status: CallStatus, summary: string | null = null, ref: string | null = null, extra: readonly Op[] = []): string {
  return register(ctx, { stepId: call.stepId, route: call.route, tool: call.tool.name, kind: call.kind, args: call.recorded, sig: call.sig, status, summary, ref }, extra);
}
