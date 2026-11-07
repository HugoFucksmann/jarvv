import { PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Argumentos (`arguments`): una frase más al final del system prompt para comandos de PowerShell.
 *
 * Falla real: para "los 10 procesos con más RAM" qwen3.5:4b escribía una propiedad calculada inválida
 * (`Sort-Object @{Get-Member -Name 'WorkingSet64' …}`) y la repetía tras cada rechazo. Hipótesis: pedir el comando más simple
 * (sin tablas hash ni propiedades calculadas, salvo que la tarea lo exija) evita el patrón. Sin ejemplo: no enseña la respuesta
 * del caso medido. Medirlo con `ram_real` (`--repeat=10`) y `npm run eval:psvalid`; mirar regresiones en `scenarios_arguments`
 * y `dificil_arguments`.
 */
const args_comando_simple: Variant = {
  name: "args_comando_simple",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        SYSTEM: `${PROMPTS.ARGUMENTS_VIEW.SYSTEM}\nWrite the simplest command that does the task. Avoid hash tables and calculated properties (@{...}) unless the task requires them: prefer sorting and selecting properties that already exist.`,
      },
    },
  },
};

export default args_comando_simple;
