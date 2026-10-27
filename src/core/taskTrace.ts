/**
 * JARVIS Core — Registro de trazas de tareas
 *
 * Al terminar una tarea se agrega UNA línea JSON a un archivo JSONL (config: traceEnabled, tracePath). No es
 * persistencia de estado: Jarvis nunca lo lee ni reanuda nada desde él. El formato del archivo es el contrato con el
 * laboratorio (lab/), que lo consume por su cuenta. Si la escritura falla, se ignora: nunca afecta a la tarea.
 */

import fs from "node:fs";
import path from "node:path";
import { ConfigManager } from "./config.ts";
import type { TaskExecutionContext } from "./context.ts";
import { RefStore, refKeyOf } from "./processor/refStore.ts";
import type { StepCall, Task } from "./types.ts";
import { errorMessage } from "./utils.ts";

const MAX_TOOL_ERROR_CHARS = 300;
const MAX_TOOL_PREVIEW_CHARS = 300;
/** Tope del resultado crudo por llamada; `resultChars` conserva el tamaño original para detectar el recorte. */
const MAX_TOOL_RESULT_CHARS = 20_000;

/**
 * Texto crudo de una llamada. Solo existe en RefStore (memoria volátil): se copia aquí al cerrar la tarea, sin duplicarlo
 * en su estado. Lo derivado (hallazgo, observación compacta, hechos, líneas de memoria) no se registra: se recalcula
 * desde este texto y los args, y ya figura en los prompts de las llamadas siguientes.
 */
function rawResultOf(taskId: string, call: StepCall): string | undefined {
    const key = refKeyOf(call.evidence?.ref);
    return key ? RefStore.get(key, taskId) : undefined;
}

/** Versión del formato de la línea de traza: el laboratorio (lab/) la usa para interpretar el archivo. */
const TRACE_FORMAT_VERSION = 1;

/**
 * Una entrada por intercambio real con un modelo (`invoked`, definido al construir la iteración: sin atajos
 * deterministas ni verificaciones que no llegaron a ejecutarse). Se ordenan por el inicio real de cada llamada.
 * `step` solo si es un paso real del plan.
 */
function buildModelCalls(task: Task) {
    const stepIds = new Set(task.steps.map((s) => s.id));
    return (task.modelIterations ?? [])
        .filter((it) => it.invoked === true)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((it, i) => ({
            seq: i + 1,
            step: it.stepId && stepIds.has(it.stepId) ? it.stepId : null,
            stage: it.stage,
            startedAt: it.timestamp,
            durationMs: it.metrics?.latencyMs ?? null,
            rawInput: it.rawInput,
            rawOutput: it.rawOutput,
            error: it.error ?? null,
        }));
}

function buildToolRuns(task: Task) {
    return task.steps.flatMap((s) =>
        (s.calls ?? []).map((c) => {
            const raw = rawResultOf(task.id, c);
            return {
                step: s.id,
                tool: c.tool,
                args: c.args ?? null,
                status: c.status ?? null,
                startedAt: c.execution?.startedAt ?? null,
                durationMs: c.execution?.durationMs ?? null,
                ok: c.outcome?.isError !== true,
                error: c.outcome?.isError === true ? (c.error ?? "").slice(0, MAX_TOOL_ERROR_CHARS) || null : null,
                resultPreview: (c.evidence?.obs ?? "").slice(0, MAX_TOOL_PREVIEW_CHARS) || undefined,
                result: raw?.slice(0, MAX_TOOL_RESULT_CHARS),
                resultChars: raw?.length,
            };
        })
    );
}

function buildPlanTrace(task: Task) {
    if (task.mode !== "PLAN") return null;
    return {
        steps: task.steps.map((s) => ({
            id: s.id,
            instruction: s.instruction,
            route: s.route,
            expectedOutcome: s.expectedOutcome,
            superseded: s.superseded === true,
        })),
    };
}

/** Línea JSON de la traza de una tarea. */
function buildTraceLine(context: TaskExecutionContext): string {
    const { task } = context;
    return JSON.stringify({
        v: TRACE_FORMAT_VERSION,
        taskId: task.id,
        startedAt: new Date(context.startTime).toISOString(),
        endedAt: new Date().toISOString(),
        mode: task.mode,
        userMessage: task.message,
        status: task.state,
        finalResponse: task.finalResponse ?? null,
        finalResponseSource: task.finalResponseSource ?? null,
        plan: buildPlanTrace(task),
        calls: buildModelCalls(task),
        toolRuns: buildToolRuns(task),
    });
}

export function recordTaskTrace(context: TaskExecutionContext): void {
    if (context.traced) return;
    context.traced = true;

    try {
        const config = ConfigManager.getConfig();
        if (!config.traceEnabled) return;

        fs.appendFileSync(path.resolve(process.cwd(), config.tracePath), `${buildTraceLine(context)}\n`, "utf-8");
    } catch (err) {
        console.warn("[TaskTrace] No se pudo registrar la traza:", errorMessage(err));
    }
}