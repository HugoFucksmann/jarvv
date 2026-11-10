/**
 * JARVIS Core — Reglas de comandos (Windows y Linux/macOS), compartidas por Guard y la lista negra.
 *
 * Clasifica un comando de terminal mirando comando Y ruta juntos. Tres niveles, de mayor a menor:
 * - `guard`: catastrófico (destruye discos o la raíz del sistema). Guard lo deniega y cierra la tarea en cualquier modo.
 * - `blocked` (nivel 1 de la lista negra): muy destructivo o de alto impacto. Manual: se pregunta al usuario. Auto: se bloquea.
 * - `sensitive` (nivel 2): riesgoso pero a veces legítimo. Manual: se pregunta. Auto: lo decide D3 con umbral estricto.
 *
 * Cómo lee el comando (para no depender de cómo lo escribió el modelo):
 * - no distingue mayúsculas; `\` y `/` valen igual; respeta comillas al partir;
 * - expande alias (`rm`, `ri`, `del`, `erase`, `rd`, `rmdir`, `remove-item`, `kill`, `spps`...);
 * - parte el comando por `;`, `&`, `&&`, `||`, `|`, saltos de línea, llaves y backticks, y evalúa cada segmento; una segunda
 *   pasada parte también por paréntesis, para ver subexpresiones;
 * - entra en `cmd /c`, `powershell -Command`, `bash -c`, `sudo` y `-EncodedCommand` (se decodifica);
 * - expande `~`, `$HOME`, `$env:USERPROFILE`, `%USERPROFILE%`, `%SystemRoot%`, etc. y compara contra la carpeta de usuario real.
 *
 * Límites conocidos (no es una barrera contra un atacante, sino contra el error de un modelo pequeño): no resuelve variables
 * definidas por el propio comando (`$x='C:\'; ri $x -r`), ni rutas que salen de una tubería (`gci C:\ | ri -r`; ahí el borrado
 * queda como `sensitive`, no como crítico), ni comandos construidos por concatenación.
 */

export type RuleTier = "guard" | "blocked" | "sensitive";

export interface RuleFinding {
  readonly tier: RuleTier;
  /** Identificador estable de la regla (sirve para configurar o para los mensajes). */
  readonly id: string;
  /** Texto en inglés que ve el modelo. */
  readonly reason: string;
}

export interface ClassifyOptions {
  /** Carpetas de usuario reales (p. ej. `os.homedir()`); un borrado de la carpeta entera es crítico. */
  readonly homeDirs?: readonly string[];
}

const RANK: Record<RuleTier, number> = { sensitive: 1, blocked: 2, guard: 3 };
const MAX_DEPTH = 3;

const hit = (tier: RuleTier, id: string, reason: string): RuleFinding => ({ tier, id, reason });
const worst = (a: RuleFinding | null, b: RuleFinding | null): RuleFinding | null => (a === null ? b : b === null ? a : RANK[b.tier] > RANK[a.tier] ? b : a);

// ───────────────────────── Lectura del comando ─────────────────────────

/** Parte un texto en palabras respetando comillas simples y dobles (las comillas no quedan en la palabra). */
function tokenize(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let started = false;
  for (const ch of text) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (cur !== "" || started) out.push(cur);
      cur = "";
      started = false;
    } else cur += ch;
  }
  if (cur !== "" || started) out.push(cur);
  return out;
}

