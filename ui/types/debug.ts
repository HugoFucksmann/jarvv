/**
 * JARVIS UI Debug & Observability Contracts
 * Consumidos por los componentes visuales de DecisionStream e inspectores.
 */

export type {
  ModelType,
  ModelStage,
  ModelIterationMetrics,
  ModelIteration,
} from "../../src/core/types.ts";

import type { ExecutableRoute, ModelIteration, StepState } from "../../src/core/types.ts";

export interface StepIterationGroupData {
  stepId: string;
  stepSeq?: number;
  stepTitle: string;
  route?: ExecutableRoute;
  tool?: string;
  state?: StepState;
  iterations: ModelIteration[];
}