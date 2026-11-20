/**
 * JARVIS Core — Registro de extractores (Fase 4)
 *
 * Una herramienta sin entrada aquí usa el extractor genérico: añadir una herramienta al manifest no exige código.
 * Se registra un extractor solo cuando el formato de salida de esa herramienta lo justifica. La clave es la misma del
 * manifest (`toolKey`), y una entrada que el manifest no cataloga falla al arrancar, como una clave duplicada.
 * Los resultados de los proveedores nativos (`jarvis_*`) no se registran aquí: los lee `extractStructured` por llevar el esquema de `tools/result.ts`.
 */

import { isKnownTool, toolKey } from "../../tools/manifest.ts";
import type { Extractor } from "./types.ts";
import { extractListDirectory, extractReadFile } from "./files.ts";
import { extractGeneric } from "./generic.ts";
import { extractStructured } from "./structured.ts";

const ENTRIES: ReadonlyArray<readonly [server: string, tool: string, extractor: Extractor]> = [
    ["desktop_commander", "list_directory", extractListDirectory],
    ["desktop_commander", "read_file", extractReadFile],
];

const REGISTRY = new Map<string, Extractor>();
for (const [server, tool, extractor] of ENTRIES) {
    if (!isKnownTool(server, tool)) throw new Error(`[Extractors] '${server}:${tool}' no figura en el manifest.`);
    const key = toolKey(server, tool);
    if (REGISTRY.has(key)) throw new Error(`[Extractors] extractor duplicado: ${key}`);
    REGISTRY.set(key, extractor);
}

/**
 * Un resultado nativo (con el esquema de `tools/result.ts`) lo lee `extractStructured`, sea cual sea la herramienta y también si es un error: el proveedor ya
 * separó `text` (el mensaje) de `raw`, y el `pid` de un proceso que no existe tiene que dar de baja el hecho `process`. Cualquier otro resultado de error usa el
 * extractor genérico: un extractor específico produciría un resumen de éxito de algo que no se obtuvo.
 */
export function selectExtractor(mcp: string, tool: string, isError: boolean, native = false): Extractor {
    if (native) return extractStructured;
    if (isError) return extractGeneric;
    return REGISTRY.get(toolKey(mcp, tool)) ?? extractGeneric;
}
