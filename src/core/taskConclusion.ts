/**
 * JARVIS Core — Cierre de tareas: conclusión, respuesta final y cierre por excepción.
 */

import { MAX_EVIDENCE_OBS_CHARS, isTerminalState, type Task, type TaskState, type TimeSpan } from "./types.ts";
import { getToolPolicy } from "./tools/manifest.ts";
import { recordTaskTrace } from "./taskTrace.ts";
import { type TaskExecutionContext, buildEffectsContext } from "./context.ts";
import type { EngineDependencies } from "./engineDeps.ts";
import { LLMServiceUnavailableError, LLMValidationError, RequestAbortedError, TransportError } from "./llmTransport.ts";
import { sanitizeForMemory } from "./processor/text.ts";
import { errorMessage } from "./utils.ts";

/** Una cancelación del usuario nunca es un error que reportar. */
export const isCancellation = (context: TaskExecutionContext, err: unknown): boolean =>
    context.isCancelled || err instanceof RequestAbortedError;

/**
 * ¿La tarea fue cancelada? Se lee de nuevo en cada llamada: tras un `await` la tarea pudo cancelarse, y una comparación
 * directa de `task.state` conserva el estrechamiento de tipos previo al `await`.
 */
const wasCancelled = (context: TaskExecutionContext): boolean =>
    context.isCancelled || context.task.state === "CANCELLED";

export const buildAllEffects = (task: Task): string[] => buildEffectsContext(task, Number.POSITIVE_INFINITY);

/** Mutaciones recientes que se aportan como evidencia a la respuesta final. */
const MAX_ACTION_EVIDENCE = 3;
/** Tope del motivo de detención cuando es la única evidencia disponible. */
const MAX_ABORT_EVIDENCE_CHARS = 1500;
/** Respuesta de respaldo: últimas acciones del LOG, lecturas incluidas y tope de cada dato/lectura. */
const FALLBACK_LOG_LINES = 5;
const FALLBACK_READS = 2;
const FALLBACK_FACT_CHARS = 200;
const FALLBACK_READ_CHARS = 600;

const STATE_LABEL: Partial<Record<TaskState, string>> = { COMPLETED: "Completada", PARTIAL: "Parcial", FAILED: "Fallida" };

/** Línea de resumen que se registra al cerrar (o cancelar) una tarea. */
export const formatTaskSummary = (context: TaskExecutionContext, state: TaskState, reason: string): string =>
    `[Task Summary] id=${context.task.id} state=${state} reason="${reason}" calls=${context.totalToolCalls} escalations=${context.escalations} duration=${Date.now() - context.startTime}ms`;

/** Única regla de cierre incompleto: PARTIAL si hubo trabajo hecho (algún paso vigente COMPLETED o UNVERIFIED); FAILED si no. */
export function resolveIncompleteState(task: Task): TaskState {
    const live = task.steps.filter((s) => !s.superseded);
    return live.some((s) => s.state === "COMPLETED" || s.state === "UNVERIFIED") ? "PARTIAL" : "FAILED";
}

/** Cierra la tarea como PARTIAL o FAILED según lo logrado. */
export function concludeAsFailure(context: TaskExecutionContext, deps: EngineDependencies, reason: string): Promise<void> {
    return concludeTask(context, resolveIncompleteState(context.task), deps, reason);
}

/**
 * Cierra la tarea ante un fallo de infraestructura LLM (Qwen o Decision no disponibles, salida inválida
 * persistente). La cancelación se ignora. Devuelve siempre false.
 */
export async function concludeOnLLMError(
    context: TaskExecutionContext,
    deps: EngineDependencies,
    what: string,
    err: unknown
): Promise<false> {
    if (isCancellation(context, err) || isTerminalState(context.task.state)) return false;
    const msg = errorMessage(err);
    console.error(`[${what}] ${msg}`);
    await concludeAsFailure(context, deps, `${what}: ${msg}`);
    return false;
}

/**
 * Cierra como FAILED una tarea cuyo pipeline lanzó una excepción. Único punto de cierre por excepción.
 * La cancelación y los estados terminales no se pisan. Deja siempre una respuesta final legible, sin depender de Qwen.
 */
