/**
 * JARVIS Core — Almacén de referencias de resultados completos y sus etiquetas.
 */

import { sanitizeForMemory } from "./text.ts";

/**
 * Task-isolated reference store for complete tool outputs (§10.4, §10.11).
 * Isolates data per taskId to prevent cross-task clearing and memory leaks.
 */
/** Descripción de una referencia guardada: origen legible y tamaño (para el bloque REFS del prompt de argumentos). */
export interface RefDescriptor {
    key: string;
    label: string;
    chars: number;
}

export class RefStore {
    private static taskStores: Map<string, Map<string, string>> = new Map();
    private static taskCounters: Map<string, number> = new Map();
    private static taskMeta: Map<string, Map<string, { label: string; chars: number }>> = new Map();

    static put(content: string, taskId: string, label?: string): string {
        let store = this.taskStores.get(taskId);
        if (!store) {
            store = new Map<string, string>();
            this.taskStores.set(taskId, store);
        }
        let meta = this.taskMeta.get(taskId);
        if (!meta) {
            meta = new Map();
            this.taskMeta.set(taskId, meta);
        }
        for (const [existing, stored] of store) {
            if (stored === content && meta.get(existing)?.label === (label ?? "")) return existing;
        }
        const currentCounter = (this.taskCounters.get(taskId) || 0) + 1;
        this.taskCounters.set(taskId, currentCounter);
        const key = `r${currentCounter}`;
        store.set(key, content);
        meta.set(key, { label: label ?? "", chars: content.length });
        return key;
    }

    /** Las últimas `limit` referencias de la tarea, de la más antigua a la más reciente. */
    static describe(taskId: string, limit = 5): RefDescriptor[] {
        const meta = this.taskMeta.get(taskId);
        if (!meta) return [];
        return Array.from(meta.entries())
            .slice(-limit)
            .map(([key, m]) => ({ key, label: m.label, chars: m.chars }));
    }

    static get(key: string, taskId: string): string | undefined {
        return this.taskStores.get(taskId)?.get(key);
    }



    /**
     * Libera las referencias de una tarea (o todas). Las refs de una tarea terminada se conservan en memoria, para que su
     * evidencia siga consultable mientras la tarea esté en el historial; solo se liberan cuando la tarea se expulsa.
     */
    static clear(taskId?: string): void {
        if (taskId) {
            this.taskStores.delete(taskId);
            this.taskCounters.delete(taskId);
            this.taskMeta.delete(taskId);
        } else {
            this.taskStores.clear();
            this.taskCounters.clear();
            this.taskMeta.clear();
        }
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