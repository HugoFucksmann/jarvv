/**
 * JARVIS Core — Task Execution Context & Memory Helpers
 */

import {
    PROGRESSIVE_MEMORY_TIERS,
    type ExecutableRoute,
    type PendingApproval,
    type CallStatus,
    type ProgressiveMemoryLimit,
    type Step,
    type StepCall,
    type StepHandoff,
    type Task,
} from "./types.ts";
import type { Attempt } from "./reasoner/prompts.ts";
import { getToolPolicy } from "./tools/manifest.ts";
import { RefStore } from "./processor/refStore.ts";
import { sanitizeForMemory } from "./processor/text.ts";

/** Observación de una lectura con datos (búsqueda, página, archivo…): lo que un paso posterior puede necesitar. */
export interface DataObservation {
    stepId: string;
    /** Herramienta + destino ("search aves de Argentina"). */
    label: string;
    text: string;
}

/** Lecturas con datos que se conservan para los argumentos de Qwen, además de la última llamada. */
const MAX_DATA_OBSERVATIONS = 3;

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
    /**
     * Últimas lecturas con datos. `lastCallCompactObs` solo guarda la última llamada: cualquier llamada intermedia
     * (otra lectura, un directorio, un intento fallido) hacía desaparecer los resultados que un paso posterior necesita.
     */
    dataObs: DataObservation[];
    /** Resumen sintético estructurado para Decision 2.0 ([SUCCESS]/[FAILURE]/…). */
    lastCallDecisionSummary?: string;
    /** Nombre de la tool que produjo lastCallCompactObs (para el label LAST de Qwen). */
    lastCallTool?: string;
    /** Id del paso que produjo lastCallCompactObs: el label LAST debe nombrar a quien la generó, no al paso actual. */
    lastCallStepId?: string;
    /** Handoff determinista del último paso completado. */
    lastHandoff?: StepHandoff;
    /** La traza de la tarea ya se registró (recordTaskTrace): evita el doble registro. */
    traced?: boolean;
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

/** Registra la observación de una lectura con datos (se conservan las últimas MAX_DATA_OBSERVATIONS). */
export function recordDataObservation(context: TaskExecutionContext, obs: DataObservation): void {
    context.dataObs = [...context.dataObs, obs].slice(-MAX_DATA_OBSERVATIONS);
}

/** Única fuente de la forma de la memoria de una tarea. */
export function createEmptyMemory(): NonNullable<Task["memory"]> {
    return { log: [], facts: {}, fail: [] };
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

function addFailEntry(context: TaskExecutionContext, line: string): void {
    const memory = ensureMemory(context);
    memory.fail.push(line);
    if (memory.fail.length > 5) {
        memory.fail = memory.fail.slice(-5);
    }
}

/**
 * Causas de FAIL. Texto fijo por causa: la memoria nunca recibe prosa de modelos. El detalle vive en LOG
 * (hallazgo de la herramienta) y en los eventos.
 */
export type FailKind =
    | Exclude<CallStatus, "ok" | "unverified">
    | "service_unavailable"
    | "fin_rejected"
    | "insufficient_info";

const FAIL_TEXT: Record<FailKind, string> = {
    args_invalid: "argumentos inválidos",
    refs_unresolved: "referencias sin resolver",
    loop_blocked: "bloqueada por anti-loop",
    denied: "denegada por política de seguridad",
    user_rejected: "rechazada por el usuario",
    exception: "excepción",
    service_unavailable: "servicio no disponible",
    tool_error: "ejecución fallida",
    not_found: "no encontrado",
    no_data: "sin resultados",
    rejected: "ejecutada; resultado no aprobado",
    fin_rejected: "fin rechazado: faltan acciones verificadas",
    insufficient_info: "información insuficiente",
};

/** Causa fija, más un detalle determinista opcional (hallazgo de la herramienta). Alimenta step.error y call.error. */
export function describeFailure(kind: FailKind, detail?: string): string {
    return detail ? `${FAIL_TEXT[kind]}: ${detail}` : FAIL_TEXT[kind];
}

/** Único punto de escritura de FAIL. Formato: `paso|herramienta|causa` (`-` si no hay paso). */
export function recordFailure(
    context: TaskExecutionContext,
    kind: FailKind,
    where: { stepId?: string; subject: string; note?: string }
): void {
    const note = where.note ? ` (${sanitizeForMemory(where.note, 60)})` : "";
    addFailEntry(context, `${where.stepId ?? "-"}|${sanitizeForMemory(where.subject, 60)}|${FAIL_TEXT[kind]}${note}`);
}

/** Historial compacto para Decision #1: últimas `limit` líneas de LOG y FAIL. Vacío mientras no haya memoria. */
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
    return parts.join("\n");
}

