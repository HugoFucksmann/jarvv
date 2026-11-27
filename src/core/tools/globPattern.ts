/**
 * JARVIS Core — Comparación literal de nombres de archivos y carpetas mediante comodines (`*`, `?`, `|`).
 *
 * Sin `*` ni `?`, busca subcadena (sin distinguir mayúsculas); con `*` o `?`, coincide con el
 * nombre completo usando comodines literales (nunca regex: `\`, `(`, `[` y `.` son literales).
 */

/** Prioridad de ordenamiento: `0` = exacto, `1` = prefijo, `2` = contiene / comodín inicial. */
export type MatchRank = 0 | 1 | 2;

export interface PatternMatcher {
  readonly lower: string;
  readonly hasWildcard: boolean;
  readonly startsWithWildcard: boolean;
}

type ParsedPattern =
  | { readonly ok: true; readonly matchers: readonly PatternMatcher[] }
  | { readonly ok: false; readonly message: string };

/** Máximo razonable de caracteres para evitar patrones degenerados. */
const MAX_PATTERN_CHARS = 300;

/**
 * Coincidencia literal de comodines (`*` = cero o más caracteres, `?` = un carácter).
 * Opera sobre puntos de código Unicode para manejar acentos y pares sustitutos sin regex.
 */
function globMatch(pattern: string, text: string): boolean {
  const p = Array.from(pattern);
  const t = Array.from(text);
  let pi = 0;
  let ti = 0;
  let starPi = -1;
  let starTi = 0;

  while (ti < t.length) {
    if (pi < p.length && (p[pi] === "?" || p[pi] === t[ti])) {
      pi++;
      ti++;
    } else if (pi < p.length && p[pi] === "*") {
      starPi = pi;
      starTi = ti;
      pi++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      starTi++;
      ti = starTi;
    } else {
      return false;
    }
  }

  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}

export function parsePattern(raw: string, fieldName = "pattern"): ParsedPattern {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: `'${fieldName}' is required and must not be empty.` };
  }
  if (trimmed.length > MAX_PATTERN_CHARS) {
    return { ok: false, message: `'${fieldName}' is too long (max ${MAX_PATTERN_CHARS} characters).` };
  }

  const parts = trimmed
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  if (parts.length === 0) {
    return { ok: false, message: `'${fieldName}' must contain at least one non-empty name or wildcard.` };
  }

  const matchers: PatternMatcher[] = parts.map((part) => {
    const lower = part.toLowerCase();
    return {
      lower,
      hasWildcard: lower.includes("*") || lower.includes("?"),
      startsWithWildcard: lower.startsWith("*") || lower.startsWith("?"),
    };
  });

  return { ok: true, matchers };
}

/**
 * Evalúa un nombre contra las alternativas del patrón y devuelve el mejor rango de coincidencia,
 * o `null` si ninguna coincide.
 */
export function matchName(name: string, matchers: readonly PatternMatcher[]): MatchRank | null {
  const lowerName = name.toLowerCase();
  let best: MatchRank | null = null;

  for (const m of matchers) {
    let rank: MatchRank | null = null;
    if (!m.hasWildcard) {
      if (lowerName === m.lower) rank = 0;
      else if (lowerName.startsWith(m.lower)) rank = 1;
      else if (lowerName.includes(m.lower)) rank = 2;
    } else if (globMatch(m.lower, lowerName)) {
      rank = m.startsWithWildcard ? 2 : 1;
    }

    if (rank !== null && (best === null || rank < best)) {
      best = rank;
      if (best === 0) return 0;
    }
  }

  return best;
}
