/**
 * `run_command`: cómo se lanza PowerShell.
 *
 * `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "<prólogo>; <cargar ayudas>; <función script>; script"`:
 * - El prólogo guarda la página OEM de la consola (para las ayudas) y fuerza la salida y la entrada a UTF-8; apaga la barra de progreso.
 * - Las ayudas (`PS_HELPERS`) se leen de un archivo `.ps1` de la carpeta temporal del usuario (`ensureHelpersFile`: ahí está por qué no van en la línea
 *   de comandos). Si no se pueden cargar, el proceso sale sin correr el comando y el proveedor lo relanza sin ayudas. Definen dos cosas:
 *   - `Read-Host` propio: escribe el prompt y lee una línea de la entrada estándar, así que llega a `waiting_input` y se responde con `{ pid, input }`
 *     (el de PowerShell falla en el acto con `-NonInteractive`). `-AsSecureString` falla con un mensaje claro: no se piden contraseñas por el chat.
 *     `pause` es una función que llama a `Read-Host`, así que también se responde.
 *   - Envoltorios de las herramientas del sistema que escriben en la página OEM o ANSI (`LEGACY_TOOLS`): cuando su salida la recoge PowerShell
 *     (`ipconfig | Select-String …`, `$x = ipconfig`), PowerShell la decodificaba como UTF-8 y las tildes se perdían (`Configuraci�n`). El envoltorio
 *     lanza el `.exe` con `Process`, decodifica cada línea (UTF-8 si lo es; si no, la página que da más letras acentuadas) y deja el código de salida en
 *     `$LASTEXITCODE`. Si algo falla antes de lanzarlo, o recibe entrada por la tubería, o es una consola interactiva sin argumentos, llama al `.exe` como siempre.
 * - El comando del modelo va en base64 dentro de la función `script`, con una última línea que da el código de salida (`EPILOGUE`). Una función (y no un
 *   bloque anónimo) para que un `Write-Error` diga `script : <mensaje>` y no repita como contexto el texto entero del comando y del epílogo.
 * No se usa `-EncodedCommand` porque con él PowerShell escribe los errores en CLIXML. El comando no viaja en claro: no hay comillas que escapar.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Herramientas del sistema que escriben en la página OEM/ANSI y que se envuelven (ver arriba). Por su nombre corto y con extensión (`ipconfig`, `ipconfig.exe`, `tree.com`); por la ruta completa, no. */
export const LEGACY_TOOLS: readonly string[] = [
  "arp", "attrib", "certutil", "chcp", "cmdkey", "driverquery", "fsutil", "getmac", "gpresult", "icacls", "ipconfig", "net", "netsh", "netstat",
  "nslookup", "pathping", "ping", "powercfg", "query", "quser", "robocopy", "route", "sc", "schtasks", "systeminfo", "taskkill", "tasklist",
  "tracert", "tree", "whoami", "xcopy",
];

/** Sin argumentos abren una consola propia que lee la entrada: se llaman tal cual para que su prompt (`netsh>`) se vea sin esperar un salto de línea. */
const INTERACTIVE_TOOLS = ["netsh", "nslookup"];

const quoted = (names: readonly string[]): string => names.map((n) => `'${n}'`).join(",");

/**
 * Ayudas que se cargan antes del comando. `$global:__jvFail` lo marca un envoltorio cuyo programa salió con error; se borra en cuanto se busca el comando
 * siguiente (`PostCommandLookupAction`, que se quita a sí mismo), así que solo cuenta si el envoltorio fue lo último que corrió.
 */