export function failTask(context: TaskExecutionContext, deps: EngineDependencies, err: unknown): void {
    const { task } = context;
    if (isCancellation(context, err) || isTerminalState(task.state)) return;

    const msg = errorMessage(err);
    console.error(formatTaskSummary(context, "FAILED", msg));
    task.state = "FAILED";
    task.waitingReason = undefined;
    task.pendingQuestion = undefined;
    task.finalResponse = task.finalResponse || `La tarea falló: ${msg}`;
    task.finalResponseSource = task.finalResponseSource ?? "fallback";
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "FAILED", error: msg, finalResponse: task.finalResponse });
    recordTaskTrace(context);
}

/** Por qué no se pudo redactar la respuesta final con el modelo (texto fijo, sin prosa del modelo). */
function describeSynthesisFailure(err: unknown): string {
    if (err instanceof LLMServiceUnavailableError) {
        return err.cause instanceof TransportError && err.cause.kind === "timeout"
            ? "el modelo no respondió a tiempo"
            : "el modelo no estuvo disponible";
    }
    if (err instanceof LLMValidationError) return "el modelo devolvió una respuesta inutilizable";
    return "error inesperado al redactar la respuesta";
}

/**
 * Respuesta final de respaldo cuando el modelo no pudo redactarla. Contrato fijo y determinista: solo usa datos ya
 * validados de la memoria; la evidencia cruda se limita a la última lectura y va rotulada como tal.
 */
export function buildFallbackResponse(
    task: Task,
    state: TaskState,
    abortReason: string | undefined,
    synthesisFailure: string,
    effects: string[],
    lastReads: string[]
): string {
    const memory = task.memory;
    const facts = Object.entries(memory?.facts || {});
    const fail = memory?.fail || [];
    const log = memory?.log || [];
    const bullets = (lines: string[]): string => lines.map((l) => `• ${l}`).join("\n");

    const sections: string[] = [
        `Resumen automático: no se pudo redactar la respuesta final (${synthesisFailure}).`,
        `Estado de la tarea: ${STATE_LABEL[state] ?? state}.`,
    ];
    if (abortReason) sections.push(`Motivo de detención: ${abortReason}`);
    if (fail.length > 0) sections.push(`Fallos registrados (${fail.length}):\n${bullets(fail)}`);
    sections.push(
        effects.length > 0
            ? `Cambios aplicados en el entorno (permanecen aunque su paso no se haya aprobado):\n${bullets(effects)}`
            : "Cambios aplicados en el entorno: ninguno registrado."
    );
    if (facts.length > 0) sections.push(`Datos registrados:\n${bullets(facts.map(([k, v]) => `${k}: ${sanitizeForMemory(v, FALLBACK_FACT_CHARS)}`))}`);
    if (log.length > 0) sections.push(`Últimas acciones (paso|acción|estado|hallazgo):\n${bullets(log.slice(-FALLBACK_LOG_LINES))}`);
    if (lastReads.length > 0) sections.push(`Última lectura (texto sin procesar):\n${lastReads.map((r) => sanitizeForMemory(r, FALLBACK_READ_CHARS)).join("\n---\n")}`);
    return sections.join("\n\n");
}

/** Evidencia que se entrega al modelo (y a la plantilla de respaldo) al redactar la respuesta final. */
interface ConclusionEvidence {
    /** Lecturas con datos (p. ej. resultados de una búsqueda anterior): no deben perderse aunque haya llamadas posteriores. */
    dataEvidence: string[];
    evidenceSummaries: string[];
}

function collectEvidence(context: TaskExecutionContext, abortReason: string | undefined): ConclusionEvidence {
    const dataEvidence = context.dataObs.map((o) => `${o.label}: ${o.text}`);
    const actionEvidence = context.task.steps
        .flatMap((s) => s.calls || [])
        .filter((c) => getToolPolicy(c.mcp, c.tool).mutates)
        .slice(-MAX_ACTION_EVIDENCE)
        .map((c) => {
            const obs = (c.evidence?.obs || c.evidence?.summary || "").trim().slice(0, MAX_EVIDENCE_OBS_CHARS);
            return obs ? `${c.tool}: ${obs}` : "";
        })
        .filter(Boolean);
    const evidenceSummaries = [...dataEvidence, ...actionEvidence];
    if (evidenceSummaries.length === 0 && abortReason) {
        evidenceSummaries.push(`abort: ${abortReason.slice(0, MAX_ABORT_EVIDENCE_CHARS)}`);
    }
    return { dataEvidence, evidenceSummaries };
}

