/**
 * JARVIS Core — Reexportación del paquete independiente `src/memory/`.
 *
 * Mantiene la superficie pública usada por las pruebas y adaptadores sin acoplar el paquete
 * de memoria con `src/core/`.
 */

export {
  createJsonMemoryProvider,
  createMemoryReader,
  factLines,
  fold,
  MAX_FACTS,
  MAX_FACTS_PER_PROMPT,
  MAX_KEY_CHARS,
  MAX_VALUE_CHARS,
  parseFacts,
  selectFacts,
  stemsOf,
} from "../memory/index.ts";
export type { MemoryFact, MemoryProvider, Recalled } from "../memory/index.ts";

