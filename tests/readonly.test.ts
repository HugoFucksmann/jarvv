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
    "npm install",
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

const TERMINAL = "jarvis_terminal";

test("isReadOnlyCall: solo run_command de jarvis_terminal: un comando de PowerShell de solo lectura, o una continuación sin respuesta", () => {
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", { command: "Get-Process" }), true);
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", { command: "Remove-Item C:\\x\\a.txt" }), false);
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", { command: 42 }), false);
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", { command: "Get-Process", pid: 7 }), false, "un comando nuevo y un pid a la vez no es una lectura");
  // Continuar un proceso ya aprobado solo espera más salida; enviarle texto es otra cosa.
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", { pid: 7 }), true);
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", { pid: 7, timeoutSec: 60 }), true);
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", { pid: 7, input: "s" }), false);
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", { pid: "7" }), false);
  assert.equal(isReadOnlyCall(TERMINAL, "run_command", {}), false);
  assert.equal(isReadOnlyCall(TERMINAL, "otra_herramienta", { command: "Get-Process" }), false);
  assert.equal(isReadOnlyCall("otro_servidor", "run_command", { command: "Get-Process" }), false);
  assert.equal(isReadOnlyCall(DC, "start_process", { command: "Get-Process" }), false, "las tools de proceso de Desktop Commander ya no están en el catálogo");
});

test("Guard: un comando de lectura se permite sin confirmación; uno que escribe sigue pidiéndola; lo catastrófico se deniega igual", () => {
  assert.equal(Guard.evaluate(TERMINAL, "run_command", { command: "Get-ChildItem C:\\x" }).decision, "ALLOW");
  assert.equal(Guard.evaluate(TERMINAL, "run_command", { command: "Remove-Item C:\\x\\a.txt" }).decision, "APPROVAL");
  assert.equal(Guard.evaluate(TERMINAL, "run_command", { command: "Get-Process | Stop-Process" }).decision, "APPROVAL");
  assert.equal(Guard.evaluate(TERMINAL, "run_command", { command: "format c:" }).decision, "DENY");
  assert.equal(Guard.evaluate(TERMINAL, "run_command", { pid: 1 }).decision, "ALLOW", "esperar más salida de un proceso ya aprobado no vuelve a pedir confirmación");
  assert.equal(Guard.evaluate(TERMINAL, "run_command", { pid: 1, input: "Get-Process" }).decision, "APPROVAL");
});

test("RC-22: consultas de versión y lecturas de npm y del sistema con argumentos exactos son de lectura", () => {
  for (const command of [
    "node --version",
    "node -v",
    "npm -v",
    "npm ls",
    "npm ls --depth=0",
    "npm outdated",
    "npm view express version",
    "npm config get prefix",
    "git --version",
    "python --version",
    "py -0",
    "dotnet --list-sdks",
    "java -version",
    "go version",
    "where.exe node",
    "ipconfig",
    "ipconfig /all",
    "netstat -ano",
    "node --version; npm --version; git --version",
    "Get-Module -ListAvailable | Select-Object -First 5 Name",
    "Resolve-DnsName example.com",
  ]) assert.equal(isReadOnlyCommand(command), true, command);
});

test("RC-22: los mismos programas con otros argumentos siguen siendo escrituras (fail-closed)", () => {
  for (const command of [
    "node -e \"require('fs').rmSync('x')\"",
    "node script.js",
    "node --version script.js",
    "npm install",
    "npm i lodash",
    "npm run build",
    "npm test",
    "npm config set prefix C:\\x",
    "npm exec rimraf x",
    "npx rimraf x",
    "npx --version",
    "git status",
    "git diff",
    "git -c core.fsmonitor=calc status",
    "python -c 1",
    "python -v",
    "python --version x.py",
    "pip list",
    "yarn --version",
    "ipconfig /release",
    "ipconfig /flushdns",
    "netstat 5",
    "getmac /s otra /u admin /p clave",
    "where.exe",
    "dotnet run",
    "go env -w GOPATH=x",
    "node --version > a.txt",
    "node --version; Remove-Item x",
  ]) assert.equal(isReadOnlyCommand(command), false, command);
});

// ───────────────────────── Comandos que se pueden volver a correr (RC-21) ─────────────────────────

test("RC-21: pruebas, compilaciones y chequeos (con cambios de carpeta y lecturas alrededor) se pueden volver a correr tras un cambio", async () => {
  const { isRerunnableCommand } = await import("../src/core/policy/rerun.ts");
  for (const command of [
    "npm test",
    "npm t",
    "npm run build",
    "npm run test:unit",
    "cd C:\\Users\\Ana\\proyecto; npm test",
    "Set-Location C:\\proyecto; npm run lint; git status",
    "npx tsc --noEmit",
    "yarn test",
    "pnpm build",
    "pytest -q",
    "python -m pytest tests",
    "dotnet test",
    "cargo build --release",
    "go test ./...",
    "node --test",
    "npm test | Select-String fail",
  ]) assert.equal(isRerunnableCommand(command), true, command);
});

test("RC-21: lo que acumula, registra, publica, instala o borra sigue sin repetirse (fail-closed)", async () => {
  const { isRerunnableCommand } = await import("../src/core/policy/rerun.ts");
  for (const command of [
    "Add-Content notas.txt cambio",
    "echo cambio >> notas.txt",
    "npm test > salida.txt",
    "git commit -m arreglo",
    "git push",
    "npm install",
    "npm publish",
    "npm run deploy",
    "npm test; Remove-Item dist -Recurse",
    "npm test; Add-Content log.txt ok",
    "cd C:\\x",
    "Get-ChildItem",
    "npx rimraf dist",
    "python script.py",
    "& npm test",
    "npm test $env:X; $y = 1",
  ]) assert.equal(isRerunnableCommand(command), false, command);
});
