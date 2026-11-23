/**
 * eval/auto/runContext.ts
 *
 * Contexto de una corrida de `--auto` y su memoria mutable. El contexto (`AutoRun`) se arma una vez y no cambia; la memoria (`LoopMemory`) es lo
 * que cada vuelta actualiza: Top-2, ranking, estadísticas para el optimizador, mejor variante y holdout ya medido. Los pasos del bucle
 * (`initialRanking.ts`, `holdout.ts`, `round.ts`, `loop.ts`) reciben ambos en vez de compartir variables de una función gigante.
 */

import type { EvalClients } from "../core/batch.ts";
import type { RawDatasetCache } from "../core/datasets.ts";
import type { ComparisonReport, InputCell } from "../core/report.ts";
import { isDecisionStage } from "../core/stages/index.ts";
import type { AutoConfig } from "./config.ts";
import type { discoverStageDatasets } from "./discover.ts";
import {
  extractConfusions,
  extractFailureKinds,
  extractVariantDatasetStats,
  type ConfusionStat,
  type FailureKind,
  type VariantDatasetStat,
} from "./feedback.ts";
import type { OptimizerLlmCaller } from "./optimizer.ts";
import { saveAutoState, type AutoSessionState, type RankedVariant } from "./ranking.ts";

/** Dependencias inyectables del bucle (tests): optimizador y clientes simulados, carpetas aisladas y silencio. */
export interface AutoLoopDeps {
  callOptimizer?: OptimizerLlmCaller;
  makeClients?: (cfg: AutoConfig) => EvalClients;
  /** Carpeta de la sesión (tests). Sin ella, `eval/results/auto/<etapa>/<fecha_hora>/`. */
  resultsRoot?: string;
  /** Solo para el escaneo de resultados reutilizables: si no se indica, el escaneo usa las carpetas de resultados habituales. Lo fija `runAutoLoop`. */
  reuseFrom?: string;
  variantsRoot?: string;
  silent?: boolean;
}

/** Lo que no cambia durante una corrida de `--auto`. */
export interface AutoRun {
  cfg: AutoConfig;
  /** Carpeta de la sesión: donde van las rondas (`r0`, `r1`, …). */
  resultsRoot?: string;
  /** Dónde buscar corridas previas reutilizables. */
  reuseFrom?: string;
  variantsRoot: string;
  rawCache: RawDatasetCache;
  /** Solo si los inyecta `deps.makeClients`; sin ellos cada lote corre en un worker con los clientes reales. */
  customClients?: EvalClients;
  discovered: ReturnType<typeof discoverStageDatasets>;
  devPaths: string[];
  holdoutPaths: string[];
  devDatasetNames: Set<string>;
  silent: boolean;
  log: (...args: unknown[]) => void;
}

/** Resultado de un holdout ya medido para una variante. */
export interface HoldoutCheck {
  score: number;
  confirmed: boolean;
  round: number;
}

/** Lo que el bucle va acumulando; se persiste en `auto_state.json` al cerrar cada vuelta. */
export class LoopMemory {
  top2: string[] = [];
  ranked: RankedVariant[] = [];
  stats: VariantDatasetStat[] = [];
  failureKinds: FailureKind[] = [];
  confusions: ConfusionStat[] = [];
  bestNonProd: AutoSessionState["bestNonProd"] | undefined;
  completedRounds = 0;
  readonly testedHoldout: Map<string, HoldoutCheck>;

  constructor(prior?: AutoSessionState | null) {
    this.bestNonProd = prior?.bestNonProd;
    this.completedRounds = prior?.completedRounds ?? 0;
    this.testedHoldout = new Map(Object.entries(prior?.holdoutChecked ?? {}));
  }

  /** Guarda el ranking de un lote y lo que se le muestra al optimizador en la vuelta siguiente. */
  remember(run: AutoRun, top2: string[], ranked: RankedVariant[], report: ComparisonReport, cells: InputCell[]): void {
    const focusVariant = top2[0] ?? "prod";
    this.ranked = ranked;
    this.stats = extractVariantDatasetStats(report, cells);
    this.confusions = cells.length > 0 ? extractConfusions({ focusVariant, cells, devDatasetNames: run.devDatasetNames, devDatasetPaths: run.devPaths }) : [];
    // Ninguna etapa muestra casos al optimizador: las de decisión ven errores por etiqueta; las generativas, tipos de fallo del evaluador con su conteo.
    this.failureKinds =
      cells.length > 0 && !isDecisionStage(run.cfg.stage)
        ? extractFailureKinds({ focusVariant, cells, devDatasetNames: run.devDatasetNames, devDatasetPaths: run.devPaths })
        : [];
  }

  /** Mejor variante distinta de `prod` de un ranking; actualiza `bestNonProd` si la iguala o supera. Devuelve esa fila. */
  considerBest(ranked: RankedVariant[], round: number): RankedVariant | undefined {
    const best = ranked.find((r) => r.variant !== "prod");
    if (best && (!this.bestNonProd || best.score >= this.bestNonProd.score)) {
      this.bestNonProd = { variant: best.variant, score: best.score, round };
    }
    return best;
  }

  /** Escribe `auto_state.json`: con él una sesión compatible retoma el avance. */
  persist(run: AutoRun, fingerprint: AutoSessionState["fingerprint"]): void {
    saveAutoState(
      {
        schemaVersion: 1,
        stage: run.cfg.stage,
        fingerprint,
        completedRounds: this.completedRounds,
        top2: this.top2,
        top2Summaries: this.top2
          .map((name) => this.ranked.find((r) => r.variant === name))
          .filter((r): r is RankedVariant => Boolean(r)),
        prodSummary: this.ranked.find((r) => r.variant === "prod"),
        bestNonProd: this.bestNonProd,
        ...(this.testedHoldout.size > 0 ? { holdoutChecked: Object.fromEntries(this.testedHoldout.entries()) } : {}),
        updatedAt: new Date().toISOString(),
      },
      run.variantsRoot,
    );
  }
}
