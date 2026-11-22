/**
 * JARVIS Core — Autorización de una llamada (`runCall`, fases 6 a 6c y la decisión de si pide confirmación al usuario).
 *
 * Con la llamada ya preparada (argumentos y huella), decide si puede seguir y qué exige antes de ejecutarla. El orden de los cortes es este y no cambia:
 *
 *   Guard (`DENY`) → lista negra `blocked` → pre-chequeo determinista → `allowedDirectories` → ¿pide confirmación al usuario?
 *
 * Tiene tres piezas, de la más pura a la que toca el disco:
 * - `evaluatePolicy` (síncrona, sin disco de la tarea ni modelos): Guard, modo automático, nivel de la operación y lista negra. Se prueba con una tabla.
 * - `needsConfirmation` (pura): dada la política y lo que dejó el pre-chequeo, ¿se le pide al usuario? Es la regla central de `autoMode` y `approvalTiers`.
 * - `checkCallArgs` (asíncrona; analiza el comando y mira el disco): pre-chequeo y `allowedDirectories`.
 * `authorize` las compone. No registra nada: devuelve un rechazo (que `runCall` registra) o la decisión con la que siguen la confirmación y la revisión.
 */

import type { CallStatus } from "../ctx/index.ts";
import type { EngineDeps } from "../contracts.ts";
import type { UserEnvironment } from "../environment.ts";
import { checkAllowedDirectory } from "../policy/allowedDirs.ts";
import { blacklistMatch } from "../policy/blacklist.ts";
import type { Blacklist, ListHit } from "../policy/blacklist.ts";
import { Guard } from "../policy/guard.ts";
import { pathValuesOf } from "../policy/pathArgs.ts";
import { approvalTierOf } from "../policy/tiers.ts";
import type { ApprovalTier } from "../policy/tiers.ts";
import { isKnownTool } from "../tools/manifest.ts";
import type { PreparedCall } from "./callRecord.ts";
import type { EngineEnv } from "./env.ts";
import { analyzePowerShell, collectSources, precheckCall } from "./precheck.ts";
import type { CommandReport } from "./precheck.ts";
import { inputAnswersProcess } from "./retries.ts";

export type GuardVerdict = ReturnType<typeof Guard.evaluate>;

/** Lo que ve el modelo cuando el Guard deniega una llamada: que no se ejecutó, el motivo de la regla y que siga por otro camino. */
export function policyDenialNote(reason: string | undefined): string {
  return `Denied by the security policy; it was not performed. ${reason ?? ""} Do not try this operation again: take a different approach, or leave this part out.`.replace(/\s+/g, " ").trim();
}

/** La lista negra vigente: estática o leída en vivo de la configuración. */
export const currentBlacklist = (deps: EngineDeps): Blacklist => (typeof deps.blacklist === "function" ? deps.blacklist() : deps.blacklist);

/** La llamada no puede seguir: `runCall` la registra con este `status` y este resumen (que se recorta al registrarlo). */
export interface Rejection {
  readonly kind: "reject";
  readonly status: CallStatus;
  readonly summary: string | null;
}

const reject = (status: CallStatus, summary: string | null = null): Rejection => ({ kind: "reject", status, summary });

// ───────────────────────── Política: Guard, modo, nivel y lista negra ─────────────────────────

/** Lo que dejan Guard, el modo automático, el nivel y la lista negra, sin haber rechazado la llamada. */
export interface PolicyFacts {
  readonly guard: GuardVerdict;
  readonly auto: boolean;
  /** Aprobación por niveles activa. */
  readonly tiered: boolean;
  /** Nivel de la operación; `null` si no es una escritura o los niveles están apagados. */
  readonly tier: ApprovalTier | null;
  /** Coincidencia con la lista negra (reglas de comando integradas o configuración), o `null`. */
  readonly listed: ListHit | null;
}

/** El resultado de `evaluatePolicy` cuando no rechaza. */
export type PolicyVerdict = PolicyFacts & { readonly kind: "ok" };

/**
 * Política (fases 6 y 6a). `DENY` de Guard (comando catastrófico, regla B de las carpetas protegidas): no se ejecuta y queda `tool_rejected` con la razón, como un
 * rechazo de la lista negra; la tarea NO cierra (`maxDeniedPerStep` corta el paso si el modelo insiste). Lista negra nivel `blocked` con modo automático o con
 * niveles: se rechaza acá con la razón escrita; sin ellos, cualquier coincidencia se le pregunta al usuario. Nivel `sensitive` con modo automático: sigue a D3 con
 * umbral estricto. El nivel por aprobación (`tier`) clasifica las escrituras en verde, amarillo y rojo (`policy/tiers.ts`).
 */
