/**
 * eval/scripts/run_all_decision.js
 *
 * Corre cada etapa de decisión comparando `prod` contra todas sus variantes: las de `eval/variants/<etapa>/` y las de `eval/variants/_ganadoras/<etapa>/`.
 * Las variantes se descubren por carpeta, así que no hay nombres que mantener a mano.
 *
 * Uso (desde la raíz del repo): node eval/scripts/run_all_decision.js [flags de eval/cli.ts, p. ej. --decision-model=d3:2b-text --repeat=3]
 * Los flags que se pasen se agregan a cada corrida. Sale con el primer código distinto de 0.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

// Las etapas de decisión (`DECISION_PROMPTS`); las generativas se miden con `--stages` a mano.
const DECISION_STAGES = ["d0", "route", "tool_choice", "args_review", "result_verification", "fragment_judge", "d5", "recovery", "continuation"];
const VARIANTS_DIR = "eval/variants";

/** Nombres de las variantes (archivos `.ts`) de una carpeta; vacío si no existe. */
function variantsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => basename(f, ".ts"));
}

const extraArgs = process.argv.slice(2);
console.log("Iniciando evaluación de las etapas de decisión...");

for (const stage of DECISION_STAGES) {
  const variants = [...new Set([...variantsIn(join(VARIANTS_DIR, stage)), ...variantsIn(join(VARIANTS_DIR, "_ganadoras", stage))])].sort();
  console.log(`\n${"=".repeat(60)}\nEtapa ${stage}: prod + ${variants.length} variante(s)${variants.length > 0 ? ` (${variants.join(", ")})` : ""}\n${"=".repeat(60)}\n`);
  const args = ["--import", "tsx", "eval/cli.ts", `--stages=${stage}`, `--variant=${["prod", ...variants].join(",")}`, `--label=eval_${stage}`, ...extraArgs];
  const run = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`Falló la etapa ${stage} (código ${run.status ?? "señal"}).`);
    process.exit(run.status ?? 2);
  }
}
console.log("\nEtapas de decisión completadas.");
