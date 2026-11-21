/**
 * eval/variants/arguments/arguments_v1.ts
 *
 * Variante dedicada para la etapa `arguments` (`ARGUMENTS_VIEW`).
 * Endurece fidelidad al schema, rutas de `ENV`/`DATA`/`USER` y sintaxis válida de PowerShell 5.1.
 */

import type { Platform } from "../../../src/core/environment.ts";
import {
  type ArgsViewPromptData,
  DATA_NOTICE_EN,
  join,
  linesBlock,
  safe,
  shortDesc,
  todayLine,
} from "../../../src/core/models/prompts.ts";
import type { PromptSet } from "../../../src/core/models/stageRequests.ts";
import type { MCPTool } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

const MAX_ENV_CHARS = 800;

const POWERSHELL_RULES = `PowerShell 5.1 Rules:
- Write the cleanest idiomatic PowerShell command solving TASK.
- NEVER chain commands with "&&" (unsupported in Windows PowerShell 5.1). Use ";" or pass directory via the "cwd" argument.
- When sorting, measuring, or selecting fields:
  * Sort-Object -Property WorkingSet64 -Descending
  * Measure-Object -Property WorkingSet64 -Sum
  * Select-Object -Property Name, WorkingSet64, Id (raw property names only; NEVER use @{Name=...; Expression={...}} or script blocks).
- NEVER put math conversions or calculated hashtables inside pipeline cmdlets.
- If a cmdlet requires a hashtable literal (e.g., -FilterHashtable), separate entries with ";" rather than commas: @{LogName='System'; Level=2}.
- NEVER use POSIX/bash commands (grep, awk, sed, kill, top, ps aux, ls -la, rm -rf) or Linux paths (/etc/, /usr/, /var/, /home/).`;

const BASE_SYSTEM = `Generate tool arguments as a SINGLE valid JSON object conforming strictly to SCHEMA.

- Supply every required field and only optional fields explicitly warranted by TASK, USER, or DATA.
- Extract exact file paths, filenames, identifiers, URLs, and PIDs from TASK, USER, STEPS, DONE, DATA, STATE, and EFFECTS.
- When FAIL or LAST ERROR appears, fix the root cause (never repeat the rejected syntax, path, or arguments).
- NEVER invent paths, URLs, credentials, or placeholders (<user>, example.com, /path/to, N/A, TODO).
- Copy directory paths verbatim from ENV (preserving casing and slashes).

${POWERSHELL_RULES}
${DATA_NOTICE_EN}`;

const ARGUMENTS_VIEW: PromptSet["ARGUMENTS_VIEW"] = {
  SYSTEM: BASE_SYSTEM,

  osLine(platform: Platform): string {
    return platform === "windows"
      ? "This computer runs Windows. Any shell command runs in Windows PowerShell 5.1: use PowerShell cmdlets or Windows executables and Windows paths from ENV."
      : `This computer runs ${platform === "macos" ? "macOS" : "Linux"}. Any shell command runs in POSIX bash using executables and paths valid on ${platform}.`;
  },

  buildSystemPrompt(tool: MCPTool, platform: Platform): string {
    const schemaObj = tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
    const props = schemaObj?.properties ?? {};
    const takesCommand = "command" in props;
    const system = takesCommand && platform === "windows" ? this.SYSTEM : this.SYSTEM.replace(`${POWERSHELL_RULES}\n`, "");
    const [first, ...rest] = system.split("\n");
    return takesCommand ? [first, this.osLine(platform), ...rest].join("\n") : system;
  },

  buildUserPrompt(data: ArgsViewPromptData): string {
    const desc = shortDesc(data.tool.description, "");
    return join([
      todayLine(),
      linesBlock(
        "ENV",
        Object.entries(data.environment)
          .filter(([k]) => k !== "platform")
          .map(([k, v]) => `${k}=${v}`),
        MAX_ENV_CHARS,
      ),
      `TOOL: ${safe(data.tool.name)}${desc ? `: ${safe(desc)}` : ""}`,
      `SCHEMA: ${JSON.stringify(data.cleanedSchema)}`,
      data.view,
    ]);
  },
};

const arguments_v1: Variant = {
  name: "arguments_v1",
  prompts: { PROMPTS: { ARGUMENTS_VIEW } },
};

export default arguments_v1;
