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

const MAX_TOOL_ERROR_CHARS = 300;
const MAX_TOOL_PREVIEW_CHARS = 300;

/** Decision #2 con una sola herramienta no llama al modelo: su "salida" sintética lleva esta marca. */
const SINGLE_TOOL_SHORTCUT = "single_tool_shortcut";

export function recordTaskTrace(context: TaskExecutionContext): void {
    if (context.traced) return;
    context.traced = true;

    try {
        const config = ConfigManager.getConfig();
        if (!config.traceEnabled) return;

        const { task } = context;
        const stepIds = new Set(task.steps.map((s) => s.id));

        // Una entrada por intercambio real con un modelo: las iteraciones sin rawInput (p. ej. una verificación que
        // no llegó a ejecutarse) y el atajo de Decision #2 no lo son. `step` solo si es un paso real del plan.
        const calls = (task.modelIterations ?? [])
            .filter((it) => it.rawInput !== undefined && !(it.stage === "DECISION_TWO" && it.rawOutput?.includes(SINGLE_TOOL_SHORTCUT)))
            .map((it, i) => ({
                seq: i + 1,
                step: it.stepId && stepIds.has(it.stepId) ? it.stepId : null,
                stage: it.stage,
                rawInput: it.rawInput,
                rawOutput: it.rawOutput,
                error: it.error ?? null,
            }));

        const toolRuns = task.steps.flatMap((s) =>
            (s.calls ?? []).map((c) => ({
                step: s.id,
                tool: c.tool,
                args: c.args ?? null,
                ok: c.outcome?.isError !== true,
                error: c.outcome?.isError === true ? (c.error ?? "").slice(0, MAX_TOOL_ERROR_CHARS) || null : null,
                resultPreview: (c.evidence?.obs ?? "").slice(0, MAX_TOOL_PREVIEW_CHARS) || undefined,
            }))
        );

        const plan = task.mode === "PLAN"
            ? {
                steps: task.steps.map((s) => ({
                    id: s.id,
                    instruction: s.instruction,
                    route: s.route,
                    expectedOutcome: s.expectedOutcome,
                    superseded: s.superseded === true,
                })),
            }
            : null;

        const line = JSON.stringify({
            v: 1,
            taskId: task.id,
            startedAt: new Date(context.startTime).toISOString(),
            endedAt: new Date().toISOString(),
            mode: task.mode,
            userMessage: task.message,
            status: task.state,
            finalResponse: task.finalResponse ?? null,
            plan,
            calls,
            toolRuns,
        });
        fs.appendFileSync(path.resolve(process.cwd(), config.tracePath), `${line}\n`, "utf-8");
    } catch (err) {
        console.warn("[TaskTrace] No se pudo registrar la traza:", err instanceof Error ? err.message : err);
    }
}