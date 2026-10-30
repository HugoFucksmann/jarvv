import type { ExtractorInput, ExtractorOutput } from "./types.ts";
import type { Scratchpad, StepExecutionSignals } from "../../types.ts";
import { sanitizeForMemory } from "../text.ts";

/** `list_directory`: entradas del directorio (hasta 40 en la observación). */
export function extractListDirectory({ fullText, refKey }: ExtractorInput): ExtractorOutput {
    let finding = "";
    let compactObs = "";
    const lines = fullText.split("\n").filter((l) => l.trim().length > 0);
    const names = lines.slice(0, 8).map((l) => l.replace(/^\[(FILE|DIR)\]\s*/, "").trim()).join(", ");
    finding = sanitizeForMemory(
        `${lines.length} entradas en directorio${names ? `: ${names}${lines.length > 8 ? ", …" : ""}` : ""}`,
        200
    );
    const top40 = lines.slice(0, 40).join("\n");
    compactObs = top40 || "Directorio vacío.";
    if (lines.length > 40 && refKey) {
        compactObs += `\n[... ${lines.length - 40} entradas omitidas, ref:${refKey}]`;
    }
    return { finding, compactObs };
}

/** `read_file`: líneas y tamaño del contenido, sin la cabecera `[Reading N lines…]`; deja la ruta como hecho. */
export function extractReadFile({ args, fullText, refKey }: ExtractorInput): ExtractorOutput {
    const factsDelta: Record<string, string> = {};
    const scratchpadDelta: Partial<Scratchpad> = {};
    const signals: Partial<StepExecutionSignals> = {};
    let finding = "";
    let compactObs = "";
    // Formato real: "[Reading N lines from start (total: T lines, R remaining)]" + línea en blanco + contenido.
    // La cabecera no es contenido del archivo: se separa para contar líneas y se informa lo que queda sin leer.
    const banner = /^\[Reading (\d+) lines?\b[^\]]*?\(total: (\d+) lines?, (\d+) remaining\)\]\s*/.exec(fullText);
    const content = banner ? fullText.slice(banner[0].length) : fullText;
    const remaining = banner ? parseInt(banner[3], 10) : 0;
    const lines = content.length > 0 ? content.split("\n") : [];
    const sizeKb = (Buffer.byteLength(content, "utf-8") / 1024).toFixed(1);
    if (args.path) {
        factsDelta.path = String(args.path);
        scratchpadDelta.path = String(args.path);
    }
    if (banner && parseInt(banner[2], 10) === 0) {
        // Archivo vacío (0 líneas en total): el servidor no lo marca como error, lo decide el Core.
        signals.empty_output = true;
        finding = "archivo vacío";
        compactObs = "Archivo vacío.";
    } else {
        finding = sanitizeForMemory(`${lines.length} líneas, ${sizeKb}KB${remaining > 0 ? `, quedan ${remaining} sin leer` : ""}`);
        if (lines.length > 30) {
            const head = lines.slice(0, 15).join("\n");
            const tail = lines.slice(-15).join("\n");
            compactObs = `${head}\n[... ${lines.length - 30} líneas omitidas, ref:${refKey}]\n${tail}`;
        } else {
            compactObs = content;
        }
        if (remaining > 0) compactObs += `\n[... quedan ${remaining} líneas sin leer en el archivo]`;
    }
    return { finding, compactObs, factsDelta, scratchpadDelta, signals };
}