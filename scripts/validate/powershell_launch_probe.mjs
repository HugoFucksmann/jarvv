/**
 * Cómo lanzar PowerShell desde Node sin que se rompan los errores, el código de salida ni las tildes. Es la investigación que está detrás de
 * `buildCommandLine` en `src/tools/terminal/terminalProvider.ts`. Solo Windows, sin dependencias del proyecto.
 *
 *   node scripts/validate/powershell_launch_probe.mjs
 *
 * Parte 1: `-EncodedCommand` frente a `-Command` con el script en base64 dentro de un bloque. Con `-EncodedCommand`, PowerShell escribe los errores en
 *          CLIXML (XML) aunque se pida `-OutputFormat Text` o `-InputFormat`; con `-Command`, en texto.
 * Parte 2: el código de salida, según dónde se calcule (`$?` después de un bloque no refleja lo que falló dentro).
 * Parte 3: la página de códigos. Las herramientas del sistema de Windows (`ipconfig`, `chcp`) escriben en la página OEM (850) aunque se fuerce UTF-8:
 *          ni `chcp 65001` lo arregla, y decodificar en 850 rompería lo que sí es UTF-8.
 */

import { spawn } from "node:child_process";

if (process.platform !== "win32") {
  console.error("Solo Windows.");
  process.exit(1);
}

const EPILOGUE = "if ($?) { exit 0 } else { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } else { exit 1 } }";
const PROLOGUE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'";
const b64 = (text) => Buffer.from(text, "utf16le").toString("base64");
const blockOf = (script) => `& ([scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64(script)}'))))`;

function launch(args, decode = "utf-8") {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", ...args], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("close", (code) => resolve({ code, out: new TextDecoder(decode).decode(Buffer.concat(out)), err: new TextDecoder(decode).decode(Buffer.concat(err)) }));
  });
}

const show = (label, r) => {
  console.log(`\n--- ${label} (exit ${r.code})`);
  console.log("    stdout:", JSON.stringify(r.out.slice(0, 160)));
  console.log("    stderr:", JSON.stringify(r.err.slice(0, 200)));
};

console.log("===== Parte 1: ¿errores en texto o en CLIXML? =====");
const failing = "Get-Item C:\\no_existe_xyz\ncmd /c \"echo desde-stderr 1>&2\"\nWrite-Output fin";
show("-EncodedCommand -OutputFormat Text", await launch(["-OutputFormat", "Text", "-EncodedCommand", b64(failing)]));
show("-Command con el script en base64 dentro de un bloque", await launch(["-Command", `${PROLOGUE}; ${blockOf(failing)}`]));

console.log("\n===== Parte 2: ¿dónde se calcula el código de salida? =====");
const cases = { "exit 7": "exit 7", "cmd /c exit 3": "cmd /c exit 3", "cmdlet que falla": "Get-Item C:\\no_existe_xyz", "todo bien": "Write-Output ok" };
for (const [label, command] of Object.entries(cases)) {
  const inside = await launch(["-Command", `${PROLOGUE}; ${blockOf(`${command}\n${EPILOGUE}`)}`]);
  const outside = await launch(["-Command", `${PROLOGUE}; ${blockOf(command)}; ${EPILOGUE}`]);
  console.log(`  ${label.padEnd(18)} cierre DENTRO del bloque: exit ${inside.code}   |   cierre FUERA del bloque: exit ${outside.code}`);
}
console.log("  (dentro es lo correcto: fuera, `$?` es verdadero aunque lo de adentro haya fallado)");

console.log("\n===== Parte 3: página de códigos =====");
const body = ["ipconfig | Select-Object -First 3", 'cmd /c "echo ñandú"', "Write-Output 'cmdlet: ñandú € “comillas” 日本'", "chcp"].join("\n");
show("UTF-8 forzado (lo que hace run_command)", await launch(["-Command", `${PROLOGUE}; ${blockOf(body)}`]));
show("chcp 65001 antes", await launch(["-Command", `chcp 65001 > $null; ${PROLOGUE}; ${blockOf(body)}`]));
show("sin tocar la codificación, leído como windows-1252", await launch(["-Command", `$ProgressPreference='SilentlyContinue'; ${blockOf(body)}`], "windows-1252"));
