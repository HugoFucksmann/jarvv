import type { Variant } from "../core/variants/types.ts";

/**
 * Decisión 3 (`args_review`, d3:2b). DIAGNÓSTICO, no para producción: la pregunta `review` queda como en `prod` (el pass
 * rate canónico debe dar igual) y se agregan tres preguntas `noul` con señales concretas en vez de "¿es válido?".
 *
 * Hallazgo de `d3_diagnostico`: `args_ok` ("¿cada valor está respaldado y es válido?") dio 0.87–0.95 en los casos de ruta
 * placeholder, URL inventada y comandos de Linux, o sea no detecta justo lo que `args_invalid` debería detectar. `user_needed`,
 * en cambio, separó bien (0.78 y 0.88 en los dos casos de información faltante; casi todo el resto por debajo de 0.3).
 *
 * Hipótesis: el 2b detecta señales concretas y observables mejor que una validez abstracta. Cada pregunta nombra una señal:
 * - `no_placeholder`: valores con marcadores (<user>, <path>, %VARIABLE%);
 * - `in_context`: rutas y URL que no aparecen en la tarea, la entrada del usuario, las lecturas ni el entorno;
 * - `windows_cmd`: el sistema operativo va dentro de la pregunta, no en el estado (como `os_fit` de `decision_opciones`).
 *
 * Respuesta esperada, deducida de `expectedReview` del caso: `args_invalid` implica al menos una de las tres en "no" (para
 * `windows_cmd`, solo en los casos de comando); `approved` implica las tres en "sí". Pasar `runs.jsonl`.
 */
const d3_diagnostico2: Variant = {
  name: "d3_diagnostico2",
  decision: {
    args_review: {
      addQuestions: {
        no_placeholder: {
          type: "noul",
          instructions:
            "Are all paths and values in the arguments real, with no placeholders such as <user>, <path> or %VARIABLE%?",
        },
        in_context: {
          type: "noul",
          instructions:
            "Does every path and URL in the arguments appear in the task, the user input, the latest reads or the environment?",
        },
        windows_cmd: {
          type: "noul",
          instructions:
            "This computer runs Windows with PowerShell. Is the command a Windows or PowerShell command (not a Linux or macOS one)? Answer yes if there is no command.",
        },
      },
    },
  },
};

export default d3_diagnostico2;
