/**
 * JARVIS Core — Extractor genérico (respaldo)
 */

import type { ExtractorInput, ExtractorOutput } from "./types.ts";
import { fitFinding } from "../text.ts";

/** Sin extractor propio (o con error): el hallazgo es el contenido aplanado hasta MAX_FINDING_CHARS. */
export function extractGeneric({ isError, success, fullText, refKey }: ExtractorInput): ExtractorOutput {
    let finding = "";
    let compactObs = "";
    // Sin extractor propio: el hallazgo es el contenido aplanado hasta MAX_FINDING_CHARS, no la primera línea
    // (en una búsqueda sin resultados la primera línea es la cabecera de sesión y el recuento viene después).
    finding = fitFinding(fullText || (success ? "Operación exitosa" : "Fallo en tool"), isError ? "err: " : "", refKey);
    if (fullText.length > 1500) {
        compactObs = `${fullText.substring(0, 750)}\n[... omitidos, ref:${refKey}]\n${fullText.substring(fullText.length - 750)}`;
    } else {
        compactObs = fullText || (success ? "Operación completada sin salida." : "Error de ejecución.");
    }
    return { finding, compactObs };
}