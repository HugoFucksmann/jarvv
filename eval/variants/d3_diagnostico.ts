import type { Variant } from "../core/variants/types.ts";

/**
 * Decisión 3 (`args_review`, d3:2b). DIAGNÓSTICO, no para producción: no cambia la pregunta `review` ni el prompt, así que el
 * pass rate canónico debe dar igual que `prod`. Agrega tres preguntas `noul` para medir si el 2b responde bien a preguntas
 * sí/no separadas, en vez de una elección de 4 opciones con probabilidades planas (en `prod`, `rev-cmd-tasklist` pasa
 * con approved 0.44 contra tool_rejected 0.27).
 *
 * Las probabilidades de las tres quedan en `runs.jsonl` (`questions.<clave>`). Sin `expect.answers` se registran pero no se
 * evalúan: la respuesta esperada se deduce de `expectedReview` de cada caso:
 * - approved:      tool_fit sí, args_ok sí, user_needed no
 * - args_invalid:  tool_fit sí, args_ok no, user_needed no
 * - tool_rejected: tool_fit no
 * - info_missing:  user_needed sí
 *
 * Hipótesis: si el 2b acierta estas tres por separado en la mayoría de los casos, el cuello de botella es la elección de
 * 4 opciones y el cambio es estructural (preguntas binarias en D3, en `src`, a cargo del dueño del flujo); si falla también
 * aquí, el problema es la comprensión del caso y ningún texto de las opciones lo arregla. Pasar `runs.jsonl` y, si se
 * puede, la matriz de confusión de `prod` en `args_review`.
 */
const d3_diagnostico: Variant = {
  name: "d3_diagnostico",
  decision: {
    args_review: {
      addQuestions: {
        tool_fit: {
          type: "noul",
          instructions: "Can this tool do what the step needs now, with suitable argument values?",
        },
        args_ok: {
          type: "noul",
          instructions:
            "Is every argument value supported by the task, the user input or the latest reads, and valid for the tool schema and for the shell used?",
        },
        user_needed: {
          type: "noul",
          instructions:
            "Does a required argument need information that only the user can give and that is not in the task, the user input or the latest reads?",
        },
      },
    },
  },
};

export default d3_diagnostico;
