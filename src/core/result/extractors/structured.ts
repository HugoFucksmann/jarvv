/**
 * Extractor de los resultados de los proveedores nativos (`tools/result.ts`).
 *
 * El proveedor ya separó lo que ve el modelo (`text`) del texto completo (`raw`): aquí solo se traduce `data` a las señales que el procesador entiende.
 * - `data.exitCode` (número): código de salida de un proceso que terminó; distinto de 0 es un fallo de la llamada (`tool_error`).
 * - `data.pid` (número) y `data.state`: el proceso sigue vivo con `running` y `waiting_input`; con cualquier otro estado, ya no existe.
 * - `data.state = waiting_input` con `data.prompt` (texto): el proceso pide una respuesta del usuario.
 * - `data.state = not_found | no_results`: la herramienta buscó y no halló nada relevante (`no_data`, que la verificación rechaza).
 * `truncated` es `true` cuando el texto completo es más largo que lo que ve el modelo: el ejecutor lo guarda como ref.
 */

import type { ExtractorInput, ExtractorOutput, ExtractorSignals } from "./types.ts";

const LIVE_STATES: readonly string[] = ["running", "waiting_input"];

export function extractStructured({ native }: ExtractorInput): ExtractorOutput {
    if (native === undefined) return { summary: null, truncated: false };
    const { text, raw, data } = native;
    const signals: ExtractorSignals = {};

    if (typeof data.exitCode === "number") signals.exit_code = data.exitCode;
    if (data.state === "not_found" || data.state === "no_results") signals.empty_output = true;
    if (data.state === "waiting_input") {
        const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
        signals.waiting_input = { prompt: prompt.length > 0 ? prompt : "(no prompt text)" };
    }

    const output: ExtractorOutput = {
        summary: text.length > 0 ? text : null,
        truncated: raw.trim() !== text.trim() && raw.trim().length > 0,
        ...(Object.keys(signals).length > 0 ? { signals } : {}),
    };
    if (typeof data.pid === "number" && Number.isInteger(data.pid)) {
        output.process = { pid: String(data.pid), active: typeof data.state === "string" && LIVE_STATES.includes(data.state) };
    }
    return output;
}