export const PS_HELPERS = String.raw`
$global:__jvUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$global:__jvAnsi = [System.Text.Encoding]::Default
$global:__jvFail = $false
function global:Read-Host {
  param([Parameter(Position = 0, ValueFromRemainingArguments = $true)] $Prompt, [switch] $AsSecureString)
  if ($AsSecureString) { throw 'Read-Host -AsSecureString is not available: PowerShell runs without interaction here, and passwords are not asked through the chat.' }
  $text = if ($null -ne $Prompt) { (@($Prompt) -join ' ') + ': ' } else { 'Input: ' }
  [Console]::Out.Write($text)
  [Console]::Out.Flush()
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { throw 'Read-Host: the input stream is closed.' }
  $line
}
function global:__jvQuote([string] $a) {
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"]') { return $a }
  '"' + (($a -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
function global:__jvDecode([byte[]] $b) {
  $n = $b.Length
  if ($n -gt 0 -and $b[$n - 1] -eq 13) { $n-- }
  try { return $global:__jvUtf8.GetString($b, 0, $n) } catch {}
  $o = $global:__jvOem.GetString($b, 0, $n)
  $a = $global:__jvAnsi.GetString($b, 0, $n)
  $letters = '[À-ÖØ-öø-ÿ]'
  if (([regex]::Matches($a, $letters)).Count -gt ([regex]::Matches($o, $letters)).Count) { $a } else { $o }
}
function global:__jvRun([string] $name, [object[]] $argv, [bool] $piped, $pipedInput) {
  $exe = Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $direct = $piped -or ($null -eq $exe) -or ($null -eq $global:__jvOem) -or ($argv.Count -eq 0 -and (@(${quoted(INTERACTIVE_TOOLS)}) -contains $name))
  $p = $null
  if (-not $direct) {
    try {
      $psi = New-Object System.Diagnostics.ProcessStartInfo($exe.Path)
      $psi.Arguments = (@($argv | ForEach-Object { __jvQuote ([string] $_) }) -join ' ')
      $psi.UseShellExecute = $false
      $psi.RedirectStandardOutput = $true
      $psi.WorkingDirectory = (Get-Location -PSProvider FileSystem).ProviderPath
      $p = [System.Diagnostics.Process]::Start($psi)
    } catch { $direct = $true }
  }
  if ($direct) {
    $target = if ($null -ne $exe) { $exe.Path } else { "$name.exe" }
    if ($piped) { $pipedInput | & $target @argv } else { & $target @argv }
    return
  }
  # Si la tubería se corta antes (Select-Object -First), el programa no puede quedar vivo escribiendo a una tubería que nadie lee.
  try {
    $s = $p.StandardOutput.BaseStream
    $buf = New-Object byte[] 8192
    $acc = New-Object System.IO.MemoryStream
    while (($n = $s.Read($buf, 0, $buf.Length)) -gt 0) {
      $start = 0
      while ($start -lt $n -and ($i = [Array]::IndexOf($buf, [byte]10, $start, $n - $start)) -ge 0) {
        $acc.Write($buf, $start, $i - $start)
        __jvDecode $acc.ToArray()
        $acc.SetLength(0)
        $start = $i + 1
      }
      if ($start -lt $n) { $acc.Write($buf, $start, $n - $start) }
    }
    if ($acc.Length -gt 0) { __jvDecode $acc.ToArray() }
    $p.WaitForExit()
  } finally {
    if (-not $p.HasExited) { try { $p.Kill() } catch {} }
  }
  $global:LASTEXITCODE = $p.ExitCode
  if ($p.ExitCode -ne 0) {
    $global:__jvFail = $true
    $ExecutionContext.InvokeCommand.PostCommandLookupAction = { $global:__jvFail = $false; $ExecutionContext.InvokeCommand.PostCommandLookupAction = $null }
  }
}
foreach ($__jvName in @(${quoted(LEGACY_TOOLS)})) {
  $__jvBody = [scriptblock]::Create(('__jvRun ''{0}'' $args $MyInvocation.ExpectingInput $input' -f $__jvName))
  foreach ($__jvAs in @($__jvName, "$__jvName.exe", "$__jvName.com")) { Set-Item -Path "function:global:$__jvAs" -Value $__jvBody }
}
`;

