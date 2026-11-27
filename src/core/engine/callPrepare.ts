/**
 * JARVIS Core — Preparación de una llamada (`runCall`, fases 1 a 5): descubrir y elegir la herramienta, generar los argumentos y calcular su huella.
 *
 * Son las fases que dependen de los modelos (Decisión 2 y el LLM de argumentos). Terminan con una `PreparedCall` (argumentos y huella ya calculados) o con un
 * `CallOutcome` que corta la llamada: la cancelación, un modelo o un servidor caído, o un `args_invalid` por salida inválida (que acá sí se registra). El anti-bucle y
 * todo lo que sigue —autorizar, confirmar, revisar, ejecutar— lo encadena `runCall`.
 */

import { BUDGET } from "../budget.ts";
import type { CallKind } from "../ctx/index.ts";
import type { UserEnvironment } from "../environment.ts";
import type { IMCPServer } from "../mcp/types.ts";
import { isReadOnlyCall } from "../policy/readOnly.ts";
import { ContextOverflowError } from "../render/index.ts";
import { expandPathAliases } from "../tools/filePaths.ts";
import { composesFromReads, getToolPolicy, repeatPolicyOf, serverOf, sortByCatalog } from "../tools/manifest.ts";
import type { MCPTool } from "../types.ts";
import type { ExecutableRoute } from "../types/routes.ts";
import { errorMessage } from "../utils.ts";
import { argsInput, renderArgsView, routeViewOptions, toolInput } from "./adapters.ts";
import { clipArgs, computeSig } from "./args.ts";
import { discoverTools } from "./callDiscovery.ts";
import { CANCELLED, fromFailure, register, registered, summaryText } from "./callRecord.ts";
import type { Policy, PreparedCall } from "./callRecord.ts";
import { allReadIds, chooseReads } from "./readSelection.ts";
import type { EngineEnv } from "./env.ts";
import { pauseOf, queryModel } from "./failures.ts";
import type { CallOutcome } from "./outcomes.ts";
import { recordUserMemory } from "./recalled.ts";

/** La llamada se corta con este resultado. */
export interface Stop {
  readonly kind: "stop";
  readonly outcome: CallOutcome;
}

const stop = (outcome: CallOutcome): Stop => ({ kind: "stop", outcome });
const STOP_CANCELLED: Stop = stop(CANCELLED);

const kindOf = (policy: Policy): CallKind => (policy.mutates ? "write" : "read");

// ───────────────────────── Fases 1 y 2: descubrir y elegir la herramienta ─────────────────────────

interface SelectedTool {
  readonly kind: "selected";
  readonly server: IMCPServer;
  readonly tool: MCPTool;
}

/**
 * Descubre las herramientas utilizables del destino y elige una (Decisión 2). Los intentos de la vista van filtrados a la ruta elegida y las opciones van en el orden del
 * catálogo, no en el del descubrimiento del servidor (DN-3.7). El catálogo del servidor pudo cambiar: `validateToolExists` refresca antes de dar la herramienta por inexistente.
 */
export async function selectTool(env: EngineEnv, stepId: string, route: ExecutableRoute): Promise<SelectedTool | Stop> {
  const { ctx, runtime, deps } = env;
  const mcp = serverOf(route);

  // 1. Descubrir.
  const found = await discoverTools(env, stepId, route, mcp);
  if (found.kind === "outcome") return stop(found.outcome);
  const { server, tools } = found;
  if (runtime.cancelled) return STOP_CANCELLED;

  // 2. Elegir la herramienta (Decision #2).
  const routeView = ctx.view.forRoute(routeViewOptions(route));
  const options = sortByCatalog(mcp, tools);
  const toolQuery = await queryModel(() => env.decision.chooseTool(toolInput(routeView, route, options), runtime.signal), pauseOf(env, "decision")); // DN-3.4: Decision es determinista, repetir da lo mismo
  if (!toolQuery.ok) return stop(fromFailure(env, stepId, toolQuery.failure, toolQuery.error));
  if (runtime.cancelled) return STOP_CANCELLED;
  const tool = toolQuery.value.tool;

  let exists: boolean;
  try {
    exists = await deps.discovery.validateToolExists(mcp, tool.name);
  } catch (error) {
    return stop(fromFailure(env, stepId, "unavailable", error));
  }
  if (!exists) return stop(fromFailure(env, stepId, "unavailable", `La herramienta '${tool.name}' ya no la expone el servidor '${mcp}'.`));
  if (runtime.cancelled) return STOP_CANCELLED;

  return { kind: "selected", server, tool };
}

// ───────────────────────── Fases 3 a 5: argumentos y huella ─────────────────────────

interface PreparedResult {
  readonly kind: "prepared";
  readonly call: PreparedCall;
  /** Datos de esta PC, ya consultados: los necesitan la autorización y los niveles. */
  readonly environment: UserEnvironment;
}

