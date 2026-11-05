/**
 * eval/ui.ts
 *
 * Primitivas de estilo para la consola, compartidas por `cli.ts` y `wizard.ts`.
 * Sin dependencias: secuencias ANSI (respeta `NO_COLOR` y terminales sin color).
 */

export const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const paint = (open: string, close = "0") => (s: string): string => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s);

export const c = {
  bold: paint("1", "22"),
  dim: paint("2", "22"),
  italic: paint("3", "23"),
  cyan: paint("36"),
  blue: paint("38;5;75"),
  violet: paint("38;5;141"),
  green: paint("32"),
  yellow: paint("33"),
  red: paint("31"),
  gray: paint("90"),
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Largo visible (sin secuencias ANSI). */
export const vlen = (s: string): number => s.replace(ANSI_RE, "").length;

/** `padEnd` que ignora las secuencias ANSI. */
export const padEnd = (s: string, n: number): string => s + " ".repeat(Math.max(0, n - vlen(s)));

export const WIDTH = Math.max(56, Math.min(process.stdout.columns ?? 80, 84));

export const sym = {
  pointer: c.cyan("❯"),
  ok: c.green("✔"),
  err: c.red("✖"),
  warn: c.yellow("!"),
  dot: c.cyan("●"),
  ring: c.gray("○"),
};

/** Caja con bordes redondeados. Las líneas no deben superar `WIDTH - 4` caracteres visibles. */
export function box(lines: string[], opts: { title?: string; color?: (s: string) => string } = {}): string {
  const color = opts.color ?? c.gray;
  const inner = WIDTH - 2;
  const top = opts.title
    ? `${color("╭─")} ${c.bold(opts.title)} ${color("─".repeat(Math.max(0, inner - vlen(opts.title) - 4)) + "╮")}`
    : color(`╭${"─".repeat(inner)}╮`);
  const body = lines.map((l) => `${color("│")} ${padEnd(l, inner - 2)} ${color("│")}`);
  return [top, ...body, color(`╰${"─".repeat(inner)}╯`)].join("\n");
}

/** Título de sección con línea separadora. */
export function section(title: string): void {
  console.log(`\n${c.violet(c.bold(title))}`);
  console.log(c.gray("─".repeat(WIDTH)));
}

/** Filas clave/valor con las claves alineadas y atenuadas. */
export function kv(rows: Array<[string, string]>, indent = 2): void {
  if (rows.length === 0) return;
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`${" ".repeat(indent)}${c.gray(k.padEnd(w))}  ${v}`);
}

/** Reparte `items` en líneas de como mucho `width` caracteres visibles, unidos por `sep`. */
export function wrapList(items: string[], width: number, sep = "  "): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const it of items) {
    const next = cur === "" ? it : `${cur}${sep}${it}`;
    if (cur !== "" && vlen(next) > width) {
      lines.push(cur);
      cur = it;
    } else {
      cur = next;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}
