/**
 * eval/auto/batchWorker.ts
 *
 * Worker efímero (`node:worker_threads`) para aislar cada corrida comparativa de `eval --auto`
 * en su propio isolate de V8. Al terminar la vuelta, el host llama a `worker.terminate()` y V8
 * libera por completo cualquier caché de compilación, contextos `vm` y módulos cargados.
 */

import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { executeAutoBatchInProcess, type AutoBatchOutcome, type RunAutoBatchPayload } from "./batchRunner.ts";

export type AutoBatchWorkerMessage =
  | { type: "rootReady"; rootDir: string }
  | { type: "cellEnd"; variantSpec: string; datasetName: string; passCount: number; runCount: number }
  | { type: "done"; outcome: AutoBatchOutcome }
  | { type: "error"; message: string };

if (!isMainThread && parentPort) {
  const port = parentPort;
  const payload = workerData as RunAutoBatchPayload;

  executeAutoBatchInProcess(payload, {
    onRootReady: (rootDir) => {
      port.postMessage({ type: "rootReady", rootDir } satisfies AutoBatchWorkerMessage);
    },
    onCellEnd: (info) => {
      port.postMessage({
        type: "cellEnd",
        variantSpec: info.variantSpec,
        datasetName: info.datasetName,
        passCount: info.passCount,
        runCount: info.runCount,
      } satisfies AutoBatchWorkerMessage);
    },
  })
    .then((outcome) => {
      port.postMessage({ type: "done", outcome } satisfies AutoBatchWorkerMessage);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      port.postMessage({ type: "error", message } satisfies AutoBatchWorkerMessage);
    });
}
