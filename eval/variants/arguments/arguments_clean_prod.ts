import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Platform } from "../../../src/core/environment.ts";
import type { MCPTool } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * arguments_clean_prod: actualiza el SYSTEM de argumentos al catálogo actual sin ruido heredado
 * y con reglas explícitas para web_search (`need` pregunta directa sin URL), `run_command` por `pid`
 * (sin repetir `command`), `stop_process`/`get_more_search_results` con IDs de DATA/STATE y `.xlsx` en matriz JSON.
 */
const POWERSHELL_RULES = `PowerShell Rules:
- Write the simplest idiomatic PowerShell 5.1 command that solves the task.
- NEVER use "&&" to chain commands; use ";" or native cmdlet flags.
- Use raw property names in Sort-Object, Measure-Object, and Select-Object (no @{...} scriptblocks or math expressions in pipelines).
- Use semicolons inside hashtable literals (e.g. @{LogName='System'; Level=2}).
- Quote Windows paths containing spaces with single or double quotes.
- Never use POSIX/bash commands (grep, awk, sed, kill, top, ps aux, ls -la, du -sh).`;

const SYSTEM_BASE = `Generate the JSON arguments for the indicated tool. Return ONLY a JSON object matching SCHEMA.

Rules:
- Include required fields and only optional fields needed for TASK and USER.
- Ground every path, URL, PID, and sessionId in TASK, USER, STEPS, DONE, STATE, DATA, MEMORY, or ENV. Never invent values or use placeholders.
- For FAIL / LAST ERROR retries: never repeat the rejected arguments; fix the exact cause stated there.
- Tool specifics:
  * web_search: "need" must be a concise direct question (never a raw URL or instruction). Only pass "urls" or "domains" if explicitly grounded in the task or DATA.
  * run_command: when continuing or answering a running/waiting_input pid from DATA/STATE, pass "pid" (and "input" if waiting) and OMIT "command". Use "cwd" instead of "cd ... && ...".
  * stop_process / get_more_search_results: use exact pid or sessionId from DATA or STATE.
  * write_file on .xlsx/.xls/.xlsm: content must be a JSON string of a 2D array of rows or {"Sheet": [[...]]}.
${POWERSHELL_RULES}
${DATA_NOTICE_EN}`;

const SYSTEM_NO_PS = SYSTEM_BASE.replace(`${POWERSHELL_RULES}\n`, "");

const arguments_clean_prod: Variant = {
  name: "arguments_clean_prod",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        ...PROMPTS.ARGUMENTS_VIEW,
        SYSTEM: SYSTEM_BASE,
        buildSystemPrompt(tool: MCPTool, platform: Platform): string {
          const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
          const takesCommand = "command" in props;
          const base = takesCommand && platform === "windows" ? SYSTEM_BASE : SYSTEM_NO_PS;
          if (!takesCommand) return base;
          const [first, ...rest] = base.split("\n");
          return [first, PROMPTS.ARGUMENTS_VIEW.osLine(platform), ...rest].join("\n");
        },
      },
    },
  },
};

export default arguments_clean_prod;
