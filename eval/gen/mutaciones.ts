/**
 * eval/gen/mutaciones.ts — Dataset `args_review` por mutación: de cada llamada correcta se derivan variantes con una falla
 * introducida a propósito, así la etiqueta es correcta por construcción y cada modo de falla tiene casos suficientes.
 *
 * Uso: npx tsx eval/gen/mutaciones.ts → escribe eval/datasets/mut_args_review.jsonl
 *
 * Límite conocido: solo prueba las fallas que se enumeran acá (es circular). Se complementa con `reales_args_review`
 * (casos de trazas reales). Cada caso malo tiene su par bueno (`pair` en `meta`) para tests pareados.
 */

import { writeFileSync } from "node:fs";

const H = "C:/Users/hugof";

interface Call {
  route: string;
  tool: string;
  kind?: "read" | "write";
  status: string;
  step: number;
  args: Record<string, unknown>;
  summary: string;
  verdict: "approved";
}

interface Base {
  id: string;
  request: string;
  steps: { state: string; instruction: string }[];
  calls?: Call[];
  route: string;
  tool: string;
  args: Record<string, unknown>;
  /** Mutaciones aplicables a esta base: nombre → args mutados y etiqueta esperada. */
  mutations: Record<string, { args: Record<string, unknown>; expected: "args_invalid" | "info_missing" }>;
}

const done = (n: number, s: string): { state: string; instruction: string } => ({ state: "completed", instruction: s + (n ? "" : "") });

