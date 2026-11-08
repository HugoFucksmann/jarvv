import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Compresión fuerte (~25 % del largo de prod). Un solo párrafo con lo esencial.
 * La línea del sistema operativo y la nota de READ_REFS_NOTE siguen viniendo de prod.
 */
const SYSTEM = `Generate the arguments for the indicated tool. Reply only with the JSON object, conforming to the SCHEMA.
Use only the parameters the task needs. Every value comes from TASK, USER, STEPS, DATA or REFS: if a needed value is missing, leave it empty or write N/A. Reference saved results as {{ref:rX}} with ids from REFS. Paths start from ENV. Write the simplest command that does the task. Follow USER; do not repeat what FAIL lists.
${DATA_NOTICE_EN}`;

const args_tiny: Variant = {
  name: "args_tiny",
  prompts: { PROMPTS: { ARGUMENTS_VIEW: { ...PROMPTS.ARGUMENTS_VIEW, SYSTEM } } },
};
export default args_tiny;
