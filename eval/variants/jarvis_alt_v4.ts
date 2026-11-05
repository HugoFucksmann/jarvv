import type { Variant } from "../core/variants/types.ts";

/**
 * jarvis_alt_v4:
 *
 * Basada en los hallazgos empíricos de las evaluaciones de prod y jarvis_alt_v3:
 * 1. arguments (generativo qwen3.5:4b): Incluye las convenciones de nombres de parámetros del schema
 *    estándar (max_results, length, mode='append', timeout_ms, force_refresh, destination) para evitar
 *    que el modelo adivine nombres inexistentes (limit, lines, results_count, timeout).
 * 2. route (decisión d3:2b): Conserva el fix comprobado de v3 contra fin prematuro, y agrega criterio
 *    para priorizar ask_user tras info_missing y búsqueda/lectura previa a escritura de archivo.
 * 3. tool_choice (decisión d3:2b): Guía para elegir ask_user cuando falta un dato esencial no deducible.
 * 4. args_review (decisión d3:2b): Clarifica que un parámetro con nombre no coincidente o desconocido es
 *    args_invalid, y que usar terminal para listar archivos o write_file para correr tests es tool_rejected.
 * 5. result_verification: Se mantiene idéntico a prod para evitar las regresiones severas observadas en v3.
 */
const jarvis_alt_v4: Variant = {
  name: "jarvis_alt_v4",

  decision: {
    route: {
      questions: {
        route: {
          instructions: {
            append:
              " Choose fin only when the work is already complete. If the request still needs something to be run, read, found or looked up, choose the route that does it. If an attempt failed with info_missing or information from the user is needed, choose ask_user. When the task requires searching or reading data before saving to a file, choose the search or read route first.",
          },
        },
      },
    },

    tool_choice: {
      questions: {
        selected_tool: {
          instructions: {
            append:
              " If essential information (such as which file or target to operate on) is completely missing from the goal and cannot be determined, choose ask_user.",
          },
        },
      },
    },

    args_review: {
      questions: {
        review: {
          instructions: {
            replace:
              "Review the candidate tool and its arguments against the goal and schema. Reject the tool if it is the wrong kind of tool for the goal. Mark arguments invalid if any parameter key is not in the schema, is misspelled, or is broken. Otherwise approve.",
          },
          criteria: {
            set: {
              approved:
                "The tool fits the goal, every required parameter key is present with the exact name from the schema, and all values are valid.",
              args_invalid:
                "The tool fits the goal, but a parameter key name differs from the schema, an unknown key is present, a required key is missing, or the argument format is broken.",
              tool_rejected:
                "The tool does not fit the goal: another kind of tool is the right one (for example, listing files requires filesystem tools rather than running ls in terminal, and executing tests requires terminal rather than write_file).",
              info_missing:
                "A needed value is not in the goal and only the user can provide it.",
            },
          },
        },
      },
    },
  },

  generative: {
    arguments: {
      system: {
        append:
          " Tool parameters convention: search(query, max_results); read_file(path, offset, length); write_file(path, content, mode); start_process(command, timeout_ms, shell); fetch(url, force_refresh); list_directory(path, depth); move_file(source, destination); interact_with_process(pid, input, timeout_ms). Always use these exact parameter names from the schema when the request specifies corresponding values (e.g. max_results for result counts or limits, length for line count, timeout_ms in milliseconds, force_refresh for cache bypass, and mode 'append' when appending). Never invent keys like 'limit', 'lines', 'results_count', 'timeout', or 'headers'.",
      },
    },
  },
};

export default jarvis_alt_v4;

