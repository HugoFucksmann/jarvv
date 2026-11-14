import { PROMPTS, join, linesBlock, safe, shortDesc, todayLine } from "../../../src/core/models/prompts.ts";
import type { ArgsViewPromptData } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Variante de contexto (Frente 2): el prompt de argumentos lleva solo lo que la herramienta necesita.
 * - Las reglas de PowerShell y la línea del sistema operativo van solo si la herramienta recibe un comando (`command` en su schema).
 *   Hoy van siempre: unos 330 tokens de reglas de PowerShell también para `web_search`, `read_file` o `create_directory`.
 * - `ENV` (carpetas del usuario) no va para `web_search`: no usa rutas.
 * El resto (TODAY, TOOL, SCHEMA y la vista) queda igual que en producción.
 */
const hasCommand = (data: { tool: { inputSchema?: unknown } }): boolean => {
  const props = (data.tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  return "command" in props;
};

const BASE = PROMPTS.ARGUMENTS_VIEW.SYSTEM;
const NO_PS = BASE.replace(/PowerShell Rules:[\s\S]*?\n(?=Everything between)/, "");

const ctx_args_by_tool: Variant = {
  name: "ctx_args_by_tool",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        ...PROMPTS.ARGUMENTS_VIEW,
        buildSystemPrompt(tool, platform) {
          if (hasCommand({ tool })) return PROMPTS.ARGUMENTS_VIEW.buildSystemPrompt(tool, platform);
          return tool.name === "read_file" ? `${NO_PS}\n${PROMPTS.ARGUMENTS_VIEW.READ_REFS_NOTE}` : NO_PS;
        },
        buildUserPrompt(data: ArgsViewPromptData): string {
          const desc = shortDesc(data.tool.description, "");
          const env = data.tool.name === "web_search"
            ? null
            : linesBlock("ENV", Object.entries(data.environment).filter(([k]) => k !== "platform").map(([k, v]) => `${k}=${v}`), 1000);
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

export default ctx_args_by_tool;
