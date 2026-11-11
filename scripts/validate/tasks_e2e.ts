/**
 * Tareas reales de punta a punta: compone los servicios igual que `server.ts` (Desktop Commander, Free Search, `run_command`, `web_search`, los modelos de
 * Ollama y el `TaskManager`), lanza pedidos en lenguaje natural y muestra qué esperas hubo, qué llamadas se hicieron y qué respondió el modelo.
 *
 * Necesita: Ollama con los modelos de `jarvis-config.json` (`qwen3.5:4b` y `d3:2b`), `uvx` y red (Free Search) y Windows.
 *
 *   npx tsx scripts/validate/tasks_e2e.ts                    # los cinco pedidos
 *   npx tsx scripts/validate/tasks_e2e.ts --only=2           # solo el que empieza con "2"
 *   npx tsx scripts/validate/tasks_e2e.ts --only=2 --judge   # con el 2B puntuando los fragmentos de `web_search`
 *
 * Qué se encontró con este arnés está en `docs/REVISION_run_command.md` y `docs/REVISION_web_search.md`.
 *
 * Lo que fija el arnés: `autoMode` apagado (así se ven las confirmaciones), la traza apagada y las refs en una carpeta temporal. Las confirmaciones se
 * aprueban o rechazan según el pedido, y a una pregunta al usuario se responde con un texto fijo. Los pedidos 5 y 6 crean carpetas en `%TEMP%`; al final se borran.
 * Los registros de los modelos (`[Qwen …]`, `[Decision …]`) salen mezclados con el resumen: el resumen de cada tarea empieza en una línea de `====`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { JarvisConfig } from "../../src/core/config.ts";
import { ConfigManager } from "../../src/core/config.ts";
import { DesktopCommanderMCPServer } from "../../src/core/mcp/desktopCommanderMcp.ts";
import { DiscoveryEngine } from "../../src/core/mcp/discovery.ts";
import { FreeSearchMCPServer } from "../../src/core/mcp/freeSearchMcp.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";
import { QwenEngine } from "../../src/core/models/qwen.ts";
import { TaskManager } from "../../src/core/tasks.ts";
import type { ToolProvider } from "../../src/core/tools/provider.ts";
import { TerminalProvider } from "../../src/tools/terminal/terminalProvider.ts";
import { WebSearchProvider } from "../../src/tools/web/webSearchProvider.ts";

if (process.platform !== "win32") {
  console.error("Este arnés es para Windows (PowerShell).");
  process.exit(1);
}

const useJudge = process.argv.includes("--judge");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
const refsDir = path.join(os.tmpdir(), "jarvis-validate-refs");

const getConfig = (): JarvisConfig => ({
  ...ConfigManager.getConfig(),
  autoMode: false,
  traceEnabled: false,
  refsDir,
  webSearchUseJudge: useJudge,
});

const decision = new Decision20Engine(getConfig);
const providers: ToolProvider[] = [
  new DesktopCommanderMCPServer(getConfig),
  new FreeSearchMCPServer(getConfig),
  new TerminalProvider(),
  new WebSearchProvider({ judge: () => (getConfig().webSearchUseJudge ? decision : undefined) }),
];
const tasks = new TaskManager({ decision, discovery: new DiscoveryEngine(providers), llm: new QwenEngine(getConfig) }, getConfig);

interface Policy {
  /** Aprobar (`true`) o rechazar las confirmaciones. */
  readonly approve: boolean;
  /** Texto con el que se responde una pregunta al usuario. */
  readonly answer: string;
}

let policy: Policy = { approve: true, answer: "x" };
const events: string[] = [];

