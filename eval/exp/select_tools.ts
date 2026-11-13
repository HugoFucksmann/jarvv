/**
 * eval/exp/select_tools.ts
 *
 * Experimento (no es una etapa): selección de ruta (D1) y de herramienta (D2) con distintas formulaciones, sobre casos nuevos.
 *   fase d1     : variantes de D1 sobre 48 instrucciones (terminal explícita e implícita, files, locate, web).
 *   fase d2     : variantes de D2 sobre 22 instrucciones dentro de `files` y `terminal`.
 *   fase chain  : solicitud -> `pending` (prompt actual o con regla de "respetar lo que el usuario dijo") -> D1.
 * Consulta directa al modelo de decisión (`/v1/systemone`): el estado y las preguntas se arman aquí, replicando los de producción en la variante `prod`.
 * Uso: npx tsx eval/exp/select_tools.ts [--phase=d1,d2,chain]
 */
import fs from "node:fs";
import { DECISION_PROMPTS, PROMPTS, shortDesc } from "../../src/core/models/prompts.ts";
import { DESTINATIONS, SYSTEM_TOOL_MANIFEST } from "../../src/core/tools/manifest.ts";
import { ConfigManager } from "../../src/core/config.ts";
import { createDecisionClient } from "../core/client/decision.ts";
import { createGenerativeClient } from "../core/client/generative.ts";
import { materializeScenario } from "../core/scenario.ts";
import { parseAnswers } from "../core/variants/labels.ts";
import { parseJsonObject } from "../core/contract.ts";
import { DEFAULT_DECISION_MODEL, DEFAULT_DECISION_URL } from "../core/config.ts";

const PHASES = (process.argv.find((a) => a.startsWith("--phase="))?.slice(8) ?? "d1,d2,chain").split(",");
const dec = createDecisionClient({ url: DEFAULT_DECISION_URL, model: DEFAULT_DECISION_MODEL });
const cfg = ConfigManager.getConfig() as any;
const gen = createGenerativeClient({ url: cfg.qwenUrl, model: cfg.qwenModel });

// ───────── Casos de D1 ─────────
type Route = "files" | "locate" | "terminal" | "web";
interface RCase { id: string; text: string; gold: Route; group: "terminal_explicita" | "terminal_implicita" | "files" | "locate" | "web" | "existente" }
const rc = (group: RCase["group"], gold: Route, items: string[]): RCase[] => items.map((text, i) => ({ id: `${{ terminal_explicita: "texp", terminal_implicita: "timp", files: "file", locate: "loca", web: "webb", existente: "exis" }[group]}${String(i + 1).padStart(2, "0")}`, text, gold, group }));
const RCASES: RCase[] = [
  ...rc("terminal_explicita", "terminal", [
    "ejecutá en la terminal: New-Item -ItemType Directory C:\\Temp\\rc_a -Force; Set-Content C:\\Temp\\rc_a\\hola.txt hola",
    "ejecutá en la terminal: robocopy C:\\Temp\\rc_a C:\\Temp\\rc_b /E",
    "corré en PowerShell: Get-ChildItem C:\\Users\\hugof\\Documents -Recurse -Filter *.log | Measure-Object",
    "en la terminal hacé git status en C:\\Users\\hugof\\dev\\portal",
    "ejecutá npm install en C:\\Users\\hugof\\dev\\api",
    "usá la consola para correr python script.py en el escritorio",
    "ejecutá en la terminal el comando: ipconfig /all",
    "run in the terminal: mkdir C:\\Temp\\demo; echo hi > C:\\Temp\\demo\\a.txt",
    "lanzá desde la terminal: Start-Process notepad",
    "ejecutá en la terminal: copy C:\\Temp\\a.txt C:\\Temp\\b.txt",
    "con PowerShell, creá la carpeta C:\\Temp\\logs y escribí 'ok' en C:\\Temp\\logs\\estado.txt",
    "ejecutá el comando dir C:\\Users\\hugof\\Downloads /s en la terminal",
    "corré en cmd: tasklist | findstr chrome",
    "ejecutá en la terminal: Remove-Item C:\\Temp\\viejo -Recurse -Force",
    "ejecutá en la terminal: Compress-Archive C:\\Temp\\rc_a C:\\Temp\\rc_a.zip",
    "usá la terminal para mover C:\\Temp\\a.txt a la carpeta C:\\Temp\\b",
  ]),
  ...rc("terminal_implicita", "terminal", [
    "abrí el bloc de notas",
    "cuánto pesa la carpeta Downloads",
    "mostrame los 5 archivos más grandes de Documents",
    "corré npm run build en C:\\Users\\hugof\\Documents\\app",
    "fijate cuántos GB libres tiene el disco C",
    "hacé ping a google.com",
    "qué procesos de Chrome hay abiertos",
    "decime la fecha y hora del sistema",
    "cuántos archivos modifiqué hoy en Documents",
    "instalá las dependencias del proyecto y corré los tests",
  ]),
  ...rc("files", "files", [
    "leé C:\\Users\\hugof\\Desktop\\notas.txt",
    "guardá el texto 'comprar pan' en C:\\Users\\hugof\\Desktop\\todo.txt",
    "creá la carpeta Proyectos en Documents",
    "mové reporte.docx de Downloads a Documents",
    "listá los archivos de C:\\Users\\hugof\\Documents",
    "renombrá foto1.jpg a vacaciones.jpg en el escritorio",
    "leé el README.md de C:\\Users\\hugof\\Documents\\app",
    "creá un Excel gastos.xlsx en Documents con las columnas Fecha, Concepto y Monto",
    "leé a.txt y b.txt de Desktop",
    "mostrame las últimas 30 líneas del log C:\\Users\\hugof\\Documents\\logs\\app.log",
  ]),
  ...rc("locate", "locate", [
    "buscá el archivo contrato.docx en mi PC",
    "buscá los archivos que mencionen 'Presupuesto' dentro de Documents",
    "dónde está el archivo facturas_2026.xlsx",
    "buscá todos los PDF de mi escritorio",
    "encontrá dónde defino la función calcularIva en mis proyectos de Documents",
    "no encuentro mi tesis.docx, buscala",
  ]),
  ...rc("web", "web", [
    "buscá en la web cuál es la capital de Australia",
    "resumime el contenido de https://es.wikipedia.org/wiki/Ajedrez",
    "cuál es la última versión LTS de Node.js",
    "buscá noticias de hoy sobre inteligencia artificial",
    "cuánto cuesta una RTX 5070 hoy",
    "leé https://docs.python.org/3/library/os.html",
  ]),
];

