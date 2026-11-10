/**
 * eval/core/datasets.ts
 *
 * Carga de datasets: archivo | carpeta | glob + filtros. Errores de validación con formato
 * `archivo:línea: mensaje`; el llamador (la CLI) los convierte en salida 2.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { validateCase } from "./case.ts";
import { globBaseDir, isGlob, matchGlob, normalizePath } from "./glob.ts";
import { materializeScenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";
import type { Case, Variant } from "./types.ts";

export interface CaseFilters {
  /** Por nombre de etapa (no por `stageKey`). */
  stages?: string[];
  /** Al menos uno de los tags. */
  tags?: string[];
  /** Id exacto. */
  ids?: string[];
  /** Primeros N casos por dataset, después de filtrar. */
  limit?: number;
}

export interface Dataset {
  /** Nombre del archivo sin extensión. */
  name: string;
  path: string;
  /** sha256 (16 hex) del contenido del archivo. */
  hash: string;
  cases: Case[];
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

/** Nombres (sin extensión) de los datasets `.jsonl` disponibles en `DATASETS_DIR` y subcarpetas, ordenados. */
export function listDatasetNames(): string[] {
  try {
    return walkFiles(DATASETS_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => datasetName(f))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Spec corta → ruta real. `smoke` y `smoke.jsonl` se buscan en `DATASETS_DIR` y sus subcarpetas; un glob sin carpeta
 * (`llm_*`) también en `DATASETS_DIR` y sus subcarpetas (`**\/` admite cero o más carpetas). Una ruta que ya existe (o una spec con carpeta) se respeta tal cual.
 */
function expandShortSpec(spec: string): string {
  if (existsSync(spec)) return spec;
  if (spec.includes("/")) return spec;
  // `**/` coincide con cero o más carpetas: encuentra tanto `eval/datasets/x.jsonl` como `eval/datasets/pending/x.jsonl`.
  if (isGlob(spec)) return `${DATASETS_DIR}/**/${spec.includes(".") ? spec : `${spec}.jsonl`}`;
  for (const candidate of [`${DATASETS_DIR}/${spec}`, `${DATASETS_DIR}/${spec}.jsonl`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  // Búsqueda recursiva en subcarpetas de DATASETS_DIR (sin la carpeta, `walkFiles` lanzaría ENOENT en vez del "no existe" de abajo).
  if (!existsSync(DATASETS_DIR)) return spec;
  const targetWithExt = spec.endsWith(".jsonl") ? spec : `${spec}.jsonl`;
  const allFiles = walkFiles(DATASETS_DIR);
  const found = allFiles.find((f) => f.endsWith(`/${targetWithExt}`) || f === targetWithExt);
  if (found) return found;

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
      // Solo `.jsonl`, igual que al resolver una carpeta: un glob amplio (`eval/datasets/*`) no debe cargar README ni otros archivos.
      const matches = walkFiles(base, maxDepth)
        .filter((f) => f.endsWith(".jsonl") && matchGlob(spec, f))
        .sort();
      if (matches.length === 0) throw new Error(`Glob '${rawSpec}' no coincide con ningún archivo .jsonl.`);
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
function loadFile(path: string, errors: string[], variant?: Variant): Dataset {
  const content = readFileSync(path, "utf8");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const cases: Case[] = [];
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

    // Un solo formato de caso: el escenario. El `request` se arma con el código de producción y los prompts de la variante.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      errors.push(`${path}:${lineNo}: la línea debe ser un objeto JSON.`);
      return;
    }
    if ("request" in parsed) {
      errors.push(`${path}:${lineNo}: un caso no trae 'request' (prompt armado a mano): describí la situación en 'scenario'. El prompt lo arma la variante.`);
      return;
    }
    if (!("scenario" in parsed)) {
      errors.push(`${path}:${lineNo}: falta 'scenario' (la situación del caso).`);
      return;
    }
    {
      const { scenario, ...rest } = parsed as Record<string, unknown>;
      // Un `meta` que no es objeto se rechazaba o se pisaba en silencio al fusionarlo con el `toolSchema` del escenario.
      if (rest.meta !== undefined && (rest.meta === null || typeof rest.meta !== "object" || Array.isArray(rest.meta))) {
        errors.push(`${path}:${lineNo}: meta debe ser un objeto.`);
        return;
      }
      try {
        const m = materializeScenario(String(rest.stage), scenario as Scenario, variant);
        const meta = (rest.meta ?? {}) as Record<string, unknown>;
        parsed = { ...rest, request: m.request, ...(m.toolSchema ? { meta: { ...meta, toolSchema: m.toolSchema, toolName: m.toolName, environment: m.environment } } : {}) };
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
    cases.push(v.case);
  });

  return { name: datasetName(path), path, hash, cases };
}

export function filterCases(cases: Case[], f: CaseFilters): Case[] {
  let out = cases;
  if (f.stages && f.stages.length > 0) out = out.filter((c) => f.stages!.includes(c.stage));
  if (f.tags && f.tags.length > 0) out = out.filter((c) => (c.tags ?? []).some((t) => f.tags!.includes(t)));
  if (f.ids && f.ids.length > 0) out = out.filter((c) => f.ids!.includes(c.id));
  if (f.limit !== undefined) out = out.slice(0, f.limit);
  return out;
}

/**
 * Resuelve, valida (todos los archivos, antes de filtrar) y filtra. `variant`: la variante con cuyos prompts se arman
 * los casos (sin ella, los de producción). Lanza `Error` con un mensaje por línea
 * si hay datasets inválidos o nombres de dataset repetidos.
 */
export function loadDatasets(specs: string[], filters: CaseFilters = {}, variant?: Variant): Dataset[] {
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
  const datasets = paths.map((p) => loadFile(p, errors, variant));
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