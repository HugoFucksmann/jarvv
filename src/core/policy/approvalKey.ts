/**
 * JARVIS Core — Clave de una operación para «aprobar siempre en esta tarea» y para no repetir una pregunta que el usuario ya rechazó.
 *
 * La clave es la herramienta más el comando normalizado (`run_command`: minúsculas, espacios colapsados, más el `cwd`) o las rutas normalizadas
 * (`canonicalPath`: separadores, prefijos `\?\`, symlinks, mayúsculas). Sin comando ni ruta, los argumentos en JSON con las claves ordenadas.
 * No hay modelos. Vive solo en la RAM de la tarea (`TaskRuntime`): ninguna aprobación sobrevive a la tarea.
 */

import { canonicalPath, isAnyAbsolute, stripExtendedPrefix } from "./allowedDirs.ts";
import { pathValuesOf } from "./pathArgs.ts";

const normPath = (value: string): string => {
  const p = stripExtendedPrefix(value.trim());
  if (p === "" || p.includes("{{")) return p.toLowerCase();
  try {
    return (isAnyAbsolute(p) ? canonicalPath(p) : p).replace(/\\/g, "/").toLowerCase();
  } catch {
    return p.replace(/\\/g, "/").toLowerCase();
  }
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function approvalKey(tool: string, args: Readonly<Record<string, unknown>>): string {
  if (typeof args.command === "string" && args.command.trim() !== "") {
    const cwd = typeof args.cwd === "string" ? normPath(args.cwd) : "";
    return `${tool}|cmd|${args.command.trim().replace(/\s+/g, " ").toLowerCase()}|${cwd}`;
  }
  const paths = pathValuesOf(args).map(normPath);
  if (paths.length > 0) return `${tool}|path|${paths.join(">")}`;
  return `${tool}|args|${stable(args)}`;
}