const HCASES: RCase[] = [
  ...rc("terminal_explicita", "terminal", [
    "ejecutá en la terminal: Get-Process | Sort-Object CPU -Descending | Select-Object -First 5",
    "corré en la terminal 'dotnet build' dentro de C:\\Users\\hugof\\dev\\svc",
    "abrí PowerShell y ejecutá: Get-Date -Format yyyy-MM-dd",
    "ejecutá en la terminal: xcopy C:\\Temp\\src C:\\Temp\\dst /E /I",
    "en la terminal escribí: echo hola > C:\\Temp\\saludo.txt",
    "ejecutá en la terminal: mkdir C:\\Temp\\pruebas",
    "usá el terminal para hacer un ls de C:\\Users\\hugof\\Documents",
    "run this in PowerShell: Get-Service | Where-Object Status -eq Running",
    "corré el comando 'cargo test' en la terminal",
    "ejecutá en la terminal: ren C:\\Temp\\a.txt b.txt",
  ]),
  ...rc("terminal_implicita", "terminal", [
    "abrí la calculadora",
    "cuánta RAM libre tengo",
    "listá los procesos que más memoria usan",
    "matá el proceso de Spotify",
    "instalá las dependencias con npm en C:\\Users\\hugof\\dev\\web",
    "fijate la versión de Python instalada",
    "cuál es mi dirección IP local",
    "ordená los archivos de Downloads por fecha y mostrame los 3 más nuevos",
  ]),
  ...rc("files", "files", [
    "abrí y leé C:\\Users\\hugof\\Documents\\config.json",
    "creá un archivo vacío llamado vacio.txt en el escritorio",
    "guardá la lista de compras en C:\\Users\\hugof\\Documents\\compras.txt: leche, pan, huevos",
    "mostrame qué carpetas hay dentro de C:\\Users\\hugof\\dev",
    "movele el archivo informe.pdf a la carpeta Archivo en Documents",
    "cambiale el nombre a datos.csv por datos_2026.csv",
    "leé el archivo C:\\Users\\hugof\\Desktop\\recetas.txt y decime los ingredientes",
    "creá la carpeta C:\\Users\\hugof\\Documents\\Facturas",
  ]),
  ...rc("locate", "locate", [
    "buscá mis fotos de las vacaciones en toda la PC",
    "dónde guardé el archivo plan_2026.pptx",
    "buscá archivos que contengan la palabra 'factura' en C:\\Users\\hugof\\Documents",
    "encontrá todos los .log del disco",
  ]),
  ...rc("web", "web", [
    "buscá cuál es la población de Chile",
    "qué dice https://example.com/blog/release sobre la nueva versión",
    "cuándo sale el próximo iPhone",
    "buscá reseñas del libro Dune",
  ]),
];

