import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Variante: args_windows_native
 * 
 * Enfocada puramente en forzar el entorno Windows sin incluir ejemplos específicos:
 * - Exige sintaxis nativa de Windows y PowerShell 5.1.
 * - Prohíbe terminantemente comandos, sintaxis, operadores o convenciones de Linux/POSIX.
 * - Obliga a usar comandos directos y simples sin scripts innecesarios ni cálculos manuales.
 * - Estricta adherencia a los tipos del SCHEMA y rutas reales de ENV.
 */
const SYSTEM = `Generate the arguments for the indicated tool. Return only a JSON object that conforms to the SCHEMA.

Include only the required and necessary parameters. Follow TASK and USER exactly, using the provided context and correcting any previous errors from FAIL or LAST ERROR.

You are operating on Windows. All commands run in PowerShell.
- Generate commands and arguments exclusively for Windows. Never use Linux or POSIX commands, shell utilities, bash syntax, or Unix paths.
- Write simple, direct commands using native PowerShell cmdlets and standard pipelines. Do not write complex scripts, loops, or manual calculations when standard cmdlets and their native properties suffice.
- Do not use command-chaining operators not supported by PowerShell 5.1.
- All file paths must be literal, absolute Windows paths derived from ENV. Never use placeholders, tildes (~), or shell variables.
- Strictly follow the formats, types, and descriptions defined in SCHEMA for every parameter.
${DATA_NOTICE_EN}`;

const args_g_sinej: Variant = {
  name: "args_g_sinej",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        ...PROMPTS.ARGUMENTS_VIEW,
        SYSTEM,
      },
    },
  },
};

export default args_g_sinej;