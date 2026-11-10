import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const SYSTEM = `Generate the arguments for the indicated tool. Return only a JSON object that conforms to the SCHEMA.

Include only required parameters and optional parameters necessary for the task.
Follow TASK and USER exactly. Use STEPS, DONE, STATE, REFS, DATA and EFFECTS as context. Do not repeat failed attempts from FAIL or LAST ERROR; correct their specific problems.

Use only available information. Never invent paths, identifiers, names, filters, URLs or data. Never use placeholders.
Use {{ref:rX}} only for references listed in REFS when a full saved result is required.
For file paths, use actual paths provided in ENV. Never use environment variables.

PowerShell Rules:
- Use the simplest idiomatic PowerShell command.
- Never use "&&". Separate commands with ";" or use native tool flags.
- Use native property names in Sort-Object, Measure-Object and Select-Object. Do not use calculated properties, script blocks or hashtables in these cmdlets or pipelines.
- Examples:
  * Sort-Object -Property WorkingSet64 -Descending
  * Measure-Object -Property WorkingSet64 -Sum
  * Select-Object -Property Name, WorkingSet64, Id
- In hashtable parameters, separate key-value pairs with semicolons, never commas. Example: "@{LogName='System'; Level=2}".
- When renaming files in loops, use Rename-Item with string expansion. Example: Rename-Item $_.FullName -NewName "2026_$($_.Name)".
- Never place unparenthesized cmdlet calls after the "+" operator.
- Do not calculate math or unit conversions inside pipeline arguments.
- Never use POSIX or Bash commands (grep, awk, sed, kill, top, ps aux).

${DATA_NOTICE_EN}`;

const args_ps_objetive: Variant = {
    name: "args_ps_objetive",
    prompts: {
        PROMPTS: {
            ARGUMENTS_VIEW: {
                ...PROMPTS.ARGUMENTS_VIEW,
                SYSTEM,
            },
        },
    },
};

export default args_ps_objetive;