const EXISTING: RCase[] = [];
for (const f of ["route_16_cases", "route_gemai"]) {
  for (const l of fs.readFileSync(`eval/datasets/route_D1/${f}.jsonl`, "utf8").split("\n")) {
    if (!l.trim() || l.startsWith("#")) continue;
    const c = JSON.parse(l);
    EXISTING.push({ id: `${f.slice(6, 9)}-${c.id}`, text: c.scenario.request, gold: c.expect.expectedRoute, group: "existente" });
  }
}

if (PHASES.includes("dump")) {
  fs.writeFileSync("eval/.cases.json", JSON.stringify({ RCASES, HCASES }));
  process.exit(0);
}

// ───────── Armado de preguntas de D1 ─────────
const ALL_ROUTES: Route[] = ["files", "locate", "terminal", "web"];
const ROUTE_HINTS: Record<string, string> = {
  files: "Not for opening or launching applications.",
  terminal: "Opening an application such as Notepad or the calculator belongs here.",
  locate: "Also use it after a file was not found at the path that was tried.",
};
const toolsOf = (route: string) => SYSTEM_TOOL_MANIFEST.filter((t) => t.route === route && !t.internal);
/** Descripción de la ruta con las herramientas que trae el manifest (generada, no escrita a mano). */
const autoTools = (route: string, withDesc: boolean): string =>
  ` Tools: ${toolsOf(route).map((t) => (withDesc ? `${t.name} (${shortDesc(t.description, t.name).replace(/\.$/, "")})` : t.name)).join(", ")}.`;

interface D1Variant { name: string; routes: Route[]; build: (instruction: string, routes: Route[], request?: string) => { state: string; questions: Record<string, unknown> }; kind: "choice" | "noul" }
const choiceQuestion = (routes: Route[], opts: { instructions?: string; hintTerminal?: string; auto?: "names" | "descs"; noHints?: boolean }) => {
  const criteria: Record<string, string> = {};
  for (const r of routes) {
    let c = DESTINATIONS[r].description;
    if (!opts.noHints && ROUTE_HINTS[r]) c += ` ${ROUTE_HINTS[r]}`;
    if (r === "terminal" && opts.hintTerminal) c += ` ${opts.hintTerminal}`;
    if (opts.auto) c += autoTools(r, opts.auto === "descs");
    criteria[r] = c;
  }
  return { route: { type: "choice", instructions: opts.instructions ?? "Which route should handle the next action?", criteria } };
};
const stateOf = (instruction: string) => `Step: ${instruction}`;
const FOLLOW = "If the step says where or how to do it (the terminal, a command, the web, a file path), follow it.";
/** `withRequest`: D1 ve también la solicitud original del usuario (línea `Request:`), además del paso. */
const mk = (name: string, opts: Parameters<typeof choiceQuestion>[1], routes: Route[] = ALL_ROUTES, withRequest = false): D1Variant => ({
  name, routes, kind: "choice",
  build: (instruction, rs, request) => ({ state: (withRequest && request ? `Request: ${request}\n` : "") + stateOf(instruction), questions: choiceQuestion(rs, opts) }),
});
const noulEach = (name: string, routes: Route[] = ALL_ROUTES, text?: (r: Route) => string): D1Variant => ({
  name, routes, kind: "noul",
  build: (instruction, rs) => ({
    state: stateOf(instruction),
    questions: Object.fromEntries(rs.map((r) => [r, {
      type: "noul",
      instructions: text ? text(r) : `Should the next action run on the '${r}' route? ${r}: ${DESTINATIONS[r].description}`,
      criteria: { true: `The step belongs to the '${r}' route.`, false: `The step belongs to another route.` },
    }])),
  }),
});
const D1_VARIANTS: D1Variant[] = [
  mk("prod", {}),
  mk("hint_terminal", { hintTerminal: "Also when the step names a command, a shell (PowerShell, cmd) or the terminal." }),
  mk("regla_general", { instructions: `Which route should handle the next action? ${FOLLOW}` }),
  mk("tools_nombres", { auto: "names" }),
  mk("tools_descripciones", { auto: "descs" }),
  mk("regla+tools_nombres", { instructions: `Which route should handle the next action? ${FOLLOW}`, auto: "names" }),
  mk("sin_hints", { noHints: true }),
  mk("donde_corre", { instructions: "Where should this step run?" }),
  mk("donde_se_hace", { instructions: "Where should this step be done?" }),
  mk("donde_se_hace+regla", { instructions: `Where should this step be done? ${FOLLOW}` }),
  mk("donde_se_hace+tools_nombres", { instructions: "Where should this step be done?", auto: "names" }),
  mk("donde_se_hace+regla+tools_nombres", { instructions: `Where should this step be done? ${FOLLOW}`, auto: "names" }),
  mk("donde_se_hace+tools_nombres+solicitud", { instructions: "Where should this step be done?", auto: "names" }, ALL_ROUTES, true),
  mk("donde_se_hace+regla+tools_nombres+solicitud", { instructions: `Where should this step be done? ${FOLLOW}`, auto: "names" }, ALL_ROUTES, true),
  mk("donde_se_hace+regla+solicitud", { instructions: `Where should this step be done? ${FOLLOW}` }, ALL_ROUTES, true),
  mk("que_ruta_puede", { instructions: "Which route can do this step?" }),
  mk("que_ruta_puede+regla", { instructions: `Which route can do this step? ${FOLLOW}` }),
  mk("donde_corre+regla", { instructions: `Where should this step run? ${FOLLOW}` }),
  mk("donde_corre+tools_nombres", { instructions: "Where should this step run?", auto: "names" }),
  mk("donde_corre+hint_terminal", { instructions: "Where should this step run?", hintTerminal: "Also when the step names a command, a shell (PowerShell, cmd) or the terminal." }),
  mk("prod+solicitud", {}, ALL_ROUTES, true),
  mk("donde_corre+solicitud", { instructions: "Where should this step run?" }, ALL_ROUTES, true),
  mk("donde_corre+regla+solicitud", { instructions: `Where should this step run? ${FOLLOW}` }, ALL_ROUTES, true),
  noulEach("noul_por_ruta"),
  noulEach("noul_donde", ALL_ROUTES, (r) => `Is the '${r}' route the right place to run this step? ${r}: ${DESTINATIONS[r].description}`),
  mk("prod_sin_locate", {}, ["files", "terminal", "web"]),
  mk("donde_corre_sin_locate", { instructions: "Where should this step run?" }, ["files", "terminal", "web"]),
  mk("donde_corre_sin_locate+busca", { instructions: "Where should this step run?", hintTerminal: "Also to find files by name or by text inside files." }, ["files", "terminal", "web"]),
  mk("regla_sin_locate", { instructions: `Which route should handle the next action? ${FOLLOW}` }, ["files", "terminal", "web"]),
  mk("regla+tools_sin_locate", { instructions: `Which route should handle the next action? ${FOLLOW}`, auto: "names" }, ["files", "terminal", "web"]),
];