/** Parte por separadores de comandos fuera de comillas. Con `parens`, también por paréntesis. */
function splitSegments(text: string, parens: boolean): string[] {
  const seps = new Set([";", "&", "|", "\n", "\r", "{", "}", "`"]);
  if (parens) for (const c of "()") seps.add(c);
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of text) {
    if (quote !== null) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (seps.has(ch)) {
      if (cur.trim() !== "") out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

const norm = (token: string): string => token.toLowerCase().replace(/\\/g, "/");
const baseName = (token: string): string => norm(token).replace(/^.*\//, "").replace(/\.exe$/, "");

// ───────────────────────── Rutas críticas ─────────────────────────

type PathClass = "root" | "system" | "home";

const HOME_MARK = "~home";
const VARIABLES: readonly [RegExp, string][] = [
  [/^(\$env:userprofile|\$env:home|\$home|\$\{home\}|%userprofile%|%homepath%|~)(?=\/|$)/, HOME_MARK],
  [/^(\$env:systemroot|\$env:windir|%systemroot%|%windir%)(?=\/|$)/, "c:/windows"],
  [/^(\$env:programfiles|%programfiles%)(?=\/|$)/, "c:/program files"],
  [/^(\$env:systemdrive|\$env:homedrive|%systemdrive%|%homedrive%)(?=\/|$)/, "c:"],
];

function pathClass(raw: string, homes: readonly string[]): PathClass | null {
  if (raw.trim() === "") return null;
  let p = norm(raw.trim()).replace(/\/{2,}/g, "/");
  for (const [re, to] of VARIABLES) p = p.replace(re, to);
  p = p.replace(/(\/\.)+$/, "").replace(/\/\*$/, "").replace(/\/+$/, "");
  if (p === "" || /^[a-z]:$/.test(p)) return "root";
  if (/^[a-z]:\/windows(\/system32(\/.*)?)?$/.test(p)) return "root";
  if (p === HOME_MARK || homes.includes(p)) return "home";
  if (
    /^[a-z]:\/(windows|program files( \(x86\))?)(\/|$)/.test(p) ||
    /^[a-z]:\/(programdata|users|users\/[^/]+|\$recycle\.bin|system volume information|recovery|boot)$/.test(p) ||
    /^\/(etc|usr|bin|sbin|lib|lib32|lib64|boot|sys|proc|dev|system)(\/|$)/.test(p) ||
    /^\/(var|home|root|opt|srv|mnt|media|run|snap|users|library|applications|volumes)$/.test(p) ||
    /^\/users\/[^/]+$/.test(p) ||
    /^(hklm|hkcr|hku|hkey_local_machine|hkey_classes_root|hkey_users):/.test(p)
  )
    return "system";
  return null;
}

const USER_FOLDERS = /^\/(documents|desktop|downloads|pictures|videos|music|onedrive)(\/(\*|\*\.\*))?$/;

/** ¿Es una carpeta de datos del usuario entera (`Documents`, `Desktop`...) o todo su contenido (`Documents\*`)? Borrarla pierde el trabajo del usuario. */
function isUserFolder(raw: string, homes: readonly string[]): boolean {
  let p = norm(raw.trim()).replace(/\/{2,}/g, "/");
  for (const [re, to] of VARIABLES) p = p.replace(re, to);
  p = p.replace(/\/+$/, "");
  const home = p.startsWith(HOME_MARK) ? HOME_MARK : homes.find((h) => p.startsWith(`${h}/`));
  return home !== undefined && USER_FOLDERS.test(p.slice(home.length));
}

// ───────────────────────── Tablas de comandos ─────────────────────────

const DELETE_NAMES = new Set(["rm", "rmdir", "rd", "del", "erase", "ri", "remove-item", "unlink"]);
const CMD_SWITCH_NAMES = new Set(["rd", "del", "erase", "rmdir"]);
const POWER_NAMES = new Set(["shutdown", "reboot", "halt", "poweroff", "stop-computer", "restart-computer", "telinit"]);
const PARTITION_BLOCKED = new Set(["fdisk", "sfdisk", "cfdisk", "gdisk", "sgdisk", "parted", "initialize-disk"]);
const GUARD_DISK = new Set(["format-volume", "clear-disk", "remove-partition", "diskpart", "wipefs"]);
const USER_BLOCKED = new Set([
  "passwd", "userdel", "deluser", "useradd", "adduser", "usermod", "groupadd", "visudo",
  "remove-localuser", "new-localuser", "set-localuser", "add-localgroupmember",
]);
const KILL_NAMES = new Set(["kill", "pkill", "killall", "stop-process", "spps", "taskkill"]);
const SERVICE_STOP = new Set(["stop-service", "spsv", "remove-service"]);
const MOVE_NAMES = new Set(["mv", "move", "move-item", "mi", "ren", "rename", "rename-item", "rni"]);
const COPY_NAMES = new Set(["cp", "copy", "copy-item", "cpi", "xcopy"]);
const WRITE_NAMES = new Set(["set-content", "add-content", "ac", "out-file", "clear-content", "clc", "tee", "tee-object"]);
const PERMISSION_NAMES = new Set(["chmod", "chown", "chgrp"]);
const SHELL_NAMES = new Set(["cmd", "powershell", "pwsh", "bash", "sh", "zsh", "dash"]);
/** Defender, firewall, red y energía: cambiar la seguridad o la configuración de la máquina. */
const SECURITY_NAMES = new Set([
  "set-mppreference", "add-mppreference", "remove-mppreference", "set-netfirewallrule", "new-netfirewallrule", "remove-netfirewallrule",
  "disable-netfirewallrule", "set-netfirewallprofile", "disable-netadapter", "remove-netadapter", "set-netipaddress", "remove-netipaddress",
  "powercfg", "disable-computerrestore", "disable-windowsoptionalfeature", "set-service",
]);
/** Descargas a disco y lanzadores indirectos: traen o ejecutan código que el comando no muestra. */
const DOWNLOAD_NAMES = new Set(["iwr", "irm", "invoke-webrequest", "invoke-restmethod", "curl", "wget"]);
const LAUNCHER_NAMES = new Set(["mshta", "rundll32", "regsvr32", "bitsadmin", "start-bitstransfer"]);
/** Tareas programadas y ejecución remota; borrado de rastros; objetos WMI. */
const PERSISTENCE_NAMES = new Set(["register-scheduledtask", "unregister-scheduledtask", "set-scheduledtask", "invoke-command", "icm", "enter-pssession", "enable-psremoting"]);
const TRACE_NAMES = new Set(["clear-eventlog", "remove-eventlog", "clear-recyclebin"]);
const WMI_NAMES = new Set(["remove-wmiobject", "remove-ciminstance", "invoke-wmimethod", "invoke-cimmethod"]);
const PKG_NAMES =new Set(["pip", "pip3", "winget", "choco", "scoop", "apt", "apt-get", "dnf", "yum", "pacman", "brew", "snap"]);

const isFlag = (t: string): boolean => t.startsWith("-");
const isCmdSwitch = (t: string): boolean => /^\/[a-z?](:.*)?$/.test(t);

// ───────────────────────── Análisis de un segmento ─────────────────────────

function analyzeSegment(tokens: string[], opts: ClassifyOptions, depth: number): RuleFinding | null {
  if (tokens.length === 0) return null;
  const lc = tokens.map(norm);
  const name = baseName(tokens[0]);
  const rest = lc.slice(1);
  const homes = (opts.homeDirs ?? []).map((h) => norm(h).replace(/\/+$/, ""));

  // Envoltorios: se analiza lo que ejecutan.
  if (SHELL_NAMES.has(name)) return analyzeShellWrapper(name, tokens, lc, opts, depth);
  if (name === "sudo" || name === "doas") {
    const inner: string[] = [];
    for (let i = 1; i < tokens.length; i++) {
      if (inner.length === 0 && isFlag(lc[i])) {
        if (["-u", "-g", "-h", "-p", "-c", "-r", "-t", "-d"].includes(lc[i])) i++;
        continue;
      }
      inner.push(tokens[i]);
    }
    return worst(hit("sensitive", "sudo", "Running a command with elevated privileges."), depth < MAX_DEPTH ? classify(inner.join(" "), opts, depth + 1) : null);
  }

  // Disco y particiones.
  if (name.startsWith("mkfs")) return hit("guard", "mkfs", "Formatting a filesystem destroys all data on it.");
  if (GUARD_DISK.has(name)) return hit("guard", name, `'${name}' destroys disks or partitions.`);
  if (name === "format" && /^[a-z]:/.test(lc[1] ?? "")) return hit("guard", "format-drive", "Formatting a drive destroys all data on it.");
  if (PARTITION_BLOCKED.has(name)) return hit("blocked", "partition-tools", "Partition tools can destroy data on whole disks.");
  if (name === "dd" && lc.some((t) => /^of=(\/dev\/(?!null$|zero$|stdout$|stderr$)|\/\/\.\/|\.\/\/)/.test(t))) {
    return hit("guard", "dd-to-device", "Writing raw data to a device destroys it.");
  }
  if (name === "shred") return lc.some((t) => t.startsWith("/dev/")) ? hit("guard", "shred-device", "Shredding a device destroys it.") : hit("sensitive", "shred", "Shred permanently destroys file contents.");

  // Apagado y reinicio.
  if (POWER_NAMES.has(name) && !lc.some((t) => t === "/a" || t === "-c")) return hit("blocked", "power", "Shutting down or restarting the machine is not allowed.");
  if (name === "init" && /^[06]$/.test(lc[1] ?? "")) return hit("blocked", "power", "Shutting down or restarting the machine is not allowed.");
  if (name === "systemctl" && rest.some((t) => ["poweroff", "reboot", "halt", "kexec"].includes(t))) return hit("blocked", "power", "Shutting down or restarting the machine is not allowed.");

  // Borrado.
  if (DELETE_NAMES.has(name)) return analyzeDelete(name, lc, homes);
  if (name === "find" && (rest.includes("-delete") || rest.includes("-exec") || rest.includes("-execdir"))) {
    const cls = pathClass(lc.slice(1).find((t) => !isFlag(t)) ?? "", homes);
    return cls ? hit("blocked", "find-delete-critical", "Recursive deletion over a critical system or user folder.") : hit("sensitive", "find-delete", "find with -delete or -exec can remove or change many files.");
  }

  // Permisos y propietarios.
  if (PERMISSION_NAMES.has(name)) {
    const recursive = rest.some((t) => /^-[a-z]*r[a-z]*$/.test(t) || t === "--recursive");
    const critical = rest.some((t) => !isFlag(t) && pathClass(t, homes) !== null);
    return recursive && critical ? hit("blocked", "chmod-recursive-critical", "Recursive permission or owner change over a critical folder.") : hit("sensitive", name, `'${name}' changes permissions or owners.`);
  }
  if (name === "takeown" || name === "icacls") {
    const critical = rest.some((t) => !isFlag(t) && !isCmdSwitch(t) && pathClass(t, homes) !== null);
    return critical ? hit("blocked", `${name}-critical`, `'${name}' over a system or user root folder is not allowed.`) : hit("sensitive", name, `'${name}' changes permissions or owners.`);
  }

  // Usuarios y administración.
  if (USER_BLOCKED.has(name)) return hit("blocked", "user-admin", "Creating, changing or deleting accounts and credentials is not allowed.");
  if (name === "net" || name === "net1") {
    if (rest[0] === "user" && rest.some((t) => t === "/add" || t === "/delete")) return hit("blocked", "net-user", "Creating or deleting accounts is not allowed.");
    if (rest[0] === "localgroup" && rest.includes("administrators")) return hit("blocked", "net-admin", "Changing the administrators group is not allowed.");
    if (rest[0] === "stop") return hit("sensitive", "service-stop", "Stopping a service can break the system.");
  }

  // Registro, arranque, sombras de volumen.
  if (name === "reg") {
    if (rest[0] === "delete") return /^(hklm|hkcr|hku|hkey_local_machine|hkey_classes_root|hkey_users)/.test(rest[1] ?? "") ? hit("blocked", "reg-delete-machine", "Deleting machine-wide registry keys is not allowed.") : hit("sensitive", "reg-delete", "Deleting registry keys can break applications.");
    if (rest[0] === "add" || rest[0] === "import") return hit("sensitive", "reg-add", "Changing the registry can break the system.");
  }
  if (name === "bcdedit") return hit("blocked", "bcdedit", "Changing the boot configuration is not allowed.");
  if (name === "set-executionpolicy") return hit("blocked", "execution-policy", "Changing the PowerShell execution policy is not allowed.");
  if ((name === "vssadmin" || name === "wbadmin") && rest.includes("delete")) return hit("blocked", "backup-delete", "Deleting backups or shadow copies is not allowed.");
  if (name === "cipher" && rest.some((t) => t.startsWith("/w"))) return hit("blocked", "cipher-wipe", "Wiping free space is not allowed.");
  if (name === "regedit" || name === "set-itemproperty" || name === "new-itemproperty" || name === "remove-itemproperty") {
    return lc.some((t) => /^(hk[a-z_]*:|hkey_)/.test(t)) ? hit("sensitive", "registry-write", "Changing the registry can break the system.") : name === "set-itemproperty" ? hit("sensitive", "set-itemproperty", "Changing item properties.") : null;
  }

  // Procesos, servicios y tareas.
  if (KILL_NAMES.has(name)) return hit("sensitive", "kill", "Ending processes can lose unsaved work or break the system.");
  if (SERVICE_STOP.has(name)) return hit("sensitive", "service-stop", "Stopping a service can break the system.");
  if (name === "sc" && ["stop", "delete", "config"].includes(rest[0] ?? "")) return hit("sensitive", "service-stop", "Changing or stopping a service can break the system.");
  if (name === "systemctl" && rest.some((t) => ["stop", "disable", "mask"].includes(t))) return hit("sensitive", "service-stop", "Stopping or disabling a service can break the system.");
  if (name === "service" && rest.includes("stop")) return hit("sensitive", "service-stop", "Stopping a service can break the system.");
  if (name === "schtasks" || name === "crontab" || name === "at") return hit("sensitive", "scheduled-tasks", "Changing scheduled tasks.");

  // Seguridad del sistema, descargas, tareas programadas, ejecución remota, rastros y WMI.
  if (SECURITY_NAMES.has(name)) return hit("sensitive", "security-settings", `'${name}' changes the security or network configuration of the machine.`);
  if (name === "netsh" && rest.some((t) => t === "advfirewall" || t === "firewall")) return hit("sensitive", "security-settings", "Changing the firewall configuration.");
  if (DOWNLOAD_NAMES.has(name) && rest.some((t) => ["-o", "-outfile", "--output", "--output-document", "-out"].includes(t))) {
    return hit("sensitive", "download-to-disk", "Downloading a file to disk brings content that is not verified.");
  }
  if (name === "certutil" && rest.some((t) => /^[-/](urlcache|urlcachesplit|decode|decodehex|encode)/.test(t))) return hit("sensitive", "download-to-disk", "certutil downloads or decodes files.");
  if (LAUNCHER_NAMES.has(name)) return hit("sensitive", "indirect-execution", `'${name}' runs or downloads code that the command does not show.`);
  if ((name === "start-process" || name === "saps") && rest.some((t) => t === "runas" || t === "-verb:runas")) return hit("sensitive", "elevation", "Running a program with administrator rights.");
  if (PERSISTENCE_NAMES.has(name)) return hit("sensitive", "persistence-remote", `'${name}' schedules tasks or runs commands on another session or machine.`);
  if (name === "wevtutil" && rest.some((t) => t === "cl" || t === "clear-log")) return hit("sensitive", "clear-logs", "Clearing event logs removes the system's records.");
  if (TRACE_NAMES.has(name)) return hit("sensitive", "clear-logs", `'${name}' permanently removes records or files.`);
  if (WMI_NAMES.has(name)) return hit("sensitive", "wmi-change", `'${name}' changes or deletes system objects.`);

  // Git, paquetes, instalaciones.
  if (name === "git") return analyzeGit(lc);
  if ((name === "npm" || name === "pnpm" || name === "yarn") && rest.some((t) => ["install", "i", "add", "uninstall", "remove", "update"].includes(t)) && rest.some((t) => t === "-g" || t === "--global" || t === "global")) {
    return hit("sensitive", "global-install", "Global package changes affect the whole machine.");
  }
  if (PKG_NAMES.has(name) && rest.some((t) => ["install", "uninstall", "remove", "purge", "upgrade", "update", "erase"].includes(t))) return hit("sensitive", "package-change", "Installing or removing software changes the machine.");
  if ((name === "python" || name === "python3" || name === "py") && rest[0] === "-m" && rest[1] === "pip" && rest.some((t) => ["install", "uninstall"].includes(t))) return hit("sensitive", "package-change", "Installing or removing software changes the machine.");
  if (name === "install-module" || name === "install-package" || name === "uninstall-module") return hit("sensitive", "package-change", "Installing or removing software changes the machine.");

  // Mover, copiar, escribir.
  if (MOVE_NAMES.has(name)) return hit("sensitive", "move", "Moving or renaming can overwrite or lose files.");
  if (name === "robocopy" && rest.some((t) => t === "/mir" || t === "/purge" || t === "/move" || t === "/mov")) return hit("sensitive", "robocopy-mirror", "robocopy mirror/purge/move can delete files.");
  if (COPY_NAMES.has(name) && rest.some((t) => ["-f", "-force", "/y", "--force", "-fr"].includes(t))) return hit("sensitive", "copy-overwrite", "Forced copy overwrites existing files.");
  if (name === "sed" && rest.some((t) => /^-[a-z]*i/.test(t) || t.startsWith("--in-place"))) return hit("sensitive", "file-write", "Editing a file in place.");
  if (name === "sc" && rest.some((t) => t === "-value" || t === "-path")) return hit("sensitive", "file-write", "Writing to a file can overwrite its content.");
  if (WRITE_NAMES.has(name)) return hit("sensitive", "file-write", "Writing to a file can overwrite its content.");
  if (name === "iex" || name === "invoke-expression") return hit("sensitive", "invoke-expression", "Evaluating a string as code is not verifiable.");

  return null;
}

function analyzeDelete(name: string, lc: string[], homes: readonly string[]): RuleFinding {
  const cmdStyle = CMD_SWITCH_NAMES.has(name);
  const targets: string[] = [];
  for (const t of lc.slice(1)) {
    if (isFlag(t) || (cmdStyle && isCmdSwitch(t))) continue;
    targets.push(...t.split(",").filter((x) => x !== ""));
  }
  let found: RuleFinding | null = null;
  for (const target of targets) {
    const cls = pathClass(target, homes);
    if (cls === "root") found = worst(found, hit("guard", "delete-root", "Deleting a drive root or the Windows folder is not allowed."));
    else if (cls !== null) found = worst(found, hit("blocked", "delete-critical", "Deleting a system folder or a whole user folder is not allowed."));
    else if (isUserFolder(target, homes)) found = worst(found, hit("blocked", "delete-user-folder", "Deleting Documents, Desktop, Downloads or another personal folder (or everything in it) is not allowed."));
  }
  if (lc.includes("--no-preserve-root")) found = worst(found, hit("guard", "delete-root", "Deleting the filesystem root is not allowed."));
  if (found !== null) return found;
  return hit("sensitive", "delete", "Deleting files cannot be undone.");
}

function analyzeGit(lc: string[]): RuleFinding | null {
  const sub = lc.slice(1).find((t) => !isFlag(t));
  const flags = lc.slice(1);
  if (sub === "reset" && flags.includes("--hard")) return hit("sensitive", "git-reset-hard", "git reset --hard discards local work.");
  if (sub === "clean" && flags.some((t) => /^-[a-z]*f/.test(t) || t === "--force")) return hit("sensitive", "git-clean", "git clean deletes untracked files.");
  if (sub === "push" && flags.some((t) => ["-f", "--force", "--force-with-lease", "--delete"].includes(t))) return hit("sensitive", "git-push-force", "Force-push rewrites remote history.");
  return null;
}

function analyzeShellWrapper(name: string, tokens: string[], lc: string[], opts: ClassifyOptions, depth: number): RuleFinding | null {
  if (depth >= MAX_DEPTH) return hit("sensitive", "nested-shell", "Deeply nested shell command cannot be verified.");
  let script: string | null = null;
  if (name === "cmd") {
    const i = lc.findIndex((t, k) => k > 0 && (t === "/c" || t === "/k"));
    if (i > 0) script = tokens.slice(i + 1).join(" ");
  } else if (name === "powershell" || name === "pwsh") {
    const enc = lc.findIndex((t, k) => k > 0 && ["-e", "-ec", "-enc", "-encodedcommand"].includes(t));
    if (enc > 0 && tokens[enc + 1] !== undefined) {
      try {
        script = Buffer.from(tokens[enc + 1], "base64").toString("utf16le");
      } catch {
        return hit("sensitive", "encoded-command", "Encoded command cannot be verified.");
      }
      if (script.trim() === "") return hit("sensitive", "encoded-command", "Encoded command cannot be verified.");
    } else {
      const c = lc.findIndex((t, k) => k > 0 && (t === "-c" || t === "-command"));
      if (c > 0) script = tokens.slice(c + 1).join(" ");
      else {
        const first = lc.findIndex((t, k) => k > 0 && !isFlag(t));
        if (first > 0) script = tokens.slice(first).join(" ");
      }
    }
  } else {
    const c = lc.findIndex((t, k) => k > 0 && /^-[a-z]*c$/.test(t));
    if (c > 0) script = tokens.slice(c + 1).join(" ");
  }
  return script === null ? null : classify(script, opts, depth + 1);
}

// ───────────────────────── Reglas sobre el texto completo ─────────────────────────

const WHOLE_TEXT_RULES: readonly { re: RegExp; tier: RuleTier; id: string; reason: string }[] = [
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, tier: "guard", id: "fork-bomb", reason: "Fork bombs are not allowed." },
  { re: /(>|\bof=)\s*\/dev\/(sd|hd|vd|xvd|nvme|mmcblk|disk|rdisk)/, tier: "guard", id: "write-to-device", reason: "Writing raw data to a disk device destroys it." },
  { re: /--no-preserve-root/, tier: "guard", id: "delete-root", reason: "Deleting the filesystem root is not allowed." },
  {
    re: /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|iex|invoke-expression|powershell|pwsh|python3?)\b/,
    tier: "blocked", id: "pipe-to-shell", reason: "Running downloaded content directly is not allowed.",
  },
  {
    re: /\b(iex|invoke-expression)\b.*\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|downloadfile|net\.webclient)\b/,
    tier: "blocked", id: "pipe-to-shell", reason: "Running downloaded content directly is not allowed.",
  },
  { re: /\b(sh|bash)\s+-c\s+["']?\$\(\s*(curl|wget)\b/, tier: "blocked", id: "pipe-to-shell", reason: "Running downloaded content directly is not allowed." },
  {
    re: /\[(system\.)?io\.(file|directory|fileinfo|directoryinfo)\]::(delete|write\w*|move|copy|replace|append\w*)/,
    tier: "sensitive", id: "dotnet-file", reason: "Direct .NET file calls change or delete files without the usual checks.",
  },
  { re: /\/etc\/(shadow|sudoers)\b/, tier: "blocked", id: "auth-files", reason: "The system authentication files are off limits." },
  { re: /(>>?|\btee\b|\bsed\s+-\w*i\b)[^|;&]*\/etc\/passwd\b/, tier: "blocked", id: "auth-files", reason: "The system authentication files are off limits." },
];

/** `>` o `>>` hacia un archivo (no `2>&1`, ni `>$null`, `>/dev/null`, `>nul`). */
const FILE_REDIRECT = /(^|[^0-9&>])>>?\s*(?!&)(?!\$null\b)(?!\/dev\/null\b)(?!nul\b)\S/i;

// ───────────────────────── API ─────────────────────────

/** Clasifica un comando; `null` si no coincide con ninguna regla (comando libre). Devuelve el hallazgo más grave. */
export function classify(command: string, opts: ClassifyOptions = {}, depth = 0): RuleFinding | null {
  const text = command.replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
  if (text === "") return null;

  let result: RuleFinding | null = null;
  for (const rule of WHOLE_TEXT_RULES) if (rule.re.test(text)) result = worst(result, hit(rule.tier, rule.id, rule.reason));

  for (const parens of [false, true]) {
    for (const segment of splitSegments(command, parens)) {
      result = worst(result, analyzeSegment(tokenize(segment), opts, depth));
      if (FILE_REDIRECT.test(segment)) result = worst(result, hit("sensitive", "file-write", "Redirecting output to a file can overwrite its content."));
    }
  }
  return result;
}

/** Texto del comando de los argumentos de una herramienta (`command`, `cmd` o `input`, la entrada que `interact_with_process` envía a un shell); `null` si no hay. */
export function commandOf(args: Record<string, unknown>): string | null {
  for (const key of ["command", "cmd", "input"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}