/**
 * eval/auto/session.ts
 *
 * Una sesión de `--auto` es una carpeta (`eval/results/auto/<etapa>/<fecha_hora>/`) con una subcarpeta por ronda (`r0`, `r1`, …,
 * `holdout-prod`, `r<k>-holdout`) y un `session.json` que resume qué se pidió y cómo terminó. Así las rondas de una misma sesión
 * quedan juntas y separadas de las corridas manuales.
 */

import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { atomicWriteFileSync } from "../core/io.ts";
import { autoSessionDir } from "../core/results.ts";
import type { AutoConfig } from "./config.ts";

export interface AutoSession {
  /** Carpeta de la sesión (absoluta). */
  readonly dir: string;
  /** Cierra la sesión: registra el código de salida y las rondas que quedaron en disco. */
  close(exitCode: number): void;
}

const STATUS_BY_EXIT: Record<number, string> = {
  0: "objetivo_cumplido",
  1: "objetivo_no_alcanzado",
  2: "error",
};

/**
 * Abre la sesión. Con `resultsRoot` explícito (tests) esa carpeta es la sesión; sin él se crea una nueva en `eval/results/auto/<etapa>/`.
 */
export function openAutoSession(cfg: AutoConfig, resultsRoot?: string): AutoSession {
  const dir = resolve(resultsRoot ?? autoSessionDir(cfg.stage));
  mkdirSync(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  const file = join(dir, "session.json");

  const base = {
    schemaVersion: 1,
    stage: cfg.stage,
    startedAt,
    config: {
      target: cfg.target,
      metric: cfg.metric,
      maxLoops: cfg.maxLoops,
      mode: cfg.mode,
      seedTop: cfg.seedTop,
      datasets: cfg.datasetSpecs,
      holdout: cfg.holdoutSpecs,
      ...(cfg.holdoutMargin !== undefined ? { holdoutMargin: cfg.holdoutMargin } : {}),
    },
    optimizer: { model: cfg.optimizerModel, url: cfg.optimizerUrl, thinking: cfg.optimizerThinking },
    evaluated: {
      client: cfg.client,
      model: cfg.model,
      decisionModel: cfg.decisionModel,
      url: cfg.url,
      decisionUrl: cfg.decisionUrl,
      repeat: cfg.repeat,
      thinking: cfg.thinking,
    },
  };
  const write = (extra: Record<string, unknown>): void => atomicWriteFileSync(file, `${JSON.stringify({ ...base, ...extra }, null, 2)}\n`);
  write({ status: "en_curso" });

  return {
    dir,
    close(exitCode: number): void {
      const runs = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      write({ status: STATUS_BY_EXIT[exitCode] ?? "error", exitCode, endedAt: new Date().toISOString(), runs });
    },
  };
}