export function evaluatePolicy(call: PreparedCall, environment: UserEnvironment, deps: EngineDeps): PolicyVerdict | Rejection {
  const { mcp, resolved, kind, policy } = call;
  const toolName = call.tool.name;

  const guard = Guard.evaluate(mcp, toolName, resolved, deps.guardScope);
  if (guard.decision === "DENY") return reject("tool_rejected", policyDenialNote(guard.reason));

  const auto = deps.autoMode();
  const tiered = deps.approvalTiers?.() === true;
  const tier: ApprovalTier | null = tiered && kind === "write" ? (isKnownTool(mcp, toolName) ? approvalTierOf(toolName, resolved, environment) : "red") : null;
  const listed = blacklistMatch(currentBlacklist(deps), mcp, toolName, policy.mutates, resolved, deps.guardScope.homeDirs);
  if (listed !== null && (auto || tiered) && listed.level === "blocked") return reject("tool_rejected", listed.reason);

  return { kind: "ok", guard, auto, tiered, tier, listed };
}

// ───────────────────────── ¿Se le pide confirmación al usuario? ─────────────────────────

export interface ConfirmationInput {
  readonly verdict: PolicyFacts;
  /** La herramienta está en el catálogo (`isKnownTool`). */
  readonly known: boolean;
  /** `allowedDirectories` no pudo resolver una ruta (con la razón), o `null`. */
  readonly allowedUnresolvableReason: string | null;
  /** La respuesta del usuario a un proceso, enviada tal cual a ese proceso (RC-20). */
  readonly userAuthored: boolean;
}

/**
 * ¿La llamada pide confirmación al usuario? Una ruta sensible (`guard.mandatory`) o una ruta no resoluble en `allowedDirectories` la piden también en modo
 * automático. Con niveles: la piden lo obligatorio de Guard, lo rojo, el amarillo sin modo automático y toda coincidencia de la lista negra; lo verde no. Sin niveles:
 * la pide Guard (`APPROVAL`) salvo que el modo automático la omita para una herramienta del catálogo, y la lista negra sin modo automático. Lo que el usuario ya
 * escribió (`userAuthored`) no se le vuelve a pedir, salvo una ruta no resoluble.
 */
export function needsConfirmation({ verdict, known, allowedUnresolvableReason, userAuthored }: ConfirmationInput): boolean {
  const { guard, auto, tiered, tier, listed } = verdict;
  if (allowedUnresolvableReason !== null) return true;
  if (userAuthored) return false;
  if (tiered) return guard.mandatory === true || tier === "red" || (tier === "yellow" && !auto) || listed !== null;
  return (guard.decision === "APPROVAL" && (guard.mandatory === true || !(auto && known))) || (listed !== null && !auto);
}

// ───────────────────────── Pre-chequeo y allowedDirectories ─────────────────────────

/** Rutas de los argumentos que `allowedDirectories` debe revisar. */
function toolPathArgs(args: Readonly<Record<string, unknown>>): string[] {
  return pathValuesOf(args);
}

export type ArgsCheck = Rejection | { readonly kind: "cancelled" } | { readonly kind: "ok"; readonly allowedUnresolvableReason: string | null };

/**
 * Fases 6b y 6c. Pre-chequeo determinista (sin modelo): lo comprobable se rechaza con una razón escrita que llega al LLM de argumentos. Después, `allowedDirectories`
 * en vivo para todas las herramientas, incluido `run_command` (cwd + rutas del AST de PowerShell): lo fuera de alcance se rechaza; lo que no se puede resolver
 * obliga a pedir confirmación al usuario (`allowedUnresolvableReason`).
 */