interface Pred { pick: string | null; p: Record<string, number>; ms: number; tokens: number }
async function ask(state: string, questions: Record<string, unknown>): Promise<{ answers: any; ms: number; tokens: number } | null> {
  const r: any = await dec.call({ type: "decision", state, questions } as never, 60000);
  if (!r.ok) return null;
  return { answers: parseAnswers(r.rawOutput) as any, ms: r.durationMs, tokens: r.tokens.prompt };
}
async function predict(v: D1Variant, instruction: string, request?: string): Promise<Pred> {
  const { state, questions } = v.build(instruction, v.routes, request);
  const r = await ask(state, questions);
  if (!r) return { pick: null, p: {}, ms: 0, tokens: 0 };
  if (v.kind === "choice") {
    const a = r.answers.route;
    return { pick: a?.choice ?? null, p: a?.probabilities ?? {}, ms: r.ms, tokens: r.tokens };
  }
  const p: Record<string, number> = {};
  for (const k of v.routes) p[k] = r.answers[k]?.noul ?? 0;
  const pick = Object.entries(p).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { pick, p, ms: r.ms, tokens: r.tokens };
}
async function pool<T>(xs: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) await fn(xs[i++]); }));
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
const goldFor = (c: RCase, v: D1Variant): string => (c.gold === "locate" && !v.routes.includes("locate") ? "terminal" : c.gold);
const GROUPS: RCase["group"][] = ["terminal_explicita", "terminal_implicita", "files", "locate", "web"];
const out: any = { when: new Date().toISOString() };

