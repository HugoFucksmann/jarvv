/**
 * JARVIS Core — Task Execution Context & Memory Helpers
 */

import {
    PROGRESSIVE_MEMORY_TIERS,
    type ExecutableRoute,
    type PendingApproval,
    type ProgressiveMemoryLimit,
    type Step,
    type StepCall,
    type StepHandoff,
    type Task,
} from "./types.ts";
import type { Attempt } from "./reasoner/prompts.ts";
import { getToolPolicy } from "./tools/manifest.ts";
import { RefStore } from "./processor/resultProcessor.ts";

export interface TaskExecutionContext {
    task: Task;
    abortController: AbortController;
    isCancelled: boolean;
    pendingApproval: PendingApproval | null;
    executedSignatures: Set<string>;
    nonReadCounter: number;
    lastActionWasRead: boolean;
    consecutiveLoopBlocks: number;
    totalToolCalls: number;
    escalations: number;
    startTime: number;
    /** Límite de recuperación de memoria contextual progresiva (PROGRESSIVE_MEMORY_TIERS). */
    memoryRetrievalLimit: ProgressiveMemoryLimit;
    /** Ruta impuesta por el arbitraje de escalación para la siguiente iteración FAST. */
    activeRouteOverride?: ExecutableRoute;
    excludedToolForNextCall?: string;
    lastCallCompactObs?: string;
    /** Resumen sintético estructurado para Decision 2.0 ([SUCCESS]/[FAILURE]/…). */
    lastCallDecisionSummary?: string;
    /** Nombre de la tool que produjo lastCallCompactObs (para el label LAST de Qwen). */
    lastCallTool?: string;
    /** Número de paso (1-based) que produjo lastCallCompactObs: el label LAST debe nombrar a quien la generó, no al paso actual. */
    lastCallStepNumber?: number;
    /** Handoff determinista del último paso completado. */
    lastHandoff?: StepHandoff;
}

/**
 * Expande progresivamente el límite de recuperación de memoria contextual al siguiente
 * escalón de PROGRESSIVE_MEMORY_TIERS (el último es el máximo).
 */
export function expandMemoryContext(context: TaskExecutionContext): ProgressiveMemoryLimit {
    const current = context.memoryRetrievalLimit;
    const next = PROGRESSIVE_MEMORY_TIERS.find((tier) => tier > current) ?? current;
    if (next !== current) {
        console.log(`[MemoryContext] Expansión progresiva de memoria: ${current} -> ${next} elementos relevantes.`);
        context.memoryRetrievalLimit = next;
    }
    return next;
}

/** Única fuente de la forma de la memoria de una tarea. */
export function createEmptyMemory(): NonNullable<Task["memory"]> {
    return { log: [], facts: {}, fail: [], effects: [] };
}

export function ensureMemory(context: TaskExecutionContext): NonNullable<Task["memory"]> {
    if (!context.task.memory) {
        context.task.memory = createEmptyMemory();
    }
    return context.task.memory;
}

/** Agrega una entrada a LOG (hasta 30 entradas completas). */
export function addLogEntry(context: TaskExecutionContext, line: string): void {
    const memory = ensureMemory(context);
    memory.log.push(line);
    if (memory.log.length > 30) {
        memory.log = memory.log.slice(-30);
    }
}

/** Registra efectos secundarios en el entorno (hasta 25). */
export function addEffectEntry(context: TaskExecutionContext, effect: string): void {
    const memory = ensureMemory(context);
    memory.effects = memory.effects || [];
    memory.effects.push(effect);
    if (memory.effects.length > 25) {
        memory.effects = memory.effects.slice(-25);
    }
}

export function addFailEntry(context: TaskExecutionContext, line: string): void {
    const memory = ensureMemory(context);
    memory.fail.push(line);
    if (memory.fail.length > 5) {
        memory.fail = memory.fail.slice(-5);
    }
}

/** Historial compacto para Decision #1: últimas `limit` líneas de LOG y FAIL. */
export function buildHistoryContext(task: Task, limit: ProgressiveMemoryLimit = 2): string {
    const logLines = task.memory?.log || [];
    const failLines = task.memory?.fail || [];
    const parts: string[] = [];

    if (logLines.length > 0) {
        parts.push(logLines.slice(-limit).join("\n"));
    }
    if (failLines.length > 0) {
        parts.push(`FAIL:\n${failLines.slice(-Math.min(limit, 5)).join("\n")}`);
    }
    return parts.join("\n") || task.message;
}

export function buildScratchpadContextForDecision(task: Task): string {
    const facts = task.memory?.facts || {};
    const factsStr = Object.entries(facts).map(([k, v]) => `${k}=${v}`).join(" ");
    const logLines = (task.memory?.log || []).slice(-2).join("; ");
    const failLines = (task.memory?.fail || []).slice(-2).join("; ");
    return `FACTS: ${factsStr} | LOG: ${logLines} | FAIL: ${failLines}`;
}

