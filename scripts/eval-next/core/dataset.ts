/**
 * scripts/eval-next/core/dataset.ts
 *
 * Carga y validación estricta de datasets en formato JSONL.
 */

import fs from "node:fs";
import path from "node:path";
import type { EvalCase, StageName } from "./types.ts";
import { STAGES_REGISTRY } from "./stages/index.ts";

export interface LoadDatasetOptions {
  stageFilter?: StageName[];
  tagFilter?: string[];
}

export function loadDatasetFile(filePath: string, options: LoadDatasetOptions = {}): EvalCase[] {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Archivo de dataset no encontrado: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, "utf-8");
  const lines = content.split("\n");
  const cases: EvalCase[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (e: any) {
      throw new Error(`Error de sintaxis JSON en línea ${i + 1} de '${filePath}': ${e.message}`);
    }

    if (!parsed.id || typeof parsed.id !== "string") {
      throw new Error(`Caso en línea ${i + 1} no tiene un 'id' string válido.`);
    }

    if (!parsed.stage || typeof parsed.stage !== "string") {
      throw new Error(`Caso '${parsed.id}' en línea ${i + 1} no tiene un campo 'stage' válido.`);
    }

    if (!STAGES_REGISTRY[parsed.stage as StageName]) {
      throw new Error(`Caso '${parsed.id}' usa etapa no registrada '${parsed.stage}'.`);
    }

    if (parsed.input === undefined || parsed.input === null) {
      throw new Error(`Caso '${parsed.id}' no contiene un campo 'input'.`);
    }

    if (parsed.expect === undefined || parsed.expect === null) {
      throw new Error(`Caso '${parsed.id}' no contiene un campo 'expect'.`);
    }

    // Filtros
    if (options.stageFilter && !options.stageFilter.includes(parsed.stage)) {
      continue;
    }

    if (options.tagFilter && options.tagFilter.length > 0) {
      const caseTags = Array.isArray(parsed.tags) ? parsed.tags : [];
      const hasMatch = options.tagFilter.some((t) => caseTags.includes(t));
      if (!hasMatch) continue;
    }

    cases.push(parsed as EvalCase);
  }

  return cases;
}

