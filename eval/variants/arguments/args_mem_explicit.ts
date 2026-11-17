import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Platform } from "../../../src/core/environment.ts";
import type { MCPTool } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: instrucciones explícitas sobre `MEMORY` (hechos del usuario para entidades/rutas reales) y `PREVIOUS TASK` (para resolver pronombres como "eso"/"el primero" sin mezclar valores viejos si el usuario pide algo nuevo) reducen placeholders e inventos en escenarios recalled.
const BASE_SYSTEM = `Generate the arguments for the indicated tool. Return only a JSON object that conforms to the SCHEMA.

Include only the required parameters and optional parameters needed for the task.
Follow TASK and USER exactly. Use STEPS, DONE, STATE, DATA and EFFECTS as context. Do not repeat failed attempts listed in FAIL or LAST ERROR; correct the specific problem.

Grounding (ENV, MEMORY, PREVIOUS TASK):
- Use ENV for system directories and user paths; never output placeholders or shell variables ($HOME, %USERPROFILE%).
- Use MEMORY when TASK refers to a user preference, alias, project path, host, or handle stored there (prefer the most specific matching fact; never invent defaults when MEMORY does not match).
- Use PREVIOUS TASK only to resolve short follow-up references ("eso", "el primero", "ahí", "rename that") to the entity or path established in the prior turn, unless TASK explicitly asks for a different target.

Use only available information for task-specific values. Never invent paths, identifiers, names, filters, URLs or data.
${DATA_NOTICE_EN}`;

const PS_EXTRA = `PowerShell Rules:
- NEVER use "&&" in Windows PowerShell 5.1; use ";" or native tool flags.
- Never write @{...} scriptblocks inside Select-Object/Sort-Object/Measure-Object; list raw property names directly.
- Separate -FilterHashtable pairs with ";", not ",".
- Never use POSIX commands (grep, awk, sed, kill, top, ps aux); use PowerShell cmdlets.`;

const args_mem_explicit: Variant = {
  name: "args_mem_explicit",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        ...PROMPTS.ARGUMENTS_VIEW,
        SYSTEM: BASE_SYSTEM,
        buildSystemPrompt(tool: MCPTool, platform: Platform): string {
          const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
          const takesCommand = "command" in props;
          const [first, ...rest] = this.SYSTEM.split("\n");
          if (!takesCommand) return this.SYSTEM;
          const os = PROMPTS.ARGUMENTS_VIEW.osLine(platform);
          return platform === "windows"
            ? [first, os, ...rest.slice(0, -1), PS_EXTRA, rest[rest.length - 1]].join("\n")
            : [first, os, ...rest].join("\n");
        },
      },
    },
  },
};

export default args_mem_explicit;
