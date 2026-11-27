/**
 * Mide contra el modelo de decisión real si puede elegir, entre las lecturas de una tarea, las que sirven a un paso («¿esta lectura trae información para este paso?», `noul`,
 * una pregunta por lectura, la lectura dentro de la pregunta como hace el juez de fragmentos). Hoy el generador de argumentos ve solo las últimas 3 lecturas aprobadas
 * (`BUDGET.caps.lastReads`), con o sin relación con el paso.
 *
 *   npx tsx scripts/validate/probe_reads.ts <trace.json> '["paso 1","paso 2"]'
 *
 * Imprime, por paso, la probabilidad de cada lectura aprobada de la traza y marca cuáles quedarían fuera de la ventana de 3.
 */

import fs from "node:fs";

import { ConfigManager } from "../../src/core/config.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";
import type { DecisionQuestion } from "../../src/core/types.ts";

const [tracePath, stepsJson] = process.argv.slice(2);
if (tracePath === undefined || stepsJson === undefined) {
  console.error("Uso: npx tsx scripts/validate/probe_reads.ts <trace.json> '[\"paso\", ...]'");
  process.exit(1);
}

const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
type Call = { id: string; kind: string; status: string; verdict: string | null; tool: string; args: Record<string, unknown>; summary: string | null };

const calls: Call[] = JSON.parse(fs.readFileSync(tracePath, "utf8")).snapshot.calls;
const reads = calls.filter((c) => c.kind === "read" && c.status === "ok" && c.verdict === "approved" && c.summary);
const outside = new Set(reads.slice(0, Math.max(0, reads.length - 3)).map((c) => c.id));
const steps: string[] = JSON.parse(stepsJson);
const engine = new Decision20Engine(() => ConfigManager.getConfig());

console.log(`${reads.length} lecturas aprobadas; fuera de la ventana de 3: ${[...outside].join(", ") || "ninguna"}`);
for (const step of steps) {
  const questions: Record<string, DecisionQuestion> = {};
  reads.forEach((read, i) => {
    questions[`r${i}`] = {
      type: "noul",
      instructions: `READ (${read.tool} ${clip(JSON.stringify(read.args), 100)}):\n"""\n${clip(flat(read.summary ?? ""), 700)}\n"""\nDoes this READ contain information that this TASK needs?`,
      criteria: {
        true: "The read states facts about what the task needs (names, prices, places, data), even partially.",
        false: "The read is about something else.",
      },
    };
  });
  const started = Date.now();
  const response = await engine.systemOne(`TASK: ${step}`, questions);
  const p = reads.map((_, i) => (response.answers[`r${i}`] as { noul: number }).noul);
  console.log(`\n${clip(step, 90)}  (${Date.now() - started} ms)`);
  reads.forEach((read, i) => console.log(`   ${p[i].toFixed(2)}  ${read.id}${outside.has(read.id) ? " [fuera de la ventana]" : ""}  ${clip(JSON.stringify(read.args), 70)}`));
}
