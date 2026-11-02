import { BUDGET } from "../../budget.ts";
import { headTailNeutral } from "../../processor/text.ts";

/**
 * Resumen de un texto sin estructura conocida: íntegro si cabe, inicio y final con el marcador neutro si es largo,
 * `null` si no hay texto (el `status` basta). Lo usan el extractor genérico, `fetch` y `search` ante un formato que no
 * se supo leer.
 */
export function compactText(text: string): { summary: string | null; truncated: boolean } {
    if (text.trim().length === 0) return { summary: null, truncated: false };
    const { textHeadChars, textTailChars } = BUDGET.extract;
    const result = headTailNeutral(text, textHeadChars, textTailChars);
    return { summary: result.text, truncated: result.clipped };
}
