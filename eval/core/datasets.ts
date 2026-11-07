/**
 * eval/core/datasets.ts
 *
 * Carga de datasets: archivo | carpeta | glob (sección 6) + filtros. Errores de validación con formato
 * `archivo:línea: mensaje` (10.3); el llamador (CLI, F4) los convierte en salida 2.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { validateCase } from "./case.ts";
import type { PromptOverrides } from "./contract.ts";
import { globBaseDir, isGlob, matchGlob, normalizePath } from "./glob.ts";
import { materializeScenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import type { CaseSource, FrozenCase } from "./types.ts";

export interface CaseFilters {
  /** Por nombre de etapa (no por `stageKey`). */
  stages?: string[];
  /** Al menos uno de los tags. */
  tags?: string[];
  /** Id exacto. */
  ids?: string[];
  /** Solo casos de ese origen de contexto (`frozen` o `scenario`). */
  source?: CaseSource;
  /** Primeros N casos por dataset, después de filtrar. */
  limit?: number;
}

export interface Dataset {
  /** Nombre del archivo sin extensión. */
  name: string;
  path: string;
  /** sha256 (16 hex) del contenido del archivo. */
  hash: string;
  cases: FrozenCase[];
}

/** Directorios que no se recorren al resolver carpetas y globs. */
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** Archivos bajo `dir` (recursivo), como rutas con `/`. `maxDepth` limita la profundidad (0 = solo `dir`). */
function walkFiles(dir: string, maxDepth = Infinity): string[] {
  const out: string[] = [];
  const visit = (d: string, depth: number): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = d === "." ? entry.name : `${d}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && depth < maxDepth) visit(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  };
  // Sin barras finales: "datasets/" generaba rutas con "//" en datasetPath.
  visit(normalizePath(dir).replace(/\/+$/, "") || ".", 0);
  return out;
}

export function datasetName(path: string): string {
  return basename(path, extname(path));
}

/** Carpeta donde se buscan los datasets cuando solo se escribe el nombre. */
export const DATASETS_DIR = "eval/datasets";

/** Nombres (sin extensión) de los datasets `.jsonl` disponibles en `DATASETS_DIR`, ordenados. */
export function listDatasetNames(): string[] {
  try {
    return readdirSync(DATASETS_DIR).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)).sort();
  } catch {
    return [];
  }
}

/**
 * Spec corta → ruta real. `smoke`, `smoke.jsonl` o `decision_*` se buscan en `DATASETS_DIR`. Una ruta que ya existe
 * (o una spec con carpeta) se respeta tal cual.
 */
function expandShortSpec(spec: string): string {
  if (existsSync(spec)) return spec;
  if (spec.includes("/")) return spec;
  if (isGlob(spec)) return `${DATASETS_DIR}/${spec.includes(".") ? spec : `${spec}.jsonl`}`;
  for (const candidate of [`${DATASETS_DIR}/${spec}`, `${DATASETS_DIR}/${spec}.jsonl`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return spec;
}

/** Resuelve cada spec a archivos. Lanza si no existe o no coincide nada. Sin duplicados, orden estable. */
export function resolveDatasetPaths(specs: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (p: string): void => {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  };

  for (const rawSpec of specs) {
    const trimmed = normalizePath(rawSpec.trim());
    if (!trimmed) continue;
    const spec = expandShortSpec(trimmed);

    if (isGlob(spec)) {
      const base = globBaseDir(spec);
      if (!existsSync(base) || !statSync(base).isDirectory()) {
        throw new Error(`Glob '${rawSpec}': el directorio base '${base}' no existe.`);
      }
      // Sin `**` el glob no puede bajar más niveles que sus segmentos.
      const maxDepth = spec.includes("**")
        ? Infinity
        : spec.split("/").length - (base === "." ? 0 : base.split("/").length) - 1;
      const matches = walkFiles(base, maxDepth)
        .filter((f) => matchGlob(spec, f))
        .sort();
      if (matches.length === 0) throw new Error(`Glob '${rawSpec}' no coincide con ningún archivo.`);
      matches.forEach(add);
    } else if (existsSync(spec)) {
      if (statSync(spec).isDirectory()) {
        const files = walkFiles(spec)
          .filter((f) => f.endsWith(".jsonl"))
          .sort();
        if (files.length === 0) throw new Error(`La carpeta '${rawSpec}' no contiene archivos .jsonl.`);
        files.forEach(add);
      } else {
        add(spec);
      }
    } else {
      throw new Error(`El dataset '${rawSpec}' no existe (se buscó también en ${DATASETS_DIR}/).`);
    }
  }

  return result;
}

/** Lee y valida un archivo. Acumula errores `archivo:línea: mensaje` en `errors`. */
function loadFile(path: string, errors: string[], ov?: PromptOverrides): Dataset {
  const content = readFileSync(path, "utf8");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const cases: FrozenCase[] = [];
  const idLines = new Map<string, number>();

  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((text, i) => {
    const lineNo = i + 1;
    const trimmed = text.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      errors.push(`${path}:${lineNo}: JSON inválido (${e instanceof Error ? e.message : String(e)}).`);
      return;
    }

    // Caso por escenario: el `request` se arma con el código de producción (ver scenario.ts).
    let source: CaseSource = "frozen";
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "scenario" in parsed) {
      const { scenario, ...rest } = parsed as Record<string, unknown>;
      if ("request" in rest) {
        errors.push(`${path}:${lineNo}: un caso no puede traer 'request' y 'scenario' a la vez.`);
        return;
      }
      try {
        const m = materializeScenario(String(rest.stage), scenario as Scenario, ov);
        const meta = rest.meta !== null && typeof rest.meta === "object" ? (rest.meta as Record<string, unknown>) : {};
        source = "scenario";
        parsed = { ...rest, request: m.request, ...(m.toolSchema ? { meta: { ...meta, toolSchema: m.toolSchema } } : {}) };
      } catch (e) {
        errors.push(`${path}:${lineNo}: scenario: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }

    const v = validateCase(parsed);
    if (!v.ok) {
      for (const msg of v.errors) errors.push(`${path}:${lineNo}: ${msg}`);
      return;
    }

    const firstLine = idLines.get(v.case.id);
    if (firstLine !== undefined) {
      errors.push(`${path}:${lineNo}: id '${v.case.id}' duplicado (ya definido en la línea ${firstLine}).`);
      return;
    }
    idLines.set(v.case.id, lineNo);
    cases.push({ ...v.case, source });
  });

  return { name: datasetName(path), path, hash, cases };
}

