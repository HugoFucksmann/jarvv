/** Pre-chequeo determinista: rechaza solo lo comprobable y, ante la duda, calla. El analizador de PowerShell se reemplaza por un doble. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { collectSources, normalizeText, precheckCall, unwrapPowerShellCommand } from "../src/core/engine/precheck.ts";
import type { CommandAnalyzer, PrecheckInput } from "../src/core/engine/precheck.ts";
import { buildContext } from "./fixtures.ts";

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

test("una escritura solo se comprueba en sus rutas de origen (source), no en el destino", async () => {
  assert.equal(await precheckCall(input({ tool: "write_file", kind: "write", args: { path: "C:\\Nuevo\\resumen.txt", content: "x" } }), noAnalyzer), null);
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
