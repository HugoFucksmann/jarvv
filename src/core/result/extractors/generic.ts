import type { ExtractorInput, ExtractorOutput } from "./types.ts";
import { compactText } from "./shared.ts";

/**
 * Sin extractor propio (o con error): el resumen es el texto de la herramienta, íntegro o con inicio y final. En un
 * resultado de error es el error de la herramienta (5.2); sin texto, `null`.
 */
export function extractGeneric({ fullText }: ExtractorInput): ExtractorOutput {
    return compactText(fullText);
}
