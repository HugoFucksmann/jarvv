/**
 * eval/exp/write_reads.ts
 *
 * Experimento con el modelo generativo real: un paso de ESCRITURA que compila lo que juntaron varias búsquedas, con la vista de argumentos de hoy (las últimas 3 lecturas) y con
 * todas las lecturas de la tarea. Reproduce la traza del viaje a Mendoza: cuatro búsquedas (pasajes, alojamiento, lugares gratuitos, excursiones) y el paso «Redactar y guardar un
 * documento con toda la información recopilada». Con 3 lecturas la de pasajes (la más vieja) queda fuera de la vista y el archivo salió con «Pasajes (No disponible en fuentes)».
 *
 * Mide, en N corridas por condición, cuántas veces el `content` generado incluye el dato de pasajes ($126.000) y cuántas dice «No disponible».
 *
 * Uso: npx tsx eval/exp/write_reads.ts --trace=<carpeta de la traza ij72> [--n=8]
 * No toca `src/`.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { BUDGET } from "../../src/core/budget.ts";
import { ConfigManager } from "../../src/core/config.ts";
import { create } from "../../src/core/ctx/index.ts";
import type { Call } from "../../src/core/ctx/index.ts";
import { argsInput, renderArgsView } from "../../src/core/engine/adapters.ts";
import { QwenEngine } from "../../src/core/models/qwen.ts";
import type { MCPTool } from "../../src/core/types.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const traceDir = flag("trace");
const N = Number(flag("n") ?? "8");
const STEP = flag("step"); // texto del paso de reapertura; con `--only-reopen` solo se mide ese paso
const ONLY_REOPEN = argv.includes("--only-reopen");
if (traceDir === undefined) {
  console.error("Uso: npx tsx eval/exp/write_reads.ts --trace=<carpeta de la traza> [--n=8]");
  process.exit(2);
}

interface SnapCall { id: string; stepId: string; route: string; tool: string; kind: "read" | "write"; status: string; verdict: string | null; args: Record<string, unknown> | null; summary: string | null }
interface Snap { task: { request: string }; steps: { id: string; instruction: string | null }[]; calls: SnapCall[] }
const full = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(traceDir, "full.json.gz"))).toString("utf8")) as { snapshot: Snap };
const snap = full.snapshot;

/** El contexto hasta justo antes de escribir: los pasos s1 a s4 hechos, sus lecturas aprobadas y el paso de redactar en curso. */
const ctx = create.context(
  { id: "exp", request: snap.task.request, mode: "reactive" },
  { now: () => 1_700_000_000_000, summaryMax: BUDGET.summaryMax, argsStringMax: BUDGET.argsStringDefault, factValueMax: BUDGET.factValueMax, feedbackMax: BUDGET.feedbackMax, jsonMaxDepth: BUDGET.jsonMaxDepth },
);
const writeStep = snap.steps.find((s) => (s.instruction ?? "").startsWith("Redactar"));
if (writeStep === undefined) throw new Error("la traza no tiene el paso de redactar");
const idMap = new Map<string, string>();
for (const s of snap.steps) {
  if (s.id === writeStep.id) break;
  const id = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: s.instruction ?? "", route: null, expected: null } }).ids[0];
  idMap.set(s.id, id);
  ctx.apply({ op: "update", target: id, value: { state: "completed" } });
}
const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: writeStep.instruction ?? "", route: null, expected: null } }).ids[0];
const readIds: string[] = [];
for (const c of snap.calls.filter((x) => x.kind === "read" && x.status === "ok" && x.verdict === "approved" && idMap.has(x.stepId))) {
  const id = ctx.apply({ op: "add", target: "calls", value: { stepId: idMap.get(c.stepId)!, route: c.route, tool: c.tool, kind: "read", args: c.args ?? {}, sig: c.id, status: "ok", summary: c.summary, ref: null } as Omit<Call, "id" | "at" | "verdict" | "reason"> }).ids[0];
  ctx.apply({ op: "update", target: id, value: { verdict: "approved", reason: null } });
  readIds.push(id);
}

const tool: MCPTool = {
  name: "write_file",
  description: "Create a text file or write content to it.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Absolute file path or ~ relative path." }, content: { type: "string", description: "Text to write into the file." }, mode: { type: "string", enum: ["rewrite", "append", "create_only"], description: "'rewrite' (default) replaces the file, 'append' adds at the end, 'create_only' fails if the file exists." }, createFolders: { type: "boolean", description: "Create missing parent folders (default false)." } },
    required: ["path", "content"],
  },
} as MCPTool;
const environment = { platform: "windows" as const, home: "C:\\Users\\usuario", desktop: "C:\\Users\\usuario\\Desktop", documents: "C:\\Users\\usuario\\Documents", downloads: "C:\\Users\\usuario\\Downloads" };
const engine = new QwenEngine(() => ConfigManager.getConfig());

async function run(label: string, ids: readonly string[] | undefined, expectAppend = false): Promise<void> {
  const rendered = renderArgsView(ctx, "write_file", ids);
  let cheap = 0, missing = 0, ok = 0, append = 0;
  const modes: Record<string, number> = {};
  const sizes: number[] = [];
  for (let i = 0; i < N; i++) {
    const res = await engine.generateArgumentsFromView(argsInput(tool, environment, rendered.text, i % 3));
    const content = typeof res.args.content === "string" ? res.args.content : "";
    ok++;
    if (res.args.mode === "append") append++;
    modes[String(res.args.mode ?? "(sin mode)")] = (modes[String(res.args.mode ?? "(sin mode)")] ?? 0) + 1;
    if (/126\.000/.test(content)) cheap++;
    if (/pasajes[^\n]*no disponible|no se encontr\w+ (datos|informaci\w+)[^\n]*pasaj/i.test(content)) missing++;
    sizes.push(content.length);
  }
  console.log(`${label.padEnd(34)} vista ${String(rendered.chars).padStart(6)} car. | corridas ${ok} | incluye $126.000 (pasajes): ${cheap}/${ok} | dice «no disponible» de pasajes: ${missing}/${ok} | content medio ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)} car.${expectAppend ? ` | mode append: ${append}/${ok} ${JSON.stringify(modes)}` : ""}`);
}

if (!ONLY_REOPEN) {
  console.log(`lecturas de la tarea: ${readIds.length}; ventana de hoy: ${BUDGET.caps.lastReads}`);
  await run("hoy (últimas 3 lecturas)", undefined);
  await run("todas las lecturas", readIds);
}

// El paso de reapertura (hueco de un requisito) con el texto de `deliverItem`.
const done = ctx.find("steps", { id: stepId })[0];
if (done !== undefined) ctx.apply({ op: "update", target: stepId, value: { state: "completed" } });
ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: STEP ?? "Add to the file C:/Users/usuario/Desktop/jarvis/viaje_mendoza.md the information found about: Obtener información sobre pasajes aéreos o terrestres desde Santa Fe a Mendoza. Keep the existing content and write only what is missing.", route: null, expected: null } });
await run("paso de reapertura (todas las lecturas)", readIds, true);