const BASES: Base[] = [
  {
    id: "leer-informe",
    request: "leé el informe que está en el escritorio",
    steps: [done(0, "listar los archivos del escritorio"), { state: "running", instruction: "leer informe_final.docx del escritorio" }],
    calls: [{ route: "files", tool: "list_directory", status: "ok", step: 0, args: { path: `${H}/Desktop` }, summary: "balance_2026.xlsx\ninforme_final.docx\nnotas.txt", verdict: "approved" }],
    route: "files",
    tool: "read_file",
    args: { path: `${H}/Desktop/informe_final.docx` },
    mutations: {
      otro_usuario: { args: { path: "C:/Users/usuario/Desktop/informe_final.docx" }, expected: "args_invalid" },
      ruta_sin_origen: { args: { path: `${H}/Desktop/informe.txt` }, expected: "args_invalid" },
      placeholder: { args: { path: "C:/Users/<user>/Desktop/informe_final.docx" }, expected: "args_invalid" },
      vacio: { args: { path: "" }, expected: "info_missing" },
    },
  },
  {
    id: "escribir-nota",
    request: "guardá una nota en el escritorio que diga reunión a las 10",
    steps: [{ state: "running", instruction: "crear notas.txt en el escritorio con el texto 'Reunión a las 10'" }],
    route: "files",
    tool: "write_file",
    args: { path: `${H}/Desktop/notas.txt`, content: "Reunión a las 10" },
    mutations: {
      otro_usuario: { args: { path: "C:/Users/john/Desktop/notas.txt", content: "Reunión a las 10" }, expected: "args_invalid" },
      placeholder: { args: { path: "/path/to/notas.txt", content: "Reunión a las 10" }, expected: "args_invalid" },
      contenido_na: { args: { path: `${H}/Desktop/notas.txt`, content: "N/A" }, expected: "info_missing" },
      ruta_vacia: { args: { path: "", content: "Reunión a las 10" }, expected: "info_missing" },
    },
  },
  {
    id: "mover-informe",
    request: "mové el informe a la carpeta documentos",
    steps: [done(0, "listar el escritorio"), { state: "running", instruction: "mover informe_final.docx del escritorio a Documentos" }],
    calls: [{ route: "files", tool: "list_directory", status: "ok", step: 0, args: { path: `${H}/Desktop` }, summary: "balance_2026.xlsx\ninforme_final.docx\nnotas.txt", verdict: "approved" }],
    route: "files",
    tool: "move_file",
    args: { source: `${H}/Desktop/informe_final.docx`, destination: `${H}/Documents/informe_final.docx` },
    mutations: {
      destino_vacio: { args: { source: `${H}/Desktop/informe_final.docx`, destination: "" }, expected: "info_missing" },
      origen_sin_origen: { args: { source: `${H}/Desktop/informe_2025.docx`, destination: `${H}/Documents/informe_2025.docx` }, expected: "args_invalid" },
      otro_usuario: { args: { source: `${H}/Desktop/informe_final.docx`, destination: "C:/Users/user/Documents/informe_final.docx" }, expected: "args_invalid" },
    },
  },
  {
    id: "ram-powershell",
    request: "lista los 10 procesos que más RAM consumen",
    steps: [{ state: "running", instruction: "listar los 10 procesos con más consumo de RAM" }],
    route: "terminal",
    tool: "start_process",
    args: { command: "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 10 Name, WorkingSet", timeout_ms: 5000 },
    mutations: {
      linux_ps: { args: { command: "ps aux --sort=-%mem | head -n 10", timeout_ms: 5000 }, expected: "args_invalid" },
      linux_top_cmd: { args: { command: "top -bn1 | head -n 12", timeout_ms: 5000 }, expected: "args_invalid" },
      sintaxis: { args: { command: "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 10 Name, WorkingSet )", timeout_ms: 5000 }, expected: "args_invalid" },
      cmdlet_inexistente: { args: { command: "Get-Procces | Sort-Object WorkingSet -Descending | Select-Object -First 10", timeout_ms: 5000 }, expected: "args_invalid" },
    },
  },
  {
    id: "contar-descargas",
    request: "decime cuántos archivos hay en descargas",
    steps: [{ state: "running", instruction: "contar los archivos de la carpeta Descargas" }],
    route: "terminal",
    tool: "start_process",
    args: { command: `(Get-ChildItem '${H}/Downloads' -File).Count`, timeout_ms: 5000 },
    mutations: {
      linux_ls: { args: { command: "ls ~/Downloads | wc -l", timeout_ms: 5000 }, expected: "args_invalid" },
      linux_find: { args: { command: "find ~/Downloads -type f | wc -l", timeout_ms: 5000 }, expected: "args_invalid" },
      sintaxis: { args: { command: `(Get-ChildItem '${H}/Downloads' -File.Count`, timeout_ms: 5000 }, expected: "args_invalid" },
    },
  },
  {
    id: "tasklist-cmd",
    request: "decime qué procesos están corriendo",
    steps: [{ state: "running", instruction: "listar los procesos en ejecución" }],
    route: "terminal",
    tool: "start_process",
    args: { command: "tasklist", timeout_ms: 5000 },
    mutations: {
      linux_ps: { args: { command: "ps -ef", timeout_ms: 5000 }, expected: "args_invalid" },
      linux_head: { args: { command: "tasklist | head -n 10", timeout_ms: 5000 }, expected: "args_invalid" },
      opcion_inventada: { args: { command: "ps aux | grep chrome", timeout_ms: 5000 }, expected: "args_invalid" },
    },
  },
  {
    id: "servicios-detenidos",
    request: "mostrame los servicios de windows que están detenidos",
    steps: [{ state: "running", instruction: "listar los servicios detenidos" }],
    route: "terminal",
    tool: "start_process",
    args: { command: "Get-Service | Where-Object Status -eq 'Stopped' | Select-Object -First 20 Name, Status", timeout_ms: 5000 },
    mutations: {
      linux_systemctl: { args: { command: "systemctl list-units --state=failed", timeout_ms: 5000 }, expected: "args_invalid" },
      sintaxis: { args: { command: "Get-Service | Where-Object { $_.Status -eq 'Stopped' | Select-Object Name", timeout_ms: 5000 }, expected: "args_invalid" },
      cmdlet_inexistente: { args: { command: "Get-Services | Where-Object Status -eq 'Stopped'", timeout_ms: 5000 }, expected: "args_invalid" },
    },
  },
  {
    id: "leer-hosts",
    request: "mostrame el contenido del archivo hosts de windows",
    steps: [{ state: "running", instruction: "leer el archivo hosts de Windows" }],
    route: "terminal",
    tool: "start_process",
    args: { command: "Get-Content C:/Windows/System32/drivers/etc/hosts", timeout_ms: 5000 },
    mutations: {
      linux_cat: { args: { command: "cat /etc/hosts", timeout_ms: 5000 }, expected: "args_invalid" },
      linux_sudo: { args: { command: "sudo cat /etc/hosts", timeout_ms: 5000 }, expected: "args_invalid" },
    },
  },
  {
    id: "buscar-python",
    request: "buscá la última versión estable de Python",
    steps: [{ state: "running", instruction: "buscar en la web la última versión estable de Python" }],
    route: "web",
    tool: "research",
    args: { question: "última versión estable de Python" },
    mutations: {
      query_vacia: { args: { question: "" }, expected: "info_missing" },
    },
  },
  {
    id: "leer-pagina-node",
    request: "buscá la última versión estable de Node.js y leé la página",
    steps: [done(0, "buscar en la web la última versión estable de Node.js"), { state: "running", instruction: "leer la página con la versión estable de Node.js" }],
    calls: [{ route: "web", tool: "research", status: "ok", step: 0, args: { question: "última versión estable Node.js" }, summary: "1) Node.js — Download: https://nodejs.org/en/download\n2) Node.js releases: https://nodejs.org/en/about/previous-releases", verdict: "approved" }],
    route: "web",
    tool: "fetch",
    args: { url: "https://nodejs.org/en/download" },
    mutations: {
      url_inventada: { args: { url: "https://www.nodeversions-oficial.com/latest" }, expected: "args_invalid" },
      path_inventado: { args: { url: "https://nodejs.org/en/latest-stable-version" }, expected: "args_invalid" },
      placeholder: { args: { url: "https://example.com/node" }, expected: "args_invalid" },
    },
  },
  {
    id: "comparar-tiendas",
    request: "compará los precios del monitor entre dos tiendas",
    steps: [done(0, "buscar el precio del monitor en tiendas"), { state: "running", instruction: "leer las páginas de las dos tiendas" }],
    calls: [
      {
        route: "web",
        tool: "research",
        status: "ok",
        step: 0,
        args: { question: "precio monitor 27 pulgadas" },
        summary: "1) Tienda A: https://www.tienda-a.com/monitores/27-pulgadas\n2) Tienda B: https://www.tienda-b.com.ar/monitor-27\n3) Reseñas: https://www.reviews-tech.com/monitores",
        verdict: "approved",
      },
    ],
    route: "web",
    tool: "fetch",
    args: { url: "https://www.tienda-a.com/monitores/27-pulgadas" },
    mutations: {
      una_inventada: { args: { url: "https://www.tienda-c.com/monitores" }, expected: "args_invalid" },
      todas_inventadas: { args: { url: "https://www.tienda-x.com/m1" }, expected: "args_invalid" },
    },
  },
  {
    id: "listar-documentos",
    request: "mostrame qué hay en documentos",
    steps: [{ state: "running", instruction: "listar el contenido de la carpeta Documentos" }],
    route: "files",
    tool: "list_directory",
    args: { path: `${H}/Documents` },
    mutations: {
      otro_usuario: { args: { path: "C:/Users/usuario/Documents" }, expected: "args_invalid" },
      subcarpeta_inventada: { args: { path: `${H}/Documents/proyectos_2026` }, expected: "args_invalid" },
    },
  },
  {
    id: "crear-backups",
    request: "creá una carpeta backups en documentos",
    steps: [{ state: "running", instruction: "crear la carpeta backups dentro de Documentos" }],
    route: "files",
    tool: "create_directory",
    args: { path: `${H}/Documents/backups` },
    mutations: {
      otro_usuario: { args: { path: "C:/Users/user/Documents/backups" }, expected: "args_invalid" },
      placeholder: { args: { path: "C:/Users/<usuario>/Documents/backups" }, expected: "args_invalid" },
    },
  },
  {
    id: "buscar-presupuesto",
    request: "buscá los archivos que se llamen presupuesto",
    steps: [{ state: "running", instruction: "buscar archivos cuyo nombre contenga presupuesto" }],
    route: "locate",
    tool: "start_search",
    args: { path: `${H}`, pattern: "presupuesto" },
    mutations: {
      otro_usuario: { args: { path: "C:/Users/john", pattern: "presupuesto" }, expected: "args_invalid" },
      patron_vacio: { args: { path: `${H}`, pattern: "" }, expected: "info_missing" },
    },
  },
];