export function buildDecisionMemory(task: Task): string {
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

/** Ventana del plan que ve Qwen: lo anterior y lo siguiente se resume, el paso actual siempre entra completo. */
const PLAN_WINDOW_PREV = 2;
const PLAN_WINDOW_NEXT = 3;
const PLAN_LINE_CHARS = 180;

const clipLine = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function planLine(s: Step): string {
    switch (s.state) {
        case "COMPLETED":
            return clipLine(`[x] ${s.id} ${s.instruction} -> ${s.evidence?.summary || "ok"}`, PLAN_LINE_CHARS);
        case "RUNNING":
            // Instrucción y criterio se recortan por separado: el criterio de éxito no puede perderse.
            return `[>] ${s.id} ${clipLine(s.instruction, 200)} | éxito: ${clipLine(s.expectedOutcome || "completado", 150)}`;
        case "UNVERIFIED":
            return clipLine(`[~] ${s.id} ${s.instruction} (sin verificar)`, PLAN_LINE_CHARS);
        default:
            return clipLine(`[ ] ${s.id} ${s.instruction}`, PLAN_LINE_CHARS);
    }
}

export function buildPlanLines(task: Task): string[] {
    const live = task.steps.filter((s) => !s.superseded);
    let current = live.findIndex((s) => s.state === "RUNNING");
    if (current < 0) current = live.findIndex((s) => s.state === "PENDING");
    if (current < 0) current = live.length;

    const before = live.slice(0, current);
    const upcoming = live.slice(current);
    const hiddenBefore = before.length - PLAN_WINDOW_PREV;
    const hiddenAfter = upcoming.length - (1 + PLAN_WINDOW_NEXT);

    return [
        ...(hiddenBefore > 0 ? [`(+${hiddenBefore} pasos anteriores)`] : []),
        ...before.slice(-PLAN_WINDOW_PREV).map(planLine),
        ...upcoming.slice(0, 1 + PLAN_WINDOW_NEXT).map(planLine),
        ...(hiddenAfter > 0 ? [`(+${hiddenAfter} pasos pendientes)`] : []),
    ];
}

/** Llamadas que ya modificaron (o pudieron modificar) el entorno: la herramienta corrió limpia, aunque la verificación no la aprobara. */
const EFFECT_STATUSES: ReadonlySet<CallStatus> = new Set<CallStatus>(["ok", "unverified", "rejected"]);

/**
 * Tope por valor de argumento en una línea de efectos. Un valor más largo se corta de forma explícita: termina en `…`
 * e indica su tamaño original. Un comando de 615 caracteres (un Excel de dos filas) debe entrar entero.
 */
const MAX_EFFECT_ARG_CHARS = 1000;

/** Argumentos de una llamada como `clave=valor` (objetos y arreglos serializados), saneados como el resto de la memoria. */
function describeArgs(args: Record<string, unknown>): string {
    return Object.entries(args)
        .map(([key, value]) => {
            const raw = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
            const flat = sanitizeForMemory(raw, Number.MAX_SAFE_INTEGER).replace(/\s{2,}/g, " ");
            return flat.length > MAX_EFFECT_ARG_CHARS
                ? `${key}=${flat.slice(0, MAX_EFFECT_ARG_CHARS - 1).trimEnd()}…(${raw.length} caracteres)`
                : `${key}=${flat}`;
        })
        .join(" ");
}

/**
 * Efectos derivados de task.steps[].calls: una línea por llamada que mutó, incluidos los pasos reemplazados por un
 * replan (sus llamadas no se borran). Cada línea lleva los argumentos de la llamada. `limit` conserva las más recientes;
 * Infinity devuelve todas.
 */
export function buildEffectsContext(task: Task, limit = 5): string[] {
    const lines = task.steps.flatMap((s) =>
        (s.calls ?? [])
            .filter((c) => c.status !== undefined && EFFECT_STATUSES.has(c.status) && getToolPolicy(c.mcp, c.tool).mutates)
            .map((c) => {
                // Qué se pidió (los argumentos: qué se escribió, qué comando corrió), no solo qué respondió la herramienta.
                const args = describeArgs(c.args ?? {});
                return `${s.id}|${c.tool}${args ? ` ${args}` : ""}: ${c.evidence?.summary || "mutación aplicada"}`;
            })
    );
    return lines.slice(-limit);
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
    // El hallazgo recortado ya puede llevar su propia clave `[ref:rN]`: no se repite.
    const refNote = handoff.refKey && !handoff.finding.includes(`ref:${handoff.refKey}`) ? ` [ref:${handoff.refKey}]` : "";
    const factNote = handoff.primaryFact ? ` | ${handoff.primaryFact.key}=${sanitizeForMemory(handoff.primaryFact.value, 400)}` : "";
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
 * Se construye del RefStore vivo, así que nunca ofrece referencias que ya no existen.
 */
export function buildRefsContext(task: Task, limit = 8): string[] {
    return RefStore.describe(task.id, limit).map(
        (r) => `ref:${r.key} ${r.label || "resultado"} (${fmtChars(r.chars)})`
    );
}