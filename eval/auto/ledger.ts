/**
 * eval/auto/ledger.ts
 *
 * Registro (ledger) de las ideas probadas por el bucle `--auto`. Lo escribe SOLO el código, con datos medidos: el modelo optimizador
 * aporta únicamente el resumen de una línea de cada variante (se recorta). Todo se guarda en disco (`ledger.jsonl`, una línea por
 * variante); al optimizador solo se le muestran las últimas entradas, así que el tamaño del prompt no crece con las rondas.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fmtDeltaPct, fmtPct } from "../core/report-format.ts";

export const LEDGER_SUMMARY_MAX = 120;
export const LEDGER_PROMPT_ENTRIES = 10;

/** Qué pasó con la variante al cerrar la vuelta. Nunca lleva cifras del holdout (el optimizador no debe enterarse de ellas). */
export type LedgerStatus = "top2" | "perdio" | "fallo_holdout" | "no_evaluada" | "invalida";

export interface LedgerEntry {
  round: number;
  variant: string;
  /** Resumen de una línea (lo escribió el optimizador; ya recortado). */
  summary: string;
  /** Nota en desarrollo (0..1) con la métrica de la sesión; ausente si no se evaluó. */
  score?: number;
  /** Diferencia contra `prod` (en fracción); ausente para `prod` o si no hay dato. */
  deltaVsProd?: number;
  improvements?: number;
  regressions?: number;
  status: LedgerStatus;
}

const STATUS_LABEL: Record<LedgerStatus, string> = {
  top2: "quedó en Top-2",
  perdio: "perdió",
  fallo_holdout: "falló el holdout (no se repite)",
  no_evaluada: "no se evaluó",
  invalida: "propuesta inválida",
};

/** Una sola línea, sin saltos ni espacios repetidos, con tope de caracteres. */
export function clipSummary(text: string, max = LEDGER_SUMMARY_MAX): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one === "") return "(sin resumen)";
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function appendLedger(filePath: string, entries: readonly LedgerEntry[]): void {
  if (entries.length === 0) return;
  const path = resolve(filePath);
  mkdirSync(dirname(path), { recursive: true });
  const lines = entries.map((e) => JSON.stringify({ ...e, summary: clipSummary(e.summary) }));
  appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

/** Lee todas las entradas válidas; una línea corrupta se ignora (no tumba la sesión). */
export function readLedger(filePath: string): LedgerEntry[] {
  const path = resolve(filePath);
  if (!existsSync(path)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const o = JSON.parse(t) as Partial<LedgerEntry>;
      if (typeof o.round === "number" && typeof o.variant === "string" && typeof o.summary === "string" && typeof o.status === "string" && o.status in STATUS_LABEL) {
        out.push(o as LedgerEntry);
      }
    } catch {
      /* línea corrupta */
    }
  }
  return out;
}

export function formatLedgerLine(e: LedgerEntry): string {
  const measured =
    e.score === undefined
      ? ""
      : ` → ${fmtPct(e.score)}${e.deltaVsProd !== undefined ? ` (Δ ${fmtDeltaPct(e.deltaVsProd)} vs prod` : " ("}${
          e.improvements !== undefined && e.regressions !== undefined ? `${e.deltaVsProd !== undefined ? ", " : ""}mej ${e.improvements}/reg ${e.regressions}` : ""
        })`;
  return `- R${e.round} \`${e.variant}\`: «${e.summary}»${measured} · ${STATUS_LABEL[e.status]}`;
}

/** Texto para el prompt del optimizador: solo las últimas `limit` entradas (el resto se resume en una línea). */
export function formatLedgerForPrompt(filePath: string, limit = LEDGER_PROMPT_ENTRIES): string {
  const all = readLedger(filePath);
  if (all.length === 0) return "Sin historial: es la primera iteración sobre esta etapa.";
  const shown = all.slice(-limit);
  const hidden = all.length - shown.length;
  return [...(hidden > 0 ? [`(${hidden} entrada(s) anterior(es) no mostradas)`] : []), ...shown.map(formatLedgerLine)].join("\n");
}
