/**
 * eval/exp/close_check.ts
 *
 * Experimento (no es una etapa): ¿cómo decidir que el pedido ya está completo, sin la llamada generativa de confirmación de `pending`?
 *   A1/A2  `request_done` como tercera pregunta de D4 en el último ítem (`d4_prod_hint` sobre el D4 de prod; `d4_request_done` sobre d4_recent_hints).
 *   D1/D2  consulta propia a Decisión (una pregunta `noul`) con la vista de `pending` (REQUEST, STATE, USER, DONE completo, FAIL).
 *   C      la confirmación de hoy: `pending` generativo con la lista vacía (vacía = completo).
 * Casos nuevos y difíciles, escritos a mano: 18 completos y 18 con una parte que falta (a veces sutil).
 * Uso: npx tsx eval/exp/close_check.ts [--only=A1,D1]
 */
import fs from "node:fs";
import { PROMPTS } from "../../src/core/models/prompts.ts";
import { ConfigManager } from "../../src/core/config.ts";
import { createDecisionClient } from "../core/client/decision.ts";
import { createGenerativeClient } from "../core/client/generative.ts";
import { materializeScenario } from "../core/scenario.ts";
import { parseAnswers } from "../core/variants/labels.ts";
import { parseJsonObject } from "../core/contract.ts";
import { DEFAULT_DECISION_MODEL, DEFAULT_DECISION_URL } from "../core/config.ts";
import d4_prod_hint from "../variants/d4/d4_prod_hint.ts";
import d4_request_done from "../variants/d4/d4_request_done.ts";

const ONLY = (process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "").split(",").filter(Boolean);
const CONC = 2;

// ───────── Casos ─────────
interface Call { s: number; route: string; tool: string; args: Record<string, unknown>; summary: string; kind?: "read" | "write" }
interface Case { id: string; done: boolean; request: string; steps: string[]; calls: Call[] }
const T = (s: number, command: string, summary: string, kind: "read" | "write" = "read"): Call => ({ s, route: "terminal", tool: "run_command", args: { command, timeout_ms: 10000 }, summary, kind });
const R = (s: number, path: string, summary: string): Call => ({ s, route: "files", tool: "read_file", args: { path }, summary });
const W = (s: number, path: string, content: string, summary: string): Call => ({ s, route: "files", tool: "write_file", args: { path, content, mode: "rewrite" }, summary, kind: "write" });
const WS = (s: number, need: string, summary: string): Call => ({ s, route: "web", tool: "web_search", args: { need }, summary });
const D = "C:/Users/hugof/";

