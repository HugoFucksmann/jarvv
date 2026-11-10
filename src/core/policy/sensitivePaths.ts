/**
 * JARVIS Core — Rutas sensibles.
 *
 * Complementa a las reglas de comando (`commandRules.ts`, que miran el QUÉ hace un comando) con una mirada al DÓNDE: hay lugares que ningún
 * modelo debería leer o modificar sin que el usuario lo confirme, se pida con `read_file`, `write_file`, `move_file` o dentro de un comando.
 *
 * Dos listas, sobre rutas con `\` y `/` equivalentes y sin distinguir mayúsculas:
 * - `SECRET_PATTERNS` (siempre, para leer y para escribir): claves y credenciales (`.ssh`, `.env`, `.aws`, claves privadas), datos de los
 *   navegadores (contraseñas y cookies), almacenes de credenciales y de cuentas de Windows, y la lista y los valores de las variables de
 *   entorno que parecen secretos.
 * - `WRITE_PATTERNS` (solo si la llamada escribe): lugares desde donde algo se ejecuta solo (carpetas de inicio, perfiles de shell, tareas
 *   y servicios), el sistema (`Windows`, `Program Files`, `/etc`) y la propia configuración de Jarvis.
 *
 * Un acierto no deniega: exige la confirmación del usuario AUNQUE esté encendido `autoMode` (`GuardDecision.mandatory`). Es una red contra el
 * error o la inyección de instrucciones, no una barrera contra alguien con acceso a la PC. Qué argumentos se miran: las rutas
 * (`path`, `paths`, `source`, `destination`, `directory`, `file`, `folder`, `cwd`) y el texto de un comando; nunca el contenido que se escribe,
 * las URL ni las consultas de búsqueda.
 */

export interface PathFinding {
  /** Identificador estable de la regla. */
  readonly id: string;
  /** Texto para el usuario (va en la confirmación). */
  readonly reason: string;
}

interface PathRule {
  readonly id: string;
  readonly reason: string;
  readonly re: RegExp;
}

/** Fin de un nombre de ruta: fin del texto, espacio, comilla, `/`, `;` o `|`. */
const END = String.raw`(?=$|[\s"'/;|,)])`;
/** Inicio de un nombre: comienzo, `/`, espacio, comilla o `=`. */
const START = String.raw`(?:^|[/\s"'=])`;

const rule = (id: string, reason: string, source: string): PathRule => ({ id, reason, re: new RegExp(source, "i") });

const SECRET_PATTERNS: readonly PathRule[] = [
  rule("ssh-keys", "SSH keys and settings.", String.raw`${START}\.ssh${END}`),
  rule("gnupg", "GnuPG keys.", String.raw`${START}\.gnupg${END}`),
  rule("cloud-credentials", "Cloud or cluster credentials.", String.raw`${START}\.(aws|azure|kube|gcloud)${END}|${START}\.config/gcloud${END}|${START}\.docker/config\.json${END}`),
  rule("token-files", "A file that holds access tokens or passwords.", String.raw`${START}(\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.pgpass|credentials\.json)${END}`),
  rule("dotenv", "An environment file with secrets (.env).", String.raw`${START}\.env(\.[\w.-]+)?${END}`),
  rule("private-keys", "A private key or certificate store.", String.raw`${START}id_(rsa|dsa|ecdsa|ed25519)${END}|\.(pem|key|pfx|p12|ppk|kdbx|jks|keystore)${END}`),
  rule(
    "browser-data",
    "Browser profile data (saved passwords, cookies, sessions).",
    String.raw`/(google/chrome|chromium|microsoft/edge|brave-software|bravesoftware|vivaldi|opera software|mozilla/firefox|mozilla/profiles)/|(appdata|user data|profiles|application support)/[^"']*/(login data|web data|cookies|logins\.json|key[34]\.db)${END}`,
  ),
  rule("windows-credentials", "Windows credential stores and account databases.", String.raw`/microsoft/(credentials|protect|vault)(/|$)|ntuser\.dat|/windows/system32/config/(sam|system|security)${END}|/windows/repair/sam|ntds\.dit`),
  rule("env-listing", "The list of environment variables (may include API keys).", String.raw`(?:^|[\s;|(])(get-childitem|gci|dir|ls|get-item|gi|printenv|env|set)\s+(-path\s+)?(env:|variable:)\*?(?=$|[\s;|)])|(?:^|[\s;|])printenv(?=$|[\s;|])|(?:^|[\s;|])env:(?=$|[\s;|*])`),
  rule("env-secret", "An environment variable that looks like a secret.", String.raw`\$?env:\w*(key|token|secret|pass|pwd|cred|auth)\w*`),
  rule("registry-secrets", "Registry hives with accounts and secrets.", String.raw`(hklm|hkey_local_machine)[:/]*(sam|security)${END}|(hklm|hkey_local_machine)[:/]*system/currentcontrolset/control/lsa`),
  rule("credential-dumping", "Tools that dump credentials.", String.raw`\b(lsass|mimikatz|procdump)\b`),
];

