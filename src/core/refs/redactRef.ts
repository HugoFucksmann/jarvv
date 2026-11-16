/**
 * JARVIS Core — Redacción simple de contenido resuelto de refs en mensajes de rechazo o error.
 *
 * Si la llamada no usó refs, el mensaje queda igual. Si usó refs, reemplaza cada valor resuelto (>= 8 caracteres,
 * exacto o con barras `/` / `\` y mayúsculas normalizadas) por `{{ref:rX}}` y, si tras el reemplazo el texto pasa de
 * 120 caracteres, lo recorta a 120.
 */

import type { RefLookup } from "./refResolver.ts";

export const REF_DISPLAY_CAP = 120;
const MIN_MATCH_LENGTH = 8;

export interface RefRedactor {
  readonly lookup: RefLookup;
  redact(text: string | null | undefined): string | null | undefined;
}

function defaultClip(text: string, cap: number): string {
  if (text.length <= cap) return text;
  let keep = Math.max(0, cap);
  while (keep > 0 && keep + `…(+${text.length - keep})`.length > cap) keep -= 1;
  return keep > 0 ? `${text.slice(0, keep)}…(+${text.length - keep})` : text.slice(0, Math.max(cap, 0));
}

function normalizedPattern(value: string): RegExp {
  const escaped = Array.from(value, (ch) =>
    ch === "/" || ch === "\\" ? "[\\\\/]" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("");
  return new RegExp(escaped, "gi");
}

export function createRefRedactor(
  baseLookup: RefLookup,
  clip: (text: string, cap: number) => string = defaultClip,
): RefRedactor {
  const resolvedRefs = new Map<string, string>();

  const lookup: RefLookup = {
    async get(id: string): Promise<string | undefined> {
      const content = await baseLookup.get(id);
      if (content !== undefined) resolvedRefs.set(id.toLowerCase(), content);
      return content;
    },
  };

  const redact = (text: string | null | undefined): string | null | undefined => {
    if (text == null || resolvedRefs.size === 0) return text;

    let out = text;
    const entries = [...resolvedRefs.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [id, content] of entries) {
      if (content.length < MIN_MATCH_LENGTH) continue;
      out = out.replace(normalizedPattern(content), `{{ref:${id}}}`);
    }

    return out.length > REF_DISPLAY_CAP ? clip(out, REF_DISPLAY_CAP) : out;
  };

  return { lookup, redact };
}
