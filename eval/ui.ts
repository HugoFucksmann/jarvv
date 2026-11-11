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
  bullet: c.cyan("▸"),
  bar: c.cyan("▌"),
};

/** Recorta a `n` caracteres visibles con "…", conservando las secuencias ANSI. */
export function clip(s: string, n: number): string {
  if (vlen(s) <= n) return s;
  let out = "";
  let vis = 0;
  for (const m of s.matchAll(/\x1b\[[0-9;]*m|[\s\S]/gu)) {
    const t = m[0];
    if (t.startsWith("\x1b")) {
      out += t;
      continue;
    }
    if (vis >= n - 1) break;
    out += t;
    vis++;
  }
  return `${out}…${useColor ? "\x1b[0m" : ""}`;
}

/** Línea horizontal del ancho de la consola (`heavy` = trazo grueso). */
export const rule = (heavy = false): string => c.gray((heavy ? "━" : "─").repeat(WIDTH));

/** Caja con bordes redondeados. Las líneas que superan `WIDTH - 4` caracteres visibles se recortan con "…". */
export function box(lines: string[], opts: { title?: string; color?: (s: string) => string } = {}): string {
  const color = opts.color ?? c.gray;
  const inner = WIDTH - 2;
  const title = opts.title ? clip(opts.title, inner - 4) : undefined;
  const top = title
    ? `${color("╭─")} ${c.bold(title)} ${color("─".repeat(Math.max(0, inner - vlen(title) - 3)) + "╮")}`
    : color(`╭${"─".repeat(inner)}╮`);
  const body = lines.map((l) => `${color("│")} ${padEnd(clip(l, inner - 2), inner - 2)} ${color("│")}`);
  return [top, ...body, color(`╰${"─".repeat(inner)}╯`)].join("\n");
}

/** Título de sección con línea separadora (como texto, para componer vistas sin imprimir). */
export const heading = (title: string): string => `\n${c.violet(c.bold(title))}\n${c.gray("─".repeat(WIDTH))}`;

/** Imprime un título de sección. */
export function section(title: string): void {
  console.log(heading(title));
}

/** Error con el mismo formato en toda la CLI (línea en blanco previa, ✖ y texto en rojo, por stderr). */
export function fail(msg: string): void {
  console.error(`\n${sym.err} ${c.red(msg)}`);
}

export const fmtPct = (r: number): string => `${(r * 100).toFixed(1)}%`;

/** Verde si pasó todo, rojo si no pasó nada, amarillo en el medio. */
export const rateColor = (rate: number, s: string): string => (rate >= 1 ? c.green(s) : rate <= 0 ? c.red(s) : c.yellow(s));

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

/**
 * Reparte celdas en columnas alineadas, ordenadas de arriba abajo (la primera columna lleva las primeras N/cols).
 * Una celda puede tener varias líneas (separadas por "\n"). Reduce las columnas si no entran en `WIDTH`, y usa una
 * sola con menos de `minItems` celdas. `rowGap` = líneas en blanco entre filas.
 */
export function columns(
  cells: string[],
  opts: { cols?: number; gap?: number; indent?: number; minItems?: number; rowGap?: number } = {},
): string[] {
  const { cols: maxCols = 2, gap = 4, indent = 2, minItems = 4, rowGap = 0 } = opts;
  if (cells.length === 0) return [];
  const avail = WIDTH - indent;
  const natural = Math.max(...cells.flatMap((cell) => cell.split("\n")).map(vlen));
  let cols = cells.length >= minItems ? maxCols : 1;
  while (cols > 1 && cols * natural + (cols - 1) * gap > avail) cols--;
  const colW = Math.min(natural, avail);
  const rows = Math.ceil(cells.length / cols);
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const blocks: string[][] = [];
    for (let k = 0; k < cols; k++) {
      const i = k * rows + r;
      if (i < cells.length) blocks.push(cells[i].split("\n").map((l) => clip(l, colW)));
    }
    const height = Math.max(...blocks.map((b) => b.length));
    for (let j = 0; j < height; j++) {
      const parts = blocks.map((b, k) => (k < blocks.length - 1 ? padEnd(b[j] ?? "", colW + gap) : (b[j] ?? "")));
      lines.push(pad + parts.join(""));
    }
    if (r < rows - 1) for (let g = 0; g < rowGap; g++) lines.push("");
  }
  return lines;
}

/** Encabezado de paso: título, barra de progreso y breadcrumb (omitido si no entra en `WIDTH`). */
export function stepHeader(n: number, labels: readonly string[]): void {
  const bar = labels.map((_, i) => (i < n ? c.cyan("▰▰") : c.gray("▱▱"))).join(" ");
  const crumbs = labels
    .map((s, i) => (i + 1 < n ? `${sym.ok} ${c.gray(s)}` : i + 1 === n ? c.cyan(c.bold(`● ${s}`)) : c.gray(`○ ${s}`)))
    .join(c.gray(" › "));
  console.log();
  console.log(rule(true));
  console.log(`${c.violet(c.bold(`PASO ${n}/${labels.length}`))}  ${c.bold(labels[n - 1])}   ${bar}`);
  if (vlen(crumbs) <= WIDTH) console.log(crumbs);
  console.log(rule());
}

/** Caja clave/valor; los valores separados por ", " se parten en varias líneas si no entran. */
export function kvBox(rows: Array<[string, string]>, opts: { title?: string; color?: (s: string) => string } = {}): string {
  const keyW = Math.max(...rows.map(([k]) => k.length));
  const valW = Math.max(10, WIDTH - 4 - (keyW + 4));
  const lines: string[] = [];
  for (const [k, v] of rows) {
    wrapList(v.split(", "), valW, ", ").forEach((part, i) => {
      lines.push(`${i === 0 ? sym.bullet : " "} ${c.gray((i === 0 ? k : "").padEnd(keyW))}  ${c.bold(part)}`);
    });
  }
  return box(lines, opts);
}

/** Mensajes con sangría de 2 espacios, para flujos interactivos. */
export const say = {
  hint: (s: string): void => console.log(`  ${c.gray(s)}`),
  warn: (s: string): void => console.log(`  ${sym.err} ${c.red(s)}`),
  note: (s: string): void => console.log(`  ${sym.warn} ${c.yellow(s)}`),
  /** Eco de lo elegido al cerrar un paso. */
  done: (label: string, value: string): void => console.log(`\n  ${sym.ok} ${c.gray(label)}  ${c.bold(value)}`),
};