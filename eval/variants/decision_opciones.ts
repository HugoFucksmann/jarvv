import type { Variant } from "../core/variants/types.ts";

/**
 * Variante de PRUEBA de preguntas con opciones en una decisión (`args_review`):
 * - quita la opción `tool_rejected` (en una ruta con una sola herramienta no hay otra que elegir);
 * - agrega una pregunta `choice` (`os_fit`, con tres opciones) y una `noul` (`command_valid`).
 *
 * La pregunta principal sigue siendo `review`. Las agregadas se evalúan si el caso trae `expect.answers` para ellas
 * (`verificacion_corrida.jsonl` lo hace en los casos de `args_review`).
 */
const decision_opciones: Variant = {
  name: "decision_opciones",
  decision: {
    args_review: {
      questions: { review: { criteria: { remove: ["tool_rejected"] } } },
      addQuestions: {
        os_fit: {
          type: "choice",
          instructions: "Is the command written for the operating system of this computer, which is Windows?",
          criteria: {
            ok: "The command only uses Windows commands, PowerShell cmdlets or programs available on Windows.",
            wrong_os: "The command uses Linux or macOS commands or syntax (for example ps, top, grep, head or sudo).",
            unknown: "It cannot be told from the call.",
          },
        },
        command_valid: {
          type: "noul",
          instructions: "Would this command run without a syntax error in the shell given in the arguments?",
        },
      },
    },
  },
};

export default decision_opciones;
