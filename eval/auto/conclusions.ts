/**
 * eval/auto/conclusions.ts
 *
 * Lectura acotada (`<= 12 000` caracteres) y actualización condicional estructurada
 * de `conclusiones.md` al cierre de cada vuelta (`§7`).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atomicWriteFileSync } from "../core/io.ts";
import { fmtDeltaPct, fmtMs, fmtPct } from "../core/report-format.ts";
import { allStageNames, isDecisionStage } from "../core/stages/index.ts";
import type { StageName } from "../core/types.ts";
import type { AutoMetric } from "./config.ts";
import type { RankedVariant } from "./ranking.ts";

function evaluatedModelLabel(stage: StageName, model: string, decisionModel: string): string {
  return isDecisionStage(stage) ? `decisión: ${decisionModel}` : `generativo: ${model}`;
}

export const MAX_CONCLUSIONS_CHARS = 12_000;
export const MAX_CONCLUSIONS_LINES = 150;

export function readConclusionsBounded(filePath: string): { exists: boolean; content: string; truncated: boolean } {
  const abs = resolve(filePath);
  if (!existsSync(abs)) {
    return { exists: false, content: "", truncated: false };
  }
  const raw = readFileSync(abs, "utf8");
  if (!raw.trim()) {
    return { exists: true, content: "", truncated: false };
  }
  if (raw.length <= MAX_CONCLUSIONS_CHARS) {
    return { exists: true, content: raw, truncated: false };
  }
  return {
    exists: true,
    content: `${raw.slice(0, MAX_CONCLUSIONS_CHARS - 80)}\n\n[...recortado a ${MAX_CONCLUSIONS_CHARS} caracteres; compactar en la próxima actualización]`,
    truncated: true,
  };
}

export function formatConclusionsForPrompt(filePath: string): string {
  const { content } = readConclusionsBounded(filePath);
  if (!content.trim()) {
    return "Archivo `conclusiones.md` vacío: primera iteración sobre esta etapa.";
  }
  return content;
}

export function compactMarkdownToLimits(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  let bounded = lines.length > MAX_CONCLUSIONS_LINES
    ? [...lines.slice(0, MAX_CONCLUSIONS_LINES - 1), "...(compactado a 150 líneas máximo)"].join("\n")
    : normalized;
  if (bounded.length > MAX_CONCLUSIONS_CHARS) {
    bounded = `${bounded.slice(0, MAX_CONCLUSIONS_CHARS - 30).trimEnd()}\n...(compactado)`;
  }
  return `${bounded}\n`;
}

export function writeConclusionsFile(filePath: string, markdown: string): void {
  atomicWriteFileSync(resolve(filePath), compactMarkdownToLimits(markdown));
}

/**
 * Validación estructural y de consistencia factual para evitar que modelos chicos
 * sobrescriban `conclusiones.md` con JSON, texto truncado o métricas alucinadas.
 */
