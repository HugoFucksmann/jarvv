import type { Variant } from "../core/variants/types.ts";

/**
 * jarvis_alt_v6:
 *
 * Iteración basada en los hallazgos de v5:
 * 1. arguments (generativo): Mantiene la directiva de objeto JSON plano que logró +66.7% en agentic_30
 *    y +35.7% en llm_generative_48, y añade la regla explícita para usar {{ref:rX}} cuando hay referencias
 *    disponibles en vez de inlinear rutas o textos literales (para resolver ar-ref-ruta, etc.).
 * 2. route (decisión): Refuerza la directiva hacia ask_user ante 'info_missing' para contrarrestar el sesgo
 *    léxico de d3 hacia la ruta de archivos.
 * 3. tool_choice (decisión): Mantiene la regla para seleccionar ask_user cuando falta información esencial (+20% en hard_40).
 * 4. plan (generativo): Guía para mantener la ruta adecuada (ej. web) tras fallos de servicio en replanificación.
 * 5. args_review y result_verification: Se conservan idénticos a prod para garantizar 0 regresiones.
 */
const jarvis_alt_v6: Variant = {
  name: "jarvis_alt_v6",

  decision: {
    route: {
      questions: {
        route: {
          instructions: {
            append:
              " Choose fin only when the work is already complete. If the request still needs something to be run, read, found or looked up, choose the route that does it. CRITICAL: If 'Attempts not approved' contains 'info_missing', or if essential information from the user is needed to proceed, you MUST choose ask_user. When the task requires searching or reading data before saving to a file, choose the search or read route first.",
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
          " Return ONLY a single flat JSON object with the argument keys directly (e.g. {\"query\": \"...\"}). NEVER nest under a tool name (do NOT output {\"search\": {...}} or {\"write_file\": {...}}). Use the exact schema parameter names from the tool: for search use 'query' and 'max_results'; for read_file use 'path', 'offset', 'length'; for write_file use 'path', 'content', and 'mode'; for start_process use 'command' and 'timeout_ms'; for fetch use 'url' and 'force_refresh'; for move_file use 'source' and 'destination'; for list_directory use 'path' and 'depth'; for interact_with_process use 'pid', 'input', and 'timeout_ms'. When a count or limit is requested use 'max_results'; when lines are requested use 'length'; when appending use mode 'append'; when execution timeout is requested use 'timeout_ms' in milliseconds; when bypassing cache use force_refresh true. When 'Available refs' or 'REFS' provides a reference (such as r1 or r2) for a path or content from an earlier step, write '{{ref:r1}}' (or corresponding ref token) as the value instead of copying the literal path or text.",
      },
    },

    plan: {
      system: {
        append:
          " When replanning after a tool error, do not switch to an inappropriate subsystem like terminal for online lookups; keep using the capability that fits the request (such as web for online information).",
      },
    },
  },
};

export default jarvis_alt_v6;

