/**
 * Una tarea real de punta a punta con la configuración de `jarvis-config.json` (incluidos `autoMode` y `approvalTiers`), en una carpeta de inicio TEMPORAL con la
 * misma forma que la del usuario (Desktop, Documents, Downloads y `Desktop\jarvis`), para repetir un pedido sin tocar sus carpetas. Imprime las consultas a los modelos
 * (con el tiempo desde el inicio), las llamadas con su veredicto, las confirmaciones pedidas y la respuesta.
 *
 *   npx tsx scripts/validate/rerun_task.ts "Crea un md dentro de la carpeta jarvis con la informacion que sepas de gpt"
 *   npx tsx scripts/validate/rerun_task.ts "Creá gpt.md en {home}\proyectos"   # {home} = la carpeta de inicio temporal
 *   npx tsx scripts/validate/rerun_task.ts "<pedido>" --tiers=false      # compara con la aprobación por niveles apagada
 *   npx tsx scripts/validate/rerun_task.ts "<pedido>" --auto=false       # sin autoMode (el arnés aprueba las confirmaciones)
 *
 * Necesita Ollama con los modelos de la configuración, `uvx` (Free Search) y red. Windows.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { JarvisConfig } from "../../src/core/config.ts";
import { ConfigManager } from "../../src/core/config.ts";
import { createEngineServices } from "../../src/core/engine/services.ts";
import { DesktopCommanderMCPServer } from "../../src/core/mcp/desktopCommanderMcp.ts";
import { DiscoveryEngine } from "../../src/core/mcp/discovery.ts";
import { FreeSearchMCPServer } from "../../src/core/mcp/freeSearchMcp.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";
import { QwenEngine } from "../../src/core/models/qwen.ts";
import { TaskManager } from "../../src/core/tasks.ts";
import type { ToolProvider } from "../../src/core/tools/provider.ts";
import { TerminalProvider } from "../../src/tools/terminal/terminalProvider.ts";
import { WebSearchProvider } from "../../src/tools/web/webSearchProvider.ts";

const rawMessage = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (rawMessage === undefined) {
  console.error('Uso: npx tsx scripts/validate/rerun_task.ts "<pedido>" [--tiers=false] [--auto=false]');
  process.exit(1);
}
const flag = (name: string): boolean | undefined => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return raw === undefined ? undefined : raw !== "false";
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-rerun-"));
const home = path.join(root, "home");
for (const folder of ["Desktop", "Documents", "Downloads", path.join("Desktop", "jarvis")]) fs.mkdirSync(path.join(home, folder), { recursive: true });
// `{home}` en el pedido se reemplaza por la carpeta de inicio temporal (para nombrar una carpeta que no existe sin tocar las del usuario).
const message = rawMessage.replaceAll("{home}", home);
const environment = { platform: "windows" as const, home, desktop: path.join(home, "Desktop"), documents: path.join(home, "Documents"), downloads: path.join(home, "Downloads") };

const base = ConfigManager.getConfig();
const getConfig = (): JarvisConfig => ({
  ...base,
  autoMode: flag("auto") ?? base.autoMode,
  approvalTiers: flag("tiers") ?? base.approvalTiers,
  traceEnabled: true,
  tracePath: path.join(root, "traces"),
  refsDir: path.join(root, "refs"),
});

const decision = new Decision20Engine(getConfig);
const providers: ToolProvider[] = [
  new DesktopCommanderMCPServer(getConfig),
  new FreeSearchMCPServer(getConfig),
  new TerminalProvider(),
  new WebSearchProvider({ judge: () => undefined }),
];
const services = { ...createEngineServices(getConfig), environment: async () => environment };
const tasks = new TaskManager({ decision, discovery: new DiscoveryEngine(providers), llm: new QwenEngine(getConfig) }, getConfig, services);

const events: string[] = [];
tasks.addEventListener((event) => {
  if (event.type !== "waiting" || event.waiting === null) return;
  const w = event.waiting;
  if (w.kind === "approval") {
    events.push(`CONFIRMACIÓN (se aprueba): ${w.request.tool} ${JSON.stringify(w.request.args).slice(0, 120)} — ${w.request.reason}`);
    queueMicrotask(() => tasks.approveCall(event.taskId, w.request.id));
  } else if (w.kind === "question") {
    events.push(`PREGUNTA: ${w.question.question}`);
    queueMicrotask(() => tasks.answer(event.taskId, "la de Desktop\\jarvis"));
  } else if (w.kind === "plan") {
    queueMicrotask(() => tasks.approvePlan(event.taskId, w.request.id));
  }
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

try {
  console.log(`(autoMode ${getConfig().autoMode}, approvalTiers ${getConfig().approvalTiers}, home temporal ${home})`);
  const started = Date.now();
  const id = tasks.start(message, "reactive").task.id;
  let snap = tasks.get(id);
  while (Date.now() - started < 170_000) {
    await sleep(300);
    snap = tasks.get(id);
    if (snap !== null && snap.task.state !== "running") break;
  }
  await tasks.drain(8000);
  await sleep(1500);
  snap = tasks.get(id);
  if (snap === null) throw new Error("la tarea desapareció");
  console.log(`\n==== ${message}\nestado: ${snap.task.state}${snap.task.stopReason === null ? "" : ` (${snap.task.stopReason})`} en ${Math.round((Date.now() - started) / 100) / 10} s`);
  for (const line of events) console.log(`  evento: ${line}`);
  for (const s of snap.steps) console.log(`  paso ${s.id} [${s.state}] ${JSON.stringify(s.instruction).slice(0, 110)}`);
  for (const c of snap.calls) {
    const verdict = c.verdict === null ? "" : `/${c.verdict}${c.reason === null ? "" : `/${c.reason}`}`;
    console.log(`  llamada ${c.id} ${c.tool} ${JSON.stringify(c.args).slice(0, 150)} → ${c.status}${verdict}  « ${String(c.summary ?? "").replace(/\s+/g, " ").slice(0, 110)} »`);
  }
  console.log(`  respuesta: ${JSON.stringify(snap.result ?? "(sin respuesta)").slice(0, 400)}`);
  console.log("  archivos en el inicio temporal:");
  const walk = (dir: string, depth = 0): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      console.log(`    ${"  ".repeat(depth)}${path.relative(home, path.join(dir, e.name))}${e.isDirectory() ? "\\" : ""}`);
      if (e.isDirectory() && depth < 3) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(home);
  // Las consultas a los modelos, de la traza que escribió el motor.
  const traces = path.join(root, "traces");
  const folder = fs.existsSync(traces) ? fs.readdirSync(traces).filter((n) => n !== "index.jsonl")[0] : undefined;
  if (folder !== undefined) {
    const trace = JSON.parse(fs.readFileSync(path.join(traces, folder, "trace.json"), "utf8")) as { queries: { seq: number; stage: string; startedAt: number; durationMs: number; output: unknown }[] };
    const t0 = trace.queries[0]?.startedAt ?? 0;
    console.log("  consultas:");
    for (const q of trace.queries) console.log(`    ${String(q.seq).padStart(2)} ${String(q.startedAt - t0).padStart(6)}ms ${q.stage.padEnd(12)} ${String(q.durationMs).padStart(5)}ms ${JSON.stringify(q.output).slice(0, 120)}`);
  }
} finally {
  tasks.cancelAll();
  await tasks.drain(4000);
  for (const provider of providers) await provider.close?.();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(0);
}