const CASES: Case[] = [
  // ── completos
  { id: "y01", done: true, request: "decime cuántas líneas tiene informe.txt de Documents y cuántas están vacías", steps: ["Contar las líneas totales y las vacías de informe.txt"],
    calls: [T(0, `$l = Get-Content ${D}Documents/informe.txt; $l.Count; ($l | Where-Object { $_ -eq '' }).Count`, "120\n14")] },
  { id: "y02", done: true, request: "sumá los números de a.txt y b.txt de Documents y guardá el total en total.txt", steps: ["Leer los números de a.txt y b.txt", "Guardar el total en total.txt"],
    calls: [R(0, `${D}Documents/a.txt`, "12"), R(0, `${D}Documents/b.txt`, "30"), W(1, `${D}Documents/total.txt`, "42", `Wrote 2 chars to ${D}Documents/total.txt`)] },
  { id: "y03", done: true, request: "listá los PDF de Downloads y decime cuántos son", steps: ["Listar los PDF de Downloads y contarlos"],
    calls: [T(0, `Get-ChildItem ${D}Downloads -Filter *.pdf | Select-Object -ExpandProperty Name`, "factura-octubre.pdf\ncontrato.pdf\nmanual.pdf")] },
  { id: "y04", done: true, request: "buscá en la web cuál es la capital de Australia y guardala en capital.txt en el escritorio", steps: ["Averiguar la capital de Australia", "Guardar la capital en capital.txt en el escritorio"],
    calls: [WS(0, "capital de Australia", "Canberra es la capital de Australia (fuente: Encyclopaedia Britannica)."), W(1, `${D}Desktop/capital.txt`, "Canberra", `Wrote 8 chars to ${D}Desktop/capital.txt`)] },
  { id: "y05", done: true, request: "mové reporte.docx de Downloads a Documents", steps: ["Mover reporte.docx de Downloads a Documents"],
    calls: [T(0, `Move-Item ${D}Downloads/reporte.docx ${D}Documents/; Test-Path ${D}Documents/reporte.docx; Test-Path ${D}Downloads/reporte.docx`, "True\nFalse", "write")] },
  { id: "y06", done: true, request: "si existe backup.zip en el escritorio decime cuánto pesa, y si no existe creá una carpeta Backup en Documents", steps: ["Comprobar si existe backup.zip en el escritorio", "Crear la carpeta Backup en Documents"],
    calls: [T(0, `Test-Path ${D}Desktop/backup.zip`, "False"), T(1, `New-Item -ItemType Directory ${D}Documents/Backup | Out-Null; Test-Path ${D}Documents/Backup`, "True", "write")] },
  { id: "y07", done: true, request: "si existe contrato.docx en Documents convertilo a pdf, y si no existe avisame", steps: ["Comprobar si existe contrato.docx en Documents"],
    calls: [T(0, `Test-Path ${D}Documents/contrato.docx`, "False")] },
  { id: "y08", done: true, request: "renombrá foto1.jpg, foto2.jpg y foto3.jpg del escritorio a vacaciones_1.jpg, vacaciones_2.jpg y vacaciones_3.jpg", steps: ["Renombrar las tres fotos del escritorio"],
    calls: [T(0, `Rename-Item ${D}Desktop/foto1.jpg vacaciones_1.jpg; Rename-Item ${D}Desktop/foto2.jpg vacaciones_2.jpg; Rename-Item ${D}Desktop/foto3.jpg vacaciones_3.jpg; Get-ChildItem ${D}Desktop -Filter vacaciones_*.jpg | Select-Object -ExpandProperty Name`, "vacaciones_1.jpg\nvacaciones_2.jpg\nvacaciones_3.jpg", "write")] },
  { id: "y09", done: true, request: "comparame la versión de package.json de app1 y app2 en Documents", steps: ["Leer la versión de package.json de app1", "Leer la versión de package.json de app2"],
    calls: [R(0, `${D}Documents/app1/package.json`, '{"name":"app1","version":"1.4.0"}'), R(1, `${D}Documents/app2/package.json`, '{"name":"app2","version":"1.6.2"}')] },
  { id: "y10", done: true, request: "abrí el bloc de notas", steps: ["Abrir el Bloc de notas"],
    calls: [T(0, "Start-Process notepad; Start-Sleep 1; (Get-Process notepad).Count", "1", "write")] },
  { id: "y11", done: true, request: "fijate qué versión de Node tengo instalada y si es la última LTS", steps: ["Obtener la versión de Node instalada", "Averiguar la última versión LTS de Node"],
    calls: [T(0, "node --version", "v18.19.0"), WS(1, "última versión LTS de Node.js", "La última LTS de Node.js es la 22.11.0 (Jod), publicada en octubre de 2024.")] },
  { id: "y12", done: true, request: "creá la carpeta Proyectos en Documents y dentro un archivo README.md con el título '# Proyectos'", steps: ["Crear la carpeta Proyectos en Documents", "Crear README.md con el título en Proyectos"],
    calls: [{ s: 0, route: "files", tool: "create_directory", args: { path: `${D}Documents/Proyectos` }, summary: `Successfully created directory ${D}Documents/Proyectos`, kind: "write" }, W(1, `${D}Documents/Proyectos/README.md`, "# Proyectos", `Wrote 12 chars to ${D}Documents/Proyectos/README.md`)] },
  { id: "y13", done: true, request: "borrá los archivos .tmp de C:/Users/hugof/Documents/app/temp", steps: ["Borrar los .tmp de la carpeta temp", "Comprobar que ya no quedan .tmp"],
    calls: [T(0, `Remove-Item ${D}Documents/app/temp/*.tmp -Verbose`, "VERBOSE: Performing the operation \"Remove File\" on 3 items (a.tmp, b.tmp, c.tmp)", "write"), T(1, `(Get-ChildItem ${D}Documents/app/temp -Filter *.tmp).Count`, "0")] },
  { id: "y14", done: true, request: "cuánto pesa la carpeta Downloads", steps: ["Calcular el tamaño de la carpeta Downloads"],
    calls: [T(0, `'{0:N2} GB' -f ((Get-ChildItem ${D}Downloads -Recurse -File | Measure-Object Length -Sum).Sum / 1GB)`, "1.84 GB")] },
  { id: "y15", done: true, request: "compilá el proyecto de Documents/app con npm run build y decime si compila", steps: ["Compilar el proyecto con npm run build"],
    calls: [T(0, `Set-Location ${D}Documents/app; npm run build`, "> app@1.0.0 build\n> tsc -p .\n\n(exit code 0)")] },
  { id: "y16", done: true, request: "leé ventas.csv de Descargas y guardá en ventas_resumen.txt el total por vendedor", steps: ["Leer ventas.csv", "Guardar el total por vendedor en ventas_resumen.txt"],
    calls: [R(0, `${D}Downloads/ventas.csv`, "vendedor,monto\nAna,100\nLuis,50\nAna,25\nLuis,70"), W(1, `${D}Downloads/ventas_resumen.txt`, "Ana: 125\nLuis: 120", `Wrote 20 chars to ${D}Downloads/ventas_resumen.txt`)] },
  { id: "y17", done: true, request: "mostrame las últimas 30 líneas del log C:/Users/hugof/Documents/logs/app.log y decime si hay errores", steps: ["Leer las últimas 30 líneas de app.log"],
    calls: [T(0, `Get-Content ${D}Documents/logs/app.log -Tail 30`, "2026-11-12 10:01 INFO start\n2026-11-12 10:02 ERROR db timeout\n2026-11-12 10:02 INFO retry\n... (30 líneas)")] },
  { id: "y18", done: true, request: "hacé ping a google.com y decime si tengo internet", steps: ["Hacer ping a google.com"],
    calls: [T(0, "ping -n 2 google.com", "Reply from 142.250.78.14: bytes=32 time=18ms TTL=117\nReply from 142.250.78.14: bytes=32 time=17ms TTL=117\nPackets: Sent = 2, Received = 2, Lost = 0")] },
  // ── con una parte que falta
  { id: "n01", done: false, request: "decime cuántas líneas tiene informe.txt de Documents y cuántas están vacías", steps: ["Contar las líneas de informe.txt"],
    calls: [T(0, `(Get-Content ${D}Documents/informe.txt).Count`, "120")] },
  { id: "n02", done: false, request: "sumá los números de a.txt y b.txt de Documents y guardá el total en total.txt", steps: ["Leer los números de a.txt y b.txt"],
    calls: [R(0, `${D}Documents/a.txt`, "12"), R(0, `${D}Documents/b.txt`, "30")] },
  { id: "n03", done: false, request: "listá los archivos PDF y los DOCX de Downloads", steps: ["Listar los PDF de Downloads"],
    calls: [T(0, `Get-ChildItem ${D}Downloads -Filter *.pdf | Select-Object -ExpandProperty Name`, "factura-octubre.pdf\ncontrato.pdf")] },
  { id: "n04", done: false, request: "buscá en la web cuál es la capital de Australia y guardala en capital.txt en el escritorio", steps: ["Averiguar la capital de Australia"],
    calls: [WS(0, "capital de Australia", "Canberra es la capital de Australia (fuente: Encyclopaedia Britannica).")] },
  { id: "n05", done: false, request: "mové reporte.docx de Downloads a Documents", steps: ["Pasar reporte.docx de Downloads a Documents"],
    calls: [T(0, `Copy-Item ${D}Downloads/reporte.docx ${D}Documents/; Test-Path ${D}Documents/reporte.docx`, "True", "write")] },
  { id: "n06", done: false, request: "si existe backup.zip en el escritorio decime cuánto pesa, y si no existe creá una carpeta Backup en Documents", steps: ["Comprobar si existe backup.zip en el escritorio"],
    calls: [T(0, `Test-Path ${D}Desktop/backup.zip`, "False")] },
  { id: "n07", done: false, request: "renombrá foto1.jpg, foto2.jpg y foto3.jpg del escritorio a vacaciones_1.jpg, vacaciones_2.jpg y vacaciones_3.jpg", steps: ["Renombrar las fotos del escritorio"],
    calls: [T(0, `Rename-Item ${D}Desktop/foto1.jpg vacaciones_1.jpg; Rename-Item ${D}Desktop/foto2.jpg vacaciones_2.jpg; Get-ChildItem ${D}Desktop -Filter vacaciones_*.jpg | Select-Object -ExpandProperty Name`, "vacaciones_1.jpg\nvacaciones_2.jpg", "write")] },
  { id: "n08", done: false, request: "comparame la versión de package.json de app1 y app2 en Documents", steps: ["Leer la versión de package.json de app1"],
    calls: [R(0, `${D}Documents/app1/package.json`, '{"name":"app1","version":"1.4.0"}')] },
  { id: "n09", done: false, request: "creá la carpeta Proyectos en Documents y dentro un archivo README.md con el título '# Proyectos'", steps: ["Crear la carpeta Proyectos en Documents"],
    calls: [{ s: 0, route: "files", tool: "create_directory", args: { path: `${D}Documents/Proyectos` }, summary: `Successfully created directory ${D}Documents/Proyectos`, kind: "write" }] },
  { id: "n10", done: false, request: "borrá los archivos .tmp de C:/Users/hugof/Documents/app/temp", steps: ["Ver los .tmp de la carpeta temp"],
    calls: [T(0, `Get-ChildItem ${D}Documents/app/temp -Filter *.tmp | Select-Object -ExpandProperty Name`, "a.tmp\nb.tmp\nc.tmp")] },
  { id: "n11", done: false, request: "fijate qué versión de Node tengo instalada y si es la última LTS", steps: ["Obtener la versión de Node instalada"],
    calls: [T(0, "node --version", "v18.19.0")] },
  { id: "n12", done: false, request: "leé ventas.csv de Descargas y guardá en ventas_resumen.txt el total por vendedor", steps: ["Leer ventas.csv"],
    calls: [R(0, `${D}Downloads/ventas.csv`, "vendedor,monto\nAna,100\nLuis,50\nAna,25\nLuis,70")] },
  { id: "n13", done: false, request: "instalá las dependencias del proyecto en Documents/app y corré los tests", steps: ["Instalar las dependencias del proyecto"],
    calls: [T(0, `Set-Location ${D}Documents/app; npm install`, "added 214 packages in 9s", "write")] },
  { id: "n14", done: false, request: "buscá noticias de hoy sobre inteligencia artificial y guardá un resumen en Documents/noticias.md", steps: ["Buscar noticias de hoy sobre inteligencia artificial"],
    calls: [WS(0, "noticias de hoy sobre inteligencia artificial", "1) Nueva ley de IA aprobada en la UE. 2) Un laboratorio presentó un modelo multimodal. 3) Se anunció un acuerdo de chips.")] },
  { id: "n15", done: false, request: "escribí en notas.txt del escritorio estas tres tareas: comprar pan, llamar a Ana y pagar la luz", steps: ["Guardar las tres tareas en notas.txt"],
    calls: [W(0, `${D}Desktop/notas.txt`, "comprar pan\nllamar a Ana", `Wrote 24 chars to ${D}Desktop/notas.txt`)] },
  { id: "n16", done: false, request: "convertí contrato.docx de Documents a pdf y después borrá el docx", steps: ["Convertir contrato.docx a pdf"],
    calls: [T(0, `soffice --headless --convert-to pdf ${D}Documents/contrato.docx --outdir ${D}Documents`, `convert ${D}Documents/contrato.docx -> ${D}Documents/contrato.pdf`, "write")] },
  { id: "n17", done: false, request: "descargá https://ejemplo.com/datos.zip a Descargas y decime cuánto pesa", steps: ["Descargar datos.zip a Descargas"],
    calls: [T(0, `Invoke-WebRequest https://ejemplo.com/datos.zip -OutFile ${D}Downloads/datos.zip; Test-Path ${D}Downloads/datos.zip`, "True", "write")] },
  { id: "n18", done: false, request: "ordená mi escritorio: los PDF a una carpeta PDFs y las imágenes a una carpeta Imagenes", steps: ["Mover los PDF del escritorio a la carpeta PDFs"],
    calls: [T(0, `New-Item -ItemType Directory ${D}Desktop/PDFs -Force | Out-Null; Move-Item ${D}Desktop/*.pdf ${D}Desktop/PDFs/; (Get-ChildItem ${D}Desktop/PDFs).Count`, "4", "write")] },
];

