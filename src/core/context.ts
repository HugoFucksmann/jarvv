/**
 * JARVIS Core — Task Execution Context & Memory Helpers
 */

import {
    Task,
    PendingApproval,
    StepCall,
    ProgressiveMemoryLimit,
    PROGRESSIVE_MEMORY_TIERS,
    StepHandoff,
    Step,
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
    /** Fase 4: Handoff determinista del último paso completado */
    lastHandoff?: StepHandoff;
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

/**
 * Agrega una entrada a LOG preservando continuidad factual sin colapso prematuro (Fase 4, §3.2.5).
 */
export function addLogEntry(context: TaskExecutionContext, line: string): void {
    if (!context.task.memory) {
        context.task.memory = { log: [], facts: {}, fail: [], effects: [] };
    }
    const log = context.task.memory.log;
    log.push(line);
    // Preservar entradas continuas sin sustitución estadística destructiva (hasta 30 entradas completas)
    if (log.length > 30) {
        context.task.memory.log = log.slice(-30);
    }
}

/**
 * Registra efectos secundarios confirmados en el entorno (Fase 4, §3.2.5).
 */
export function addEffectEntry(context: TaskExecutionContext, effect: string): void {
    if (!context.task.memory) {
        context.task.memory = { log: [], facts: {}, fail: [], effects: [] };
    }
    context.task.memory.effects = context.task.memory.effects || [];
    context.task.memory.effects.push(effect);
    if (context.task.memory.effects.length > 25) {
        context.task.memory.effects = context.task.memory.effects.slice(-25);
    }
}

export function addFailEntry(context: TaskExecutionContext, line: string): void {
    if (!context.task.memory) {
        context.task.memory = { log: [], facts: {}, fail: [], effects: [] };
    }
    const fail = context.task.memory.fail;
    fail.push(line);
    if (fail.length > 5) {
        context.task.memory.fail = fail.slice(-5);
    }
}

/**
 * Registra traza cruda de interacción con modelo en la memoria del contexto.
 */
export function addRawInteraction(
    context: TaskExecutionContext,
    interaction: { model: string; stage: string; rawInput: string; rawOutput: string }
): void {
    if (!context.task.memory) {
        context.task.memory = { log: [], facts: {}, fail: [], effects: [], rawInteractions: [] };
    }
    context.task.memory.rawInteractions = context.task.memory.rawInteractions || [];
    context.task.memory.rawInteractions.push({
        timestamp: Date.now(),
        ...interaction,
    });
    if (context.task.memory.rawInteractions.length > 50) {
        context.task.memory.rawInteractions = context.task.memory.rawInteractions.slice(-50);
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

/**
 * Obtiene las entradas más recientes del log de efectos secundarios (Fase 4, §3.2.5).
 */
export function buildEffectsContext(task: Task, limit = 5): string[] {
    const effects = task.memory?.effects || [];
    return effects.slice(-limit);
}

/**
 * Aplica el handoff determinista entre pasos completados y el paso activo (Fase 4, §3.2.5, §11).
 * Transfiere hechos clave, hallazgos y referencias de los pasos previos o de dependencias directas.
 */
export function applyStepHandoff(step: Step, context: TaskExecutionContext): string {
    const handoff = context.lastHandoff;
    if (!handoff) {
        return step.instruction;
    }

    const parts: string[] = [step.instruction];

    // Si el paso declara dependencias específicas (ej. ["s1", "s2"])
    if (step.dependencies && step.dependencies.length > 0) {
        const depSteps = context.task.steps.filter((s) => step.dependencies?.includes(s.id) && s.state === "COMPLETED");
        if (depSteps.length > 0) {
            const depSummaries = depSteps.map((ds) => {
                const h = ds.handoff;
                const summary = h?.finding || ds.evidence?.summary || "ok";
                const ref = h?.refKey ? ` (ref:${h.refKey})` : ds.evidence?.ref ? ` (${ds.evidence.ref})` : "";
                return `• ${ds.id} [${ds.tool || ds.route}]: ${summary}${ref}`;
            });
            parts.push(`[DATOS PREVIOS DE DEPENDENCIAS]:\n${depSummaries.join("\n")}`);
        }
    } else if (handoff.finding) {
        // Enlace secuencial directo con el paso inmediatamente anterior
        const refNote = handoff.refKey ? ` [ref:${handoff.refKey}]` : "";
        const factNote = handoff.primaryFact ? ` | ${handoff.primaryFact.key}=${handoff.primaryFact.value}` : "";
        parts.push(`[HANDOFF ${handoff.fromStepId} (${handoff.tool})]: ${handoff.finding}${refNote}${factNote}`);
    }

    return parts.join("\n");
}