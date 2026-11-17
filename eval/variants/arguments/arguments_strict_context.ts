import type { ArgsViewPromptData } from "../../../src/core/models/prompts.ts";
import { DATA_NOTICE_EN, join, linesBlock, PROMPTS, safe, shortDesc, todayLine } from "../../../src/core/models/prompts.ts";
import type { Platform } from "../../../src/core/environment.ts";
import type { MCPTool } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * arguments_strict_context: combina recorte selectivo por herramienta (sin ENV en web_search,
 * sin reglas de PowerShell fuera de herramientas con `command`) + recordatorio explícito de usar rutas exactas
 * de ENV / DATA / MEMORY y comillas en rutas Windows con espacios.
 */
const PS_BLOCK = `PowerShell Rules (Windows PowerShell 5.1):
- Never use "&&" (use ";"), bash commands (grep/awk/sed/ps/kill), or calculated hashtables @{...} in Select-Object/Sort-Object/Measure-Object.
- Quote file paths containing spaces. Use semicolons in parameter hashtables.`;

const SYSTEM_BASE = `Generate tool arguments as a single JSON object matching SCHEMA.
- Include required fields plus only relevant optional fields.
- Never fabricate paths, filenames, PIDs, session IDs, domains, or URLs. Use exact literal values from TASK, USER, DATA, MEMORY, or ENV (never env vars like %USERPROFILE%).
- Fix any issue noted in FAIL or LAST ERROR rather than repeating it.
- Omit "command" when continuing an active "pid" with run_command.
${PS_BLOCK}
${DATA_NOTICE_EN}`;

const SYSTEM_NO_PS = SYSTEM_BASE.replace(`${PS_BLOCK}\n`, "");

const arguments_strict_context: Variant = {
  name: "arguments_strict_context",
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
        buildUserPrompt(data: ArgsViewPromptData): string {
          const desc = shortDesc(data.tool.description, "");
          const env =
            data.tool.name === "web_search"
              ? null
              : linesBlock(
                  "ENV",
                  Object.entries(data.environment)
                    .filter(([k]) => k !== "platform")
                    .map(([k, v]) => `${k}=${v}`),
                  800,
                );
          return join([
            todayLine(),
            env,
            `TOOL: ${safe(data.tool.name)}${desc ? `: ${safe(desc)}` : ""}`,
            `SCHEMA: ${JSON.stringify(data.cleanedSchema)}`,
            data.view,
          ]);
        },
      },
    },
  },
};

export default arguments_strict_context;
