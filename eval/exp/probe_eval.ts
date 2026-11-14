/**
 * eval/exp/probe_eval.ts
 *
 * Experimento (no es una etapa): mide las sondas de producción (`src/core/tools/probes.ts`) con casos parecidos a los de producción: el pedido tal como lo escribe el usuario,
 * los argumentos que mandaría el generador y el resumen que deja la herramienta. El estado y la pregunta (con sus criterios `true`/`false`) los arman las mismas funciones
 * `stages()` que usa el motor, y el veredicto se compone igual que en `engine/probes.ts` (compuerta, `badWhenTrue`, umbral). Varios casos por sonda: buenos (deben pasar) y malos
 * (deben rechazarse). Uso: npx tsx eval/exp/probe_eval.ts [modelo] [sonda]
 */
import { ATTRIBUTE_PROBE, GATE_MIN, ITEM_PROBE, PLACE_PROBE, POSITION_PROBE, SCOPE_PROBE, type Probe, type ProbeCall } from "../../src/core/tools/probes.ts";

const BASE = "http://127.0.0.1:11434";
const MODEL = process.argv[2] ?? "d3:2b-text";
const ONLY = process.argv[3];
const BS = String.fromCharCode(92);
const P = (...parts: string[]): string => parts.join(BS);
const U = P("C:", "Users", "Hugo F");
const D = (...p: string[]): string => P(U, ...p);

interface Case {
  readonly probe: Probe;
  readonly ok: boolean;
  readonly note: string;
  readonly call: ProbeCall;
}
const c = (probe: Probe, ok: boolean, note: string, tool: string, request: string, args: Record<string, unknown>, summary: string | null): Case => ({
  probe,
  ok,
  note,
  call: { tool, args, summary, request, step: request },
});
const wrote = (path: string): string => `Successfully wrote to ${path} (12 lines)`;

const GPT = "Crea un md dentro de la carpeta jarvis con la informacion que sepas de gpt";
const GPT_DOCS = "Crea un md dentro de la carpeta jarvis de Documentos con la informacion que sepas de gpt";
const PROY = "Guarda un resumen en la carpeta Proyectos dentro de Documentos";
const README = `agregá al principio de ${D("Documents", "app", "README.md")} la línea "## Novedades"`;
const NOTAS_END = `agregá al final de ${D("Documents", "notas.txt")} la línea "comprar pan"`;