/**
 * Historial de acciones ejecutadas (task.steps[].calls[]).
 * Decision #1 y #2 lo usan para marcar rutas/tools cuyo último intento falló.
 */
export function buildAttempts(task: Task): Attempt[] {
    return task.steps.flatMap((s) =>
        ((s.calls || []) as StepCall[]).map((c) => ({
            route: s.route,
            mcp: c.mcp,
            tool: c.tool,
            ok: c.evidence?.ok === true,
            note: c.evidence?.summary,
        }))
    );
}

export function buildPlanLines(task: Task): string[] {
    return task.steps
        .filter((s) => !s.superseded)
        .map((s) => {
            if (s.state === "COMPLETED") {
                return `[x] ${s.id} ${s.instruction} -> ${s.evidence?.summary || 'ok'}`;
            }
            if (s.state === "RUNNING") {
                return `[>] ${s.id} ${s.instruction} | éxito: ${s.expectedOutcome || 'completado'}`;
            }
            return `[ ] ${s.id} ${s.instruction}`;
        });
}

/** Entradas más recientes del log de efectos secundarios. */
export function buildEffectsContext(task: Task, limit = 5): string[] {
    const effects = task.memory?.effects || [];
    return effects.slice(-limit);
}

/**
 * Handoff determinista del paso completado más reciente hacia el paso activo:
 * hallazgo, referencia y hecho clave.
 */
export function applyStepHandoff(step: Step, context: TaskExecutionContext): string {
    const handoff = context.lastHandoff;
    if (!handoff || !handoff.finding) {
        return step.instruction;
    }
    const refNote = handoff.refKey ? ` [ref:${handoff.refKey}]` : "";
    const factNote = handoff.primaryFact ? ` | ${handoff.primaryFact.key}=${handoff.primaryFact.value}` : "";
    return `${step.instruction}\n[HANDOFF ${handoff.fromStepId} (${handoff.tool})]: ${handoff.finding}${refNote}${factNote}`;
}

/**
 * ¿Queda una llamada UNVERIFIED sin resolver? Una llamada se resuelve cuando una lectura exitosa posterior
 * la observa. Solo cuenta la última UNVERIFIED: una lectura exitosa posterior a ella resuelve las anteriores.
 * Sin esta regla, una sola llamada sin verificar bloquearía `fin` durante el resto de la tarea.
 */
export function hasUnresolvedUnverified(task: Task): boolean {
    const calls = task.steps.flatMap((s) => (s.calls || []) as StepCall[]);
    let lastUnverified = -1;
    for (let i = 0; i < calls.length; i++) {
        if (calls[i].verification === "UNVERIFIED") lastUnverified = i;
    }
    if (lastUnverified < 0) return false;
    for (let j = lastUnverified + 1; j < calls.length; j++) {
        const c = calls[j];
        if (c.outcome?.success === true && getToolPolicy(c.mcp, c.tool).kind === "READ") return false;
    }
    return true;
}

const fmtChars = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`);

/**
 * Referencias disponibles ({{ref:rX}}) con su origen y tamaño. Es la única vía para que Qwen conozca referencias
 * anteriores a la última observación: el marcador de LAST solo describe la más reciente y puede recortarse.
 * Se construye del RefStore vivo, así que tras un reinicio (refs perdidas) no ofrece referencias inexistentes.
 */
export function buildRefsContext(task: Task, limit = 5): string[] {
    return RefStore.describe(task.id, limit).map(
        (r) => `ref:${r.key} ${r.label || "resultado"} (${fmtChars(r.chars)})`
    );
}

/**
 * Retira de la memoria los facts que un paso aportó cuando su verificación semántica NO lo aprobó, y el handoff
 * que habría pasado al siguiente paso. Solo se retira lo que sigue valiendo lo que aportó el paso (no lo que otro
 * paso sobrescribió después). Los facts de una mutación (p. ej. el pid de un proceso lanzado) se conservan: describen
 * el entorno, no una hipótesis sobre el contenido observado.
 */
export function retractStepFacts(context: TaskExecutionContext, step: Step): void {
    if (context.lastHandoff?.fromStepId === step.id) {
        context.lastHandoff = undefined;
    }
    const delta = step.handoff?.factsDelta;
    if (!delta) return;
    const last = step.calls?.[step.calls.length - 1];
    if (last && getToolPolicy(last.mcp, last.tool).mutates) return;
    const facts = context.task.memory?.facts;
    if (!facts) return;
    for (const [key, value] of Object.entries(delta)) {
        if (facts[key] === value) delete facts[key];
    }
}