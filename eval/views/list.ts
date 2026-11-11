/**
 * eval/views/list.ts
 *
 * Vista de `--list`: etapas (agrupadas), variantes (con baseline) y datasets (con casos por etapa).
 * Separada en dos pasos: `collectListData` lee del disco y `renderList` solo arma texto (sin I/O).
 */

import { DECISION_STAGES, GENERATIVE_STAGES } from "../core/case.ts";
import { datasetName, listDatasetNames, loadDatasets, resolveDatasetPaths } from "../core/datasets.ts";
import { allStageNames } from "../core/stages/index.ts";
import { listVariantNames } from "../core/variants/load.ts";
import { box, c, clip, columns, heading, padEnd, sym, WIDTH, wrapList } from "../ui.ts";

interface DatasetInfo {
  total: number;
  byStage: Array<[string, number]>;
}

interface ListData {
  baseline: string;
  stageGroups: Array<[string, string[]]>;
  stageCount: number;
  variants: string[];
  datasets: Array<{ name: string; info: DatasetInfo | null }>;
  /** Datasets que elige `--dataset`; vacío si elige todos (marcarlos no informaría nada). */
  selected: Set<string>;
}

// ───────────────────────── Datos ─────────────────────────

/** Lee un dataset para contar sus casos por etapa; `null` si no se puede cargar (no debe romper el listado). */
function datasetInfo(name: string): DatasetInfo | null {
  try {
    const [ds] = loadDatasets([name], {});
    if (!ds) return null;
    const by = new Map<string, number>();
    for (const k of ds.cases) by.set(k.stage, (by.get(k.stage) ?? 0) + 1);
    return { total: ds.cases.length, byStage: [...by.entries()] };
  } catch {
    return null;
  }
}

function collectListData(baseline: string, datasetSpecs: string[]): ListData {
  const stages = allStageNames() as string[];
  const decisionSet = DECISION_STAGES as readonly string[];
  const generativeSet = GENERATIVE_STAGES as readonly string[];
  const names = [...listDatasetNames()].sort((a, b) => a.localeCompare(b));

  let selected = new Set<string>();
  try {
    selected = new Set(resolveDatasetPaths(datasetSpecs).map(datasetName));
  } catch {
    // Spec inválida: el listado no debe romper.
  }
  if (!(selected.size > 0 && names.some((n) => !selected.has(n)))) selected = new Set();

  // La baseline va primero (arriba a la izquierda); el resto, alfabético.
  const variants = [...listVariantNames()].sort((a, b) => (a === baseline ? -1 : b === baseline ? 1 : a.localeCompare(b)));

  return {
    baseline,
    stageGroups: [
      ["Decisión", stages.filter((s) => decisionSet.includes(s))],
      ["Generativas", stages.filter((s) => generativeSet.includes(s))],
      ["Otras", stages.filter((s) => !decisionSet.includes(s) && !generativeSet.includes(s))],
    ],
    stageCount: stages.length,
    variants,
    datasets: names.map((name) => ({ name, info: datasetInfo(name) })),
    selected,
  };
}

// ───────────────────────── Vista ─────────────────────────

const MAX_BREAKDOWN_LINES = 3;

function renderStages(d: ListData): string[] {
  const groups = d.stageGroups.filter(([, items]) => items.length > 0);
  const labelW = Math.max(0, ...groups.map(([label]) => label.length)) + 2;
  const out: string[] = [];
  for (const [label, items] of groups) {
    const lines = wrapList(items.map((s) => c.cyan(s)), WIDTH - 2 - labelW, c.gray(" · "));
    lines.forEach((ln, i) => out.push(`  ${i === 0 ? c.gray(label.padEnd(labelW)) : " ".repeat(labelW)}${ln}`));
  }
  return out;
}

function renderVariants(d: ListData): string[] {
  if (d.variants.length === 0) return [`  ${c.gray("(ninguna en eval/variants/)")}`];
  const cells = d.variants.map((v) =>
    v === d.baseline ? `${sym.dot} ${c.bold(c.green(v))}  ${c.gray("baseline")}` : `${sym.ring} ${c.cyan(v)}`,
  );
  return [
    ...columns(cells),
    "",
    `  ${c.gray("Una variante es un archivo con prompts enteros (eval/variants/<nombre>.ts); no se componen.")}`,
  ];
}

/** Dos líneas por dataset: nombre y casos, y debajo el desglose por etapa (gris, máx. 3 líneas). */
function renderDatasets(d: ListData): string[] {
  if (d.datasets.length === 0) return [`  ${c.gray("(ninguno en eval/datasets/)")}`];
  const nameW = Math.max(...d.datasets.map((x) => x.name.length));
  const totalW = Math.max(...d.datasets.map((x) => (x.info ? String(x.info.total).length : 1)));
  const headW = 2 + nameW + 2 + totalW + " casos".length;
  // Ancho de cada columna si entran dos: el desglose por etapa aprovecha todo el ancho disponible.
  const cellW = Math.max(headW, Math.floor((WIDTH - 2 - 4) / 2));

  const cells = d.datasets.map(({ name, info }) => {
    const sel = d.selected.has(name);
    const title = padEnd(sel ? c.bold(c.green(name)) : c.cyan(name), nameW);
    const count = info ? c.gray(`${String(info.total).padStart(totalW)} casos`) : c.red("no se pudo leer");
    const lines = [`${sel ? sym.dot : sym.ring} ${title}  ${count}`];
    if (info && info.byStage.length > 0) {
      const parts = info.byStage.map(([s, n]) => `${s} ${n}`);
      const wrapped = wrapList(parts, cellW - 2, " · ");
      const shown = wrapped.slice(0, MAX_BREAKDOWN_LINES);
      if (wrapped.length > MAX_BREAKDOWN_LINES) shown[shown.length - 1] = clip(`${shown[shown.length - 1]} …`, cellW - 2);
      for (const ln of shown) lines.push(`  ${c.gray(ln)}`);
    }
    return lines.join("\n");
  });

  const out = columns(cells, { rowGap: 1, minItems: 2 });
  if (d.selected.size > 0) out.push("", `  ${c.gray(`${sym.dot} = lo que elige --dataset en este comando.`)}`);
  return out;
}

function renderList(d: ListData): string[] {
  const totalCases = d.datasets.reduce((n, x) => n + (x.info?.total ?? 0), 0);
  return [
    "",
    box(
      [
        `${c.bold(c.cyan("Eval"))} ${c.gray("·")} ${c.bold("recursos disponibles")}`,
        c.gray(`${d.stageCount} etapas  ·  ${d.variants.length} variantes  ·  ${d.datasets.length} datasets  ·  ${totalCases} casos`),
      ],
      { color: c.violet },
    ),
    heading("Etapas"),
    ...renderStages(d),
    heading("Variantes"),
    ...renderVariants(d),
    heading("Datasets"),
    ...renderDatasets(d),
    heading("Ejemplo"),
    `  ${sym.bar} npm run eval -- --dataset=<dataset> --variant=prod,<variante> --stages=<etapa>`,
    `  ${sym.bar} npm run eval -- --menu   ${c.gray("asistente interactivo")}`,
    "",
  ];
}

/** `--list`. */
export function printList(baseline: string, datasetSpecs: string[]): void {
  console.log(renderList(collectListData(baseline, datasetSpecs)).join("\n"));
}
