import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Variante: args_robust_ps
 * 
 * Diseñada para casos reales de dificultad media/alta en Windows:
 * 1. Evita scripts y fórmulas matemáticas complejas innecesarias en PowerShell (ordena directo por propiedades nativas).
 * 2. Bloquea el operador && (no soportado en PowerShell 5.1) y previene bashismos (grep, tail, kill, lsof).
 * 3. Respeta formatos estrictos del schema (como matrices JSON serializadas para .xlsx).
 * 4. Fuerza la resolución de rutas absolutas desde ENV sin variables de entorno ni placeholders.
 */
const SYSTEM = `Generate the arguments for the indicated tool. Return only a JSON object that conforms to the SCHEMA.

Include only the required parameters and optional parameters needed for the task. Follow TASK and USER exactly. Use STEPS, DONE, STATE, REFS, DATA and EFFECTS as context. Never repeat errors listed in FAIL or LAST ERROR.

Paths and Files:
- Always resolve paths to full absolute paths derived from ENV. Never output placeholders, tildes (~), or shell variables ($HOME, %USERPROFILE%, %APPDATA%).
- If a schema expects structured data (e.g. a JSON 2D array for .xlsx in write_file), provide valid serialized JSON matching the schema, never raw CSV text or inline script code.

Terminal and Commands:
- Write simple, idiomatic commands using standard pipelines (| Where-Object, | Sort-Object, | Select-Object).
- Do not write complex inline script blocks, custom loops, or unit conversion math (e.g. do not calculate [Math]::Round for RAM/sizes; sort directly by raw properties such as WorkingSet64 or Length).
- In PowerShell 5.1, never chain commands with "&&". Use ";" or command-native flags (such as git -C <path>).
- Never use POSIX/Linux commands (such as grep, awk, sed, kill, lsof, tail, top, du, systemctl); use the appropriate Windows or PowerShell equivalents.
${DATA_NOTICE_EN}`;

const args_g: Variant = {
  name: "args_g",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        ...PROMPTS.ARGUMENTS_VIEW,
        SYSTEM,
      },
    },
  },
};

export default args_g;