const cases: Case[] = [
  // ── ubicación ──
  c(PLACE_PROBE, true, "jarvis en el escritorio (no nombra lugar)", "write_file", GPT, { path: D("Desktop", "jarvis", "gpt_info.md"), content: "# GPT", mode: "rewrite" }, wrote(D("Desktop", "jarvis", "gpt_info.md"))),
  c(PLACE_PROBE, true, "jarvis de Documentos", "write_file", GPT_DOCS, { path: D("Documents", "jarvis", "gpt_info.md"), content: "# GPT", mode: "rewrite" }, wrote(D("Documents", "jarvis", "gpt_info.md"))),
  c(PLACE_PROBE, true, "Proyectos dentro de Documentos", "write_file", PROY, { path: D("Documents", "Proyectos", "resumen.md"), content: "x", mode: "rewrite" }, wrote(D("Documents", "Proyectos", "resumen.md"))),
  c(PLACE_PROBE, true, "escritorio", "write_file", "Crea una nota en el escritorio con la lista de compras", { path: D("Desktop", "nota.md"), content: "x", mode: "rewrite" }, wrote(D("Desktop", "nota.md"))),
  c(PLACE_PROBE, true, "Descargas", "write_file", "Guarda el archivo en Descargas", { path: D("Downloads", "archivo.md"), content: "x", mode: "rewrite" }, wrote(D("Downloads", "archivo.md"))),
  c(PLACE_PROBE, true, "sin lugar nombrado", "write_file", "Crea un archivo notas.txt con tres tareas", { path: D("Downloads", "notas.txt"), content: "x", mode: "rewrite" }, wrote(D("Downloads", "notas.txt"))),
  c(PLACE_PROBE, true, "carpeta nueva en Documentos", "create_directory", "Crea una carpeta Proyectos en Documentos", { path: D("Documents", "Proyectos") }, `Successfully created directory ${D("Documents", "Proyectos")}`),
  c(PLACE_PROBE, true, "mover al escritorio", "move_file", "Mueve a.pdf a la carpeta Archivo del escritorio", { source: D("Downloads", "a.pdf"), destination: D("Desktop", "Archivo", "a.pdf") }, `Successfully moved ${D("Downloads", "a.pdf")} to ${D("Desktop", "Archivo", "a.pdf")}`),
  c(PLACE_PROBE, false, "Documentos pedido, escritorio escrito", "write_file", GPT_DOCS, { path: D("Desktop", "jarvis", "gpt_info.md"), content: "# GPT", mode: "rewrite" }, wrote(D("Desktop", "jarvis", "gpt_info.md"))),
  c(PLACE_PROBE, false, "jarvis pedida, escribió en Documentos", "write_file", GPT, { path: D("Documents", "gpt_info.md"), content: "# GPT", mode: "rewrite" }, wrote(D("Documents", "gpt_info.md"))),
  c(PLACE_PROBE, false, "Proyectos omitida", "write_file", PROY, { path: D("Documents", "resumen.md"), content: "x", mode: "rewrite" }, wrote(D("Documents", "resumen.md"))),
  c(PLACE_PROBE, false, "escritorio pedido, Documentos escrito", "write_file", "Crea una nota en el escritorio con la lista de compras", { path: D("Documents", "nota.md"), content: "x", mode: "rewrite" }, wrote(D("Documents", "nota.md"))),
  c(PLACE_PROBE, false, "Descargas pedido, escritorio escrito", "write_file", "Guarda el archivo en Descargas", { path: D("Desktop", "archivo.md"), content: "x", mode: "rewrite" }, wrote(D("Desktop", "archivo.md"))),
  c(PLACE_PROBE, false, "Proyectos del escritorio, escrito en Documentos", "write_file", "Guarda el resumen en la carpeta Proyectos del escritorio", { path: D("Documents", "Proyectos", "resumen.md"), content: "x", mode: "rewrite" }, wrote(D("Documents", "Proyectos", "resumen.md"))),
  c(PLACE_PROBE, false, "carpeta creada en el escritorio", "create_directory", "Crea una carpeta Proyectos en Documentos", { path: D("Desktop", "Proyectos") }, `Successfully created directory ${D("Desktop", "Proyectos")}`),
  c(PLACE_PROBE, false, "carpeta creada en la raíz del usuario", "create_directory", "Crea una carpeta Proyectos en Documentos", { path: D("Proyectos") }, `Successfully created directory ${D("Proyectos")}`),
  c(PLACE_PROBE, false, "movido a Documentos", "move_file", "Mueve a.pdf a la carpeta Archivo del escritorio", { source: D("Downloads", "a.pdf"), destination: D("Documents", "Archivo", "a.pdf") }, `Successfully moved ${D("Downloads", "a.pdf")} to ${D("Documents", "Archivo", "a.pdf")}`),
  c(PLACE_PROBE, false, "movido sin la carpeta", "move_file", "Mueve a.pdf a la carpeta Archivo del escritorio", { source: D("Downloads", "a.pdf"), destination: D("Downloads", "a.pdf") }, `Successfully moved ${D("Downloads", "a.pdf")} to ${D("Downloads", "a.pdf")}`),

  // ── posición ──
  c(POSITION_PROBE, true, "al principio, reescrito con la línea primero", "write_file", README, { path: D("Documents", "app", "README.md"), content: "## Novedades\n# App\nTexto", mode: "rewrite" }, wrote(D("Documents", "app", "README.md"))),
  c(POSITION_PROBE, true, "al final, append", "write_file", NOTAS_END, { path: D("Documents", "notas.txt"), content: "comprar pan", mode: "append" }, wrote(D("Documents", "notas.txt"))),
  c(POSITION_PROBE, true, "al final de un log, append", "write_file", `agregá al final de ${D("Documents", "app", "log.txt")} la línea "fin"`, { path: D("Documents", "app", "log.txt"), content: "fin", mode: "append" }, wrote(D("Documents", "app", "log.txt"))),
  c(POSITION_PROBE, true, "sin posición, append", "write_file", `agregá la línea "hola" a ${D("Documents", "notas.txt")}`, { path: D("Documents", "notas.txt"), content: "hola", mode: "append" }, wrote(D("Documents", "notas.txt"))),
  c(POSITION_PROBE, true, "archivo nuevo", "write_file", "Crea un archivo notas.txt con tres tareas", { path: D("Documents", "notas.txt"), content: "1. a\n2. b\n3. c", mode: "rewrite" }, wrote(D("Documents", "notas.txt"))),
  c(POSITION_PROBE, true, "al inicio, reescrito", "write_file", `poné al inicio de ${D("Documents", "todo.md")} el título "# Pendientes"`, { path: D("Documents", "todo.md"), content: "# Pendientes\n- a\n- b", mode: "rewrite" }, wrote(D("Documents", "todo.md"))),
  c(POSITION_PROBE, false, "al principio pedido, append", "write_file", README, { path: D("Documents", "app", "README.md"), content: "## Novedades", mode: "append" }, wrote(D("Documents", "app", "README.md"))),
  c(POSITION_PROBE, false, "al principio de un log, append", "write_file", `agregá al principio de ${D("Documents", "app", "log.txt")} la línea "inicio"`, { path: D("Documents", "app", "log.txt"), content: "inicio", mode: "append" }, wrote(D("Documents", "app", "log.txt"))),
  c(POSITION_PROBE, false, "al comienzo, append", "write_file", `agregá al comienzo de ${D("Documents", "todo.md")} la tarea "pagar luz"`, { path: D("Documents", "todo.md"), content: "pagar luz", mode: "append" }, wrote(D("Documents", "todo.md"))),
  c(POSITION_PROBE, false, "al final pedido, reescrito con la línea sola primero", "write_file", NOTAS_END, { path: D("Documents", "notas.txt"), content: "comprar pan", mode: "rewrite" }, wrote(D("Documents", "notas.txt"))),
  c(POSITION_PROBE, false, "al principio pedido, texto al final del contenido", "write_file", README, { path: D("Documents", "app", "README.md"), content: "# App\nTexto\n## Novedades", mode: "rewrite" }, wrote(D("Documents", "app", "README.md"))),
  c(POSITION_PROBE, false, "al final pedido, línea nueva primero", "write_file", `agregá al final de ${D("Documents", "todo.md")} la tarea "llamar a Ana"`, { path: D("Documents", "todo.md"), content: "llamar a Ana\n- a\n- b", mode: "rewrite" }, wrote(D("Documents", "todo.md"))),

  // ── alcance ──
  c(SCOPE_PROBE, true, "todos los pdf", "start_search", "buscá PDFs en Documents", { path: D("Documents"), pattern: "*.pdf" }, "Search started: 14 results"),
  c(SCOPE_PROBE, true, "todos los log", "start_search", `listá todos los archivos .log de ${D("Documents", "app")}`, { path: D("Documents", "app"), pattern: "*.log" }, "Search started: 6 results"),
  c(SCOPE_PROBE, true, "un archivo por nombre", "start_search", "buscá el archivo presupuesto.xlsx", { path: U, pattern: "presupuesto.xlsx" }, "Search started: 1 result"),
  c(SCOPE_PROBE, true, "fotos jpg", "start_search", "encontrá las fotos jpg del escritorio", { path: D("Desktop"), pattern: "*.jpg" }, "Search started: 22 results"),
  c(SCOPE_PROBE, true, "prefijo", "start_search", "buscá todos los archivos que empiecen con informe", { path: U, pattern: "informe*" }, "Search started: 9 results"),
  c(SCOPE_PROBE, true, "todos los csv", "start_search", "buscá todos los csv de Documentos", { path: D("Documents"), pattern: "*.csv" }, "Search started: 5 results"),
  c(SCOPE_PROBE, false, "todos los log, patrón con prefijo", "start_search", `listá todos los archivos .log de ${D("Documents", "app")}`, { path: D("Documents", "app"), pattern: "app*.log" }, "Search started: 2 results"),
  c(SCOPE_PROBE, false, "todos los pdf, patrón con prefijo", "start_search", "buscá todos los PDF de Documentos", { path: D("Documents"), pattern: "informe*.pdf" }, "Search started: 3 results"),
  c(SCOPE_PROBE, false, "todos los csv, nombre fijo", "start_search", "buscá todos los csv de Documentos", { path: D("Documents"), pattern: "ventas*.csv" }, "Search started: 1 result"),
  c(SCOPE_PROBE, false, "todos los log, nombre fijo", "start_search", "buscá todos los archivos de log", { path: U, pattern: "error.log" }, "Search started: 1 result"),
  c(SCOPE_PROBE, false, "archivos de texto, nombre fijo", "start_search", "buscá todos los archivos de texto de Documentos", { path: D("Documents"), pattern: "notas.txt" }, "Search started: 1 result"),
  c(SCOPE_PROBE, false, "imágenes, solo png", "start_search", "buscá todas las imágenes jpg y png de Descargas", { path: D("Downloads"), pattern: "*.png" }, "Search started: 8 results"),

  // ── ítem (hoja de Excel) ──
  c(ITEM_PROBE, true, "hoja nombrada", "read_file", `leé la hoja Ventas de ${D("Documents", "ventas.xlsx")}`, { path: D("Documents", "ventas.xlsx"), sheet: "Ventas" }, "Sheet: Ventas\nProducto\tVentas\nMouse\t15\nTeclado\t8"),
  c(ITEM_PROBE, true, "sin hoja nombrada", "read_file", `leé el excel ${D("Documents", "ventas.xlsx")}`, { path: D("Documents", "ventas.xlsx") }, "Sheet: Hoja1\nProducto\tVentas\nMouse\t15"),
  c(ITEM_PROBE, true, "rango de una hoja", "read_file", `leé las celdas A1:C10 de la hoja Datos de ${D("Documents", "datos.xlsx")}`, { path: D("Documents", "datos.xlsx"), sheet: "Datos", range: "A1:C10" }, "Sheet: Datos\nA\tB\tC\n1\t2\t3"),
  c(ITEM_PROBE, true, "mostrar contenido", "read_file", `mostrame el contenido de ${D("Documents", "inventario.xlsx")}`, { path: D("Documents", "inventario.xlsx") }, "Sheet: Inventario\nProducto\tStock\nMouse\t15"),
  c(ITEM_PROBE, true, "pestaña nombrada", "read_file", `leé la pestaña Marzo de ${D("Documents", "gastos.xlsx")}`, { path: D("Documents", "gastos.xlsx"), sheet: "Marzo" }, "Sheet: Marzo\nRubro\tMonto\nLuz\t4500"),
  c(ITEM_PROBE, true, "xls sin hoja", "read_file", `abrí ${D("Documents", "viejo.xls")} y decime qué tiene`, { path: D("Documents", "viejo.xls") }, "Sheet: Hoja1\nNombre\tEdad\nAna\t30"),
  c(ITEM_PROBE, false, "hoja pedida, por defecto", "read_file", `leé la hoja Ventas de ${D("Documents", "ventas.xlsx")}`, { path: D("Documents", "ventas.xlsx") }, "Sheet: Resumen\nTotal\t1200"),
  c(ITEM_PROBE, false, "hoja pedida, otra hoja", "read_file", `leé la hoja Costos de ${D("Documents", "ventas.xlsx")}`, { path: D("Documents", "ventas.xlsx"), sheet: "Hoja1" }, "Sheet: Hoja1\nProducto\tVentas\nMouse\t15"),
  c(ITEM_PROBE, false, "pestaña pedida, por defecto", "read_file", `leé la pestaña Marzo de ${D("Documents", "gastos.xlsx")}`, { path: D("Documents", "gastos.xlsx") }, "Sheet: Enero\nRubro\tMonto\nLuz\t4200"),
  c(ITEM_PROBE, false, "rango de una hoja, otra hoja", "read_file", `leé el rango B2:D20 de la hoja Ventas de ${D("Documents", "ventas.xlsx")}`, { path: D("Documents", "ventas.xlsx"), sheet: "Resumen", range: "B2:D20" }, "Sheet: Resumen\nB\tC\tD\n1\t2\t3"),
  c(ITEM_PROBE, false, "hoja Gastos, por defecto", "read_file", `leé la hoja Gastos de ${D("Documents", "finanzas.xlsx")}`, { path: D("Documents", "finanzas.xlsx") }, "Sheet: Ingresos\nMes\tMonto\nEnero\t9000"),
  c(ITEM_PROBE, false, "segunda hoja, por defecto", "read_file", `leé la segunda hoja de ${D("Documents", "finanzas.xlsx")}`, { path: D("Documents", "finanzas.xlsx") }, "Sheet: Ingresos\nMes\tMonto\nEnero\t9000"),

  // ── atributo ──
  c(ATTRIBUTE_PROBE, true, "listar", "list_directory", "qué hay en Descargas", { path: D("Downloads") }, "[FILE] a.pdf\n[FILE] foto.jpg\n[DIR] viejos"),
  c(ATTRIBUTE_PROBE, true, "listar archivos", "list_directory", "listame los archivos de Documentos", { path: D("Documents") }, "[FILE] informe.docx\n[FILE] ventas.xlsx\n[DIR] app"),
  c(ATTRIBUTE_PROBE, true, "contar carpetas", "list_directory", "cuántas carpetas hay en el escritorio", { path: D("Desktop") }, "[DIR] jarvis\n[DIR] fotos\n[FILE] nota.md"),
  c(ATTRIBUTE_PROBE, true, "contenido de una carpeta", "list_directory", `mostrame el contenido de ${D("Documents", "app")}`, { path: D("Documents", "app") }, "[FILE] README.md\n[FILE] log.txt\n[DIR] src"),
  c(ATTRIBUTE_PROBE, true, "listar una carpeta", "list_directory", "listá lo que hay en la carpeta Proyectos", { path: D("Documents", "Proyectos") }, "[FILE] resumen.md\n[DIR] backup"),
  c(ATTRIBUTE_PROBE, true, "contar archivos", "list_directory", "contame cuántos archivos hay en Documentos", { path: D("Documents") }, "[FILE] a.txt\n[FILE] b.txt\n[FILE] c.txt"),
  c(ATTRIBUTE_PROBE, false, "más recientes", "list_directory", "decime los 5 archivos más recientes de Descargas", { path: D("Downloads") }, "[FILE] a.pdf\n[FILE] foto.jpg\n[FILE] b.zip\n[DIR] viejos"),
  c(ATTRIBUTE_PROBE, false, "más pesado", "list_directory", "cuál es el archivo más pesado de Documentos", { path: D("Documents") }, "[FILE] informe.docx\n[FILE] ventas.xlsx\n[DIR] app"),
  c(ATTRIBUTE_PROBE, false, "modificados esta semana", "list_directory", "listá los archivos modificados esta semana en Documentos", { path: D("Documents") }, "[FILE] informe.docx\n[FILE] ventas.xlsx"),
  c(ATTRIBUTE_PROBE, false, "más grandes", "list_directory", "mostrame los 3 archivos más grandes del escritorio", { path: D("Desktop") }, "[FILE] nota.md\n[FILE] video.mp4\n[FILE] tesis.pdf"),
  c(ATTRIBUTE_PROBE, false, "más viejo", "list_directory", "cuál es el archivo más viejo de Descargas", { path: D("Downloads") }, "[FILE] a.pdf\n[FILE] foto.jpg"),
  c(ATTRIBUTE_PROBE, false, "ordenar por fecha", "list_directory", "ordená por fecha lo que hay en Documentos", { path: D("Documents") }, "[FILE] informe.docx\n[FILE] ventas.xlsx\n[DIR] app"),
];