// ───────── Armado de escenarios ─────────
function scenario(c: Case, mode: "verify" | "after") {
  const n = c.steps.length;
  const steps = c.steps.map((instruction, i) => ({ instruction, state: mode === "verify" && i === n - 1 ? "running" : "completed" }));
  const calls = c.calls.map((x, k) => {
    const last = k === c.calls.length - 1;
    return { step: x.s, route: x.route, tool: x.tool, kind: x.kind ?? "read", status: "ok", args: x.args, summary: x.summary, ...(mode === "verify" && last ? {} : { verdict: "approved" }) };
  });
  return { mode: "reactive", request: c.request, steps, calls, ...(mode === "verify" ? { at: { lastItem: true } } : { at: { previous: [] } }) };
}

const cfg = ConfigManager.getConfig() as any;
const dec = createDecisionClient({ url: DEFAULT_DECISION_URL, model: DEFAULT_DECISION_MODEL });
const gen = createGenerativeClient({ url: cfg.qwenUrl, model: cfg.qwenModel });

const D_QUESTION = {
  type: "noul" as const,
  instructions: "Using only what DONE shows, is every part of REQUEST already done? False if any part is missing or was never done.",
  criteria: { true: "Every part of the REQUEST is done.", false: "Some part of the REQUEST is missing or not done yet." },
};
const D2_QUESTION = {
  type: "noul" as const,
  instructions:
    "Check each part of REQUEST against DONE: every target and every item of a list, the quantity, the exact values written, and any final action (save, delete, report). Is every part of REQUEST done?",
  criteria: {
    true: "Every part of REQUEST is shown as done in DONE, with the right targets and values.",
    false: "A part is missing: a target, an item, a value, a save or delete, or only a read or copy where a change was requested.",
  },
};

