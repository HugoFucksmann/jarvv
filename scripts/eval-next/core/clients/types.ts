/**
 * scripts/eval-next/core/clients/types.ts
 *
 * Contrato uniforme para los clientes de modelos (generativo, decisión y mock).
 */

import type { ModelRequest, ModelResponse } from "../types.ts";

export interface ModelClientConfig {
  url?: string;
  model?: string;
  timeoutMs?: number;
  apiKey?: string;
  device?: "gpu" | "cpu" | "remote";
  options?: Record<string, unknown>;
}

export interface ModelClient {
  readonly name: string;
  call(request: ModelRequest): Promise<ModelResponse>;
}

