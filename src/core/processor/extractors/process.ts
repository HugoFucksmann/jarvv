/**
 * JARVIS Core — Extractor de procesos
 */

import type { ExtractorInput, ExtractorOutput } from "./types.ts";
import type { Scratchpad, StepExecutionSignals } from "../../types.ts";
import { MAX_EVIDENCE_OBS_CHARS } from "../../types.ts";
import { sanitizeForMemory, clipAtWord } from "../text.ts";

/** Procesos de Desktop Commander (`start_process`, `read_process_output`, `interact_with_process`): pid y estado. */
export function extractProcess({ args, fullText, mergedData, refKey }: ExtractorInput): ExtractorOutput {
    const factsDelta: Record<string, string> = {};
    const scratchpadDelta: Partial<Scratchpad> = {};
    const signals: Partial<StepExecutionSignals> = {};
    let finding = "";
    let compactObs = "";
    // Desktop Commander no devuelve pid ni exit code estructurados. Formatos reales (MCP_REAL_OUTPUTS):
    //   start_process       primera línea: "Process started with PID <n> (shell: ...)"; última: "✅ Process <n> has finished execution" (si terminó)
    //   read_process_output última línea:   "✅ Process completed with exit code <n> (runtime: ...)" (si terminó)
    // Solo se leen la primera y la última línea: el cuerpo es salida del proceso y no es fiable.
    const textLines = fullText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const firstTextLine = textLines[0] ?? "";
    const lastTextLine = textLines[textLines.length - 1] ?? "";
    const textPid = /^Process started with PID (\d+)\b/.exec(firstTextLine)?.[1];
    const textExit = /Process completed with exit code (-?\d+)\b/.exec(lastTextLine)?.[1];
    const finished = /Process \d+ has finished execution$/.test(lastTextLine);
    // Cabeceras de Desktop Commander ("Initial output:", "⏳ Process is running…"): no son salida del proceso.
    const isWrapperLine = (l: string) =>
        /^Process started with PID \d+\b/.test(l) || /Process \d+ has finished execution$/.test(l) ||
        /Process completed with exit code -?\d+\b/.test(l) ||
        /^Initial output:?$/i.test(l) || /^⏳ Process is running/.test(l) ||
        /^\[Reading \d+ new lines\b/.test(l) || /^🔄 Process \d+ is waiting for input\b/.test(l) ||
        /^✅ Input executed in process \d+:?$/.test(l) || /^📤 Output:?$/.test(l);
    const body = textLines.filter((l) => !isWrapperLine(l));
    // `…` aparece solo si clipAtWord recortó algo.
    const outputNote = body.length === 0
        ? "sin salida"
        : body.length === 1
            ? clipAtWord(body[0], 90)
            : body.length === 2
                ? `${clipAtWord(body[0], 60)} | ${clipAtWord(body[1], 60)}`
                : `${clipAtWord(body[0], 60)} | (+${body.length - 2} líneas) | ${clipAtWord(body[body.length - 1], 60)}`;

    const pid = mergedData.process_id || mergedData.pid || args.pid || args.process_id || textPid;
    if (pid) factsDelta.pid = String(pid);

    let knownExit: number | undefined;
    if (typeof mergedData.exit_code === "number") {
        knownExit = mergedData.exit_code;
    } else if (textExit !== undefined) {
        knownExit = parseInt(textExit, 10);
        signals.exit_code = knownExit;
    }
    const processStatus = knownExit !== undefined ? `exit=${knownExit}` : finished ? "status=finished" : "status=running";
    scratchpadDelta.process_id = pid && knownExit === undefined && !finished ? String(pid) : undefined;
    finding = sanitizeForMemory(`pid=${pid || 'desconocido'}, ${processStatus} | ${outputNote}`, 200);
    const lines = fullText.split("\n");
    const wasTruncatedLines = lines.length > 30;
    let tail = lines.slice(-30).join("\n");
    const note = (wasTruncatedLines || tail.length > MAX_EVIDENCE_OBS_CHARS) && refKey
        ? `[... salida previa omitida, ref:${refKey}]\n`
        : "";
    const maxTailChars = MAX_EVIDENCE_OBS_CHARS - note.length;
    if (tail.length > maxTailChars) {
        tail = tail.slice(-maxTailChars);
    }
    compactObs = tail ? `${note}${tail}` : `Proceso ${pid || 'desconocido'} ejecutado.`;
    return { finding, compactObs, factsDelta, scratchpadDelta, signals };
}