export function validateConclusionsMarkdown(
  markdown: string,
  stage: StageName,
  ranked: RankedVariant[] = [],
): string | null {
  const trimmed = markdown.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("```")) return "markdown envuelto en JSON o fence de código";
  if (trimmed.length < 20) return "markdown demasiado corto";
  if (!/^#\s+\S/m.test(trimmed)) return "falta encabezado principal `# ...`";
  if (!/^##\s+\S/m.test(trimmed)) return "falta al menos una sección `## ...`";

  const otherStages = allStageNames().filter((s) => s !== stage);
  const titleMatch = /^#\s+Conclusiones\s+[—-]\s+([a-z0-9_]+)/im.exec(trimmed);
  if (titleMatch && titleMatch[1] !== stage) {
    return `el título referencia etapa '${titleMatch[1]}' en lugar de '${stage}'`;
  }

  for (const other of otherStages) {
    if (new RegExp(`\\bauto_${other}_`, "i").test(trimmed)) {
      return `referencia variante de otra etapa ('auto_${other}_...')`;
    }
  }

  if (ranked.length > 0) {
    const scoreByVariant = new Map(ranked.map((r) => [r.variant, r.score * 100]));
    const citedRe = /`([a-zA-Z0-9_-]+)`\s*(?:\(|:\s*)(\d{1,3}(?:\.\d+)?)\s*%/g;
    for (const match of trimmed.matchAll(citedRe)) {
      const name = match[1];
      const citedPct = Number(match[2]);
      const actualPct = scoreByVariant.get(name);
      if (actualPct !== undefined && Number.isFinite(citedPct) && Math.abs(citedPct - actualPct) > 1.5) {
        return `porcentaje inconsistente para '${name}' (${citedPct.toFixed(1)}% vs ${actualPct.toFixed(1)}% medido)`;
      }
    }
  }

  return null;
}

export interface RoundFactsInput {
  stage: StageName;
  round: number;
  target: number;
  metric: AutoMetric;
  model: string;
  decisionModel: string;
  ranked: RankedVariant[];
  top2: string[];
  previousTop2: string[];
  generatedHypotheses: Array<{ name: string; hypothesis: string; archived: boolean }>;
  holdoutOverfitNote?: string;
}

export function formatObjectiveRoundFacts(input: RoundFactsInput): string {
  const prod = input.ranked.find((r) => r.variant === "prod");
  const top1 = input.ranked.find((r) => r.variant === input.top2[0]);
  const top2 = input.ranked.find((r) => r.variant === input.top2[1]);
  const topChanged = JSON.stringify(input.previousTop2) !== JSON.stringify(input.top2);

  const lines: string[] = [
    `Etapa: ${input.stage} | Vuelta: R${input.round} | Objetivo: >= ${fmtPct(input.target)} (${input.metric})`,
    `Modelo evaluado: ${evaluatedModelLabel(input.stage, input.model, input.decisionModel)}`,
    `Top-2 anterior: ${input.previousTop2.join(", ") || "ninguno"}`,
    `Top-2 actual (${topChanged ? "CAMBIÓ" : "sin cambio"}): ${input.top2.join(", ")}`,
    `Baseline prod: ${prod ? `${fmtPct(prod.score)} (${prod.passedRuns}/${prod.totalRuns}, p50 ${fmtMs(prod.p50DurationMs)})` : "N/A"}`,
    `Top 1: ${top1 ? `${top1.variant} (${fmtPct(top1.score)}, p50 ${fmtMs(top1.p50DurationMs)})` : "N/A"}`,
    `Top 2: ${top2 ? `${top2.variant} (${fmtPct(top2.score)}, p50 ${fmtMs(top2.p50DurationMs)})` : "N/A"}`,
    "",
    "Resultados de la vuelta:",
  ];

  for (const r of input.ranked) {
    const hyp = input.generatedHypotheses.find((h) => h.name === r.variant);
    const deltaStr = r.variant === "prod"
      ? "baseline"
      : r.deltaPassRate !== undefined
        ? fmtDeltaPct(input.metric === "macroPassRate" ? (r.deltaMacroPassRate ?? r.deltaPassRate) : r.deltaPassRate)
        : "—";
    const statusTag = input.top2.includes(r.variant)
      ? " [TOP-2]"
      : hyp?.archived
        ? " [ARCHIVADA]"
        : "";
    lines.push(
      `- ${r.variant}${statusTag}: ${fmtPct(r.score)} (${r.passedRuns}/${r.totalRuns}), Δ=${deltaStr}, mej=${r.improvements}, reg=${r.regressions}, reint=${r.retriedRuns}, p50=${fmtMs(r.p50DurationMs)}${hyp ? ` | hipótesis: ${hyp.hypothesis}` : ""}`,
    );
  }

  for (const hyp of input.generatedHypotheses) {
    if (!input.ranked.some((r) => r.variant === hyp.name)) {
      lines.push(`- ${hyp.name} [NO EVALUADA]: ${hyp.hypothesis}`);
    }
  }

  if (input.holdoutOverfitNote) {
    lines.push("", `ALERTA HOLDOUT: ${input.holdoutOverfitNote}`);
  }

  return lines.join("\n");
}

export function buildBaselineConclusionsMarkdown(input: {
  stage: StageName;
  target: number;
  metric: AutoMetric;
  model: string;
  decisionModel: string;
  ranked: RankedVariant[];
  top2: string[];
  roundNote?: string;
}): string {
  const prod = input.ranked.find((r) => r.variant === "prod");
  const top1 = input.ranked.find((r) => r.variant === input.top2[0]);
  const top2 = input.ranked.find((r) => r.variant === input.top2[1]);
  return compactMarkdownToLimits(`# Conclusiones — ${input.stage}

## Estado actual (auto-actualizado)
- Objetivo: >= ${fmtPct(input.target)} (\`${input.metric}\`) · Modelo evaluado: \`${evaluatedModelLabel(input.stage, input.model, input.decisionModel)}\`
- Top 1: ${top1 ? `\`${top1.variant}\` (${fmtPct(top1.score)}, p50 ${fmtMs(top1.p50DurationMs)})` : "—"}
- Top 2: ${top2 ? `\`${top2.variant}\` (${fmtPct(top2.score)}, p50 ${fmtMs(top2.p50DurationMs)})` : "—"}
- Baseline \`prod\`: ${prod ? fmtPct(prod.score) : "—"}

## Reglas confirmadas (qué ayuda)
- Pendiente de confirmar evidencia adicional.

## Descartadas (qué empeora — no repetir)
- Ninguna registrada aún.

## Últimas rondas (máx. 5)
- ${input.roundNote ?? "Sesión inicializada."}
`);
}

/** Agrega una alerta de sobreajuste en holdout al final de `conclusiones.md` sin romper el límite de tamaño. */
export function recordHoldoutOverfitAlert(opts: {
  filePath: string;
  stage: StageName;
  candidate: string;
  devScore: number;
  holdoutScore: number;
  target: number;
  metric: AutoMetric;
  model: string;
  decisionModel: string;
  ranked: RankedVariant[];
  top2: string[];
  round: number;
}): void {
  const existing = readConclusionsBounded(opts.filePath).content;
  const note = `R${opts.round}: \`${opts.candidate}\` alcanzó ${fmtPct(opts.devScore)} en dev pero cayó a ${fmtPct(opts.holdoutScore)} en holdout (target ${fmtPct(opts.target)}) — posible sobreajuste, continuar generalizando.`;
  if (!existing.trim()) {
    writeConclusionsFile(
      opts.filePath,
      buildBaselineConclusionsMarkdown({
        stage: opts.stage,
        target: opts.target,
        metric: opts.metric,
        model: opts.model,
        decisionModel: opts.decisionModel,
        ranked: opts.ranked,
        top2: opts.top2,
        roundNote: `[Alerta holdout] ${note}`,
      }),
    );
    return;
  }

  const lines = existing.replace(/\r\n/g, "\n").trimEnd().split("\n");
  lines.push(`- [Alerta holdout] ${note}`);
  writeConclusionsFile(opts.filePath, lines.join("\n"));
}

/** Registra en `conclusiones.md` una vuelta en la que ninguna propuesta pasó validación. */
export function recordInvalidRoundNote(opts: {
  filePath: string;
  stage: StageName;
  round: number;
  rejectedNotes: string[];
  target: number;
  metric: AutoMetric;
  model: string;
  decisionModel: string;
  ranked: RankedVariant[];
  top2: string[];
}): void {
  const summary = opts.rejectedNotes.length > 0
    ? opts.rejectedNotes.slice(0, 2).join(" | ").slice(0, 220)
    : "todas las propuestas fallaron validación";
  const line = `- [Vuelta sin válidas] R${opts.round}: ${summary}`;
  const existing = readConclusionsBounded(opts.filePath).content;
  if (!existing.trim()) {
    writeConclusionsFile(
      opts.filePath,
      buildBaselineConclusionsMarkdown({
        stage: opts.stage,
        target: opts.target,
        metric: opts.metric,
        model: opts.model,
        decisionModel: opts.decisionModel,
        ranked: opts.ranked,
        top2: opts.top2,
        roundNote: line.slice(2),
      }),
    );
    return;
  }

  const lines = existing.replace(/\r\n/g, "\n").trimEnd().split("\n");
  lines.push(line);
  writeConclusionsFile(opts.filePath, lines.join("\n"));
}