/**
 * Genera los argumentos (LLM) y arma la llamada preparada. Una salida inválida es `args_invalid`; el LLM caído o el desborde de la vista cierran la tarea. Los
 * argumentos propuestos (`resolved`) son los que se ejecutan: las refs son solo para depurar y para el pre-chequeo, el modelo no las usa. Desde acá la llamada tiene
 * huella y se registra con los mismos `args` y `sig`.
 */
export async function prepareArgs(env: EngineEnv, stepId: string, route: ExecutableRoute, selected: SelectedTool): Promise<PreparedResult | Stop> {
  const { ctx, runtime, deps } = env;
  const { server, tool } = selected;
  const mcp = serverOf(route);
  const policy = getToolPolicy(mcp, tool.name);

  // 3. Argumentos (LLM).
  const stepText = ctx.find("steps", {}).find((s) => s.id === stepId)?.instruction ?? "";
  await recordUserMemory(env, `${ctx.task.request}\n${stepText}`, stepId);
  if (runtime.cancelled || ctx.isClosed()) return STOP_CANCELLED;

  // Las lecturas que ve el generador: las que el paso necesita, no solo las últimas (`engine/readSelection.ts`); si el paso escribe un texto compuesto con lo leído, todas.
  const readIds = composesFromReads(mcp, tool.name) ? allReadIds(env) : await chooseReads(env, stepText);
  if (runtime.cancelled || ctx.isClosed()) return STOP_CANCELLED;
  const rendered = renderArgsView(ctx, tool.name, readIds);
  if (rendered.overflow) {
    // D26, D30: la vista no cabe en su límite; cierre sin `error`.
    console.error(`[Engine] ${new ContextOverflowError("forArgs", BUDGET.caps.effectsReserve, rendered.chars).message}`);
    return stop({ kind: "close", stopReason: "unrecoverable", callId: null });
  }
  const environment = await deps.environment();
  const generateArgs = (attempts: number) =>
    queryModel(() => env.llm.generateArgumentsFromView(argsInput(tool, environment, rendered.text, attempts), runtime.signal), pauseOf(env, "llm"));
  // Intentos previos de esta herramienta en este paso que no se aprobaron (rechazados, bloqueados o con error): suben la temperatura.
  // Un `waiting_input` no es un intento fallido: el proceso pidió una respuesta y la llamada siguiente (`{ pid, input }`) necesita precisión, no variedad.
  const priorAttempts = ctx.find("calls", { stepId, tool: tool.name }).filter((c) => c.verdict !== "approved" && c.status !== "waiting_input").length;
  // Una llamada idéntica a una ya hecha no es una candidata válida (anti-bucle): se vuelve a generar con más temperatura, sin registrar nada, hasta `BUDGET.argsRegenerations`
  // veces. Si sigue igual, la llamada sale repetida y `runCall` la registra como `loop_blocked`: la herramienta no tiene otra llamada que ofrecer en este paso.
  // Qwen ya reintenta una vez una salida inválida: aquí no se repite.
  let regeneration = 0;
  let generation: Awaited<ReturnType<typeof generateArgs>>;
  for (; ;) {
    generation = await generateArgs(priorAttempts + regeneration);
    if (runtime.cancelled || ctx.isClosed()) return STOP_CANCELLED;
    if (!generation.ok || regeneration >= BUDGET.argsRegenerations) break;
    const candidate = expandPathAliases(generation.value.args, environment);
    const repeated = ctx.isRepeat(tool.name, computeSig(candidate), { policy: repeatPolicyOf(mcp, tool.name, candidate), stepId });
    if (!repeated) break;
    regeneration++;
  }
  if (!generation.ok) {
    if (generation.failure !== "invalid") return stop(fromFailure(env, stepId, generation.failure, generation.error));
    const callId = register(ctx, {
      stepId,
      route,
      tool: tool.name,
      kind: kindOf(policy),
      args: null,
      sig: null,
      status: "args_invalid",
      summary: summaryText(errorMessage(generation.error)),
      ref: null,
    });
    return stop(registered(callId, "args_invalid"));
  }
  // Un alias de carpeta (`desktop`, `desktop\Archivos`) pasa a ruta absoluta ahora: Guard, pre-chequeo, `allowedDirectories` y la herramienta ven la misma ruta.
  const resolved = expandPathAliases(generation.value.args, environment);
  const recorded = clipArgs(mcp, tool.name, resolved);

  // 4. Un comando de terminal que solo lee es una lectura aunque `run_command` sea una escritura por catálogo (`policy/readOnly.ts`): su salida va a DATA, no pide
  // confirmación y no pasa por D3. Desde acá la llamada se registra con este `kind`.
  const kind: CallKind = isReadOnlyCall(mcp, tool.name, resolved, deps.guardScope.homeDirs) ? "read" : kindOf(policy);

  // 5. Huella de los argumentos resueltos.
  const sig = computeSig(resolved);
  return { kind: "prepared", environment, call: { stepId, route, mcp, server, tool, policy, kind, resolved, recorded, sig, ...(readIds === undefined ? {} : { readIds }) } };
}
