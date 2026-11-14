/** Rutas sensibles: claves, credenciales, navegadores y lugares de inicio automático piden confirmación obligatoria, también en modo automático. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Guard } from "../src/core/policy/guard.ts";
import { sensitivePathFinding } from "../src/core/policy/sensitivePaths.ts";

const DC = "desktop_commander";
const find = (args: Record<string, unknown>, write = false) => sensitivePathFinding(args, write)?.id ?? null;

test("secretos: se detectan al leer y al escribir, con cualquier forma de ruta", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ path: "C:\\Users\\Ana\\.ssh\\id_rsa" }, "ssh-keys"],
    [{ path: "/home/ana/.ssh" }, "ssh-keys"],
    [{ path: "C:\\Users\\Ana\\.aws\\credentials" }, "cloud-credentials"],
    [{ path: "C:\\proyecto\\.env" }, "dotenv"],
    [{ path: "C:\\proyecto\\.env.local" }, "dotenv"],
    [{ path: "C:\\Users\\Ana\\.config\\gh\\hosts.yml" }, "cloud-credentials"],
    [{ path: "C:\\Users\\Ana\\AppData\\Roaming\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt" }, "shell-history"],
    [{ path: "C:\\claves\\servidor.pem" }, "private-keys"],
    [{ path: "C:\\Users\\Ana\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data" }, "browser-data"],
    [{ path: "C:\\Users\\Ana\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\x\\logins.json" }, "browser-data"],
    [{ path: "C:\\Users\\Ana\\AppData\\Roaming\\Microsoft\\Credentials\\ABC" }, "windows-credentials"],
    [{ path: "C:\\Windows\\System32\\config\\SAM" }, "windows-credentials"],
    [{ paths: ["C:\\x\\a.txt", "C:\\Users\\Ana\\.ssh\\config"] }, "ssh-keys"],
    [{ source: "C:\\x\\a.txt", destination: "C:\\Users\\Ana\\.gnupg\\a" }, "gnupg"],
    [{ command: "Get-Content ~\\.ssh\\id_rsa" }, "ssh-keys"],
    [{ command: "Get-ChildItem Env:" }, "env-listing"],
    [{ command: "gci env:" }, "env-listing"],
    [{ command: "Write-Output $env:OPENAI_API_KEY" }, "env-secret"],
    [{ command: "Get-ItemProperty HKLM:\\SAM" }, "registry-secrets"],
    [{ command: "rundll32 comsvcs.dll MiniDump (Get-Process lsass).Id" }, "credential-dumping"],
  ];
  for (const [args, id] of cases) {
    assert.equal(find(args), id, JSON.stringify(args));
    assert.equal(find(args, true), id, `${JSON.stringify(args)} (escribiendo)`);
  }
});

test("lo cotidiano no se marca: documentos, el perfil como carpeta, variables comunes y nombres parecidos", () => {
  for (const args of [
    { path: "C:\\Users\\Ana\\Documents\\informe.txt" },
    { path: "C:\\Users\\Ana" },
    { path: "C:\\proyecto\\environment.md" },
    { path: "C:\\proyecto\\.environment" },
    { path: "C:\\proyecto\\.env.example" },
    { path: "C:\\proyecto\\.env.sample" },
    { path: "C:\\proyecto\\keyboard.txt" },
    { path: "C:\\Users\\Ana\\Downloads\\cookies recipe.pdf" },
    { command: "Get-ChildItem C:\\Users\\Ana\\Documents" },
    { command: "Get-Item $env:USERPROFILE\\Desktop" },
    { command: "Get-Process | Sort-Object WorkingSet -Descending" },
    { command: "Write-Output $env:COMPUTERNAME" },
  ]) assert.equal(find(args), null, JSON.stringify(args));
});

test("solo al escribir: inicio automático, perfiles, sistema y la configuración de Jarvis", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ path: "C:\\Users\\Ana\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\x.bat" }, "startup-folders"],
    [{ path: "C:\\Users\\Ana\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1" }, "shell-profiles"],
    [{ path: "/home/ana/.bashrc" }, "shell-profiles"],
    [{ path: "C:\\Windows\\evil.dll" }, "system-folders"],
    [{ path: "C:\\Program Files\\App\\app.exe" }, "system-folders"],
    [{ path: "/etc/crontab" }, "unix-system"],
    [{ path: "C:\\repo\\.git\\hooks\\pre-commit" }, "git-hooks"],
    [{ path: "E:\\colo\\jarvv\\jarvis-config.json" }, "jarvis-config"],
    [{ source: "C:\\x\\a.txt", destination: "C:\\Windows\\a.txt" }, "system-folders"],
  ];
  for (const [args, id] of cases) {
    assert.equal(find(args, false), null, `${JSON.stringify(args)} (leyendo)`);
    assert.equal(find(args, true), id, JSON.stringify(args));
  }
});

test("no se miran el contenido que se escribe, las URL ni las búsquedas", () => {
  assert.equal(find({ path: "C:\\x\\nota.txt", content: "copiar ~/.ssh/id_rsa a otro lado" }, true), null);
  assert.equal(find({ url: "https://sitio.com/.env" }), null);
  assert.equal(find({ query: "cómo proteger mi .ssh" }), null);
});

test("Guard: una ruta sensible exige confirmación obligatoria, incluso de solo lectura; lo común sigue como antes", () => {
  const sensitive = Guard.evaluate(DC, "read_file", { path: "C:\\Users\\Ana\\.ssh\\id_rsa" });
  assert.equal(sensitive.decision, "APPROVAL");
  assert.equal(sensitive.mandatory, true);
  assert.match(sensitive.reason ?? "", /ssh-keys/);

  const command = Guard.evaluate(DC, "start_process", { command: "Get-Content C:\\Users\\Ana\\.ssh\\id_rsa" });
  assert.equal(command.decision, "APPROVAL", "un comando de solo lectura sobre una ruta sensible ya no se permite solo");
  assert.equal(command.mandatory, true);

  assert.equal(Guard.evaluate(DC, "write_file", { path: "C:\\Windows\\evil.dll", content: "x" }).mandatory, true);
  assert.equal(Guard.evaluate(DC, "write_file", { path: "C:\\Users\\Ana\\Documents\\n.txt", content: "x" }).mandatory, undefined);
  assert.equal(Guard.evaluate(DC, "read_file", { path: "C:\\Users\\Ana\\Documents\\n.txt" }).decision, "ALLOW");
  assert.equal(Guard.evaluate("free_search", "search", { query: "qué es .ssh y ~/.aws/credentials" }).decision, "ALLOW");
  assert.equal(Guard.evaluate(DC, "write_file", { path: "C:\\Users\\Ana\\Documents\\notas.txt", content: "mi clave está en ~/.ssh/id_rsa" }).mandatory, undefined);
});

test("Guard: DENY sigue por encima de la ruta sensible", () => {
  assert.equal(Guard.evaluate(DC, "write_file", { path: "C:\\Windows\\System32\\drivers\\etc\\hosts", content: "x" }).decision, "DENY");
});
