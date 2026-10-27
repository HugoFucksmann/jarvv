/**
 * JARVIS Core — Registro de extractores
 *
 * Una herramienta sin entrada aquí usa el extractor genérico: añadir una herramienta al manifest no exige código.
 * Se registra un extractor solo cuando el formato de salida de esa herramienta lo justifica. La clave es la misma del
 * manifest (`toolKey`), y una entrada que el manifest no cataloga falla al arrancar, como una clave duplicada.
 */

import { isKnownTool, toolKey } from "../../tools/manifest.ts";
import type { Extractor } from "./types.ts";
import { extractListDirectory, extractReadFile } from "./files.ts";
import { extractProcess } from "./process.ts";
import { extractSearch, extractFetch } from "./freeSearch.ts";
import { extractGeneric } from "./generic.ts";

const ENTRIES: ReadonlyArray<readonly [server: string, tool: string, extractor: Extractor]> = [
    ["desktop_commander", "list_directory", extractListDirectory],
    ["desktop_commander", "read_file", extractReadFile],
    ["desktop_commander", "start_process", extractProcess],
    ["desktop_commander", "read_process_output", extractProcess],
    ["desktop_commander", "interact_with_process", extractProcess],
    ["free_search", "search", extractSearch],
    ["free_search", "fetch", extractFetch],
];

const REGISTRY = new Map<string, Extractor>();
for (const [server, tool, extractor] of ENTRIES) {
    if (!isKnownTool(server, tool)) throw new Error(`[Extractors] '${server}:${tool}' no figura en el manifest.`);
    const key = toolKey(server, tool);
    if (REGISTRY.has(key)) throw new Error(`[Extractors] extractor duplicado: ${key}`);
    REGISTRY.set(key, extractor);
}

/** Un resultado de error nunca usa un extractor específico: producirían un resumen de éxito y hechos de algo que no se obtuvo. */
export function selectExtractor(mcp: string, tool: string, isError: boolean): Extractor {
    if (isError) return extractGeneric;
    return REGISTRY.get(toolKey(mcp, tool)) ?? extractGeneric;
}