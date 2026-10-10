/**
 * JARVIS Core — Task Execution Context & Memory Helpers
 */

import {
    Task,
    PendingApproval,
    StepCall,
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
    activeServerOverride?: string;
    excludedToolForNextCall?: string;
    lastCallCompactObs?: string;
    /** Nombre de la tool que produjo lastCallCompactObs (para el label LAST de Qwen). */
    lastCallTool?: string;
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

export function buildHistoryContext(task: Task): string {
    const logLines = task.memory?.log || [];
    const failLines = task.memory?.fail || [];
    const historyParts: string[] = [];
    if (logLines.length > 0) {
        historyParts.push(logLines.slice(-3).join("\n"));
    }
    if (failLines.length > 0) {
        historyParts.push(`FAIL:\n${failLines.slice(-2).join("\n")}`);
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