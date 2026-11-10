/**
 * JARVIS Core — Ejecutor de una llamada (`runCall`, Fase 5; PLAN_CONTEXT 5.2 y 5.3).
 *
 * Fases, en orden: descubrir herramientas → elegir herramienta (Decision #2) → argumentos (LLM) → resolver refs → huella
 * (`sig`) y anti-loop → Guard (política) → lista negra (en automático, el nivel 1 se rechaza aquí) → pre-chequeo determinista → confirmación del usuario (si Guard la exige
 * y no hay modo automático, o si la lista negra coincide y no hay modo automático: con ella, D3 no entra) → revisión de argumentos (Decisión 3, solo escrituras que no pidieron confirmación) → despacho (compite
 * contra la cancelación) → procesar el resultado → guardar la ref si hace falta → registrar la llamada → verificar.
 *
 * Registro en el contexto:
 * - Una llamada se registra UNA sola vez, al terminar el intento, con su `status` final y sin `verdict`. Un reintento es una
 *   llamada nueva. El `verdict` y la `reason` se escriben después, juntos, en un segundo `apply` (`verifyCall`).
 * - Con `ref`: el texto crudo se guarda en disco (`vault.put`) → `apply add ref` → `apply add call` con `ref = rN` (dos `apply`).
 * - `args` van como los propuso el modelo (refs sin resolver) con los strings recortados; `sig` sale de los argumentos ya
 *   resueltos y es `null` en `args_invalid` por validación y en `refs_unresolved`; un `args_invalid` de la revisión conserva su `sig`.
 * - No se registra nada mientras se espera la confirmación; cancelar ahí no deja llamada. Si la cancelación llega con la
 *   herramienta ya despachada se registra `interrupted` en ese momento y el resultado tardío se descarta.
 *
 * Esta función NUNCA llama a `finish` ni escribe `result` (Fase 6): devuelve un `CallOutcome` y quien llama decide.
 */

import { BUDGET } from "../budget.ts";
import type { CallKind, CallStatus, JsonObject, Op, TaskContext } from "../ctx/index.ts";
import { collectSources, precheckCall } from "./precheck.ts";
import type { IMCPServer } from "../mcp/types.ts";
import { blacklistMatch, isBlacklistedTool, type Blacklist } from "../policy/blacklist.ts";
import { Guard } from "../policy/guard.ts";
import { createRefLookup, resolveRefs } from "../refs/refResolver.ts";
import { RefVaultError } from "../refs/refVault.ts";
import { ContextOverflowError } from "../render/index.ts";
import { processResult } from "../result/processResult.ts";
import type { ProcessedResult } from "../result/processResult.ts";
import { applyDestination, getToolPolicy, isKnownTool, requirementOf, serverOf } from "../tools/manifest.ts";
import type { MCPTool } from "../types.ts";
import type { ExecutableRoute } from "../types/routes.ts";
import { errorMessage } from "../utils.ts";
import { argsInput, renderArgsView, reviewInput, reviewViewOptions, routeViewOptions, toolInput } from "./adapters.ts";
import { callLabel, clipArgs, clipWithin, computeSig } from "./args.ts";
import { captureCallTool } from "./capture.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";
import type { ModelFailureKind } from "./failures.ts";
import type { CallOutcome } from "./outcomes.ts";
import { factValue } from "./retries.ts";
import { reviewOutcome, verifyCall } from "./verify.ts";

export interface RunCallParams {
  readonly stepId: string;
  /** Destino de la llamada: en reactivo lo elige Decision #1; en deliberativo viene del plan. */
  readonly route: ExecutableRoute;
}

type Policy = ReturnType<typeof getToolPolicy>;

const CANCELLED: CallOutcome = { kind: "cancelled", callId: null };
const kindOf = (policy: Policy): CallKind => (policy.mutates ? "write" : "read");

/** Resumen de un texto fijo o de un error: recortado al tope; `null` si no hay texto (nunca `""`). */
function summaryText(text: string | null | undefined): string | null {
  const clean = text?.trim();
  return clean ? clipWithin(clean, BUDGET.summaryMax) : null;
}

/** Motivo fijo de un `args_invalid` de la revisión (D3): el modelo de decisión solo elige la opción, no dice qué argumento falla. */
export const REVIEW_ARGS_INVALID_NOTE =
  "The review found a wrong argument: a value is invented, copied incorrectly, or contradicts the task or the data read. Write the arguments again from the task and the data.";

