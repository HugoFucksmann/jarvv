import { PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Etapa `arguments` (qwen 4b, sin thinking). Texto fijo de sistema operativo y shell, en positivo.
 *
 * Hipótesis: con una sola frase que diga que la computadora es Windows y que los comandos corren en PowerShell (con el
 * valor literal "powershell" para el parámetro de shell), el modelo deja de escribir comandos de Linux. La frase va justo
 * después de la primera línea del prompt (la instrucción de qué generar) y antes de las reglas de secciones, para que no
 * quede al final, lejos de donde el modelo de 4b decide qué escribir.
 *
 * Se compara con `args_so_equivalencias`, que agrega la tabla de equivalencias en el mismo lugar: la diferencia entre
 * ambas es solo la tabla. `prompt_prueba` lo agrega al final, así que la posición se compara contra esa.
 * Es texto fijo para todas las herramientas: la frase dice "cuando escribas un comando", no afecta a las demás.
 */
const SO_LINE = `This computer runs Windows. Whenever you write a command, it runs in PowerShell: use PowerShell cmdlets or programs that exist on Windows, and Windows paths as ENV shows them. If the tool has a shell parameter, set it to "powershell".`;

const [first, ...rest] = PROMPTS.ARGUMENTS_VIEW.SYSTEM.split("\n");

const args_so_basico: Variant = {
  name: "args_so_basico",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        SYSTEM: [first, SO_LINE, ...rest].join("\n"),
      },
    },
  },
};

export default args_so_basico;