// ───────── Fase D1 ─────────
if (PHASES.includes("d1")) {
  // control: el armado de `prod` coincide con el de producción
  const sc = { mode: "reactive", request: RCASES[0].text, steps: [{ state: "running" }], at: { routes: ALL_ROUTES } };
  const real: any = materializeScenario("route", sc as never, undefined).request;
  const mine = D1_VARIANTS[0].build(RCASES[0].text, ALL_ROUTES);
  console.log("control prod == producción:", real.state === mine.state && JSON.stringify(real.questions) === JSON.stringify(mine.questions));
  out.d1 = {};
  console.log("\nD1: acierto por grupo (terminal explícita 16, implícita 10, files 10, locate 6, web 6)");
  console.log("variante".padEnd(26), "total".padEnd(8), GROUPS.map((g) => g.slice(0, 9).padEnd(10)).join(""), "ms   tok  p(gold) medio");
  for (const v of D1_VARIANTS) {
    const res: Record<string, Pred> = {};
    await pool(RCASES, 3, async (c) => { res[c.id] = await predict(v, c.text); });
    const rows = RCASES.map((c) => ({ c, r: res[c.id], gold: goldFor(c, v) }));
    const ok = rows.filter((x) => x.r.pick === x.gold);
    const per = GROUPS.map((g) => { const gr = rows.filter((x) => x.c.group === g); return `${gr.filter((x) => x.r.pick === x.gold).length}/${gr.length}`.padEnd(10); }).join("");
    const pg = mean(rows.map((x) => x.r.p[x.gold] ?? 0));
    console.log(v.name.padEnd(26), `${ok.length}/${rows.length}`.padEnd(8), per, String(Math.round(mean(rows.map((x) => x.r.ms)))).padEnd(4), String(Math.round(mean(rows.map((x) => x.r.tokens)))).padEnd(4), pg.toFixed(3));
    out.d1[v.name] = { ok: ok.length, wrong: rows.filter((x) => x.r.pick !== x.gold).map((x) => ({ id: x.c.id, text: x.c.text.slice(0, 70), gold: x.gold, pick: x.r.pick, p: x.r.p })), pg };
  }
  for (const n of ["prod", "donde_corre", "donde_corre+regla", "noul_por_ruta", "noul_donde"]) {
    console.log(`\n  errores de ${n}:`, out.d1[n].wrong.map((w: any) => `${w.id}[${w.gold}→${w.pick}]`).join(" ") || "-");
  }
}

if (PHASES.includes("d1h")) {
  out.d1h = {};
  for (const [title, cases] of [["RESERVA (34 casos nuevos)", HCASES], ["DESARROLLO repetido (48 casos, para medir el ruido)", RCASES]] as const) {
    console.log("\nD1 " + title);
    console.log("variante".padEnd(30), "total".padEnd(8), GROUPS.map((g) => g.slice(0, 9).padEnd(10)).join(""), "p(gold)");
    for (const v of D1_VARIANTS) {
      const res: Record<string, Pred> = {};
      await pool([...cases], 3, async (c) => { res[c.id] = await predict(v, c.text); });
      const rows = cases.map((c) => ({ c, r: res[c.id], gold: goldFor(c, v) }));
      const ok = rows.filter((x) => x.r.pick === x.gold);
      const per = GROUPS.map((g) => { const gr = rows.filter((x) => x.c.group === g); return `${gr.filter((x) => x.r.pick === x.gold).length}/${gr.length}`.padEnd(10); }).join("");
      console.log(v.name.padEnd(30), `${ok.length}/${rows.length}`.padEnd(8), per, mean(rows.map((x) => x.r.p[x.gold] ?? 0)).toFixed(3));
      (out.d1h[title] ??= {})[v.name] = { ok: ok.length, wrong: rows.filter((x) => x.r.pick !== x.gold).map((x) => `${x.c.id}[${x.gold}→${x.r.pick}]`) };
    }
  }
}

if (PHASES.includes("d1all")) {
  const sets: [string, RCase[]][] = [["desarrollo 48", RCASES], ["reserva 34", HCASES], ["datasets existentes 32", EXISTING]];
  out.d1all = {};
  console.log("\nD1 en los tres conjuntos (114 casos). Sin locate, el gold de locate es terminal.");
  console.log("variante".padEnd(30), sets.map(([n]) => n.padEnd(24)).join(""), "total");
  for (const v of D1_VARIANTS) {
    const parts: number[] = []; const wrong: string[] = [];
    for (const [, cases] of sets) {
      const res: Record<string, Pred> = {};
      await pool([...cases], 3, async (c) => { res[c.id] = await predict(v, c.text); });
      parts.push(cases.filter((c) => res[c.id].pick === goldFor(c, v)).length);
      for (const c of cases) if (res[c.id].pick !== goldFor(c, v)) wrong.push(`${c.id}[${goldFor(c, v)}→${res[c.id].pick}]`);
    }
    const total = parts.reduce((a, b) => a + b, 0);
    console.log(v.name.padEnd(30), sets.map(([, c], i) => `${parts[i]}/${c.length}`.padEnd(24)).join(""), `${total}/114`);
    out.d1all[v.name] = { parts, total, wrong };
  }
}

