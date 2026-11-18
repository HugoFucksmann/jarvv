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

import { canonicalPath, isAnyAbsolute, stripExtendedPrefix } from "./allowedDirs.ts";
import { isPathArgKey, PATH_LIST_KEY } from "./pathArgs.ts";

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
  rule("cloud-credentials", "Cloud or cluster credentials.", String.raw`${START}\.(aws|azure|kube|gcloud)${END}|${START}\.config/(gcloud|gh)${END}|${START}\.docker/config\.json${END}|${START}\.terraform\.d/credentials\.tfrc\.json${END}`),
  rule("token-files", "A file that holds access tokens or passwords.", String.raw`${START}(\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.pgpass|\.vault-token|\.htpasswd|credentials\.json|creden~[1-9]\.jso)${END}|${START}\.config/git/credentials${END}`),
  rule("shell-history", "Shell history (commands often include tokens and passwords).", String.raw`${START}(consolehost_history\.txt|consol~[1-9]\.txt|\.bash_history|\.zsh_history|\.python_history)${END}`),
  // Las plantillas (`.env.example`, `.env.sample`...) no guardan secretos y se leen a diario.
  rule("dotenv", "An environment file with secrets (.env).", String.raw`${START}\.env(?!\.(example|sample|template|dist)${END})(\.[\w.-]+)?${END}`),
  rule("private-keys", "A private key or certificate store.", String.raw`${START}id_(rsa|dsa|ecdsa|ed25519)${END}|\.(pem|key|pfx|p12|ppk|kdbx|jks|keystore)${END}`),
  rule(
    "browser-data",
    "Browser profile data (saved passwords, cookies, sessions).",
    String.raw`/(google/chrome|chromium|chromi~[1-9]|(microsoft|micros~[1-9])/edge|brave-software|bravesoftware|braves~[1-9]|vivaldi|opera software|operas~[1-9]|(mozilla|mozill~[1-9])/(firefox|profiles|profil~[1-9]))/|(appdata|user data|userda~[1-9]|profiles|profil~[1-9]|application support|applic~[1-9])/[^"']*/(login data|logind~[1-9]|web data|webdat~[1-9]|cookies|logins\.json|logins~[1-9]\.jso|key[34]\.db)${END}`,
  ),
  rule(
    "windows-credentials",
    "Windows credential stores and account databases.",
    String.raw`/(microsoft|micros~[1-9])/(credentials|creden~[1-9]|protect|vault)(/|$)|(ntuser\.dat|ntuser~[1-9]\.dat)|/windows/system32/config/(sam|system|security)${END}|/windows/repair/sam|ntds\.dit`,
  ),
  rule("env-listing", "The list of environment variables (may include API keys).", String.raw`(?:^|[\s;|(])(get-childitem|gci|dir|ls|get-item|gi|printenv|env|set)\s+(-path\s+)?(env:|variable:)\*?(?=$|[\s;|)])|(?:^|[\s;|])printenv(?=$|[\s;|])|(?:^|[\s;|])env:(?=$|[\s;|*])`),
  rule("env-secret", "An environment variable that looks like a secret.", String.raw`\$?env:\w*(key|token|secret|pass|pwd|cred|auth)\w*`),
  rule("registry-secrets", "Registry hives with accounts and secrets.", String.raw`(hklm|hkey_local_machine)[:/]*(sam|security)${END}|(hklm|hkey_local_machine)[:/]*system/currentcontrolset/control/lsa`),
  rule("credential-dumping", "Tools that dump credentials.", String.raw`\b(lsass|mimikatz|procdump)\b`),
];

const WRITE_PATTERNS: readonly PathRule[] = [
  rule(
    "startup-folders",
    "A startup folder: whatever is written there runs at every login.",
    String.raw`/(start menu|startm~[1-9])/(programs|progra~[1-9])/startup(/|$)|/(programdata|progra~[1-9])/(microsoft|micros~[1-9])/windows/(start menu|startm~[1-9])`,
  ),
  rule(
    "shell-profiles",
    "A shell profile: it runs every time a shell starts.",
    String.raw`(microsoft\.powershell_profile|microsoft\.vscode_profile|micros~[1-9]\.ps1|(^|/)profile)\.ps1${END}|${START}\.(bashrc|bash_profile|bash_login|profile|zshrc|zprofile|zshenv)${END}`,
  ),
  rule(
    "system-folders",
    "System folders (Windows, Program Files).",
    String.raw`(^|[\s"'=])(?:[a-z]:|//[^/]+/[a-z]\$)/(windows|program files|program files \(x86\)|progra~[1-9])(/|$)`,
  ),
  rule("unix-system", "System configuration folders.", String.raw`(^|[\s"'=])/(etc|boot|usr/(bin|sbin|lib)|bin|sbin|lib|system/library|library/(launchagents|launchdaemons))(/|$)`),
  rule("autostart", "Autostart entries (cron, systemd, launch agents).", String.raw`/(\.config/(autostart|systemd)|var/spool/cron|cron\.(d|daily|hourly))(/|$)|/library/launchagents(/|$)`),
  rule("git-hooks", "Git hooks run as commands on git operations.", String.raw`/\.git/hooks(/|$)`),
  rule("jarvis-config", "Jarvis' own configuration (it holds the security switches).", String.raw`(jarvis-config\.json|jarvis~[1-9]\.jso)${END}`),
];

/** Argumentos con el texto de un comando. */
const COMMAND_KEYS = new Set(["command", "cmd", "input"]);

/**
 * `\` y `/` equivalentes, prefijos extendidos (`\\?\`, `\\?\UNC\`) traducidos a ruta estándar o UNC `//servidor/...`,
 * barras internas repetidas colapsadas (conservando `//` inicial en UNC) y minúsculas.
 */
function normalize(text: string): string {
  const cleaned = stripExtendedPrefix(text).replace(/\\/g, "/");
  if (cleaned.startsWith("//")) {
    return (`//${cleaned.slice(2).replace(/\/{2,}/g, "/")}`).toLowerCase();
  }
  return cleaned.replace(/\/{2,}/g, "/").toLowerCase();
}

function addCanonicalVariants(raw: string, out: string[]): void {
  const normRaw = normalize(raw);
  out.push(normRaw);
  const stripped = stripExtendedPrefix(raw);
  if (isAnyAbsolute(stripped)) {
    const canon = normalize(canonicalPath(stripped));
    if (canon && canon !== normRaw) out.push(canon);
  }
}

/** Textos de los argumentos que se miran (ver la cabecera), incluyendo la resolución real de enlaces simbólicos. */
function scannedTexts(args: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const k = key.toLowerCase();
    const isPath = isPathArgKey(k) || k === PATH_LIST_KEY;
    const isCmd = COMMAND_KEYS.has(k);
    if (!isPath && !isCmd) continue;
    const values = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    for (const v of values) {
      if (isPath) {
        addCanonicalVariants(v, out);
      } else {
        out.push(normalize(v));
        // En comandos, también resolvemos tokens con forma de ruta absoluta por si apuntan por symlink a un lugar sensible.
        for (const match of v.matchAll(/(?:[A-Za-z]:|\\\\[?.]\\|\/\/[^/\s"']+|\/)[^\s"'`;|)]+/g)) {
          const token = stripExtendedPrefix(match[0]);
          if (isAnyAbsolute(token)) {
            const canon = normalize(canonicalPath(token));
            if (canon) out.push(canon);
          }
        }
      }
    }
  }
  return out;
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
