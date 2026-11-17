import { DATA_NOTICE_EN, PROMPTS, todayLine } from "../../../src/core/models/prompts.ts";
import { threadBlock } from "../../../src/core/engine/thread.ts";
import type { PreviousTask } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * final_lang_natural: combina dos mejoras de Frente 2 en una variante completa:
 * - Limpia cabeceras internas (`c1 s1 route/tool ...`) y rutas UUID de `ref:rN` en la vista para evitar fugas.
 * - Elimina el relleno robótico "No changes were made to the system" en consultas de solo lectura (`EFFECTS: none`)
 *   y fija explícitamente el idioma de salida al de REQUEST.
 */
const SPANISH =
  /[áéíóúñ¿¡]|\b(el|la|los|las|de|que|en|un|una|y|mi|del|por|para|con|qué|cómo|cuál|busca|buscá|decime|abri|abrí|lista|listá|dame|crea|creá|mové|leé|hola|gracias|cuánto|cuánta|cuántos|cuándo|dónde)\b/i;

const cleanView = (view: string): string =>
  view
    .replace(/^c\d+ s\d+ \S+\/(\S+) (?:read|write) (\S+)(?: verdict=\S+)?(.*)$/gm, (_m, tool: string, status: string, rest: string) => `${tool} (${status})${rest}`)
    .replace(/^ref:r\d+ \(.*\)\s*$\n?/gm, "");

const detectLanguage = (view: string): string => {
  const req = /^REQUEST: (.*)$/m.exec(view)?.[1] ?? "";
  return SPANISH.test(req) ? "Spanish" : "the exact language of REQUEST";
};

const SYSTEM = `You are JARVIS. Answer REQUEST naturally in its exact language using only EVIDENCE, DATA, STATE, and EFFECTS.
- Start directly with the answer (no greeting). Preserve numbers, sizes, units, dates, and identifiers verbatim without rounding or unit conversion.
- Report system modifications (EFFECTS) only when real changes occurred; when EFFECTS is none, omit change statements unless REQUEST asked whether anything changed.
- Never present failed or unexecuted attempts as completed. If partial or failed, explain the obstacle concisely without technical status codes, tool names, PIDs, or internal call/step IDs.
${DATA_NOTICE_EN}`;

const final_lang_natural: Variant = {
  name: "final_lang_natural",
  prompts: {
    PROMPTS: {
      FINAL_VIEW: {
        ...PROMPTS.FINAL_VIEW,
        SYSTEM,
        buildUserPrompt(data: { readonly view: string; readonly thread?: PreviousTask }): string {
          if (!data.view.trim()) return "(no context available)";
          const body = cleanView(data.view);
          const prefix = data.thread === undefined ? todayLine() : `${todayLine()}\n\n${threadBlock(data.thread)}`;
          return `${prefix}\n\n${body}\n\nAnswer directly in ${detectLanguage(data.view)}.`;
        },
      },
    },
  },
};

export default final_lang_natural;
