/**
 * JARVIS Core — Dependencias que reciben los motores de ejecución (ejecutor de pasos, modos FAST/PLAN, cierre de tareas).
 * Viven aquí, y no en el ejecutor, para que ningún módulo dependa de otro solo por este contrato.
 */

import type { CoreEventType } from "./types.ts";
import type { Decision20Engine } from "./decision.ts";
import type { DiscoveryEngine } from "./mcp/discovery.ts";
import type { ILLMClient } from "./reasoner/qwen.ts";

export type EmitEventFn = (
    taskId: string,
    type: CoreEventType,
    data?: Record<string, unknown>,
    stepId?: string
) => void;

export interface EngineDependencies {
    decisionEngine: Decision20Engine;
    discoveryEngine: DiscoveryEngine;
    qwenEngine: ILLMClient;
    emitEvent: EmitEventFn;
}