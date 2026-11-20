/**
 * JARVIS Core — Guard & Authorization Engine
 *
 * Invariantes:
 * - Ningún modelo puede eludir Guard.
 * - Patrones destructivos sobre el SO y comandos catastróficos (nivel `guard` de `commandRules.ts`: discos, raíz del sistema) => DENY siempre. Se escanean los argumentos que son rutas o comandos; no se
 *   escanean los de `free_search` ni `jarvis_web` (consultas y URLs).
 * - Ruta sensible (`sensitivePaths.ts`: claves, credenciales, navegadores, lugares de inicio automático, el sistema) => APPROVAL obligatorio,
 *   también con `autoMode`: `GuardDecision.mandatory`. Se mira antes que el modo de solo lectura de un comando.
 * - Datos sensibles en lo que `web_search` envía a internet (`egress.ts`: claves, tokens, rutas del usuario) => APPROVAL obligatorio, también con `autoMode`.
 * - Herramienta no catalogada en el manifest => APPROVAL (fail-closed; en la práctica runStep ya no la ofrece).
 * - policy.requiresApproval => APPROVAL cada vez (la aprobación no perdura), salvo un comando de terminal que `readOnly.ts` demuestra de
 *   solo lectura (pasó antes por todas las reglas anteriores: DENY de patrones y reglas de comando).
 * - Regla B / Invariante 8: una escritura (`FILE_WRITE`, mutación o comando `run_command` no de solo lectura) sobre una ruta dentro de las
 *   carpetas o archivos protegidos (`refsDir`, logs de tareas, carpeta del proyecto, `data/memory.json`) => DENY siempre. Se revisan los
 *   argumentos de tipo texto, salvo `content` y `mode`, y las rutas extraídas de comandos; las rutas relativas se resuelven contra cada base
 *   conocida (`relativeBases` / `commandBases`); se compara sin seguir enlaces simbólicos. No cubre un directorio que CONTENGA a la protegida.
 * - Resto => ALLOW (lecturas).
 * - La política sale únicamente del manifest (tools/manifest.ts); no hay otra fuente.
 */

import path from "node:path";

import type { Capability, GuardDecision } from "../types.ts";
import { getToolPolicy, isKnownTool } from "../tools/manifest.ts";
import { classify, commandOf, splitSegments, tokenize } from "./commandRules.ts";
import { defaultHomeDirs } from "./homeDirs.ts";
import { isReadOnlyCall } from "./readOnly.ts";
import { egressFinding } from "./egress.ts";
import { sensitivePathFinding } from "./sensitivePaths.ts";

// Se evalúan sobre el JSON de args en minúsculas, con "\\" -> "/" y espacios colapsados.
// Los comandos de terminal (Windows y Linux) los analiza además `commandRules.ts` (comando y ruta juntos): `rm -rf /` o `Remove-Item -Recurse C:\`
// dan DENY, pero `rm -rf /tmp/x` ya no (antes un patrón de texto lo denegaba: falso positivo heredado).
const DENY_PATTERNS: readonly RegExp[] = [
  /\bformat\s+c:/,
  /\bmkfs\b/,
  /del\s+\/f\s+\/s\s+\/q\s+c:\/windows/,
  /\/etc\/shadow/,
  /system32\/drivers/,
];

/** Carpetas y archivos que el modelo no puede modificar y bases para resolver rutas relativas (invariante 8). */
export interface ProtectedPaths {
  /** Rutas absolutas de las carpetas protegidas (`refsDir`, logs de tareas, proyecto de Jarvis). */
  readonly protectedDirs: readonly string[];
  /** Rutas absolutas de archivos protegidos (`data/memory.json`). */
  readonly protectedFiles?: readonly string[];
  /** Bases contra las que se resuelve una ruta relativa de herramientas de archivos: cada una es un candidato (D27). */
  readonly relativeBases: readonly string[];
  /** Bases para resolver rutas relativas en comandos de terminal si el llamado omite `cwd` (p. ej. `os.homedir()`). */
  readonly commandBases?: readonly string[];
  /** Carpetas de inicio del usuario: `~` y `$env:USERPROFILE` se resuelven contra la primera, y borrar una de ellas entera es crítico. Omitida = las del sistema (`policy/homeDirs.ts`). */
  readonly homeDirs?: readonly string[];
}