// ───────── Casos y fase de D2 ─────────
interface TCase { id: string; text: string; route: "files" | "terminal"; gold: string }
const TCASES: TCase[] = [
  { id: "t01", route: "files", gold: "read_file", text: "Leer C:\\Users\\hugof\\Desktop\\notas.txt" },
  { id: "t02", route: "files", gold: "read_multiple_files", text: "Leer los archivos a.txt y b.txt de C:\\Users\\hugof\\Desktop" },
  { id: "t03", route: "files", gold: "write_file", text: "Guardar el texto 'hola' en C:\\Temp\\hola.txt" },
  { id: "t04", route: "files", gold: "create_directory", text: "Crear el directorio C:\\Temp\\rc_a" },
  { id: "t05", route: "files", gold: "list_directory", text: "Listar el contenido de C:\\Users\\hugof\\Documents" },
  { id: "t06", route: "files", gold: "move_file", text: "Mover reporte.docx de C:\\Users\\hugof\\Downloads a C:\\Users\\hugof\\Documents" },
  { id: "t07", route: "files", gold: "move_file", text: "Renombrar foto1.jpg a vacaciones.jpg en el escritorio" },
  { id: "t08", route: "files", gold: "write_file", text: "Crear el archivo C:\\Temp\\rc_a\\hola.txt con el texto hola" },
  { id: "t09", route: "files", gold: "create_directory", text: "Crear la carpeta Proyectos en Documents" },
  { id: "t10", route: "files", gold: "read_file", text: "Leer la hoja Octubre de facturas_2026.xlsx" },
  { id: "t11", route: "files", gold: "list_directory", text: "Ver las subcarpetas de C:\\Users\\hugof\\Proyectos" },
  { id: "t12", route: "files", gold: "write_file", text: "Crear un Excel gastos.xlsx en Documents con las columnas Fecha, Concepto y Monto" },
  { id: "t13", route: "files", gold: "read_file", text: "Leer las últimas 30 líneas del log C:\\Users\\hugof\\Documents\\logs\\app.log" },
  { id: "t20", route: "terminal", gold: "run_command", text: "Ejecutar en la terminal: robocopy C:\\Temp\\rc_a C:\\Temp\\rc_b /E" },
  { id: "t21", route: "terminal", gold: "run_command", text: "Abrir el Bloc de notas" },
  { id: "t22", route: "terminal", gold: "run_command", text: "Calcular el tamaño de la carpeta Downloads" },
  { id: "t23", route: "terminal", gold: "list_processes", text: "Listar los procesos de Chrome que están abiertos" },
  { id: "t24", route: "terminal", gold: "stop_process", text: "Detener el proceso con pid 4321" },
  { id: "t25", route: "terminal", gold: "run_command", text: "Continuar el proceso con pid 1111 enviándole la respuesta 's'" },
  { id: "t26", route: "terminal", gold: "list_processes", text: "Listar todos los procesos de la PC" },
  { id: "t27", route: "terminal", gold: "run_command", text: "Compilar el proyecto de C:\\Users\\hugof\\app con npm run build" },
  { id: "t28", route: "terminal", gold: "run_command", text: "Ejecutar en la terminal: New-Item -ItemType Directory C:\\Temp\\rc_a -Force; Set-Content C:\\Temp\\rc_a\\hola.txt hola" },
];
const PROD_D2_INSTR = "Choose the tool that directly accomplishes the step instruction.";
interface D2Variant { name: string; kind: "choice" | "noul"; build: (c: TCase) => { state: string; questions: Record<string, unknown> } }
const D2_STATE = (c: TCase) => `Step: ${c.text}\nRoute: ${c.route}`;
const paramsOf = (name: string): string => { const t = SYSTEM_TOOL_MANIFEST.find((x) => x.name === name); return t?.params ? `(${t.params.join(", ")})` : ""; };
const d2choice = (name: string, crit: (t: (typeof SYSTEM_TOOL_MANIFEST)[number]) => string, instructions = PROD_D2_INSTR): D2Variant => ({
  name, kind: "choice",
  build: (c) => ({ state: D2_STATE(c), questions: { selected_tool: { type: "choice", instructions, criteria: Object.fromEntries(toolsOf(c.route).map((t) => [t.name, crit(t)])) } } }),
});
const D2_VARIANTS: D2Variant[] = [
  d2choice("prod", (t) => shortDesc(t.description, t.name)),
  d2choice("desc_completa", (t) => t.description),
  d2choice("desc+parametros", (t) => `${shortDesc(t.description, t.name)} Parameters: ${(t.params ?? []).join(", ") || "see schema"}.`),
  d2choice("instr_que_hace", (t) => shortDesc(t.description, t.name), "Which tool does what the step asks?"),
  d2choice("instr_sin_inventar", (t) => shortDesc(t.description, t.name), `${PROD_D2_INSTR} Use only what the tool descriptions say it can do.`),
  {
    name: "noul_por_herramienta", kind: "noul",
    build: (c) => ({
      state: D2_STATE(c),
      questions: Object.fromEntries(toolsOf(c.route).map((t) => [t.name, {
        type: "noul", instructions: `Is '${t.name}' the right tool for the step? ${t.name}: ${shortDesc(t.description, t.name)}`,
        criteria: { true: "This tool directly accomplishes the step.", false: "Another tool fits better." },
      }])),
    }),
  },
];
if (PHASES.includes("d2")) {
  const sc = { mode: "reactive", request: TCASES[0].text, steps: [{ state: "running" }], at: { route: "files", tools: toolsOf("files").map((t) => t.name) } };
  const real: any = materializeScenario("tool_choice", sc as never, undefined).request;
  const mine = D2_VARIANTS[0].build(TCASES[0]);
  console.log("\ncontrol D2 prod == producción:", real.state === mine.state, JSON.stringify(real.questions) === JSON.stringify(mine.questions));
  out.d2 = {};
  console.log("\nD2: acierto (files 13, terminal 9)");
  console.log("variante".padEnd(24), "total".padEnd(8), "files".padEnd(7), "terminal".padEnd(9), "ms   tok");
  for (const v of D2_VARIANTS) {
    const res: Record<string, string | null> = {}; const pr: Record<string, number> = {}; const ms: number[] = []; const tk: number[] = [];
    await pool(TCASES, 3, async (c) => {
      const { state, questions } = v.build(c);
      const r = await ask(state, questions);
      if (!r) { res[c.id] = null; return; }
      ms.push(r.ms); tk.push(r.tokens);
      if (v.kind === "choice") { res[c.id] = r.answers.selected_tool?.choice ?? null; pr[c.id] = r.answers.selected_tool?.probabilities?.[c.gold] ?? 0; }
      else { const p = toolsOf(c.route).map((t) => [t.name, r.answers[t.name]?.noul ?? 0] as const).sort((a, b) => b[1] - a[1]); res[c.id] = p[0][0]; pr[c.id] = r.answers[c.gold]?.noul ?? 0; }
    });
    const f = TCASES.filter((c) => c.route === "files"), t = TCASES.filter((c) => c.route === "terminal");
    const okOf = (xs: TCase[]) => xs.filter((c) => res[c.id] === c.gold).length;
    console.log(v.name.padEnd(24), `${okOf(TCASES)}/${TCASES.length}`.padEnd(8), `${okOf(f)}/${f.length}`.padEnd(7), `${okOf(t)}/${t.length}`.padEnd(9), String(Math.round(mean(ms))).padEnd(4), Math.round(mean(tk)));
    out.d2[v.name] = { wrong: TCASES.filter((c) => res[c.id] !== c.gold).map((c) => `${c.id}[${c.gold}→${res[c.id]}]`), pg: mean(TCASES.map((c) => pr[c.id] ?? 0)) };
    console.log("   errores:", out.d2[v.name].wrong.join(" ") || "-", "| p(gold) medio", out.d2[v.name].pg.toFixed(3));
  }
}