export async function checkCallArgs(env: EngineEnv, call: PreparedCall, environment: UserEnvironment): Promise<ArgsCheck> {
  const { ctx, runtime, deps } = env;
  const { kind, resolved } = call;
  const toolName = call.tool.name;

  // Analizador AST por llamada (lo comparten precheckCall y el chequeo de rutas de run_command en allowedDirectories).
  const rawAnalyzer = deps.analyzeCommand ?? analyzePowerShell;
  let cachedCmdReport: Promise<CommandReport | null> | null = null;
  let cachedCmdText: string | null = null;
  const analyzeCmd = (cmd: string): Promise<CommandReport | null> => {
    if (cachedCmdReport === null || cachedCmdText !== cmd) {
      cachedCmdText = cmd;
      cachedCmdReport = rawAnalyzer(cmd);
    }
    return cachedCmdReport;
  };

  // 6b. Pre-chequeo determinista.
  const finding = await precheckCall({ tool: toolName, kind, args: resolved, sources: collectSources(ctx), environment }, analyzeCmd);
  if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
  if (finding !== null) return reject(finding.review, finding.reason);

  // 6c. allowedDirectories.
  const allowedDirs = (deps.allowedDirectories?.() ?? []).map((d) => d.trim()).filter(Boolean);
  let allowedUnresolvableReason: string | null = null;
  if (allowedDirs.length > 0) {
    const effectiveCwd = typeof resolved.cwd === "string" && resolved.cwd.trim() !== "" ? resolved.cwd.trim() : environment.home;
    const pathArgs = toolPathArgs(resolved);
    for (const p of pathArgs) {
      const res = checkAllowedDirectory(p, allowedDirs, {
        home: environment.home,
        ...(toolName === "run_command" ? { cwdBase: effectiveCwd } : {}),
      });
      if (!res.allowed) {
        if (res.reason === "outside") {
          return reject("tool_rejected", policyDenialNote(`La ruta '${p}' está fuera de allowedDirectories.`));
        }
        allowedUnresolvableReason ??= `La ruta '${p}' no se pudo resolver contra allowedDirectories.`;
      }
    }
    if (toolName === "run_command" && typeof resolved.command === "string") {
      const cwdCheck = checkAllowedDirectory(effectiveCwd, allowedDirs, { home: environment.home });
      if (!cwdCheck.allowed) {
        if (cwdCheck.reason === "outside") {
          return reject("tool_rejected", policyDenialNote(`La carpeta de trabajo '${effectiveCwd}' está fuera de allowedDirectories.`));
        }
        allowedUnresolvableReason ??= `La carpeta de trabajo '${effectiveCwd}' no se pudo resolver contra allowedDirectories.`;
      }
      const cmdReport = environment.platform === "windows" || deps.analyzeCommand !== undefined ? await analyzeCmd(resolved.command) : null;
      if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
      if (cmdReport === null) {
        allowedUnresolvableReason ??= "No se pudieron analizar todas las rutas del comando contra allowedDirectories.";
      } else {
        for (const dp of cmdReport.detectedPaths ?? []) {
          const dpCheck = checkAllowedDirectory(dp, allowedDirs, { cwdBase: effectiveCwd, home: environment.home });
          if (!dpCheck.allowed) {
            if (dpCheck.reason === "outside") {
              return reject("tool_rejected", policyDenialNote(`La ruta '${dp}' detectada en el comando está fuera de allowedDirectories.`));
            }
            allowedUnresolvableReason ??= `La ruta '${dp}' detectada en el comando no se pudo resolver contra allowedDirectories.`;
          }
        }
        const unresolvable = cmdReport.unresolvablePaths?.[0];
        if (unresolvable !== undefined) {
          allowedUnresolvableReason ??= `El comando usa rutas o variables sin resolver (${unresolvable}) que no pueden verificarse contra allowedDirectories.`;
        }
      }
    }
  }
  return { kind: "ok", allowedUnresolvableReason };
}

// ───────────────────────── Composición ─────────────────────────

/** Con lo que `authorize` deja a la confirmación y a la revisión: lo que cada una necesita, empaquetado. */
export interface Authorization extends PolicyFacts {
  readonly kind: "proceed";
  readonly allowedUnresolvableReason: string | null;
  /** La respuesta del usuario a un proceso, enviada tal cual: ni confirmación ni D3 (RC-20). */
  readonly userAuthored: boolean;
  /** ¿Se le pide confirmación al usuario antes de ejecutar? Si la aprobó, D3 no entra. */
  readonly askUser: boolean;
}

export type AuthorizeResult = Rejection | { readonly kind: "cancelled" } | Authorization;

/** Fases 6 a 6c y la decisión de confirmar. No registra nada ni pide nada al usuario: eso es de `runCall`. */
export async function authorize(env: EngineEnv, call: PreparedCall, environment: UserEnvironment): Promise<AuthorizeResult> {
  const { ctx, deps } = env;

  const evaluated = evaluatePolicy(call, environment, deps);
  if (evaluated.kind === "reject") return evaluated;
  const { kind: _ok, ...verdict } = evaluated;

  const checked = await checkCallArgs(env, call, environment);
  if (checked.kind !== "ok") return checked;
  const { allowedUnresolvableReason } = checked;

  // La respuesta del usuario a un proceso, enviada tal cual a ese proceso, ya la escribió él: no se le pide aprobarla ni la revisa D3 (RC-20). No vale con una
  // ruta sensible ni con una coincidencia de la lista negra, que siguen su camino.
  const userAuthored =
    verdict.guard.mandatory !== true &&
    verdict.listed === null &&
    allowedUnresolvableReason === null &&
    inputAnswersProcess(ctx, call.stepId, call.tool.name, call.resolved, call.recorded.input);
  const askUser = needsConfirmation({ verdict, known: isKnownTool(call.mcp, call.tool.name), allowedUnresolvableReason, userAuthored });

  return { kind: "proceed", ...verdict, allowedUnresolvableReason, userAuthored, askUser };
}
