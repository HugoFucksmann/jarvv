import type { Variant } from "../core/variants/types.ts";

/**
 * jarvis_alt_v5:
 *
 * Iteración basada en los hallazgos de v4:
 * 1. arguments (generativo): Se corrige el comportamiento observado en v4 donde el modelo aprendió
 *    los nombres de parámetros exactos (max_results, length, mode='append', timeout_ms) pero los
 *    envolvió dentro de una clave con el nombre de la herramienta (ej: {"search": {...}}).
 *    Se instruye explícitamente generar un objeto JSON plano sin anidar bajo el nombre de la herramienta.
 * 2. route (decisión): Conserva la mejora comprobada (+14.3% en route) que elimina el 'fin' prematuro
 *    y prioriza ask_user y lectura previa.
 * 3. tool_choice (decisión): Mantiene la regla para seleccionar ask_user cuando falta información esencial.
 * 4. args_review y result_verification: Se mantienen idénticos a prod, tras comprobar empíricamente en
 *    decision_combo_52 que modificar los criterios de args_review generaba sobre-rechazo y regresiones (-11.1%).
 */
const jarvis_alt_v5: Variant = {
  name: "jarvis_alt_v5",

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
  },

  generative: {
    arguments: {
      system: {
        append:
          " Return ONLY a single flat JSON object with the argument keys directly (e.g. {\"query\": \"...\"}). NEVER nest under a tool name (do NOT output {\"search\": {...}} or {\"write_file\": {...}}). Use the exact schema parameter names from the tool: for search use 'query' and 'max_results'; for read_file use 'path', 'offset', 'length'; for write_file use 'path', 'content', and 'mode'; for start_process use 'command' and 'timeout_ms'; for fetch use 'url' and 'force_refresh'; for move_file use 'source' and 'destination'; for list_directory use 'path' and 'depth'; for interact_with_process use 'pid', 'input', and 'timeout_ms'. When a count or limit is requested use 'max_results'; when lines are requested use 'length'; when appending use mode 'append'; when execution timeout is requested use 'timeout_ms' in milliseconds; when bypassing cache use force_refresh true.",
      },
    },
  },
};

export default jarvis_alt_v5;

