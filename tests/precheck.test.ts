/** Pre-chequeo determinista: rechaza solo lo comprobable y, ante la duda, calla. El analizador de PowerShell se reemplaza por un doble. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { collectSources, normalizeText, precheckCall, REF_SOURCE_MAX_BYTES, unwrapPowerShellCommand } from "../src/core/engine/precheck.ts";
import type { CommandAnalyzer, PrecheckInput } from "../src/core/engine/precheck.ts";
import { buildContext, newContext } from "./fixtures.ts";

const environment = { platform: "windows" as const, home: "C:\\Users\\Ana", documents: "C:\\Users\\Ana\\Documents" };
const noAnalyzer: CommandAnalyzer = async () => null;

function input(over: Partial<PrecheckInput> & Pick<PrecheckInput, "tool" | "args">): PrecheckInput {
  return { kind: "read", sources: { text: normalizeText("lee C:\\Users\\Ana\\Documents\\informe.txt y https://sitio.com/a"), complete: true }, environment, ...over };
}

test("valores vacíos o N/A piden información (info_missing); un content vacío es válido", async () => {
  assert.equal((await precheckCall(input({ tool: "read_file", args: { path: "" } }), noAnalyzer))?.review, "info_missing");
  assert.equal((await precheckCall(input({ tool: "read_file", args: { path: "N/A" } }), noAnalyzer))?.review, "info_missing");
  assert.equal(await precheckCall(input({ tool: "write_file", kind: "write", args: { path: "C:\\Users\\Ana\\Documents\\vacio.txt", content: "" } }), noAnalyzer), null);
});

test("marcadores de posición se rechazan, pero no dentro de un texto que se escribe", async () => {
  const bad = await precheckCall(input({ tool: "fetch", args: { url: "https://example.com/x" } }), noAnalyzer);
  assert.equal(bad?.review, "args_invalid");
  assert.equal(await precheckCall(input({ tool: "write_file", kind: "write", args: { path: "C:\\Users\\Ana\\Documents\\n.txt", content: "usar <usuario> aquí" } }), noAnalyzer), null);
});

test("una ruta bajo la carpeta de otro usuario se rechaza; las carpetas del sistema no", async () => {
  const other = await precheckCall(input({ tool: "read_file", args: { path: "C:\\Users\\Pedro\\Documents\\informe.txt" } }), noAnalyzer);
  assert.equal(other?.review, "args_invalid");
  assert.match(other?.reason ?? "", /another user/);
  assert.equal(await precheckCall(input({ tool: "list_directory", args: { path: "C:\\Users\\Public" }, sources: { text: "c:/users/public", complete: true } }), noAnalyzer), null);
});

test("una ruta o URL de lectura que no aparece en nada de lo que la tarea sabe se rechaza", async () => {
  assert.equal((await precheckCall(input({ tool: "read_file", args: { path: "C:\\Datos\\inventado.txt" } }), noAnalyzer))?.review, "args_invalid");
  assert.equal((await precheckCall(input({ tool: "fetch", args: { url: "https://otro.com/b" } }), noAnalyzer))?.review, "args_invalid");
});

test("una ruta o URL con origen pasa (ruta completa, carpeta conocida o nombre de archivo)", async () => {
  assert.equal(await precheckCall(input({ tool: "read_file", args: { path: "C:\\Users\\Ana\\Documents\\informe.txt" } }), noAnalyzer), null);
  assert.equal(await precheckCall(input({ tool: "list_directory", args: { path: "C:\\Users\\Ana\\Documents" } }), noAnalyzer), null);
  assert.equal(await precheckCall(input({ tool: "read_file", args: { path: "D:\\copia\\informe.txt" } }), noAnalyzer), null);
  assert.equal(await precheckCall(input({ tool: "fetch", args: { url: "https://www.sitio.com/a/" } }), noAnalyzer), null);
});

test("si hay resultados guardados aparte (fuentes incompletas) no se rechaza por 'no aparece'", async () => {
  const sources = { text: "nada", complete: false };
  assert.equal(await precheckCall(input({ tool: "read_file", args: { path: "C:\\Datos\\otro.txt" }, sources }), noAnalyzer), null);
});

test("una escritura comprueba sus rutas de origen (source) y un destino fuera de las carpetas del usuario que no sale de ningún lado", async () => {
  assert.equal((await precheckCall(input({ tool: "write_file", kind: "write", args: { path: "C:\\Nuevo\\resumen.txt", content: "x" } }), noAnalyzer))?.review, "args_invalid");
  assert.equal(await precheckCall(input({ tool: "write_file", kind: "write", args: { path: "C:\\Users\\Ana\\Documents\\resumen.txt", content: "x" } }), noAnalyzer), null);
  assert.equal((await precheckCall(input({ tool: "move_file", kind: "write", args: { source: "C:\\Fantasma\\a.txt", destination: "C:\\Nuevo\\a.txt" } }), noAnalyzer))?.review, "args_invalid");
});

test("comandos en Windows: ruta Linux, sintaxis, comando inexistente y opciones estilo Linux", async () => {
  const run = (command: string, analyzer: CommandAnalyzer) => precheckCall(input({ tool: "run_command", kind: "write", args: { command } }), analyzer);
  assert.match((await run("cat /etc/hosts", noAnalyzer))?.reason ?? "", /Linux path/);
  assert.match((await run("Get-Process -", async () => ({ syntaxErrors: ["Missing argument"], commands: [] })))?.reason ?? "", /syntax error/);
  assert.match((await run("ps aux", async () => ({ syntaxErrors: [], commands: [{ name: "aux", kind: "None", dashOptions: [] }] })))?.reason ?? "", /does not exist/);
  assert.match((await run("ls -la", async () => ({ syntaxErrors: [], commands: [{ name: "ls", kind: "Alias", dashOptions: ["-la"] }] })))?.reason ?? "", /Linux-style options/);
  assert.equal(await run("Get-Process", async () => ({ syntaxErrors: [], commands: [{ name: "Get-Process", kind: "Cmdlet", dashOptions: [] }] })), null);
});

test("si el analizador falla (null), el comando no se rechaza", async () => {
  assert.equal(await precheckCall(input({ tool: "run_command", kind: "write", args: { command: "Get-Process" } }), noAnalyzer), null);
});

test("unwrapPowerShellCommand extrae el texto interior de powershell -Command", () => {
  assert.equal(unwrapPowerShellCommand('powershell -NoProfile -Command "Get-Date"'), "Get-Date");
  assert.equal(unwrapPowerShellCommand("Get-Date"), null);
});

test("collectSources: solo lo ejecutado bien da origen, y una ref ilegible vuelve incompletas las fuentes", () => {
  const ctx = buildContext("reactive", "running");
  const sources = collectSources(ctx);
  assert.ok(sources.text.includes("informes de ventas"), "el pedido es fuente");
  assert.ok(sources.text.includes("informe_ventas.txt"), "los args de una llamada ok son fuente");
  assert.ok(!sources.text.includes("no_existe.txt"), "los args de un intento fallido no lo son");
  assert.equal(sources.complete, false, "la ref del fixture no existe en disco");
});

test("collectSources: una ref mayor que REF_SOURCE_MAX_BYTES marca fuentes incompletas y evita falsos rechazos", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ref-cap-"));
  try {
    const exactFile = path.join(dir, "exact.txt");
    const bigFile = path.join(dir, "big.txt");
    const prefixUrl = "https://primera.invalid/inicio";
    const tailUrl = "https://despues-del-tope.invalid/recurso";
    fs.writeFileSync(exactFile, prefixUrl.padEnd(REF_SOURCE_MAX_BYTES, "a"), "utf8");
    fs.writeFileSync(bigFile, `${"b".repeat(REF_SOURCE_MAX_BYTES)}\n${tailUrl}`, "utf8");

    const addRefCall = (where: string) => {
      const ctx = newContext("reactive");
      const s1 = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "buscar", route: null, expected: null } }).ids[0];
      const ref = ctx.apply({ op: "add", target: "refs", value: { stepId: s1, label: "web_search", size: fs.statSync(where).size, where } }).ids[0];
      ctx.apply({ op: "add", target: "calls", value: { stepId: s1, route: "web", tool: "web_search", kind: "read", args: { need: "x" }, sig: "s", status: "ok", summary: "ok", ref } });
      return ctx;
    };

    const exactSources = collectSources(addRefCall(exactFile));
    assert.equal(exactSources.complete, true, "hasta REF_SOURCE_MAX_BYTES exacto sigue completo");
    assert.equal(await precheckCall(input({ tool: "fetch", args: { url: prefixUrl }, sources: exactSources }), noAnalyzer), null);
    assert.equal((await precheckCall(input({ tool: "fetch", args: { url: tailUrl }, sources: exactSources }), noAnalyzer))?.review, "args_invalid");

    const bigSources = collectSources(addRefCall(bigFile));
    assert.equal(bigSources.complete, false, "si la ref excede REF_SOURCE_MAX_BYTES, no es concluyente");
    assert.equal(await precheckCall(input({ tool: "fetch", args: { url: tailUrl }, sources: bigSources }), noAnalyzer), null, "no rechaza una URL que quedó más allá del tope");
    assert.equal((await precheckCall(input({ tool: "fetch", args: { url: "ftp://despues-del-tope.invalid/recurso" }, sources: bigSources }), noAnalyzer))?.review, "args_invalid", "las reglas de sintaxis siguen corriendo");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── Destino de una escritura con origen ─────────────────────────

test("escritura: un destino fuera de las carpetas del usuario que no sale de ningún lado se rechaza; con origen o dentro de ENV, no", async () => {
  const write = (args: Record<string, unknown>, tool = "create_directory", request = "creá la carpeta backup") =>
    precheckCall(input({ tool, kind: "write", args, sources: { text: normalizeText(request), complete: true } }), noAnalyzer);

  // Inventados: no están en el pedido ni en ENV.
  for (const path of ["D:\\proyectos\\facturacion\\backup", "E:\\datos\\reportes\\Reportes", "F:\\trabajo\\clientes"]) {
    assert.equal((await write({ path }))?.review, "args_invalid", path);
  }
  assert.equal((await write({ source: "C:\\Users\\Ana\\Documents\\a.txt", destination: "D:\\archivo\\a.txt" }, "move_file", "mové C:\\Users\\Ana\\Documents\\a.txt"))?.review, "args_invalid", "destino de move_file");

  // Con origen o dentro de las carpetas del usuario: se aceptan.
  assert.equal(await write({ path: "C:\\Users\\Ana\\Documents\\backup" }), null, "dentro de ENV");
  assert.equal(await write({ path: "D:\\proyectos\\backup" }, "create_directory", "creá la carpeta D:\\proyectos\\backup"), null, "la ruta está en el pedido");
  assert.equal(await write({ path: "notas.txt", content: "x" }, "write_file", "guardá en notas.txt"), null, "una ruta relativa no se juzga");
  assert.equal(await write({ source: "C:\\Users\\Ana\\Documents\\a.txt", destination: "C:\\Users\\Ana\\Documents\\b.txt" }, "move_file", "renombrá a.txt"), null);
});

test("escritura: la comprobación del destino se omite si hay resultados guardados aparte (fuentes incompletas)", async () => {
  const finding = await precheckCall(input({ tool: "create_directory", kind: "write", args: { path: "D:\\x\\y" }, sources: { text: "x", complete: false } }), noAnalyzer);
  assert.equal(finding, null);
});

// ───────────────────────── La carpeta que contiene al archivo tiene que existir ─────────────────────────

import fsForParent from "node:fs";
import osForParent from "node:os";
import pathForParent from "node:path";

test("write_file y move_file: si la carpeta contenedora no existe se rechaza con una razón útil; create_directory no entra", async () => {
  const home = fsForParent.mkdtempSync(pathForParent.join(osForParent.tmpdir(), "jarvis-parent-"));
  try {
    fsForParent.mkdirSync(pathForParent.join(home, "existe"));
    const env = { platform: "windows" as const, home };
    const run = (tool: string, args: Record<string, unknown>) =>
      precheckCall(input({ tool, kind: "write", args, environment: env, sources: { text: normalizeText(JSON.stringify(args)), complete: true } }), noAnalyzer);

    const missing = await run("write_file", { path: pathForParent.join(home, "jarvis", "nota.md"), content: "x" });
    assert.equal(missing?.review, "args_invalid");
    assert.match(missing?.reason ?? "", /does not exist.*create the folder first/i);
    assert.equal(await run("write_file", { path: pathForParent.join(home, "existe", "nota.md"), content: "x" }), null, "la carpeta existe");
    assert.equal((await run("move_file", { source: pathForParent.join(home, "existe", "a.txt"), destination: pathForParent.join(home, "nueva", "a.txt") }))?.review, "args_invalid");
    assert.equal(await run("create_directory", { path: pathForParent.join(home, "a", "b", "c") }), null, "create_directory crea las intermedias");
    assert.equal(await run("write_file", { path: "nota.md", content: "x" }), null, "una ruta relativa no se juzga");
  } finally {
    fsForParent.rmSync(home, { recursive: true, force: true });
  }
});

test("la comprobación de la carpeta contenedora se omite si la carpeta de inicio del entorno no existe en esta PC (entornos inventados)", async () => {
  const env = { platform: "windows" as const, home: pathForParent.join(osForParent.tmpdir(), "no-existe-jarvis-home") };
  const args = { path: pathForParent.join(env.home, "x", "nota.md"), content: "x" };
  assert.equal(await precheckCall(input({ tool: "write_file", kind: "write", args, environment: env, sources: { text: normalizeText(args.path), complete: true } }), noAnalyzer), null);
});

// ───────────────────────── Registro de reglas y validaciones nuevas ─────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseAnalyzerOutput, precheckRuleNames } from "../src/core/engine/precheck.ts";

const BS = String.fromCharCode(92);
const win = (...parts: string[]): string => ["C:", "Users", "Ana", ...parts].join(BS);

test("registro: las reglas tienen nombre único y las existentes siguen en su orden", () => {
  const names = precheckRuleNames();
  for (const list of [names.call, names.value, names.source]) assert.equal(new Set(list).size, list.length, "nombres únicos");
  assert.deepEqual(names.value.slice(0, 4), ["empty-value", "na-value", "placeholder", "other-user-folder"], "las reglas anteriores primero: un caso que ya se rechazaba da la misma razón");
  assert.deepEqual(names.source, ["url-source", "write-destination-source", "read-path-source"]);
  assert.ok(names.call.indexOf("argument-values") < names.call.indexOf("parent-folder") && names.call.indexOf("command-analysis") < names.call.indexOf("argument-sources"));
});

test("url-syntax: un esquema que no es http(s) o una URL que no se puede analizar se rechaza antes de llegar a la herramienta", async () => {
  const run = (url: string) => precheckCall(input({ tool: "fetch", args: { url }, sources: { text: normalizeText(`lee ${url}`), complete: true } }), noAnalyzer);
  assert.match((await run("ftp://sitio.com/a"))?.reason ?? "", /Only http and https/);
  assert.match((await run("file:///C:/datos.txt"))?.reason ?? "", /Only http and https/);
  assert.match((await run("https://usuario:clave@sitio.com/a"))?.reason ?? "", /credentials/);
  assert.match((await run("https://sitio .com/a"))?.reason ?? "", /not a valid URL/);
  assert.equal(await run("https://sitio.com/a"), null);
  assert.equal(await run("sitio.com/a"), null, "sin esquema se acepta (la herramienta la normaliza)");
});

test("windows-invalid-path: caracteres que Windows no admite y, al escribir, comodines y nombres reservados", async () => {
  const write = (p: string, tool = "write_file") => precheckCall(input({ tool, kind: "write", args: { path: p, content: "x" }, sources: { text: "", complete: true } }), noAnalyzer);
  assert.match((await write(win("Documents", "a<b.txt")))?.reason ?? "", /does not allow/);
  assert.match((await write(win("Documents", "a*.txt")))?.reason ?? "", /wildcard/);
  assert.match((await write(win("Documents", "CON.txt")))?.reason ?? "", /reserved/);
  assert.match((await write(win("Documents", "nota.")))?.reason ?? "", /ends with a dot/);
  assert.equal(await write(win("Documents", "nota.txt")), null);
  // Una lectura admite el comodín (lo juzga el origen, no esta regla).
  const read = await precheckCall(input({ tool: "read_file", args: { path: win("Documents", "informe*.txt") }, sources: { text: normalizeText(win("Documents", "informe*.txt")), complete: true } }), noAnalyzer);
  assert.equal(read, null);
});

test("same-source-destination: mover algo a donde ya está", async () => {
  const found = await precheckCall(input({ tool: "move_file", kind: "write", args: { source: win("Documents", "a.txt"), destination: `${win("Documents", "A.txt").split(BS).join("/")}/` }, sources: { text: "", complete: true } }), noAnalyzer);
  assert.match(found?.reason ?? "", /same path/);
});

test("path-kind: lo que hay en disco no es lo que la herramienta espera (solo si la carpeta de inicio del entorno existe aquí)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-kind-"));
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "x");
  const env = { platform: "windows" as const, home: dir };
  const run = (tool: string, kind: "read" | "write", args: Record<string, unknown>) =>
    precheckCall({ tool, kind, args, sources: { text: normalizeText(JSON.stringify(args)), complete: true }, environment: env }, noAnalyzer);
  try {
    assert.match((await run("write_file", "write", { path: dir, content: "x" }))?.reason ?? "", /is a folder/);
    assert.match((await run("read_file", "read", { path: dir }))?.reason ?? "", /is a folder/);
    assert.match((await run("list_directory", "read", { path: file }))?.reason ?? "", /is a file/);
    assert.match((await run("move_file", "write", { source: path.join(dir, "no_existe.txt"), destination: path.join(dir, "b.txt") }))?.reason ?? "", /does not exist/);
    assert.equal(await run("read_file", "read", { path: file }), null);
    assert.equal(await run("list_directory", "read", { path: dir }), null);
    assert.equal(await run("move_file", "write", { source: file, destination: path.join(dir, "b.txt") }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Con un entorno que no existe en esta PC no se juzga contra el disco.
  assert.equal(await precheckCall(input({ tool: "move_file", kind: "write", args: { source: win("Documents", "x.txt"), destination: win("Documents", "y.txt") }, sources: { text: normalizeText(`${win("Documents", "x.txt")} ${win("Documents", "y.txt")}`), complete: true } }), noAnalyzer), null);
});

test("analizador de PowerShell: el JSON de ConvertTo-Json (un elemento suelto, arreglos vacíos) se normaliza a arreglos", () => {
  const one = parseAnalyzerOutput(JSON.stringify({ syntaxErrors: "falta }", commands: { name: "Get-Item", kind: "Cmdlet", dashOptions: "--x" }, detectedPaths: "C:/a", unresolvablePaths: [] }));
  assert.deepEqual(one.syntaxErrors, ["falta }"]);
  assert.deepEqual(one.commands, [{ name: "Get-Item", kind: "Cmdlet", dashOptions: ["--x"] }]);
  assert.deepEqual(one.detectedPaths, ["C:/a"]);
  assert.equal(one.unresolvablePaths, undefined, "vacío = ausente");
  const none = parseAnalyzerOutput(JSON.stringify({ syntaxErrors: null, commands: null }));
  assert.deepEqual(none, { syntaxErrors: [], commands: [] });
  assert.throws(() => parseAnalyzerOutput("no es json"));
});
