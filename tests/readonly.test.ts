/** Comandos de terminal de solo lectura: se reconocen solo los demostrables, y todo lo dudoso sigue siendo una escritura. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Guard } from "../src/core/policy/guard.ts";
import { isReadOnlyCall, isReadOnlyCommand } from "../src/core/policy/readOnly.ts";

const DC = "desktop_commander";

test("consultas simples y tuberías de filtrado son de lectura", () => {
  for (const command of [
    "Get-ChildItem C:\\Users\\Ana\\Documents",
    "Get-ChildItem -Path C:\\Users\\Ana -Recurse | Sort-Object Length -Descending | Select-Object -First 5",
    "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 3 Name, Id, WorkingSet",
    "Get-Process | Where-Object WorkingSet -gt 100MB | Measure-Object",
    "Get-Content C:\\x\\a.txt -Tail 20",
    'Select-String -Path C:\\x\\a.txt -Pattern "error; fallo | warning"',
    "Get-Date -Format yyyy-MM-dd",
    "ls; pwd",
    "Get-Item $env:USERPROFILE\\Desktop",
    "hostname",
  ]) assert.equal(isReadOnlyCommand(command), true, command);
});

test("lo que escribe, borra, ejecuta o lanza algo no es de lectura", () => {
  for (const command of [
    "Remove-Item C:\\x\\a.txt",
    "Set-Content C:\\x\\a.txt hola",
    "New-Item C:\\x -ItemType Directory",
    "Get-Process | Stop-Process",
    "Get-ChildItem | ForEach-Object Delete",
    "Invoke-WebRequest https://x.com -OutFile a.zip",
    "Start-Process notepad",
    "node script.js",
    "python -c 1",
    "git status",
    "ipconfig /release",
  ]) assert.equal(isReadOnlyCommand(command), false, command);
});

test("redirecciones, llamadas, subexpresiones, métodos .NET, variables y acentos graves descartan el comando", () => {
  for (const command of [
    "Get-ChildItem > salida.txt",
    "Get-Content a.txt >> b.txt",
    "Get-ChildItem & Remove-Item x",
    "Get-ChildItem && Remove-Item x",
    "Get-Date; (Get-Item x).Delete()",
    "Get-Item [IO.File]::Delete('x')",
    "Get-Process | ForEach-Object { $_.Kill() }",
    'Write-Output "$(Remove-Item x)"',
    "$x = 'C:\\'; Get-ChildItem $x",
    "Get-ChildItem `\nRemove-Item x",
  ]) assert.equal(isReadOnlyCommand(command), false, command);
});

test("-Wait, comillas sin cerrar, vacío y comandos larguísimos no son de lectura", () => {
  assert.equal(isReadOnlyCommand("Get-Content a.txt -Wait"), false);
  assert.equal(isReadOnlyCommand('Select-String -Pattern "abierta'), false);
  assert.equal(isReadOnlyCommand("   "), false);
  assert.equal(isReadOnlyCommand(`Get-ChildItem ${"a".repeat(700)}`), false);
});

test("una regla de comando de cualquier nivel lo descarta aunque empiece por un comando de lectura", () => {
  assert.equal(isReadOnlyCommand("Get-Content C:\\x\\a.txt | Out-String; Get-Date"), true);
  assert.equal(isReadOnlyCommand("Get-Content /etc/shadow"), false);
});

test("isReadOnlyCall: solo start_process de Desktop Commander, con el shell por defecto o PowerShell", () => {
  assert.equal(isReadOnlyCall(DC, "start_process", { command: "Get-Process" }), true);
  assert.equal(isReadOnlyCall(DC, "start_process", { command: "Get-Process", shell: "powershell.exe" }), true);
  assert.equal(isReadOnlyCall(DC, "start_process", { command: "Get-Process", shell: "cmd" }), false);
  assert.equal(isReadOnlyCall(DC, "start_process", { command: 42 }), false);
  assert.equal(isReadOnlyCall(DC, "interact_with_process", { command: "Get-Process" }), false);
  assert.equal(isReadOnlyCall("otro_servidor", "start_process", { command: "Get-Process" }), false);
});

test("Guard: un comando de lectura se permite sin confirmación; uno que escribe sigue pidiéndola; lo catastrófico se deniega igual", () => {
  assert.equal(Guard.evaluate(DC, "start_process", { command: "Get-ChildItem C:\\x" }).decision, "ALLOW");
  assert.equal(Guard.evaluate(DC, "start_process", { command: "Remove-Item C:\\x\\a.txt" }).decision, "APPROVAL");
  assert.equal(Guard.evaluate(DC, "start_process", { command: "Get-Process | Stop-Process" }).decision, "APPROVAL");
  assert.equal(Guard.evaluate(DC, "start_process", { command: "format c:" }).decision, "DENY");
  assert.equal(Guard.evaluate(DC, "interact_with_process", { pid: 1, input: "Get-Process" }).decision, "APPROVAL");
});