const WRITE_PATTERNS: readonly PathRule[] = [
  rule("startup-folders", "A startup folder: whatever is written there runs at every login.", String.raw`/start menu/programs/startup(/|$)|/programdata/microsoft/windows/start menu`),
  rule("shell-profiles", "A shell profile: it runs every time a shell starts.", String.raw`(microsoft\.powershell_profile|microsoft\.vscode_profile|(^|/)profile)\.ps1${END}|${START}\.(bashrc|bash_profile|bash_login|profile|zshrc|zprofile|zshenv)${END}`),
  rule("system-folders", "System folders (Windows, Program Files).", String.raw`(^|[\s"'=])[a-z]:/(windows|program files|program files \(x86\))(/|$)`),
  rule("unix-system", "System configuration folders.", String.raw`(^|[\s"'=])/(etc|boot|usr/(bin|sbin|lib)|bin|sbin|lib|system/library|library/(launchagents|launchdaemons))(/|$)`),
  rule("autostart", "Autostart entries (cron, systemd, launch agents).", String.raw`/(\.config/(autostart|systemd)|var/spool/cron|cron\.(d|daily|hourly))(/|$)|/library/launchagents(/|$)`),
  rule("git-hooks", "Git hooks run as commands on git operations.", String.raw`/\.git/hooks(/|$)`),
  rule("jarvis-config", "Jarvis' own configuration (it holds the security switches).", String.raw`jarvis-config\.json${END}`),
];

/** Argumentos que nombran una ruta. */
const PATH_KEYS = new Set(["path", "source", "src", "destination", "dest", "directory", "dir", "file", "folder", "cwd"]);
/** Argumentos con el texto de un comando. */
const COMMAND_KEYS = new Set(["command", "cmd", "input"]);

/** `\` y `/` equivalentes, barras repetidas colapsadas y sin distinguir mayúsculas. */
function normalize(text: string): string {
  return text.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
}

/** Textos de los argumentos que se miran (ver la cabecera). */
function scannedTexts(args: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const k = key.toLowerCase();
    if (!PATH_KEYS.has(k) && k !== "paths" && !COMMAND_KEYS.has(k)) continue;
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === "string") out.push(v);
  }
  return out.map(normalize);
}

/**
 * ¿Alguna ruta o comando de los argumentos cae en un lugar sensible? `write`: la llamada escribe (una escritura del catálogo o un comando que
 * no es de solo lectura); con `false` solo se aplican los secretos. Devuelve el primer acierto, o `null`.
 */
export function sensitivePathFinding(args: Readonly<Record<string, unknown>>, write: boolean): PathFinding | null {
  const rules = write ? [...SECRET_PATTERNS, ...WRITE_PATTERNS] : SECRET_PATTERNS;
  for (const text of scannedTexts(args)) {
    for (const r of rules) if (r.re.test(text)) return { id: r.id, reason: r.reason };
  }
  return null;
}
