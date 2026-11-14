import { PROMPTS, todayLine } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Variante de contexto (Frente 2): la respuesta final recibe los datos sin identificadores internos y con el idioma fijado por código.
 * - Las cabeceras `c1 s1 web/web_search read ok verdict=approved` pasan a `web_search (ok)`: el SYSTEM le pide al modelo no mencionar esos ids,
 *   así que hoy se le dan y se le pide que los ignore.
 * - Se quitan las líneas `ref:rN (tamaño, ruta)`: la ruta lleva el id de la tarea y un uuid, y la respuesta no la usa.
 * - El idioma lo detecta el código sobre REQUEST y va como instrucción explícita al final (en las trazas, 5 de 28 respuestas salieron en inglés).
 */
const SPANISH = /[áéíóúñ¿¡]|\b(el|la|los|las|de|que|en|un|una|y|mi|del|por|para|con|qué|cómo|cuál|busca|buscá|decime|abri|abrí|lista|listá|dame|crea|creá|mové|leé|hola|gracias)\b/i;

const clean = (view: string): string =>
  view
    .replace(/^c\d+ s\d+ \S+\/(\S+) (?:read|write) (\S+)(?: verdict=\S+)?(.*)$/gm, (_m, tool: string, status: string, rest: string) => `${tool} (${status})${rest}`)
    .replace(/^ref:r\d+ \(.*\)\s*$\n?/gm, "");

const languageOf = (view: string): string => {
  const request = /^REQUEST: (.*)$/m.exec(view)?.[1] ?? "";
  return SPANISH.test(request) ? "Spanish" : "the language of REQUEST";
};

const ctx_final_clean: Variant = {
  name: "ctx_final_clean",
  prompts: {
    PROMPTS: {
      FINAL_VIEW: {
        ...PROMPTS.FINAL_VIEW,
        buildUserPrompt(data: { readonly view: string }): string {
          if (!data.view.trim()) return "(no context available)";
          return `${todayLine()}\n\n${clean(data.view)}\n\nWrite the answer now, in ${languageOf(data.view)}.`;
        },
      },
    },
  },
};

export default ctx_final_clean;