// ───────── Fase d2n: ¿D2 puede decir "ninguna herramienta de esta ruta sirve"? (recuperación ante un error de D1) ─────────
if (PHASES.includes("d2n")) {
  const MISMATCH: TCase[] = [
    { id: "m01", route: "files", gold: "none", text: "Copiar los archivos de C:\\Temp\\rc_a a C:\\Temp\\rc_b recursivamente" },
    { id: "m02", route: "files", gold: "none", text: "Ejecutar en la terminal: robocopy C:\\Temp\\rc_a C:\\Temp\\rc_b /E" },
    { id: "m03", route: "files", gold: "none", text: "Comprimir la carpeta C:\\Temp\\rc_a en un archivo zip" },
    { id: "m04", route: "files", gold: "none", text: "Abrir el Bloc de notas" },
    { id: "m05", route: "files", gold: "none", text: "Ejecutar en la terminal: New-Item -ItemType Directory C:\\Temp\\rc_a -Force; Set-Content C:\\Temp\\rc_a\\hola.txt hola" },
    { id: "m06", route: "files", gold: "none", text: "Averiguar cuánto pesa la carpeta Downloads" },
    { id: "m07", route: "files", gold: "none", text: "Buscar en la web la capital de Australia" },
    { id: "m08", route: "files", gold: "none", text: "Instalar las dependencias del proyecto con npm" },
    { id: "m09", route: "files", gold: "none", text: "Borrar la carpeta C:\\Temp\\viejo y todo su contenido" },
    { id: "m10", route: "files", gold: "none", text: "Copiar foto.jpg al escritorio" },
  ];
  const matched = TCASES;
  const NONE = "No tool of this route can do the step; another route is needed.";
  const variants: [string, (t: (typeof SYSTEM_TOOL_MANIFEST)[number]) => string, string][] = [
    ["prod+opcion_ninguna", (t) => shortDesc(t.description, t.name), PROD_D2_INSTR],
    ["opcion_ninguna+instr", (t) => shortDesc(t.description, t.name), "Choose the tool that directly accomplishes the step instruction. If none of these tools can do it, choose none."],
  ];
  out.d2n = {};
  console.log("\nD2 con opción 'none' (10 pedidos que no son de files, 13 que sí)");
  for (const [name, crit, instr] of variants) {
    const res: Record<string, string | null> = {};
    await pool([...MISMATCH, ...matched], 3, async (c) => {
      const criteria: Record<string, string> = Object.fromEntries(toolsOf(c.route).map((t) => [t.name, crit(t)]));
      criteria.none = NONE;
      const r = await ask(D2_STATE(c), { selected_tool: { type: "choice", instructions: instr, criteria } });
      res[c.id] = r?.answers.selected_tool?.choice ?? null;
    });
    const tp = MISMATCH.filter((c) => res[c.id] === "none").length;
    const fp = matched.filter((c) => res[c.id] === "none").length;
    const okM = matched.filter((c) => res[c.id] === c.gold).length;
    console.log(name.padEnd(24), `detecta el error de ruta ${tp}/10`, `| falso 'none' en los 22 válidos ${fp}/22`, `| herramienta correcta ${okM}/22`);
    console.log("   no detectados:", MISMATCH.filter((c) => res[c.id] !== "none").map((c) => `${c.id}→${res[c.id]}`).join(" ") || "-", "| falsos none:", matched.filter((c) => res[c.id] === "none").map((c) => c.id).join(" ") || "-");
    out.d2n[name] = { tp, fp, okM };
  }
}

