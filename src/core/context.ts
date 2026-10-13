/**
 * JARVIS Core — Task Execution Context & Memory Helpers
 */

import {
    Task,
    PendingApproval,
    StepCall,
    ProgressiveMemoryLimit,
    PROGRESSIVE_MEMORY_TIERS,
} from "./types.ts";
import { Attempt } from "./reasoner/prompts.ts";

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
    overridesCount: number;
    retriesCount: number;
    /** Límite de recuperación de memoria contextual progresiva (2 -> 5 -> 10) */
    memoryRetrievalLimit: ProgressiveMemoryLimit;
    activeServerOverride?: string;
    excludedToolForNextCall?: string;
    lastCallCompactObs?: string;
    /** Resumen sintético estructurado para Decision 2.0 ([ÉXITO]/[FALLO]) */
    lastCallDecisionSummary?: string;
    /** Nombre de la tool que produjo lastCallCompactObs (para el label LAST de Qwen). */
    lastCallTool?: string;
}

/**
 * Expande progresivamente el límite de recuperación de memoria contextual:
 * 2 -> 5 -> 10 (máximo). Cumple estrictamente la Sección 7.1.
 */
export function expandMemoryContext(context: TaskExecutionContext): ProgressiveMemoryLimit {
    const current = context.memoryRetrievalLimit || 2;
    let next: ProgressiveMemoryLimit;
    if (current < 5) {
        next = 5;
    } else if (current < 10) {
        next = 10;
    } else {
        next = 10;
    }
    if (next !== current) {
        console.log(`[MemoryContext] Expansión progresiva de memoria: ${current} -> ${next} elementos relevantes.`);
        context.memoryRetrievalLimit = next;
    }
    return next;
}

export function addLogEntry(context: TaskExecutionContext, line: string): void {
    if (!context.task.memory) {
        context.task.memory = { log: [], facts: {}, fail: [] };
    }
    const log = context.task.memory.log;
    log.push(line);
    // Collapse older lines if > 12 lines (§10.3)
    if (log.length > 12) {
        const old = log.slice(0, log.length - 6);
        const okCount = old.filter((l) => l.includes("|ok|")).length;
        const errCount = old.length - okCount;
        const summaryLine = `1-${old.length}: ${okCount} ok, ${errCount} err`;
        context.task.memory.log = [summaryLine, ...log.slice(-6)];
    }
}

export function addFailEntry(context: TaskExecutionContext, line: string): void {
    if (!context.task.memory) {
        context.task.memory = { log: [], facts: {}, fail: [] };
    }
    const fail = context.task.memory.fail;
    fail.push(line);
    if (fail.length > 5) {
        context.task.memory.fail = fail.slice(-5);
    }
}

/**
 * Construye el contexto de memoria de manera progresiva (2 -> 5 -> 10).
 * Preserva el contexto estrictamente compacto según la Sección 7.1.
 */
export function buildHistoryContext(
    task: Task,
    limit: ProgressiveMemoryLimit = 2,
    sessionHistory?: string[]
): string {
    const logLines = task.memory?.log || [];
    const failLines = task.memory?.fail || [];
    const historyParts: string[] = [];

    // Si existen mensajes previos de sesión, recuperar hasta 'limit' más recientes
    if (sessionHistory && sessionHistory.length > 0) {
        const recentSession = sessionHistory.slice(-limit);
        historyParts.push(`SESIÓN_PREVIA:\n${recentSession.map((m) => `• ${m}`).join("\n")}`);
    }

    if (logLines.length > 0) {
        historyParts.push(logLines.slice(-limit).join("\n"));
    }
    if (failLines.length > 0) {
        const failSlice = failLines.slice(-Math.min(limit, 5));
        historyParts.push(`FAIL:\n${failSlice.join("\n")}`);
    }
    return historyParts.join("\n") || task.message;
}

export function buildScratchpadContextForDecision(task: Task): string {
    const facts = task.memory?.facts || {};
    const factsStr = Object.entries(facts).map(([k, v]) => `${k}=${v}`).join(" ");
    const logLines = (task.memory?.log || []).slice(-2).join("; ");
    const failLines = (task.memory?.fail || []).slice(-2).join("; ");
    return `FACTS: ${factsStr} | LOG: ${logLines} | FAIL: ${failLines}`;
}

/**
 * Construye el historial de acciones ejecutadas a partir de task.steps[].calls[].
 * Usado por Decision #1 y Decision #2 para marcar rutas/tools ya intentadas.
 */
export function buildAttempts(task: Task): Attempt[] {
    return task.steps
        .flatMap((s) => (s.calls || []) as StepCall[])
        .map((c) => ({
            mcp: c.mcp,
            tool: c.tool,
            ok: c.evidence?.ok === true,
            note: c.evidence?.summary,
        }));
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