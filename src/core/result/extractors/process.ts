/**
 * JARVIS Core — Extractor de procesos (Fase 4)
 */

import type { ExtractorInput, ExtractorOutput, ExtractorSignals, ProcessSignal } from "./types.ts";
import { BUDGET } from "../../budget.ts";
import { omissionMarker } from "../../processor/text.ts";

/** Caracteres que se reservan al principio del resumen para el marcador de omisión (con su salto de línea). */
const MARKER_ROOM = 48;

/**
 * Procesos de Desktop Commander (`start_process`, `read_process_output`, `interact_with_process`): el resumen es el
 * final de la salida y la señal `process` dice si el proceso sigue activo. El ejecutor convierte esa señal en el
 * hecho `process` (5.2): este extractor no escribe hechos.
 */
export function extractProcess({ args, fullText, mergedData }: ExtractorInput): ExtractorOutput {
    const signals: ExtractorSignals = {};
    // Desktop Commander no devuelve pid ni exit code estructurados. Formatos reales (formato observado de la herramienta):
    //   start_process       primera línea: "Process started with PID <n> (shell: ...)"; última: "✅ Process <n> has finished execution" (si terminó)
    //   read_process_output última línea:   "✅ Process completed with exit code <n> (runtime: ...)" (si terminó)
    // Solo se leen la primera y la última línea: el cuerpo es salida del proceso y no es fiable.
    const textLines = fullText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const firstTextLine = textLines[0] ?? "";
    const lastTextLine = textLines[textLines.length - 1] ?? "";
    const textPid = /^Process started with PID (\d+)\b/.exec(firstTextLine)?.[1];
    const textExit = /Process completed with exit code (-?\d+)\b/.exec(lastTextLine)?.[1];
    const finished = /Process \d+ has finished execution$/.test(lastTextLine);

    const pid = mergedData.process_id || mergedData.pid || args.pid || args.process_id || textPid;

    let knownExit: number | undefined;
    if (typeof mergedData.exit_code === "number") {
        knownExit = mergedData.exit_code;
    } else if (textExit !== undefined) {
        knownExit = parseInt(textExit, 10);
        signals.exit_code = knownExit;
    }
    const processSignal: ProcessSignal | undefined = pid
        ? { pid: String(pid), active: knownExit === undefined && !finished }
        : undefined;

    // Resumen: las últimas `processTailLines` líneas, sin superar el tope. Se conserva el final (lo más reciente de
    // la salida) y, si se omitió algo, el marcador neutro va al principio.
    const lines = fullText.split("\n");
    let tail = lines.slice(-BUDGET.extract.processTailLines).join("\n");
    let truncated = lines.length > BUDGET.extract.processTailLines;
    const room = BUDGET.summaryMax - MARKER_ROOM;
    if (tail.length > room) {
        tail = tail.slice(tail.length - room);
        truncated = true;
    }
    const summary =
        tail.trim().length === 0 ? null : truncated ? `${omissionMarker(fullText.length - tail.length)}\n${tail}` : tail;

    return {
        summary,
        truncated,
        signals,
        ...(processSignal ? { process: processSignal } : {}),
    };
}