interface Res { p: number | null; ms: number; tokens: number }
const noulOf = (raw: string, key: string): number | null => {
  try { const v: any = parseAnswers(raw)[key]; const x = v?.noul ?? v?.value ?? null; return typeof x === "number" ? x : null; } catch { return null; }
};
async function callDecision(state: string, questions: Record<string, unknown>, key: string): Promise<Res & { all?: Record<string, number | null> }> {
  const req: any = { type: "decision", state, questions };
  const r = await dec.call(req, 60000);
  if (!r.ok) return { p: null, ms: r.durationMs, tokens: 0 };
  const all: Record<string, number | null> = {};
  for (const k of Object.keys(questions)) all[k] = noulOf(r.rawOutput, k);
  return { p: all[key] ?? null, ms: r.durationMs, tokens: r.tokens.prompt, all };
}

async function methodA(c: Case, variant: any, key = "request_done"): Promise<Res & { all?: any }> {
  const m = materializeScenario("result_verification", scenario(c, "verify") as never, variant);
  const req: any = m.request;
  return callDecision(req.state, req.questions, key);
}
async function methodD(c: Case, q: unknown): Promise<Res> {
  const m = materializeScenario("pending", scenario(c, "after") as never, undefined);
  const req: any = m.request;
  return callDecision(req.user, { complete: q }, "complete");
}
async function methodC(c: Case): Promise<Res & { empty: boolean | null }> {
  const m = materializeScenario("pending", scenario(c, "after") as never, undefined);
  const r: any = m.request;
  const res = await gen.call(r, 120000);
  if (!res.ok) return { p: null, ms: res.durationMs, tokens: 0, empty: null };
  const list = (parseJsonObject(res.rawOutput) as any)?.pending;
  return { p: null, ms: res.durationMs, tokens: res.tokens?.prompt ?? 0, empty: Array.isArray(list) ? list.length === 0 : null };
}

