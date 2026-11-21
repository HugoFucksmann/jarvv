/**
 * JARVIS Core — Reglas de política de las tools nativas que modifican el sistema.
 *
 * Los comandos de `run_command` los clasifica `commandRules.ts` (apagar la PC, borrar carpetas críticas, bajar y ejecutar código…). Las tools nativas hacen lo mismo
 * sin pasar por un comando, así que sin estas reglas esos casos solo dependerían del nivel de aprobación. Acá se les da la MISMA clasificación que a su comando
 * equivalente (se reutiliza `classify`), con el mismo efecto:
 * - `guard`: Guard deniega (`tool_rejected`), también con confirmación del usuario.
 * - `blocked`: con modo automático o niveles, se rechaza con la razón escrita; sin ellos, se le pregunta al usuario.
 * - `sensitive`: con modo automático lo decide Decisión 3 con el umbral estricto; con niveles, además, se le pregunta al usuario.
 *
 * Qué cubre: `power` (apagar y reiniciar), `delete_file` (raíces de disco, carpetas del sistema, carpetas enteras del usuario), y escribir, copiar, mover, extraer o
 * descargar un archivo ejecutable o un script (código que después alguien puede ejecutar). No hay modelos. Es una hoja: la importan Guard y la lista negra.
 */

import { classify, type RuleFinding } from "./commandRules.ts";
import { expandedArgEntries } from "./pathArgs.ts";

/** Extensiones de archivos que ejecutan código (o lo cargan) al abrirlos. */
const CODE_EXTENSIONS = new Set([
  "exe", "dll", "sys", "scr", "msi", "msp", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "wsf", "js", "jse", "hta", "jar", "lnk", "reg", "cpl", "sh",
]);

/** Alias de carpetas del usuario que aceptan las tools de archivos: nombrar uno entero como destino de un borrado es borrar una carpeta personal. */
const USER_ALIASES = /^(?:home|desktop|documents|downloads|~)[\\/]*$/i;

const finding = (tier: RuleFinding["tier"], id: string, reason: string): RuleFinding => ({ tier, id, reason });

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const extensionOf = (value: string): string => {
  const clean = value.split(/[?#]/)[0].replace(/[\\/]+$/, "");
  const name = clean.slice(Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

/** Destinos que una escritura deja en el disco, de cualquier forma de pedirla (`path`, `destination`, `items`, `filename`, y el `format` de una conversión). */
function writtenTargets(tool: string, args: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const [key, value] of expandedArgEntries(args)) {
    if (typeof value !== "string") continue;
    if (key === "destination" || key === "filename") out.push(value);
    else if (key === "path" && (tool === "write_file" || tool === "edit_file")) out.push(value);
  }
  if (tool === "convert_file") {
    const format = text(args.format).replace(/^\./, "");
    if (format !== "") out.push(`resultado.${format}`);
  }
  return out;
}

/**
 * La regla más grave que cumple la llamada a una tool nativa, o `null`. `homeDirs` son las carpetas de inicio reales (igual que en `classify`).
 */
export function classifyToolCall(tool: string, args: Readonly<Record<string, unknown>>, homeDirs: readonly string[] = []): RuleFinding | null {
  switch (tool) {
    case "power": {
      const action = text(args.action).toLowerCase();
      return action === "shutdown" || action === "restart" ? finding("blocked", "power", "Shutting down or restarting the machine is not allowed.") : null;
    }
    case "delete_file": {
      const target = text(args.path);
      if (target === "") return null;
      if (USER_ALIASES.test(target)) return finding("blocked", "delete-user-folder", "Deleting Documents, Desktop, Downloads or another personal folder (or everything in it) is not allowed.");
      // Mismo análisis que el borrado equivalente de un comando; un borrado común (`sensitive`) lo cubre el nivel rojo, no se repite acá.
      const found = classify(`Remove-Item -Recurse -Force "${target.replace(/"/g, "")}"`, { homeDirs });
      return found !== null && found.tier !== "sensitive" ? found : null;
    }
    case "download_file": {
      const names = [text(args.destination), text(args.filename), text(args.url)];
      return names.some((n) => CODE_EXTENSIONS.has(extensionOf(n)))
        ? finding("sensitive", "download-executable", "Downloading an executable or a script brings code that is not verified.")
        : null;
    }
    case "write_file":
    case "edit_file":
    case "copy_file":
    case "move_file":
    case "convert_file":
    case "archive_files": {
      if (tool === "archive_files" && text(args.action) === "extract") return null; // los nombres de lo que sale del zip no se ven antes de extraer
      return writtenTargets(tool, args).some((n) => CODE_EXTENSIONS.has(extensionOf(n)))
        ? finding("sensitive", "write-executable", "Writing an executable or a script creates code that can be run later.")
        : null;
    }
    default:
      return null;
  }
}
