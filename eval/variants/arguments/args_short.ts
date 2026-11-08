import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Compresión media (~50 % del largo de prod). Sin glosario de secciones y sin lista de verificación:
 * solo las reglas que cambian la salida, en viñetas cortas.
 * La primera línea debe seguir siendo la instrucción: buildSystemPrompt inserta ahí la línea del sistema operativo.
 */
const SYSTEM = `Generate the arguments for the indicated tool. Reply only with the JSON object, conforming to the SCHEMA.
- Include only the parameters the task needs; omit optional ones you do not use. Do not add filters the user did not ask for. For "latest" or "current", a search query may include the year from TODAY.
- Take every value from TASK, USER, STEPS, DATA or REFS. Never invent it or complete it with your own knowledge: if a needed field has no source, leave it empty or write N/A.
- To use a saved result as a value, write {{ref:rX}} with an id listed in REFS.
- Paths start from the ones in ENV, as written. No placeholders like <user>, no environment variables.
- Commands: the simplest one that does the task. Avoid hash tables and calculated properties (@{...}).
- Follow USER. Do not repeat what FAIL lists.
${DATA_NOTICE_EN}`;

const args_short: Variant = {
  name: "args_short",
  prompts: { PROMPTS: { ARGUMENTS_VIEW: { ...PROMPTS.ARGUMENTS_VIEW, SYSTEM } } },
};
export default args_short;
