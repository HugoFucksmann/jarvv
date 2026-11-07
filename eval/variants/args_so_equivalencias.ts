import { PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Etapa `arguments` (qwen 4b, sin thinking). Igual que `args_so_basico` más una tabla corta de equivalencias.
 *
 * Hipótesis: un modelo chico no deduce el cmdlet a partir de "PowerShell"; con el equivalente de los cinco comandos de
 * Linux que más se le escapan (listar, mostrar, buscar texto, procesos, primeras líneas) acierta más. La tabla va en el
 * mismo lugar que en `args_so_basico`, así que la diferencia entre las dos es solo la tabla. Riesgo que mide: que la tabla
 * empuje a usar comandos aunque la herramienta no sea de terminal (por eso empieza con "when you write a command").
 */
const SO_LINE = `This computer runs Windows. Whenever you write a command, it runs in PowerShell: use PowerShell cmdlets or programs that exist on Windows, and Windows paths as ENV shows them. If the tool has a shell parameter, set it to "powershell".
Equivalents: list files = Get-ChildItem; show a file = Get-Content; search text = Select-String; running processes = Get-Process; first N lines = Select-Object -First N. Do not write Linux or macOS commands or Unix paths.`;

const [first, ...rest] = PROMPTS.ARGUMENTS_VIEW.SYSTEM.split("\n");

const args_so_equivalencias: Variant = {
  name: "args_so_equivalencias",
  prompts: {
    PROMPTS: {
      ARGUMENTS_VIEW: {
        SYSTEM: [first, SO_LINE, ...rest].join("\n"),
      },
    },
  },
};

export default args_so_equivalencias;
