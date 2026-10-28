/**
 * JARVIS Core — Almacén de referencias de resultados completos y sus etiquetas.
 */

import { sanitizeForMemory } from "./text.ts";

/** Descripción de una referencia guardada: origen legible y tamaño (para el bloque REFS del prompt de argumentos). */
export interface RefDescriptor {
    key: string;
    label: string;
    chars: number;
}

interface RefEntry {
    content: string;
    label: string;
}

/** Referencias de una tarea: contador de claves (`r1`, `r2`…) y contenidos con su etiqueta. */
interface TaskRefs {
    counter: number;
    entries: Map<string, RefEntry>;
}

/**
 * Almacén de resultados completos de herramientas (§10.4, §10.11), aislado por `taskId` para que limpiar o consultar
 * una tarea nunca afecte a otra.
 */
export class RefStore {
    private static readonly tasks = new Map<string, TaskRefs>();

    /** Guarda `content` y devuelve su clave; el mismo contenido con la misma etiqueta reutiliza la clave existente. */
    static put(content: string, taskId: string, label = ""): string {
        let refs = RefStore.tasks.get(taskId);
        if (!refs) {
            refs = { counter: 0, entries: new Map() };
            RefStore.tasks.set(taskId, refs);
        }
        for (const [existing, entry] of refs.entries) {
            if (entry.content === content && entry.label === label) return existing;
        }
        const key = `r${++refs.counter}`;
        refs.entries.set(key, { content, label });
        return key;
    }

    /** Las últimas `limit` referencias de la tarea, de la más antigua a la más reciente. */
    static describe(taskId: string, limit = 5): RefDescriptor[] {
        const refs = RefStore.tasks.get(taskId);
        if (!refs) return [];
        return Array.from(refs.entries)
            .slice(-limit)
            .map(([key, entry]) => ({ key, label: entry.label, chars: entry.content.length }));
    }

    static get(key: string, taskId: string): string | undefined {
        return RefStore.tasks.get(taskId)?.entries.get(key)?.content;
    }

    /**
     * Libera las referencias de una tarea. Las refs de una tarea terminada se conservan en memoria, para que su
     * evidencia siga consultable mientras la tarea esté en el historial; solo se liberan cuando la tarea se expulsa.
     */
    static clear(taskId: string): void {
        RefStore.tasks.delete(taskId);
    }
}

/** Argumentos que mejor identifican de dónde viene un resultado (para describirlo en REFS). */
const REF_LABEL_ARGS = ["path", "file_path", "url", "query", "command", "pattern", "name"] as const;

/** Etiqueta determinista de una llamada: herramienta + su destino (ruta, URL, consulta o comando). */
export function refLabel(tool: string, args: Record<string, unknown>): string {
    const src = args.source;
    const dst = args.destination;
    if (typeof src === "string" && src.trim() && typeof dst === "string" && dst.trim()) {
        return `${tool} ${sanitizeForMemory(src, 60)} -> ${sanitizeForMemory(dst, 60)}`;
    }
    for (const key of REF_LABEL_ARGS) {
        const value = args[key];
        if (typeof value === "string" && value.trim()) return `${tool} ${sanitizeForMemory(value, 60)}`;
    }
    return tool;
}

/**
 * `Evidence.ref`: `<mcp>:<tool>:<refKey>` si el resultado tuvo texto (quedó en RefStore), `<mcp>:<tool>` si no.
 * Único lugar que conoce el formato: lo construye `evidenceRef` y lo lee `refKeyOf`.
 */
export function evidenceRef(mcp: string, tool: string, refKey?: string): string {
    return refKey ? `${mcp}:${tool}:${refKey}` : `${mcp}:${tool}`;
}

/** Clave de RefStore contenida en un `Evidence.ref`; undefined si la llamada no guardó texto. */
export function refKeyOf(ref?: string): string | undefined {
    return /:(r\d+)$/.exec(ref ?? "")?.[1];
}