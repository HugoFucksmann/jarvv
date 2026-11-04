/**
 * eval/prompts/core/glob.ts
 *
 * Matcher propio (Node 20 no tiene `fs.glob`). Separador `/`.
 *   `*`   cualquier secuencia sin `/`
 *   `**`  cualquier secuencia, incluido `/`; un `**` seguido de `/` coincide con cero o más directorios
 *   `?`   un carácter que no sea `/`
 * Las `\` se normalizan a `/` (no hay escape).
 */

/** Normaliza separadores y quita el `./` inicial. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isGlob(s: string): boolean {
  return /[*?]/.test(s);
}

export function globToRegExp(pattern: string): RegExp {
  const p = normalizePath(pattern);
  let re = "";
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        if (p[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(normalizePath(path));
}

/** Directorio fijo desde el que hay que recorrer para resolver el glob (segmentos previos al primer comodín). */
export function globBaseDir(pattern: string): string {
  const segs = normalizePath(pattern).split("/");
  const fixed: string[] = [];
  for (const seg of segs) {
    if (isGlob(seg)) break;
    fixed.push(seg);
  }
  // Si no hubo comodín, el último segmento es el archivo, no un directorio.
  if (fixed.length === segs.length) fixed.pop();
  return fixed.length > 0 ? fixed.join("/") : ".";
}