interface SynthesisRaw {
    rawInput?: string;
    rawOutput?: string;
    timing?: TimeSpan;
    synthesisError?: string;
}

/** Redacta la respuesta final con Qwen; si falla, usa la plantilla determinista. Deja `finalResponse` y su origen en la tarea. */
async function synthesizeFinalResponse(
    context: TaskExecutionContext,
    deps: EngineDependencies,
    state: TaskState,
    abortReason: string | undefined,
    evidence: ConclusionEvidence
): Promise<SynthesisRaw> {
    const { task } = context;
    try {
        const finalRes = await deps.llm.generateFinalResponse({
            goal: task.message,
            logLines: task.memory?.log || [],
            facts: task.memory?.facts || {},
            failLines: task.memory?.fail || [],
            effects: buildAllEffects(task),
            evidenceSummaries: evidence.evidenceSummaries,
            abortReason,
        }, context.abortController.signal);
        task.finalResponse = finalRes.response;
        task.finalResponseSource = "model";
        return { rawInput: finalRes.rawInput, rawOutput: finalRes.rawOutput, timing: finalRes.timing };
    } catch (err) {
        if (!isCancellation(context, err)) {
            console.error(`[concludeTask] Error al generar respuesta final con Qwen:`, errorMessage(err));
        }
        // Se conserva lo que ya se envió al modelo para poder auditar el fallo (nunca pensamiento del modelo).
        const raw: SynthesisRaw = {};
        if (err instanceof LLMServiceUnavailableError) {
            raw.rawInput = err.raw?.rawInput;
            raw.timing = err.raw?.timing;
        } else if (err instanceof LLMValidationError) {
            raw.rawInput = err.raw?.rawInput;
            raw.rawOutput = err.raw?.rawOutput;
            raw.timing = err.raw?.timing;
        }
        raw.synthesisError = describeSynthesisFailure(err);
        task.finalResponse = buildFallbackResponse(
            task,
            state,
            abortReason,
            raw.synthesisError,
            buildAllEffects(task),
            evidence.dataEvidence.slice(-FALLBACK_READS)
        );
        task.finalResponseSource = "fallback";
        return raw;
    }
}

export async function concludeTask(
    context: TaskExecutionContext,
    state: TaskState,
    deps: EngineDependencies,
    abortReason?: string
): Promise<void> {
    const { task } = context;

    // Invarianza de estados terminales: si la tarea ya fue cancelada, ningún resultado tardío la altera.
    if (wasCancelled(context)) {
        console.log(`[concludeTask] Tarea ${task.id} previamente cancelada. Ignorando conclusión tardía.`);
        return;
    }

    const evidence = collectEvidence(context, abortReason);
    const synthesis = await synthesizeFinalResponse(context, deps, state, abortReason, evidence);

    // La generación fue asíncrona: la tarea pudo cancelarse mientras tanto.
    if (wasCancelled(context)) {
        console.log(`[concludeTask] Tarea ${task.id} cancelada durante generación de respuesta final. Descartando resultado.`);
        return;
    }

    task.state = state;
    task.pendingQuestion = undefined;
    task.waitingReason = undefined;
    task.rawFinalInput = synthesis.rawInput;
    task.rawFinalOutput = synthesis.rawOutput;
    console.log(formatTaskSummary(context, state, abortReason || "None"));
    deps.emitEvent(task.id, "FINAL_RESPONSE", {
        response: task.finalResponse,
        state,
        source: task.finalResponseSource,
        synthesisError: synthesis.synthesisError,
        rawInput: synthesis.rawInput,
        rawOutput: synthesis.rawOutput,
        timing: synthesis.timing,
    });
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state, finalResponse: task.finalResponse });
    recordTaskTrace(context);
}