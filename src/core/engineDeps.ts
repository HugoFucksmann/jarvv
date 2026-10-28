/**
 * JARVIS Core — Dependencias que reciben los motores de ejecución (ejecutor de pasos, modos FAST/PLAN, cierre de tareas).
 * Este módulo solo declara contratos mínimos (interfaces) y depende únicamente de tipos: las implementaciones
 * (Decision20Engine, DiscoveryEngine, QwenEngine) las conoce solo la raíz de composición (server.ts).
 */

import type {
    ArgumentPromptData,
    ArgumentsGenerationResult,
    Attempt,
    CoreEventDataMap,
    CoreEventType,
    DecisionOneResult,
    DecisionTwoResult,
    FinalResponsePromptData,
    FinalResponseResult,
    MCPTool,
    Plan,
    PlanRevision,
    ReplanPromptData,
    ReplanResult,
    StageVerificationPromptData,
    StageVerificationResult,
    StepVerificationResult,
} from "./types.ts";
import type { IMCPServer } from "./mcp/types.ts";

export type EmitEventFn = <T extends CoreEventType>(
    taskId: string,
    type: T,
    data: CoreEventDataMap[T],
    stepId?: string
) => void;

export interface ILLMClient {
    generateArguments(data: ArgumentPromptData, signal?: AbortSignal): Promise<ArgumentsGenerationResult>;

    generateFinalResponse(data: FinalResponsePromptData, signal?: AbortSignal): Promise<FinalResponseResult>;

    generatePlan(userMessage: string, signal?: AbortSignal, revision?: PlanRevision): Promise<Plan>;

    replan(data: ReplanPromptData, signal?: AbortSignal): Promise<ReplanResult>;

    verifyStage(data: StageVerificationPromptData, signal?: AbortSignal): Promise<StageVerificationResult>;
}

export interface IDecisionEngine {
    evaluateDecisionOne(
        taskMessage: string,
        historyContext?: string,
        options?: { allowFin?: boolean; lastResult?: string; attempts?: Attempt[]; signal?: AbortSignal }
    ): Promise<DecisionOneResult>;

    evaluateDecisionTwo(
        instruction: string,
        discoveredTools: MCPTool[],
        memory?: string,
        attempts?: Attempt[],
        options?: { mcp?: string; signal?: AbortSignal }
    ): Promise<DecisionTwoResult>;

    evaluateStepVerification(
        instruction: string,
        toolName: string,
        resultSummary: string,
        evidenceSummary?: string,
        expectedOutcome?: string,
        observation?: string,
        signal?: AbortSignal
    ): Promise<StepVerificationResult>;
}

export interface IDiscoveryEngine {
    getServer(name: string): IMCPServer | undefined;
    getDiscoveredTools(serverName: string, forceRefresh?: boolean): Promise<MCPTool[]>;
    getUnavailableServers(): Record<string, { reason: string; since: number }>;
    validateToolExists(serverName: string, toolName: string): Promise<boolean>;
}

export interface EngineDependencies {
    decisionEngine: IDecisionEngine;
    discoveryEngine: IDiscoveryEngine;
    llm: ILLMClient;
    emitEvent: EmitEventFn;
}