/**
 * ¿`child` es `parent` o está dentro de `parent`? Ambas se resuelven con `path.resolve`; en Windows la comparación no
 * distingue mayúsculas (lo hace `path.relative` de Node). No sigue enlaces simbólicos ni uniones.
 */
export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function samePath(a: string, b: string): boolean {
  return path.relative(path.resolve(a), path.resolve(b)) === "";
}

/** Argumentos de las herramientas de escritura que no son rutas (texto que se escribe, modo de escritura). */
const NON_PATH_ARGS: readonly string[] = ["content", "mode"];
const COMMAND_ARG_KEYS: readonly string[] = ["command", "cmd", "input"];
const MAX_WRAPPER_DEPTH = 3;
const SHELL_WRAPPERS = new Set(["cmd", "powershell", "pwsh", "bash", "sh", "zsh", "dash"]);
const HOME_VAR_PREFIX = /^(\$env:userprofile|\$env:home|\$home|\$\{home\}|%userprofile%|%homepath%|~)(?=[\\/]|$)/i;
const REDIRECT_TARGET = /(?:^|[^&>])>>?\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|>`"']+))/g;

export class Guard {
  /**
   * @param scope Carpetas y archivos protegidos (invariante 8). Sin él, la regla no se aplica.
   */
  static evaluate(mcp: string, tool: string, args: Record<string, unknown> = {}, scope?: ProtectedPaths): GuardDecision {
    const policy = getToolPolicy(mcp, tool);
    const capability = policy.capability;

    const scannable = Guard.denyScanArgs(mcp, tool, args);
    if (scannable && Guard.matchesDenyPattern(scannable)) {
      return {
        decision: "DENY",
        reason: "Operación rechazada (DENY): patrón destructivo prohibido sobre el sistema operativo.",
        capability,
      };
    }

    const command = scannable ? commandOf(scannable) : null;
    const homeDirs = scope?.homeDirs ?? defaultHomeDirs();
    const found = command !== null ? classify(command, { homeDirs }) : null;
    if (found?.tier === "guard") {
      return { decision: "DENY", reason: `Operación rechazada (DENY): comando catastrófico prohibido (${found.id}).`, capability };
    }

    const isWrite = capability === "FILE_WRITE" || policy.mutates || command !== null;
    if (scope && !isReadOnlyCall(mcp, tool, args, homeDirs) && isWrite && Guard.touchesProtectedPath(args, scope, command !== null)) {
      return {
        decision: "DENY",
        reason: "Operación rechazada (DENY): la ruta pertenece a una carpeta o archivo protegido del sistema (refs, logs, memoria o proyecto) y no se puede modificar.",
        capability,
      };
    }

    if (scannable !== null) {
      const write = policy.mutates && !isReadOnlyCall(mcp, tool, args, homeDirs);
      const sensitive = sensitivePathFinding(scannable, write);
      if (sensitive !== null) {
        return { decision: "APPROVAL", mandatory: true, reason: `Ruta sensible (${sensitive.id}): ${sensitive.reason}`, capability };
      }
    }

    // Lo que una herramienta envía a internet (la consulta de `web_search`): un dato sensible exige confirmación también con `autoMode`.
    const egress = egressFinding(mcp, tool, args);
    if (egress !== null) {
      return { decision: "APPROVAL", mandatory: true, reason: `La consulta a internet lleva datos sensibles (${egress.id}): ${egress.reason}.`, capability };
    }

    if (!isKnownTool(mcp, tool)) {
      return {
        decision: "APPROVAL",
        reason: `Herramienta no catalogada (${mcp}:${tool}). Requiere confirmación.`,
        capability,
      };
    }

    if (policy.requiresApproval && !isReadOnlyCall(mcp, tool, args, homeDirs)) {
      return { decision: "APPROVAL", reason: Guard.approvalReason(capability, tool, args), capability };
    }

    return { decision: "ALLOW", capability };
  }

  /** Argumentos sobre los que se aplica el DENY. `null` = sin escaneo (free_search y jarvis_web). */
  private static denyScanArgs(mcp: string, tool: string, args: Record<string, unknown>): Record<string, unknown> | null {
    const server = mcp.toLowerCase();
    if (server === "free_search" || server === "jarvis_web") return null;
    return args;
  }

  /** Rutas que un argumento de texto puede nombrar: absoluta, `~`/env o relativa a cada base dada. */
  private static candidatePaths(value: string, bases: readonly string[], home: string): string[] {
    let text = value.trim().replace(/^['"]|['"]$/g, "");
    if (text.length === 0 || text.includes("\0")) return [];
    const envMatch = text.match(HOME_VAR_PREFIX);
    if (envMatch) text = path.join(home, text.slice(envMatch[0].length));
    if (path.isAbsolute(text) || /^[a-z]:[\\/]/i.test(text)) return [text];
    return bases.map((base) => path.resolve(base, text));
  }

  private static isProtectedTarget(candidate: string, scope: ProtectedPaths): boolean {
    return (
      scope.protectedDirs.some((dir) => isPathInside(dir, candidate)) ||
      (scope.protectedFiles?.some((file) => samePath(file, candidate)) ?? false)
    );
  }

  private static looksLikePath(token: string, protectedFileNames: ReadonlySet<string>): boolean {
    const t = token.trim();
    if (t === "" || t.includes("\0")) return false;
    if (t === "." || t === ".." || t.startsWith("./") || t.startsWith(".\\") || t.startsWith("../") || t.startsWith("..\\")) return true;
    if (t.includes("/") || t.includes("\\") || t.startsWith("~") || /^[a-z]:/i.test(t)) return true;
    if (HOME_VAR_PREFIX.test(t)) return true;
    return protectedFileNames.has(path.basename(t).toLowerCase());
  }

  private static extractCommandPaths(command: string, protectedFileNames: ReadonlySet<string>, depth = 0): string[] {
    const found: string[] = [];
    const segments = new Set([...splitSegments(command, false), ...splitSegments(command, true)]);

    for (const segment of segments) {
      let match: RegExpExecArray | null;
      REDIRECT_TARGET.lastIndex = 0;
      while ((match = REDIRECT_TARGET.exec(segment)) !== null) {
        const target = match[1] ?? match[2] ?? match[3] ?? "";
        if (target && !/^(&|\$null|\/dev\/null|nul)$/i.test(target)) found.push(target);
      }

      const tokens = tokenize(segment);
      if (tokens.length === 0) continue;

      if (depth < MAX_WRAPPER_DEPTH) {
        const cmdName = tokens[0].toLowerCase().replace(/\\/g, "/").replace(/^.*\//, "").replace(/\.exe$/, "");
        const lc = tokens.map((t) => t.toLowerCase());
        if (SHELL_WRAPPERS.has(cmdName)) {
          let inner: string | null = null;
          if (cmdName === "cmd") {
            const i = lc.findIndex((t, k) => k > 0 && (t === "/c" || t === "/k"));
            if (i > 0) inner = tokens.slice(i + 1).join(" ");
          } else if (cmdName === "powershell" || cmdName === "pwsh") {
            const enc = lc.findIndex((t, k) => k > 0 && ["-e", "-ec", "-enc", "-encodedcommand"].includes(t));
            if (enc > 0 && tokens[enc + 1]) {
              try {
                inner = Buffer.from(tokens[enc + 1], "base64").toString("utf16le");
              } catch {
                inner = null;
              }
            } else {
              const c = lc.findIndex((t, k) => k > 0 && (t === "-c" || t === "-command"));
              if (c > 0) inner = tokens.slice(c + 1).join(" ");
            }
          } else {
            const c = lc.findIndex((t, k) => k > 0 && /^-[a-z]*c$/.test(t));
            if (c > 0) inner = tokens.slice(c + 1).join(" ");
          }
          if (inner) found.push(...Guard.extractCommandPaths(inner, protectedFileNames, depth + 1));
        } else if (cmdName === "sudo" || cmdName === "doas") {
          const inner: string[] = [];
          for (let i = 1; i < tokens.length; i++) {
            if (inner.length === 0 && lc[i].startsWith("-")) {
              if (["-u", "-g", "-h", "-p", "-c", "-r", "-t", "-d"].includes(lc[i])) i++;
              continue;
            }
            inner.push(tokens[i]);
          }
          if (inner.length > 0) found.push(...Guard.extractCommandPaths(inner.join(" "), protectedFileNames, depth + 1));
        }
      }

      for (const token of tokens) {
        const candidates = [token];
        const eq = token.indexOf("=");
        if (eq > 0 && eq < token.length - 1) candidates.push(token.slice(eq + 1));
        const colon = token.indexOf(":");
        if (token.startsWith("-") && colon > 1 && colon < token.length - 1) candidates.push(token.slice(colon + 1));
        for (const piece of candidates) {
          if (Guard.looksLikePath(piece, protectedFileNames)) found.push(piece);
        }
      }
    }

    return found;
  }

  /** Invariante 8: ¿los argumentos o el comando nombran una carpeta o archivo protegido? */
  private static touchesProtectedPath(args: Record<string, unknown>, scope: ProtectedPaths, hasCommand: boolean): boolean {
    const relativeBases = scope.relativeBases;
    const home = (scope.homeDirs ?? defaultHomeDirs())[0];
    for (const [key, value] of Object.entries(args)) {
      const k = key.toLowerCase();
      if (NON_PATH_ARGS.includes(k)) continue;
      if (hasCommand && COMMAND_ARG_KEYS.includes(k)) continue;
      const values = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
      for (const item of values) {
        for (const candidate of Guard.candidatePaths(item, relativeBases, home)) {
          if (Guard.isProtectedTarget(candidate, scope)) return true;
        }
      }
    }

    if (hasCommand) {
      const command = commandOf(args);
      if (command !== null) {
        const cmdBases =
          typeof args.cwd === "string" && args.cwd.trim() !== ""
            ? Guard.candidatePaths(args.cwd.trim(), scope.commandBases ?? relativeBases, home)
            : (scope.commandBases ?? relativeBases);
        const protectedFileNames = new Set((scope.protectedFiles ?? []).map((f) => path.basename(f).toLowerCase()));
        for (const token of Guard.extractCommandPaths(command, protectedFileNames)) {
          for (const candidate of Guard.candidatePaths(token, cmdBases, home)) {
            if (Guard.isProtectedTarget(candidate, scope)) return true;
          }
        }
      }
    }

    return false;
  }

  private static matchesDenyPattern(args: Record<string, unknown>): boolean {
    const normalized = JSON.stringify(args).toLowerCase().replace(/\\\\/g, "/").replace(/\s+/g, " ");
    return DENY_PATTERNS.some((p) => p.test(normalized));
  }

  /** Valor de un argumento si es texto no vacío; evita que un valor que no es texto se imprima como "[object Object]". */
  private static text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private static approvalReason(cap: Capability, tool: string, args: Record<string, unknown>): string {
    switch (cap) {
      case "COMMAND_EXECUTION":
        return `Ejecución de comando en terminal: "${Guard.text(args.command) ?? Guard.text(args.cmd) ?? tool}". Requiere confirmación de seguridad.`;
      case "FILE_WRITE":
        return `Modificación o creación de archivo en la ruta "${Guard.text(args.path) ?? Guard.text(args.filename) ?? "sistema"}".`;
      case "PROCESS_CONTROL":
        return `Control de proceso o ciclo de vida de aplicación (${tool}).`;
      case "DOWNLOAD":
        return "Descarga de documento o archivo binario externo hacia el almacenamiento local.";
      case "CONFIGURATION":
        return "Modificación de ajustes de entorno o configuración del sistema.";
      default:
        return `Acción con impacto potencial sobre el sistema (${tool}).`;
    }
  }
}