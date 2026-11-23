/**
 * eval/auto/batchExecution.ts
 *
 * Ejecuta un lote comparativo de `--auto`. Sin clientes inyectados corre en un `Worker` efímero (cada lote en su propio isolate de V8, que se
 * libera entero al terminar); con clientes inyectados (tests) corre en el mismo proceso.
 */

import { Worker } from "node:worker_threads";
import { c } from "../ui/style.ts";
import { executeAutoBatchInProcess, type AutoBatchOutcome, type RunAutoBatchPayload } from "./batchRunner.ts";
import type { AutoBatchWorkerMessage } from "./batchWorker.ts";
import type { AutoRun } from "./runContext.ts";

const BATCH_WORKER_URL = new URL("./batchWorker.ts", import.meta.url);

/** Una línea por celda terminada: variante, dataset y `pasaron/corridos`. */
function printCell(variantSpec: string, datasetName: string, passCount: number, runCount: number): void {
  console.log(`  ${variantSpec.padEnd(28)} ${datasetName.padEnd(24)} ${passCount}/${runCount}`);
}

async function runInWorker(payload: RunAutoBatchPayload, silent: boolean): Promise<AutoBatchOutcome> {
  const worker = new Worker(BATCH_WORKER_URL, { workerData: payload });
  try {
    return await new Promise<AutoBatchOutcome>((resolvePromise) => {
      let settled = false;
      const finish = (outcome: AutoBatchOutcome): void => {
        if (settled) return;
        settled = true;
        resolvePromise(outcome);
      };

      worker.on("message", (msg: AutoBatchWorkerMessage) => {
        if (msg.type === "rootReady") {
          if (!silent) console.log(`${c.gray("Resultados en")} ${c.cyan(msg.rootDir)}`);
        } else if (msg.type === "cellEnd") {
          if (!silent) printCell(msg.variantSpec, msg.datasetName, msg.passCount, msg.runCount);
        } else if (msg.type === "done") {
          finish(msg.outcome);
        } else if (msg.type === "error") {
          finish({ ok: false, reason: `Error en worker de evaluación: ${msg.message}` });
        }
      });
      worker.once("error", (err) => finish({ ok: false, reason: `Error en worker de evaluación: ${err.message}` }));
      worker.once("exit", (code) => finish({ ok: false, reason: `Worker de evaluación terminó inesperadamente (exit ${code}).` }));
    });
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/**
 * Corre `variantNames` sobre `datasetPaths` y devuelve el ranking. `label` es la carpeta de la ronda dentro de la sesión (`r0`, `r1`, `r1-holdout`…).
 * `silent` fuerza el silencio de ese lote aunque la corrida no lo sea (la medición de `prod` en el holdout).
 */
export function runComparativeBatch(
  run: AutoRun,
  opts: { variantNames: string[]; datasetPaths: string[]; label: string; silent?: boolean },
): Promise<AutoBatchOutcome> {
  const silent = opts.silent ?? run.silent;
  const payload: RunAutoBatchPayload = {
    cfg: run.cfg,
    variantNames: opts.variantNames,
    datasetPaths: opts.datasetPaths,
    label: opts.label,
    resultsRoot: run.resultsRoot,
    variantsRoot: run.variantsRoot,
  };
  if (!run.customClients) return runInWorker(payload, silent);

  return executeAutoBatchInProcess(payload, {
    clients: run.customClients,
    rawCache: run.rawCache,
    onRootReady: (rootDir) => {
      if (!silent) console.log(`${c.gray("Resultados en")} ${c.cyan(rootDir)}`);
    },
    onCellEnd: ({ variantSpec, datasetName, passCount, runCount }) => {
      if (!silent) printCell(variantSpec, datasetName, passCount, runCount);
    },
  });
}
