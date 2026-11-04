#!/usr/bin/env node
/**
 * scripts/eval-next/cli.ts
 *
 * CLI Entry point para la nueva suite de evaluación de JARVIS.
 *
 * Exit codes:
 *   0 = OK (pass rate cumplido o sin umbral mínimo configurado)
 *   1 = Pass rate por debajo del umbral --minPassRate
 *   2 = Error de infraestructura (dataset no encontrado, modelo inalcanzable, etc.)
 *
 * Uso:
 *   npx tsx scripts/eval-next/cli.ts --model=mock --stage=all
 *   npx tsx scripts/eval-next/cli.ts --stage=plan --model=qwen3.5:4b --dataset=scripts/eval-next/datasets/sample.jsonl
 */

import { parseCliArgs } from "./core/config.ts";
import { runEvaluation } from "./core/runner.ts";

async function main() {
  let config;
  try {
    config = parseCliArgs();
  } catch (err: any) {
    console.error(`\n💥 Error de configuración: ${err.message}\n`);
    process.exit(2);
  }

  try {
    await runEvaluation(config);
  } catch (err: any) {
    console.error(`\n💥 Error de infraestructura: ${err.message}\n`);
    process.exit(2);
  }
}

void main();
