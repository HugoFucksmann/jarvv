import type { Variant } from "../core/variants/types.ts";

/**
 * Variante SOLO de decisión para probar preguntas alternativas. No toca la etapa generativa.
 *
 * Qué hace: deja intactas las preguntas de producción (la principal sigue alimentando la salida canónica de la etapa)
 * y agrega preguntas `noul` extra sobre el MISMO state. d3 responde cada una con su propio forward pass, así que no se
 * influyen entre sí: sirven para medir señales independientes y, después, probar reglas de combinación (2 de 3, AND, ...)
 * sobre `runs.jsonl` sin volver a llamar al modelo.
 *
 * Para que una extra se EVALÚE, el caso del dataset debe traer su respuesta en `expect.answers`, p. ej.:
 *   "answers": { "usable": { "yes": true }, "goal_met": { "yes": true }, "has_error": { "yes": false } }
 * Sin esa expectativa la pregunta se registra pero no cuenta (ver "Decisiones con varias preguntas" en INSTRUCCIONES.md).
 *
 * Para reemplazar una pregunta de producción en vez de sumar una, usar `questions.<clave>.replace` o
 * `questions.<clave>.instructions` (como hace jarvis_alt_v3) y, si cambia la clave, `answerMap`.
 */
const decision_alt_questions: Variant = {
  name: "decision_alt_questions",

  decision: {
    // route: las opciones son dinámicas (rutas), por eso las extras son sí/no independientes de las opciones.
    route: {
      addQuestions: {
        complete: {
          type: "noul",
          instructions: "Is the work already complete, so that nothing else needs to be run, read, found or looked up?",
        },
        needs_user: {
          type: "noul",
          instructions: "Is information missing that only the user can provide?",
        },
      },
    },

    // tool_choice: igual, extras sí/no que no dependen de qué herramientas se ofrecen.
    tool_choice: {
      addQuestions: {
        needs_user: {
          type: "noul",
          instructions: "Is information missing that only the user can provide, so no tool can make the next call?",
        },
        retry_failed: {
          type: "noul",
          instructions: "Is the only sensible next action to repeat a call that already failed?",
        },
      },
    },

    // args_review: la principal es `review` (4 opciones); las extras la miran por separado desde dos lados.
    args_review: {
      addQuestions: {
        tool_fits: {
          type: "noul",
          instructions: "Is the tool of the candidate call the right kind of tool for what the task needs now?",
        },
        args_ok: {
          type: "noul",
          instructions:
            "Does every argument use the exact key names of the tool schema, with values that come from the task, the user input or the latest reads?",
        },
      },
    },

    // result_verification: `ok` y `cumple` se mantienen; se suman reformulaciones y una inversa (has_error)
    // para comparar cuál señal acierta más y probar combinaciones.
    result_verification: {
      addQuestions: {
        usable: {
          type: "noul",
          instructions:
            "Does the evaluated call return data or confirm that an action succeeded? Answer no only if it is empty or an error message.",
        },
        has_error: {
          type: "noul",
          instructions: "Is the result an error message, an exception or an empty output?",
        },
        goal_met: {
          type: "noul",
          instructions:
            "Does the result contain what the request or the step needs? If the goal was to confirm something and the result shows it is not true or not there, answer no.",
        },
      },
    },
  },
};

export default decision_alt_questions;
