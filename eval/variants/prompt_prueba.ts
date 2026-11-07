import { DECISION_PROMPTS, PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Variante de PRUEBA de prompts enteros (sirve para comprobar el camino `prompts`, no para medir un prompt mejor):
 * - `pending`: agrega la regla de no nombrar comandos ni herramientas.
 * - `arguments`: agrega que la computadora es Windows y que se usa PowerShell.
 * - `args_review` (decisión): arma el prompt de producción y le suma la plataforma al estado.
 */
const prompt_prueba: Variant = {
  name: "prompt_prueba",
  prompts: {
    PROMPTS: {
      PENDING_VIEW: {
        SYSTEM: `${PROMPTS.PENDING_VIEW.SYSTEM}\nNever write command names or tool names in an item: describe the goal, not how to achieve it.`,
      },
      ARGUMENTS_VIEW: {
        SYSTEM: `${PROMPTS.ARGUMENTS_VIEW.SYSTEM}\nThis computer runs Windows: write PowerShell commands (shell "powershell"), never Linux commands.`,
      },
    },
    DECISION_PROMPTS: {
      buildArgsReview: (data) => {
        const base = DECISION_PROMPTS.buildArgsReview(data);
        return { ...base, state: `${base.state}\nPlatform: Windows` };
      },
    },
  },
};

export default prompt_prueba;