function scenario(b: Base, args: Record<string, unknown>): Record<string, unknown> {
  return {
    mode: "reactive",
    request: b.request,
    steps: b.steps,
    ...(b.calls ? { calls: b.calls } : {}),
    at: { route: b.route, tool: b.tool, args },
  };
}

const out: string[] = [
  "# Casos args_review por mutación (generado por eval/gen/mutaciones.ts; no editar a mano).",
  "# Cada caso malo tiene su par bueno en `meta.pair`. La falla introducida está en los tags (`mut:<nombre>`).",
];
let good = 0;
let bad = 0;
for (const b of BASES) {
  const goodId = `mut-${b.id}-ok`;
  out.push(
    JSON.stringify({
      id: goodId,
      stage: "args_review",
      tags: ["escenario", "args_review", "mutacion", "control", b.tool],
      description: `Llamada correcta: ${b.request}`,
      scenario: scenario(b, b.args),
      expect: { expectedReview: "approved" },
      meta: { pair: goodId },
    }),
  );
  good++;
  for (const [name, m] of Object.entries(b.mutations)) {
    out.push(
      JSON.stringify({
        id: `mut-${b.id}-${name}`,
        stage: "args_review",
        // Estas mutaciones usan herramientas de Linux que existen en una PC con Git para Windows en el PATH: ahí correrían.
        tags: ["escenario", "args_review", "mutacion", `mut:${name}`, b.tool, ...(["linux_find", "linux_head", "linux_ls"].includes(name) ? ["depende_del_path"] : [])],
        description: `Mutación '${name}' de: ${b.request}`,
        scenario: scenario(b, m.args),
        expect: { expectedReview: m.expected },
        meta: { pair: goodId },
      }),
    );
    bad++;
  }
}
writeFileSync("eval/datasets/mut_args_review.jsonl", `${out.join("\n")}\n`);
console.log(`${good} buenos + ${bad} malos = ${good + bad} casos → eval/datasets/mut_args_review.jsonl`);