tasks.addEventListener((event) => {
  if (event.type !== "waiting" || event.waiting === null) return;
  const waiting = event.waiting;
  switch (waiting.kind) {
    case "plan":
      events.push("plan: aprobado");
      queueMicrotask(() => tasks.approvePlan(event.taskId, waiting.request.id));
      break;
    case "approval":
      events.push(`CONFIRMACIÓN ${policy.approve ? "(se aprueba)" : "(se rechaza)"}: ${waiting.request.tool} ${JSON.stringify(waiting.request.args).slice(0, 140)} — ${waiting.request.reason}`);
      queueMicrotask(() => (policy.approve ? tasks.approveCall(event.taskId, waiting.request.id) : tasks.denyCall(event.taskId, "no", waiting.request.id)));
      break;
    case "question":
      events.push(`PREGUNTA al usuario: ${waiting.question.question}  → se responde ${JSON.stringify(policy.answer)}`);
      queueMicrotask(() => tasks.answer(event.taskId, policy.answer));
      break;
  }
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function runTask(label: string, message: string, next: Policy): Promise<void> {
  policy = next;
  events.length = 0;
  const started = Date.now();
  const id = tasks.start(message, "reactive").task.id;
  let snapshot = tasks.get(id);
  while (Date.now() - started < 170_000) {
    await sleep(400);
    snapshot = tasks.get(id);
    if (snapshot !== null && snapshot.task.state !== "running") break;
  }
  await sleep(2500); // la respuesta final se escribe un instante después del cierre
  snapshot = tasks.get(id);
  if (snapshot === null) throw new Error(`la tarea ${id} desapareció`);

  console.log(`\n==================== ${label} (${Math.round((Date.now() - started) / 1000)} s)`);
  console.log(`pedido: ${message}`);
  console.log(`estado: ${snapshot.task.state}${snapshot.task.stopReason === null ? "" : ` (${snapshot.task.stopReason})`}`);
  for (const line of events) console.log(`  evento: ${line}`);
  for (const call of snapshot.calls) {
    const verdict = call.verdict === null ? "" : `/${call.verdict}${call.reason === null ? "" : `/${call.reason}`}`;
    const summary = call.summary === null ? "" : `  « ${call.summary.replace(/\s+/g, " ").slice(0, 120)} »`;
    console.log(`  llamada: ${call.tool} ${JSON.stringify(call.args).slice(0, 110)} → ${call.status}${verdict}${summary}`);
  }
  console.log(`  respuesta: ${JSON.stringify(snapshot.result ?? "(sin respuesta)").slice(0, 420)}`);
}

const requests: readonly [label: string, message: string, policy: Policy][] = [
  ["1 terminal de solo lectura", "¿Qué versión de Node.js tengo instalada en esta PC? Usá la terminal.", { approve: true, answer: "x" }],
  ["2 búsqueda en internet", "Buscá en internet en qué fecha se publicó Node.js 22.0.0 y decime la fecha.", { approve: true, answer: "x" }],
  ["3 proceso que espera entrada", "Ejecutá en PowerShell el comando: cmd /c pause. Avisame cuando termine.", { approve: true, answer: "ok" }],
  ["4 consulta con un secreto (se rechaza la confirmación)", "Buscá en internet qué es esto: sk-abcdefghijklmnopqrstuvwxyz1234567890", { approve: false, answer: "x" }],
  ["5 escritura: crear carpeta", "Creá una carpeta llamada jarvis_validacion en el directorio temporal del usuario (%TEMP%) usando la terminal.", { approve: true, answer: "x" }],
  [
    "6 escritura por la terminal (D1 puede elegir la ruta de archivos: RC-24)",
    String.raw`En PowerShell ejecutá exactamente: New-Item -ItemType Directory -Path $env:TEMP\jarvis_validacion2 -Force`,
    { approve: true, answer: "x" },
  ],
];

try {
  console.log(`(juez 2B de web_search: ${useJudge ? "ENCENDIDO" : "apagado"})`);
  for (const [label, message, next] of requests) {
    if (only !== undefined && !label.startsWith(only)) continue;
    await runTask(label, message, next);
  }
} finally {
  tasks.cancelAll();
  await tasks.drain(4000);
  for (const provider of providers) await provider.close?.();
  for (const leftover of ["jarvis_validacion", "jarvis_validacion2"]) fs.rmSync(path.join(os.tmpdir(), leftover), { recursive: true, force: true });
  fs.rmSync(refsDir, { recursive: true, force: true });
  process.exit(0);
}
