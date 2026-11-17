import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Platform } from "../../../src/core/environment.ts";
import type { MCPTool } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: un formato breve y numerado de reglas (alcance de parámetros, resolución de rutas desde ENV/MEMORY y reglas mínimas de PowerShell solo si aplica) baja la latencia y evita olvidos en el 4B.
const BASE_SYSTEM = `Return only a valid JSON object matching SCHEMA for the indicated tool.

1. Parameters: include required fields and only the optional fields needed by TASK/USER.
2. Context: use STEPS, DONE, DATA, MEMORY, PREVIOUS TASK and ENV for concrete paths/values. Never repeat FAIL or LAST ERROR mistakes.
3. No invention: never use placeholders (<user>, example.com, ~, %USERPROFILE%) or ungrounded paths/IDs.
${DATA_NOTICE_EN}`;

const PS_RULES = `PowerShell (Windows): no "&&" (use ";"); no @{...} inside Sort-Object/Select-Object/Measure-Object; use ";" inside -FilterHashtable; no bash commands (grep/awk/sed/kill/tail).`;

const args_structured_brief: Variant = {
  name: "args_structured_brief",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        ...PROMPTS.ARGUMENTS_VIEW,
        SYSTEM: BASE_SYSTEM,
        buildSystemPrompt(tool: MCPTool, platform: Platform): string {
          const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
          const takesCommand = "command" in props;
          if (!takesCommand) return this.SYSTEM;
          const [first, ...rest] = this.SYSTEM.split("\n");
          const os = PROMPTS.ARGUMENTS_VIEW.osLine(platform);
          return platform === "windows"
            ? [first, os, ...rest.slice(0, -1), PS_RULES, rest[rest.length - 1]].join("\n")
            : [first, os, ...rest].join("\n");
        },
      },
    },
  },
};

export default args_structured_brief;