export function filterCases(cases: FrozenCase[], f: CaseFilters): FrozenCase[] {
  let out = cases;
  if (f.stages && f.stages.length > 0) out = out.filter((c) => f.stages!.includes(c.stage));
  if (f.tags && f.tags.length > 0) out = out.filter((c) => (c.tags ?? []).some((t) => f.tags!.includes(t)));
  if (f.ids && f.ids.length > 0) out = out.filter((c) => f.ids!.includes(c.id));
  if (f.source) out = out.filter((c) => c.source === f.source);
  if (f.limit !== undefined) out = out.slice(0, f.limit);
  return out;
}

/**
 * Resuelve, valida (todos los archivos, antes de filtrar) y filtra. `ov`: los prompts de una variante, con los que se rearman
 * los casos por escenario (sin `ov`, los de producción). Lanza `Error` con un mensaje por línea
 * si hay datasets inválidos o nombres de dataset repetidos.
 */
export function loadDatasets(specs: string[], filters: CaseFilters = {}, ov?: PromptOverrides): Dataset[] {
  const paths = resolveDatasetPaths(specs);

  const byName = new Map<string, string>();
  for (const p of paths) {
    const name = datasetName(p);
    const other = byName.get(name);
    if (other !== undefined) {
      throw new Error(`Dos datasets comparten el nombre '${name}': '${other}' y '${p}'.`);
    }
    byName.set(name, p);
  }

  const errors: string[] = [];
  const datasets = paths.map((p) => loadFile(p, errors, ov));
  if (errors.length > 0) throw new Error(errors.join("\n"));

  // Un id que no existe en ningún dataset (typo) se ignoraba si otros ids sí coincidían.
  if (filters.ids && filters.ids.length > 0) {
    const known = new Set(datasets.flatMap((d) => d.cases.map((c) => c.id)));
    const unknown = filters.ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`--ids: no existe ningún caso con id ${unknown.map((i) => `'${i}'`).join(", ")} en los datasets cargados.`);
    }
  }

  return datasets.map((d) => ({ ...d, cases: filterCases(d.cases, filters) }));
}
