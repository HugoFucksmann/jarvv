/**
 * Identidad visible de los modelos. Única fuente de nombres para el núcleo y la UI.
 * Sin dependencias de Node: la UI lo importa directamente.
 */
import type { ModelType } from "./types.ts";

export interface ModelInfo {
  /** Nombre completo, para badges y títulos. */
  name: string;
  /** Nombre corto, para contadores y registros. */
  short: string;
}

export const MODELS: Record<ModelType, ModelInfo> = {
  EOS_0_8B: { name: "Eos-0.8B", short: "Eos" },
  QWEN_3_5_9B: { name: "Qwen 3.5 9B", short: "Qwen" },
};