const registered = (
  callId: string,
  status: CallStatus,
  verdict: "approved" | "rejected" | null = null,
  reason: "no_usable_data" | "not_accomplished" | null = null,
): CallOutcome => ({ kind: "registered", callId, status, verdict, reason });

/** Fallo de un modelo o de la infraestructura → cierre (o cancelación) con la llamada registrada, si la hay. */
function fromFailure(ctx: TaskContext, stepId: string, failure: ModelFailureKind, detail: unknown, callId: string | null = null): CallOutcome {
  const closure = closeOnFailure(ctx, stepId, failure, detail);
  return closure.kind === "cancelled" ? { kind: "cancelled", callId } : { kind: "close", stopReason: closure.stopReason, callId };
}

// ───────────────────────── Registro de la llamada ─────────────────────────

interface CallDraft {
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
function register(ctx: TaskContext, draft: CallDraft, extra: readonly Op[] = []): string {
  return ctx.apply([{ op: "add", target: "calls", value: { ...draft } }, ...extra]).ids[0];
}

// ───────────────────────── Descubrimiento ─────────────────────────

type Discovery =
  | { readonly kind: "ok"; readonly server: IMCPServer; readonly tools: MCPTool[] }
  | { readonly kind: "outcome"; readonly outcome: CallOutcome };

/**
 * Herramientas del catálogo que se pueden usar ahora: las que no exigen un proceso o una búsqueda activos, o cuyo requisito
 * se cumple, menos las vetadas enteras por la lista negra (FLUJO 2, opciones disponibles). Una herramienta cuya llamada se
 * bloqueó por repetición sigue disponible: el anti-bucle solo bloquea la llamada idéntica, y con otros argumentos pasa.
 */
function usableTools(ctx: TaskContext, mcp: string, cataloged: readonly MCPTool[], blacklist: Blacklist): MCPTool[] {
  const processActive = factValue(ctx, "process") !== null;
  const searchActive = ctx.find("calls", { tool: "start_search", status: "ok" }).length > 0;
  return cataloged.filter((t) => {
    if (isBlacklistedTool(blacklist, mcp, t.name, getToolPolicy(mcp, t.name).mutates)) return false;
    const required = requirementOf(mcp, t.name);
    return required === undefined || (required === "process" ? processActive : searchActive);
  });
}

/**
 * Rutas que se ofrecen a Decisión 1: las que tienen al menos una herramienta usable. Una ruta cuyo servidor o catálogo no
 * se puede consultar NO se descarta: el fallo aparece al ejecutar y cierra la tarea como infraestructura caída.
 */
export async function availableRoutes(env: EngineEnv, stepId: string, routes: readonly ExecutableRoute[]): Promise<ExecutableRoute[]> {
  const out = await routesWithTools(env, routes);
  // Una ruta cuyo resultado Decisión 4 rechazó `ROUTE_EXHAUSTED_AFTER` veces como "no cumple lo pedido" en este paso se deja de ofrecer: cambiar los
  // argumentos de la misma herramienta no resuelve lo que esa ruta no puede dar (p. ej. `list_directory` no trae tamaños). Si no quedara ninguna ruta, se ofrecen todas.
  const notAccomplished = (route: string): number =>
    env.ctx.find("calls", { stepId, route }).filter((c) => c.verdict === "rejected" && c.reason === "not_accomplished").length;
  const remaining = out.filter((route) => notAccomplished(route) < ROUTE_EXHAUSTED_AFTER);
  return remaining.length > 0 ? remaining : out;
}

/** Cuántos rechazos `not_accomplished` de Decisión 4 en un paso agotan una ruta (deja de ofrecerse a Decisión 1 en ese paso). */
export const ROUTE_EXHAUSTED_AFTER = 2;

async function routesWithTools(env: EngineEnv, routes: readonly ExecutableRoute[]): Promise<ExecutableRoute[]> {
  const { ctx, deps } = env;
  const out: ExecutableRoute[] = [];
  for (const route of routes) {
    const mcp = serverOf(route);
    let cataloged: MCPTool[] = [];
    try {
      cataloged = deps.discovery.getServer(mcp) ? applyDestination(route, await deps.discovery.getDiscoveredTools(mcp)) : [];
    } catch {
      cataloged = [];
    }
    if (cataloged.length === 0 || usableTools(ctx, mcp, cataloged, deps.blacklist).length > 0) out.push(route);
  }
  return out;
}

/**
 * Herramientas utilizables del destino. Servidor ausente, sin catálogo disponible o descubrimiento que falla =
 * infraestructura (`service_unavailable`, D4). Que tras filtrar las que exigen un proceso o una búsqueda activos no
 * quede ninguna NO es infraestructura: `no_tools` (D32).
 */
async function discoverTools(env: EngineEnv, stepId: string, route: ExecutableRoute, mcp: string): Promise<Discovery> {
  const { ctx, deps } = env;
  const unavailable = (detail: unknown): Discovery => ({ kind: "outcome", outcome: fromFailure(ctx, stepId, "unavailable", detail) });

  const server = deps.discovery.getServer(mcp);
  if (!server) return unavailable(`Servidor MCP '${mcp}' no disponible.`);

  let cataloged: MCPTool[];
  try {
    cataloged = applyDestination(route, await deps.discovery.getDiscoveredTools(mcp));
  } catch (error) {
    return unavailable(error);
  }
  if (cataloged.length === 0) {
    const down = deps.discovery.getUnavailableServers()[mcp];
    return unavailable(
      `Discovery: no hay herramientas catalogadas disponibles para el destino '${route}' en '${mcp}'` + (down ? `: servidor no disponible (${down.reason}).` : "."),
    );
  }

  const usable = usableTools(ctx, mcp, cataloged, deps.blacklist);
  if (usable.length === 0) {
    console.warn(`[Engine] no hay herramientas utilizables en el destino '${route}'.`);
    return { kind: "outcome", outcome: { kind: "no_tools" } };
  }
  return { kind: "ok", server, tools: usable };
}

// ───────────────────────── Cancelación en vuelo ─────────────────────────

type Raced<T> = { readonly kind: "done"; readonly value: T } | { readonly kind: "failed"; readonly error: unknown } | { readonly kind: "cancelled" };

/**
 * Compite la promesa contra la señal de cancelación (`callTool` no recibe señal). Si gana la señal, el resultado tardío
 * se descarta; el rechazo tardío se absorbe para que no quede una promesa rechazada sin manejar.
 */
function raceCancel<T>(promise: Promise<T>, signal: AbortSignal): Promise<Raced<T>> {
  const settled: Promise<Raced<T>> = promise.then(
    (value): Raced<T> => ({ kind: "done", value }),
    (error: unknown): Raced<T> => ({ kind: "failed", error }),
  );
  if (signal.aborted) return Promise.resolve({ kind: "cancelled" });
  return new Promise<Raced<T>>((resolve) => {
    const onAbort = (): void => resolve({ kind: "cancelled" });
    signal.addEventListener("abort", onAbort, { once: true });
    void settled.then((result) => {
      signal.removeEventListener("abort", onAbort);
      resolve(result); // si la señal ganó, `resolve` ya no tiene efecto: el resultado tardío se descarta
    });
  });
}

// ───────────────────────── Hecho `process` ─────────────────────────

const setProcessFact = (value: string | null, stepId: string): Op => ({ op: "set", target: "facts.process", value: { value, stepId } });

/**
 * Operaciones del hecho `process` a partir de la señal del procesador (5.2): alta al terminar `ok` la mutación que lanza el
 * proceso; baja (`value = null`) cuando el proceso ya no existe o una interacción devuelve `not_found`; con otros errores
 * el hecho se conserva.
 */
function processFactOps(ctx: TaskContext, stepId: string, mcp: string, tool: string, policy: Policy, processed: ProcessedResult): Op[] {
  const current = factValue(ctx, "process");
  const signal = processed.process;
  if (signal === undefined) {
    const interactionLost = processed.status === "not_found" && requirementOf(mcp, tool) === "process";
    return interactionLost && current !== null ? [setProcessFact(null, stepId)] : [];
  }
  const pid = String(signal.pid);
  if (signal.active) return processed.status === "ok" && policy.mutates && current !== pid ? [setProcessFact(pid, stepId)] : [];
  return current === pid ? [setProcessFact(null, stepId)] : [];
}

// ───────────────────────── runCall ─────────────────────────

export async function runCall(env: EngineEnv, params: RunCallParams): Promise<CallOutcome> {
  const { ctx, runtime, deps } = env;
  const { stepId, route } = params;
  const mcp = serverOf(route);

  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;

  // 1. Descubrir.
  const found = await discoverTools(env, stepId, route, mcp);
  if (found.kind === "outcome") return found.outcome;
  const { server, tools } = found;
  if (runtime.cancelled) return CANCELLED;

  // 2. Elegir la herramienta (Decision #2). Los intentos de la vista van filtrados a la ruta elegida.
  const routeView = ctx.view.forRoute(routeViewOptions(route));
  const toolQuery = await queryModel(() => env.decision.chooseTool(toolInput(routeView, route, tools), runtime.signal));
  if (!toolQuery.ok) return fromFailure(ctx, stepId, toolQuery.failure, toolQuery.error);
  if (runtime.cancelled) return CANCELLED;
  const tool = toolQuery.value.tool;

  // El catálogo del servidor pudo cambiar: `validateToolExists` refresca antes de dar la herramienta por inexistente.
  let exists: boolean;
  try {
    exists = await deps.discovery.validateToolExists(mcp, tool.name);
  } catch (error) {
    return fromFailure(ctx, stepId, "unavailable", error);
  }
  if (!exists) return fromFailure(ctx, stepId, "unavailable", `La herramienta '${tool.name}' ya no la expone el servidor '${mcp}'.`);
  if (runtime.cancelled) return CANCELLED;

  const policy = getToolPolicy(mcp, tool.name);
  const base = { stepId, route, tool: tool.name, kind: kindOf(policy) } as const;

  // 3. Argumentos (LLM). Una salida inválida es `args_invalid`; el LLM caído o el desborde cierran la tarea.
  const rendered = renderArgsView(ctx, tool.name);
  if (rendered.overflow) {
    // D26, D30: la vista no cabe en su límite; cierre sin `error`.
    console.error(`[Engine] ${new ContextOverflowError("forArgs", BUDGET.caps.effectsReserve, rendered.chars).message}`);
    return { kind: "close", stopReason: "unrecoverable", callId: null };
  }
  const environment = await deps.environment();
  // Intentos previos de esta herramienta en este paso que no se aprobaron (rechazados, bloqueados o con error): suben la temperatura.
  const priorAttempts = ctx.find("calls", { stepId, tool: tool.name }).filter((c) => c.verdict !== "approved").length;
  // Qwen ya reintenta una vez una salida inválida: aquí no se repite.
  const generation = await queryModel(
    () => env.llm.generateArgumentsFromView(argsInput(tool, environment, rendered.text, priorAttempts), runtime.signal),
    0,
  );
  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
  if (!generation.ok) {
    if (generation.failure !== "invalid") return fromFailure(ctx, stepId, generation.failure, generation.error);
    console.error("[Engine] argumentos inválidos:", errorMessage(generation.error));
    const callId = register(ctx, { ...base, args: null, sig: null, status: "args_invalid", summary: summaryText(errorMessage(generation.error)), ref: null });
    return registered(callId, "args_invalid");
  }
  const proposed = generation.value.args;
  const recorded = clipArgs(mcp, tool.name, proposed);

  // 4. Sustituir las refs `{{ref:rN}}` (asíncrono). Una ref desconocida o ilegible nunca llega literal a la herramienta.
  const resolution = await resolveRefs(proposed, createRefLookup(ctx, deps.vault), { ...tool.inputSchema });
  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
  if (resolution.unresolvedRefs.length > 0) {
    const callId = register(ctx, {
      ...base,
      args: recorded,
      sig: null,
      status: "refs_unresolved",
      summary: summaryText(`Referencias sin resolver: ${resolution.unresolvedRefs.join(", ")}`),
      ref: null,
    });
    return registered(callId, "refs_unresolved");
  }
  const resolved = resolution.resolvedArgs;

  // 5. Huella de los argumentos resueltos y anti-loop (un `denied` del servidor cuenta como ejecutada).
  const sig = computeSig(resolved);
  if (ctx.isRepeat(tool.name, sig, { exempt: policy.loopExempt })) {
    const callId = register(ctx, { ...base, args: recorded, sig, status: "loop_blocked", summary: null, ref: null });
    return registered(callId, "loop_blocked");
  }

  // 6. Política (Guard). DENY: la llamada queda `denied` y la tarea cierra con `security_denied` (regla B incluida).
  const guard = Guard.evaluate(mcp, tool.name, resolved, deps.guardScope);
  if (guard.decision === "DENY") {
    const callId = register(ctx, { ...base, args: recorded, sig, status: "denied", summary: summaryText(guard.reason), ref: null });
    return { kind: "close", stopReason: "security_denied", callId };
  }

  // 6a. Lista negra (reglas de comando integradas + configuración). Solo escrituras. Nivel 1 (`blocked`) con modo automático: se rechaza aquí con la razón
  // escrita (llega a FAIL; el modelo prueba otro comando y no cuenta contra el tope de rechazos de D3). Sin modo automático, cualquier coincidencia se
  // pregunta al usuario (paso 7). Nivel 2 (`sensitive`) con modo automático: sigue a D3 (paso 8) con umbral estricto.
  const auto = deps.autoMode();
  const listed = blacklistMatch(deps.blacklist, mcp, tool.name, policy.mutates, resolved);
  if (listed !== null && auto && listed.level === "blocked") {
    const callId = register(ctx, { ...base, args: recorded, sig, status: "tool_rejected", summary: summaryText(listed.reason), ref: null });
    return registered(callId, "tool_rejected");
  }

  // 6b. Pre-chequeo determinista (sin modelo): lo comprobable se rechaza con una razón escrita que llega al LLM de argumentos.
  const finding = await precheckCall({ tool: tool.name, kind: base.kind, args: resolved, sources: collectSources(ctx), environment });
  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
  if (finding !== null) {
    const callId = register(ctx, { ...base, args: recorded, sig, status: finding.review, summary: summaryText(finding.reason), ref: null });
    return registered(callId, finding.review);
  }

  // Modo automático: una herramienta del catálogo que pedía aprobación no se la pide al usuario y pasa por D3 (si escribe). Una no catalogada
  // (Guard la manda a aprobación por defecto) sigue pidiéndola. Sin modo automático, una coincidencia con la lista negra siempre se pregunta.
  const askUser = (guard.decision === "APPROVAL" && !(auto && isKnownTool(mcp, tool.name))) || (listed !== null && !auto);

  // 7. Confirmación del usuario, tras el pre-chequeo (no se le pide aprobar lo que ya se sabe inválido). No hay registro mientras se espera; cancelar aquí no deja llamada.
  if (askUser) {
    const approval = await runtime.requestApproval({
      mcp,
      tool: tool.name,
      capability: guard.capability,
      reason: listed !== null ? `Lista de seguridad (${listed.id}): ${listed.reason}` : (guard.reason ?? "Operación sensible"),
      args: recorded,
    });
    if (approval.kind === "cancelled" || runtime.cancelled || ctx.isClosed()) return CANCELLED;
    if (approval.kind === "rejected") {
      const callId = register(ctx, { ...base, args: recorded, sig, status: "user_rejected", summary: summaryText(approval.instruction), ref: null });
      return registered(callId, "user_rejected");
    }
  }

  // 8. Revisión de argumentos (Decisión 3): solo en las escrituras que el usuario no aprobó. Si el usuario las aprobó (paso 7), la
  // aprobación es la revisión y D3 no entra.
  // Una lectura no la pasa por D3: no deja cambios, la verificación posterior atrapa un resultado inútil y, medido, D3 rechazaba
  // lecturas correctas (con el pre-chequeo delante, solo suma falsos rechazos). Si rechaza una escritura, la llamada queda con su
  // `sig` (los argumentos sí se resolvieron) y con el `status` del escenario.
  if (base.kind === "write" && !askUser) {
    const reviewView = ctx.view.forReview(reviewViewOptions());
    const review = await queryModel(() => env.decision.reviewArgs(reviewInput(reviewView, route, tool, recorded), runtime.signal));
    if (!review.ok) return fromFailure(ctx, stepId, review.failure, review.error);
    if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
    // Nivel 2 de la lista negra (solo llega aquí en automático): umbral estricto. Si el comando habría pasado con el umbral normal y solo lo frena la
    // exigencia extra, no es un argumento inválido: se rechaza como `tool_rejected` (no cuenta contra el tope de rechazos de D3) y el modelo prueba otro camino.
    const strict = listed?.level === "sensitive";
    const reviewed = reviewOutcome(review.value, strict ? BUDGET.sensitiveApprove : undefined);
    if (reviewed !== "approved" && strict && reviewOutcome(review.value) === "approved") {
      const note = `${listed?.reason ?? "Sensitive command."} The safety review was not confident enough to run it automatically. Use a safer command or a different approach.`;
      const callId = register(ctx, { ...base, args: recorded, sig, status: "tool_rejected", summary: summaryText(note), ref: null });
      return registered(callId, "tool_rejected");
    }
    if (reviewed !== "approved") {
      const status: CallStatus = reviewed;
      const summary = status === "args_invalid" ? REVIEW_ARGS_INVALID_NOTE : null;
      const callId = register(ctx, { ...base, args: recorded, sig, status, summary, ref: null });
      return registered(callId, status);
    }
  }

  // 9. Despacho: compite contra la cancelación.
  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
  console.log(`[MCP → SEND] server=${mcp} tool=${tool.name} args=${JSON.stringify(resolved).slice(0, 300)}`);
  const raced = await raceCancel(captureCallTool(server, env.sink)(tool.name, resolved), runtime.signal);

  if (raced.kind === "cancelled") {
    if (ctx.isClosed()) return CANCELLED;
    const callId = register(ctx, { ...base, args: recorded, sig, status: "interrupted", summary: null, ref: null });
    console.warn(`[Engine] '${tool.name}' interrumpida por la cancelación; si responde después, el resultado se descarta.`);
    return { kind: "cancelled", callId };
  }
  if (ctx.isClosed()) return CANCELLED;

  const finishWithVerification = async (callId: string, status: CallStatus): Promise<CallOutcome> => {
    const verification = await verifyCall(env, callId);
    switch (verification.kind) {
      case "verified":
        return registered(callId, status, verification.verdict, verification.reason);
      case "skipped":
        return registered(callId, status);
      case "close":
        return { kind: "close", stopReason: verification.stopReason, callId };
      case "cancelled":
        return { kind: "cancelled", callId };
    }
  };

  if (raced.kind === "failed") {
    // `callTool` lanzó: la herramienta no produjo resultado. `exception` es de quien ejecuta (el procesador no lo produce).
    console.error(`[MCP ← ERROR] server=${mcp} tool=${tool.name}: ${errorMessage(raced.error)}`);
    const summary = summaryText(errorMessage(raced.error)) ?? "La herramienta lanzó una excepción.";
    const callId = register(ctx, { ...base, args: recorded, sig, status: "exception", summary, ref: null });
    return finishWithVerification(callId, "exception");
  }

  // 10. Procesar el resultado.
  console.log(`[MCP ← RECV] server=${mcp} tool=${tool.name} result=${JSON.stringify(raced.value).slice(0, 400)}`);
  const processed = processResult(mcp, tool.name, raced.value, resolved);

  // 11. Con `ref` (el resumen no contiene el resultado completo): disco → `add ref` → `add call` con `ref = rN`.
  let ref: string | null = null;
  let vaultFailed = false;
  if (processed.truncated && processed.fullText.length > 0) {
    try {
      const stored = await deps.vault.put(ctx.task.id, processed.fullText);
      if (ctx.isClosed()) return CANCELLED;
      ref = ctx.apply({
        op: "add",
        target: "refs",
        value: { stepId, label: callLabel(tool.name, resolved, processed.fullText), size: stored.size, where: stored.where },
      }).ids[0];
    } catch (error) {
      if (!(error instanceof RefVaultError)) throw error;
      // D7: la herramienta ya se ejecutó. La llamada se registra sin `ref` (el resumen queda incompleto), con el error.
      console.error(`[Engine] no se pudo guardar el resultado completo de '${tool.name}': ${error.message}`);
      vaultFailed = true;
    }
  }
  if (ctx.isClosed()) return CANCELLED;

  const factOps = processFactOps(ctx, stepId, mcp, tool.name, policy, processed);
  const errorOps: Op[] = vaultFailed ? [{ op: "add", target: "errors", value: { stepId, kind: "service_unavailable" } }] : [];
  const callId = register(
    ctx,
    { ...base, args: recorded, sig, status: processed.status, summary: processed.summary, ref },
    [...errorOps, ...factOps],
  );
  if (vaultFailed) return { kind: "close", stopReason: "unrecoverable", callId };

  // 12. Verificar (segundo `apply`: `verdict` y `reason` juntos).
  return finishWithVerification(callId, processed.status);
}