// ───────── Fase chain: solicitud -> pending -> D1 ─────────
if (PHASES.includes("chain") || PHASES.includes("chainh")) {
  const CC = PHASES.includes("chainh") ? HCASES : RCASES;
  const KEEP_RULE =
    "- Keep exactly what the user said about where or how to do it (the terminal, PowerShell, a command or program name, a site): copy it into the item; a command the user wrote is part of the goal.";
  const pend: Record<string, string> = {
    pending_actual: PROMPTS.PENDING_VIEW.SYSTEM,
    pending_respeta_lo_dicho: PROMPTS.PENDING_VIEW.SYSTEM.replace("Follow USER.", `${KEEP_RULE}\nFollow USER.`),
    pending_regla_estrecha: PROMPTS.PENDING_VIEW.SYSTEM.replace(
      "Follow USER.",
      "- If REQUEST says to run something in the terminal, PowerShell or cmd, keep that in the item together with the command (for example: 'In the terminal: <command>').\nFollow USER.",
    ),
  };
  const first = async (system: string, request: string): Promise<string> => {
    const m: any = materializeScenario("pending", { mode: "reactive", request, at: { previous: [] } } as never, undefined).request;
    const r: any = await gen.call({ ...m, system }, 120000);
    const list = r.ok ? (parseJsonObject(r.rawOutput) as any)?.pending : null;
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : request;
  };
  const chainVariants = D1_VARIANTS.filter((v) => ["prod", "donde_se_hace+regla", "donde_se_hace+regla+solicitud", "donde_corre+regla+solicitud"].includes(v.name));
  out.chain = {};
  console.log("\nChain: solicitud -> pending -> D1 (acierto sobre las 48 solicitudes; entre paréntesis, terminal explícita 16)");
  for (const [pn, system] of Object.entries(pend)) {
    const goals: Record<string, string> = {};
    await pool(CC, 3, async (c) => { goals[c.id] = await first(system, c.text); });
    const keepsTerminal = CC.filter((c) => c.group === "terminal_explicita" && /terminal|powershell|consola|cmd|comando|command/i.test(goals[c.id])).length;
    console.log(`\n${pn}: la meta conserva "terminal/PowerShell/comando" en ${keepsTerminal}/10 solicitudes de terminal explícita`);
    for (const e of ["terminal_explicita"]) console.log("  ejemplos:", CC.filter((c) => c.group === e).slice(0, 3).map((c) => `"${goals[c.id].slice(0, 80)}"`).join(" | "));
    for (const v of chainVariants) {
      const res: Record<string, Pred> = {};
      await pool(CC, 3, async (c) => { res[c.id] = await predict(v, goals[c.id], c.text); });
      const ok = CC.filter((c) => res[c.id].pick === goldFor(c, v)).length;
      const okT = CC.filter((c) => c.group === "terminal_explicita" && res[c.id].pick === "terminal").length;
      console.log(`  D1 ${v.name.padEnd(22)} ${ok}/${CC.length} (${okT}/16)`);
      out.chain[`${pn}|${v.name}`] = { ok, okT };
    }
    out.chain[pn] = { goals };
  }
}
fs.mkdirSync("eval/results/_exp", { recursive: true });
const file = `eval/results/_exp/select_tools_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log("\nguardado:", file);
