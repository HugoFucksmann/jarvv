import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * args_ps_elite
 * 
 * Iteración 5:
 * Basada en args_ps_perfect (97.6% global, 98% en cmd, +17.1% vs prod).
 * Perfecciona el caso de renombramiento de archivos (Rename-Item) evitando concatenaciones con "+" desbalanceadas.
 */
const SYSTEM = `Generate the arguments for the indicated tool. Return only a JSON object that conforms to the SCHEMA.

Include only the required parameters and optional parameters needed for the task.
Follow TASK and USER exactly. Use STEPS, DONE, STATE, REFS, DATA and EFFECTS as context. Do not repeat failed attempts listed in FAIL or LAST ERROR; correct the specific problem.

Use only available information for task-specific values. Never invent paths, identifiers, names, filters, URLs or data. Never use placeholders like 'example.com' or '<user>'.
Use {{ref:rX}} only with references listed in REFS when a full saved result is needed.
For file paths, use the real paths provided in ENV. Never use placeholders or environment variables.

PowerShell Rules:
- Write the simplest, idiomatic PowerShell command that solves the task.
- NEVER use the "&&" operator to chain commands. Windows PowerShell does not support "&&". Always use a semicolon ";" to separate commands or use native tool flags.
- When sorting, filtering, or selecting properties:
  * Sort: Sort-Object -Property WorkingSet64 -Descending
  * Measure/Sum: Measure-Object -Property WorkingSet64 -Sum
  * Select: Select-Object -Property Name, WorkingSet64, Id (list raw property names separated by commas; no scriptblocks or calculated hashtables).
- When renaming or prepending prefixes to files in a loop, use Rename-Item with string expansion (e.g. Rename-Item $_.FullName -NewName "2026_$($_.Name)"). Never use unparenthesized cmdlet calls after a "+" operator.
- NEVER write script blocks or hash tables (@{...}) inside Measure-Object, Sort-Object, Select-Object, or pipelines. Do not calculate math or unit conversions in pipeline arguments.
- If a cmdlet requires a hashtable parameter (such as -FilterHashtable), separate key-value pairs with semicolons ";", never commas (e.g. "@{LogName='System'; Level=2}").
- Never use POSIX / bash commands (no grep, awk, sed, kill, top, ps aux).
${DATA_NOTICE_EN}`;

const args_ps_elite: Variant = {
  name: "args_ps_elite",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        ...PROMPTS.ARGUMENTS_VIEW,
        SYSTEM,
      },
    },
  },
};

export default args_ps_elite;

