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

import type { ModelIteration } from "../../src/core/types.ts";

export interface StepIterationGroupData {
  stepId: string;
  stepSeq?: number;
  stepTitle: string;
  route?: string;
  tool?: string;
  state?: string;
  iterations: ModelIteration[];
}