async function pool<T>(xs: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) await fn(xs[i++]); }));
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);

const run: Record<string, (c: Case) => Promise<any>> = {
  A1: (c) => methodA(c, d4_prod_hint),
  A2: (c) => methodA(c, d4_request_done),
  D1: (c) => methodD(c, D_QUESTION),
  D2: (c) => methodD(c, D2_QUESTION),
  C: (c) => methodC(c),
  // D4 de prod con 2 preguntas (sin request_done): línea base de costo e interferencia
  P2: (c) => methodA(c, undefined, "cumple"),
};
const out: any = { when: new Date().toISOString(), cases: CASES.map((c) => ({ id: c.id, done: c.done })), methods: {} };

for (const name of Object.keys(run)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const res: Record<string, any> = {};
  await pool(CASES, CONC, async (c) => { res[c.id] = await run[name](c); });
  out.methods[name] = res;
  const rows = CASES.map((c) => ({ c, r: res[c.id] }));
  const ms = rows.map((x) => x.r.ms), tk = rows.map((x) => x.r.tokens);
  if (name === "C") {
    const ok = rows.filter((x) => x.r.empty === x.c.done).length;
    const falseYes = rows.filter((x) => !x.c.done && x.r.empty === true).map((x) => x.c.id);
    const falseNo = rows.filter((x) => x.c.done && x.r.empty === false).map((x) => x.c.id);
    console.log(`\n== C (confirmación de hoy: lista vacía = completo)  acierto ${ok}/36  ms ${Math.round(mean(ms))}  tokens prompt ${Math.round(mean(tk))}`);
    console.log("  falso sí (cerraría incompleta):", falseYes.join(" ") || "-", "| falso no:", falseNo.join(" ") || "-");
    continue;
  }
  if (name === "P2") {
    console.log(`\n== P2 (D4 prod, 2 preguntas, último ítem)  ms ${Math.round(mean(ms))}  tokens prompt ${Math.round(mean(tk))}`);
    continue;
  }
  const yes = rows.filter((x) => x.c.done).map((x) => x.r.p).filter((p): p is number => p !== null);
  const no = rows.filter((x) => !x.c.done).map((x) => x.r.p).filter((p): p is number => p !== null);
  const minYes = Math.min(...yes), maxNo = Math.max(...no);
  const at = (t: number) => ({
    acierto: rows.filter((x) => x.r.p !== null && (x.r.p >= t) === x.c.done).length,
    falso_si: rows.filter((x) => !x.c.done && x.r.p !== null && x.r.p >= t).map((x) => x.c.id),
    falso_no: rows.filter((x) => x.c.done && (x.r.p === null || x.r.p < t)).map((x) => x.c.id),
  });
  console.log(`\n== ${name}  ms ${Math.round(mean(ms))}  tokens prompt ${Math.round(mean(tk))}  | sí: mín ${minYes.toFixed(2)} media ${mean(yes).toFixed(2)} | no: máx ${maxNo.toFixed(2)} media ${mean(no).toFixed(2)} | margen (mín sí − máx no) ${(minYes - maxNo).toFixed(2)}`);
  for (const t of [0.6, 0.75, 0.9]) { const a = at(t); console.log(`  umbral ${t}: acierto ${a.acierto}/36  falso sí [${a.falso_si.join(" ")}]  falso no [${a.falso_no.join(" ")}]`); }
  if (name === "A1" || name === "A2") {
    // interferencia: ok/cumple con la tercera pregunta frente al D4 de prod (2 preguntas)
    out.methods[name + "_all"] = true;
  }
}
// interferencia sobre ok/cumple (A1 y A2 contra P2)
for (const name of ["A1", "A2"]) {
  const m = out.methods[name], base = out.methods.P2;
  if (!m || !base) continue;
  let flips = 0, dsum = 0, n = 0;
  for (const c of CASES) {
    for (const k of ["ok", "cumple"]) {
      const a = m[c.id].all?.[k], b = base[c.id].all?.[k];
      if (typeof a !== "number" || typeof b !== "number") continue;
      n++; dsum += Math.abs(a - b);
      if ((a >= 0.6) !== (b >= 0.6)) flips++;
    }
  }
  console.log(`\ninterferencia ${name} vs D4 de 2 preguntas: ${flips}/${n} respuestas ok/cumple cambian de lado (0.6); |Δp| medio ${(dsum / Math.max(n, 1)).toFixed(3)}`);
}
fs.mkdirSync("eval/results/_exp", { recursive: true });
const file = `eval/results/_exp/close_check_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log("\nguardado:", file);