async function ask(state: string, instructions: string, t: string, f: string): Promise<number> {
  const r = await fetch(`${BASE}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions: { q: { type: "noul", instructions, criteria: { true: t, false: f } } }, keep_alive: "10m" }) });
  return ((await r.json()) as { answers: { q: { noul: number } } }).answers.q.noul;
}

/** Como `engine/probes.ts`: el valor de «bien» de cada etapa sin compuerta; la compuerta por debajo de GATE_MIN deja la sonda sin aplicar (valor 1). */
async function score(call: ProbeCall, probe: Probe): Promise<{ values: number[]; gated: boolean }> {
  const values: number[] = [];
  for (const stage of probe.stages(call)) {
    const p = await ask(stage.state, stage.question.instructions, stage.question.criteria.true, stage.question.criteria.false);
    if (stage.gate === true) {
      if (p < GATE_MIN) return { values: [...values, 1], gated: true };
      continue;
    }
    values.push(stage.badWhenTrue === true ? 1 - p : p);
  }
  return { values, gated: false };
}

console.log(`RESULT modelo ${MODEL}`);
const probes = [PLACE_PROBE, POSITION_PROBE, SCOPE_PROBE, ITEM_PROBE, ATTRIBUTE_PROBE].filter((p) => ONLY === undefined || p.id === ONLY);
for (const probe of probes) {
  const rows: { c: Case; value: number; gated: boolean }[] = [];
  for (const k of cases.filter((x) => x.probe === probe)) {
    if (!probe.applies(k.call)) {
      console.log(`RESULT   (no aplica) ${k.note}`);
      continue;
    }
    const s = await score(k.call, probe);
    rows.push({ c: k, value: Math.min(...s.values), gated: s.gated });
  }
  const ok = rows.filter((r) => r.c.ok);
  const bad = rows.filter((r) => !r.c.ok);
  const at = (t: number): string => `t${t}: buenas pasan ${ok.filter((r) => r.value >= t).length}/${ok.length}, malas rechazadas ${bad.filter((r) => !(r.value >= t)).length}/${bad.length}`;
  console.log(`RESULT ${probe.id.padEnd(10)} umbral ${probe.threshold} | ${at(0.5)} | ${at(0.6)} | ${at(0.7)} | ${at(0.8)}`);
  for (const r of rows) {
    const miss = r.c.ok ? !(r.value >= probe.threshold) : r.value >= probe.threshold;
    if (miss) console.log(`RESULT   ${r.c.ok ? "BUENA rechazada" : "MALA aprobada "} ${r.value.toFixed(2)}${r.gated ? " (compuerta)" : ""} | ${r.c.note} | ${r.c.call.request.slice(0, 60)}`);
  }
}
