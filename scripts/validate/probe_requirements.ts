/**
 * Prueba el libro de requisitos (`engine/requirements.ts`) contra el modelo de decisión real con los datos de una traza guardada: las lecturas salen de las llamadas de la
 * traza y el entregable es un archivo (como está en el disco ahora). Imprime, por requisito, las tres probabilidades que usa el cierre (`info`, `gathered`, `delivered`).
 *
 *   npx tsx scripts/validate/probe_requirements.ts <trace.json> <archivo entregable> '["requisito 1","requisito 2"]'
 *
 * Los requisitos son la primera lista de pendientes de la traza (`summary.md`, «Lista de pendientes por vuelta», la primera). Necesita el servicio de decisión en marcha.
 */

import fs from "node:fs";

import { ConfigManager } from "../../src/core/config.ts";
import { sectionDigest } from "../../src/core/engine/artifacts.ts";
import { DELIVERED_MIN, GATHERED_MIN, INFO_MIN } from "../../src/core/engine/requirements.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";

const [tracePath, file, requirementsJson] = process.argv.slice(2);
if (tracePath === undefined || file === undefined || requirementsJson === undefined) {
  console.error("Uso: npx tsx scripts/validate/probe_requirements.ts <trace.json> <archivo> '[\"requisito\", ...]'");
  process.exit(1);
}

const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const snapshot = JSON.parse(fs.readFileSync(tracePath, "utf8")).snapshot;
const reads: string[] = snapshot.calls
  .filter((c: { kind: string; status: string; verdict: string | null; summary: string | null }) => c.kind === "read" && c.status === "ok" && c.verdict !== "rejected" && c.summary)
  .slice(-6)
  .map((c: { tool: string; args: unknown; summary: string }) => `- ${c.tool} ${clip(JSON.stringify(c.args ?? {}), 120)} => ${clip(flat(c.summary), 350)}`);
const text = fs.readFileSync(file, "utf8");
const requirements: string[] = JSON.parse(requirementsJson);

const engine = new Decision20Engine(() => ConfigManager.getConfig());
const started = Date.now();
const out = await engine.checkRequirements({
  requirements,
  request: clip(flat(snapshot.task.request), 600),
  reads: reads.length > 0 ? reads.join("\n") : "(none)",
  deliverable: `${file} · ${sectionDigest(text, Buffer.byteLength(text))}`,
});
console.log(`${reads.length} lecturas, ${Date.now() - started} ms (umbrales: info ≥ ${INFO_MIN}, gathered ≥ ${GATHERED_MIN}, delivered ≥ ${DELIVERED_MIN})`);
requirements.forEach((requirement, i) => {
  const v = out.items[i];
  const verdict = v.info < INFO_MIN ? "acción (no se juzga)" : v.gathered < GATHERED_MIN ? "HUECO: buscar" : v.delivered !== null && v.delivered < DELIVERED_MIN ? "HUECO: volcar al entregable" : "cubierto";
  console.log(`${clip(requirement, 64).padEnd(64)} info=${v.info.toFixed(2)} gathered=${v.gathered.toFixed(2)} delivered=${v.delivered?.toFixed(2) ?? "-"}  → ${verdict}`);
});
