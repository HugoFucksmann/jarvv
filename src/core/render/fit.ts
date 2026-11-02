/**
 * Ajuste de un texto por secciones a un máximo de caracteres (sección 9).
 *
 * Prioridad al recortar (de la que se conserva a la que se sacrifica primero): paso actual y criterio, solicitud,
 * último resultado relevante, fallos recientes, hechos, historial anterior. Cada sección declara su `priority`
 * (menor = más importante) y si es recortable. Al exceder el máximo se descartan líneas de la sección recortable de
 * menor importancia, de la más antigua a la más reciente, y se deja un marcador con la cantidad omitida. Las secciones
 * no recortables (efectos, texto fijo) nunca se tocan: si aun así no entra, `overflow` vale `true`.
 */

export interface Rendered {
  text: string;
  /** Tamaño del texto en caracteres. */
  chars: number;
  /** Lo que no se puede recortar excede el máximo. */
  overflow: boolean;
}

export interface Section {
  readonly label: string;
  /**
   * `plain`: `ETIQUETA: texto`. `obs`: `ETIQUETA:` + bloque `<obs>…</obs>` (datos externos). `list`: `Etiqueta:` y
   * las líneas debajo. `bare`: solo las líneas, sin etiqueta.
   */
  readonly kind: "plain" | "obs" | "list" | "bare";
  readonly lines: readonly string[];
  /** Menor número = más importante; solo ordena el sacrificio entre secciones recortables. */
  readonly priority: number;
  readonly droppable: boolean;
  /** Líneas más recientes que nunca se descartan (por defecto 0). */
  readonly keep?: number;
}

export function plainSection(label: string, line: string | null, priority: number): Section {
  return { label, kind: "plain", lines: line === null ? [] : [line], priority, droppable: false };
}

export function obsSection(label: string, lines: readonly string[], priority: number, droppable: boolean, keep = 0): Section {
  return { label, kind: "obs", lines, priority, droppable, keep };
}

export function listSection(label: string, lines: readonly string[], priority: number, droppable: boolean): Section {
  return { label, kind: "list", lines, priority, droppable };
}

export function bareSection(lines: readonly string[], priority: number): Section {
  return { label: "", kind: "bare", lines, priority, droppable: false };
}

interface Work {
  readonly section: Section;
  lines: string[];
  dropped: number;
  text: string;
}

function renderWork(work: Work): string {
  if (work.lines.length === 0 && work.dropped === 0) return "";
  const body = work.dropped > 0 ? [`[… ${work.dropped} anteriores omitidos]`, ...work.lines] : work.lines;
  const { label, kind } = work.section;
  switch (kind) {
    case "plain":
      return `${label}: ${body.join("\n")}`;
    case "obs":
      return `${label}:\n<obs>\n${body.join("\n")}\n</obs>`;
    case "list":
      return `${label}:\n${body.join("\n")}`;
    case "bare":
      return body.join("\n");
  }
}

const SEPARATOR = "\n\n";

export function fitSections(sections: readonly Section[], maxChars: number): Rendered {
  const work: Work[] = sections.map((section) => {
    const w: Work = { section, lines: [...section.lines], dropped: 0, text: "" };
    w.text = renderWork(w);
    return w;
  });

  const measure = (): number => {
    let chars = 0;
    let parts = 0;
    for (const w of work) {
      if (w.text.length === 0) continue;
      chars += w.text.length;
      parts++;
    }
    return chars + SEPARATOR.length * Math.max(0, parts - 1);
  };

  let size = measure();
  while (size > maxChars) {
    let pick = -1;
    for (let i = 0; i < work.length; i++) {
      const w = work[i];
      if (!w.section.droppable || w.lines.length <= (w.section.keep ?? 0)) continue;
      // Menor importancia = número de prioridad mayor; en empate, la sección que va después.
      if (pick < 0 || w.section.priority >= work[pick].section.priority) pick = i;
    }
    if (pick < 0) break;
    work[pick].lines.shift();
    work[pick].dropped++;
    work[pick].text = renderWork(work[pick]);
    size = measure();
  }

  const text = work
    .map((w) => w.text)
    .filter((t) => t.length > 0)
    .join(SEPARATOR);
  return { text, chars: text.length, overflow: size > maxChars };
}
