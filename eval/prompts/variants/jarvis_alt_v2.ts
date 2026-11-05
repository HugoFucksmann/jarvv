import type { Variant } from "../core/variants/types.ts";

/**
 * v2: escrita contra el texto REAL de los casos de agentic_30 (no contra prompts.ts).
 * Solo toca las etapas donde prod falla. Todo lo demás queda idéntico a prod.
 */
const jarvis_alt_v2: Variant = {
  name: "jarvis_alt_v2",

  decision: {
    // Falla: term-route-tests (esperado terminal, obtuvo fin: 0.41 fin vs 0.19 terminal).
    route: {
      questions: {
        route: {
          instructions: {
            append:
              " Choose fin only when the work is already complete. If the request still needs something to be run, read, found or looked up, choose the route that does it.",
          },
        },
      },
    },

    // Fallas: term-review-ls-en-terminal y prob-review-clave-incorrecta (prod aprueba casi todo, p(approved) 0.86 y 0.99).
    args_review: {
      questions: {
        review: {
          instructions: {
            replace:
              "Check the call against the goal. Compare every key of Args with the keys the schema requires, and every value with the goal. Choose approved only if the tool fits the goal and all keys and values are correct.",
          },
          criteria: {
            set: {
              approved: "The tool fits the goal, every required key is present with the exact name from the schema, and every value comes from the goal.",
              args_invalid:
                "The tool fits the goal, but a key name differs from the schema, a required key is missing, or a value is wrong.",
              tool_rejected: "The tool does not fit the goal: another kind of tool is the right one for it.",
              info_missing: "A needed value is not in the goal and only the user can provide it.",
            },
          },
        },
      },
    },

    // Falla: fs-verify-archivo-ausente (esperado ok=true; prod dijo ok=false, p=0.057).
    // `ok` mide si la llamada devolvió algo usable, no si el resultado cumple el objetivo (eso es `cumple`).
    result_verification: {
      questions: {
        ok: {
          instructions: {
            replace:
              "Did the call itself work? Answer yes if it returned data or confirmed an action, even when the data is not what the goal wanted. Answer no only if the result is empty or an error.",
          },
        },
        cumple: {
          instructions: {
            replace:
              "Does the result contain what the goal needs? If the goal asked to confirm something and the result shows it is not true or not there, answer no.",
          },
        },
      },
    },
  },

  generative: {
    // Fallas: busq-args-search (faltó max_results) y fs-args-write-append (faltó mode).
    arguments: {
      system: {
        append:
          " Include every parameter for which the request gives a value (for example a limit, a count or a mode), using the parameter name from the schema. Do not add keys that are not parameters of the schema.",
      },
    },
  },
};

export default jarvis_alt_v2;