/** Las ayudas que se cargan: todas, o solo `Read-Host` con los envoltorios apagados (`legacyTools: false`). */
export function helpersSource(legacyTools: boolean): string {
  return legacyTools ? PS_HELPERS : PS_HELPERS.slice(0, PS_HELPERS.indexOf("function global:__jvQuote"));
}

/** Variable de entorno con la ruta del archivo de ayudas, el texto que se escribe si no se pudieron cargar y el código de salida con el que se avisa. */
export const HELPERS_ENV = "JARVIS_TERMINAL_HELPERS";
export const HELPERS_UNAVAILABLE = "__JARVIS_HELPERS_UNAVAILABLE__";
export const HELPERS_UNAVAILABLE_EXIT = 97;

/**
 * Escribe las ayudas en un archivo `.ps1` de la carpeta temporal del usuario (una vez por contenido) y devuelve su ruta, o `null` si no se pudo.
 * Van en un archivo y no en la línea de comandos: un bloque grande en base64 dentro de `-Command` es el patrón de un script ofuscado y el antivirus
 * (AMSI) llegó a bloquear el comando entero ("contiene elementos malintencionados"). Se leen como texto (`ReadAllText`), así que la directiva de
 * ejecución no interviene. La carpeta temporal es del usuario: quien puede cambiar el archivo ya puede ejecutar lo que quiera con su cuenta.
 */
export function ensureHelpersFile(legacyTools: boolean, dir: string = path.join(os.tmpdir(), "jarvis-terminal")): string | null {
  const source = helpersSource(legacyTools);
  const file = path.join(dir, `helpers-${createHash("sha256").update(source).digest("hex").slice(0, 16)}.ps1`);
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === source) return file;
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, source, "utf8");
    fs.renameSync(temp, file);
    return file;
  } catch {
    return null;
  }
}

/** Página OEM de la consola (antes de cambiarla), salida y entrada en UTF-8, y sin barras de progreso. Va antes de todo, fuera de la función del comando. */
export const PROLOGUE =
  "$global:__jvOem=[Console]::OutputEncoding; [Console]::OutputEncoding=[Text.Encoding]::UTF8; try { [Console]::InputEncoding=[Text.Encoding]::UTF8 } catch {}; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'";

/**
 * Código de salida del proceso: 0 si el último comando salió bien; si no, el del programa externo que falló, o 1. Un envoltorio de herramienta del sistema
 * que salió con error marca `$__jvFail` (una función no deja `$?` en falso).
 */
export const EPILOGUE =
  "if ($? -and -not $global:__jvFail) { exit 0 } else { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } else { exit 1 } }";

/** El comando tal cual (una línea de comentario final no lo anula) y, en otra línea, el cálculo del código de salida. */
export function buildScript(command: string): string {
  return `${command}\n${EPILOGUE}`;
}

const base64Block = (code: string): string =>
  `[scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(code, "utf16le").toString("base64")}')))`;

export interface CommandLineOptions {
  /** Cargar las ayudas del archivo que nombra `HELPERS_ENV` (por defecto, sí). Si no se pueden cargar, el proceso sale con `HELPERS_UNAVAILABLE_EXIT` sin correr el comando. */
  readonly helpers?: boolean;
}

/** Argumento de `-Command` (ver la cabecera del archivo). */
export function buildCommandLine(command: string, options: CommandLineOptions = {}): string {
  const helpers =
    options.helpers === false
      ? ""
      : `try { . ([scriptblock]::Create([IO.File]::ReadAllText($env:${HELPERS_ENV}))) } catch { [Console]::Error.WriteLine('${HELPERS_UNAVAILABLE}'); exit ${HELPERS_UNAVAILABLE_EXIT} }; `;
  // `script` se llama desde un bloque propio de una sola palabra: la línea de contexto de un error dice `+ script` y no el base64 de alrededor.
  return `${PROLOGUE}; ${helpers}\${function:script} = ${base64Block(buildScript(command))}; & ([scriptblock]::Create('script'))`;
}

export const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] as const;
