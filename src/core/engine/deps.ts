/**
 * JARVIS Core — Dependencias del ejecutor de llamadas y del bucle de paso (Fase 5).
 *
 * Contratos mínimos, sin implementaciones (las conoce solo la raíz de composición): el descubrimiento de herramientas,
 * las decisiones (ruta, herramienta, revisión de argumentos y verificación) y el modelo generativo (argumentos, pregunta,
 * plan y respuesta final, todos desde las vistas del contexto).
 *
 * También compone, una sola vez, el almacén de refs y el alcance de la regla B del Guard (`createEngineServices`).
 */

import path from "node:path";

import { ConfigManager, type JarvisConfig } from "../config.ts";
import type { getUserEnvironment } from "../environment.ts";
import type { IMCPServer } from "../mcp/types.ts";
import { isPathInside, type ProtectedPaths } from "../policy/guard.ts";
import { createRefVault, type RefVault } from "../refs/refVault.ts";
import type { VerdictReason } from "../ctx/index.ts";
import type { ArgumentsGenerationResult, MCPTool, TimeSpan } from "../types.ts";
import type { ExecutableRoute } from "../types/routes.ts";
import type { cleanInputSchema } from "../utils.ts";
import type { CaptureSink } from "./capture.ts";

// ───────────────────────── Descubrimiento de herramientas ─────────────────────────

export interface IDiscoveryEngine {
  getServer(name: string): IMCPServer | undefined;
  getDiscoveredTools(serverName: string, forceRefresh?: boolean): Promise<MCPTool[]>;
  getUnavailableServers(): Record<string, { reason: string; since: number }>;
  validateToolExists(serverName: string, toolName: string): Promise<boolean>;
}

// ───────────────────────── Decision: ruta y herramienta ─────────────────────────

/** Lo que Decision devolvió, para la traza y el depurado. */
export interface DecisionTrace {
  readonly probabilities: Record<string, number>;
  readonly rawInput: string;
  readonly rawOutput: string;
  readonly timing?: TimeSpan;
}

/** Decisión 1: ruta de la siguiente acción. `shortcut`: había una sola opción y no se consultó al modelo. */
export type RouteDecision = DecisionTrace & { readonly action: "route"; readonly route: ExecutableRoute; readonly shortcut?: boolean };

/** Decisión 2: herramienta dentro de la ruta elegida. `shortcut`: había una sola opción y no se consultó al modelo. */
export type ToolDecision = DecisionTrace & { readonly action: "tool"; readonly tool: MCPTool; readonly shortcut?: boolean };

/** Intento no aprobado tal como lo ve Decision: marca la ruta o la herramienta cuyo último intento falló. */
export interface DecisionAttempt {
  readonly route: string;
  readonly tool: string;
  /** Fallo de llamada (5.4). */
  readonly failed: boolean;
  /** Línea `L` ya saneada y recortada. */
  readonly text: string;
}

/**
 * Lo que Decisión 1 y 2 reciben de `forRoute` (8.3), ya saneado y recortado a los topes de 8.2: una línea por llamada y
 * por entrada del usuario.
 */
export interface DecisionFrame {
  /** Paso actual. */
  readonly step: { readonly instruction: string; readonly expected: string | null } | null;
  /** Última llamada aprobada que no es efecto, con su resumen: solo en reactivo. */
  readonly lastResult: string | null;
  /** Llamadas hechas (aprobadas): solo en reactivo. */
  readonly done: readonly string[];
  readonly attempts: readonly DecisionAttempt[];
  readonly userInput: readonly string[];
  readonly env: readonly string[];
}

export interface RouteDecisionInput extends DecisionFrame {
  /** Rutas con alguna herramienta usable: son las opciones de ruta. */
  readonly routes: readonly ExecutableRoute[];
}

export interface ToolDecisionInput extends DecisionFrame {
  /** Ruta elegida; los intentos del marco ya están filtrados a ella. */
  readonly route: ExecutableRoute;
  /** Herramientas usables de la ruta, ya filtradas. */
  readonly tools: MCPTool[];
}

/** Resultado de la revisión de argumentos: aprobar o el escenario del rechazo (se refleja en el `status` de la llamada). */
export const ARGS_REVIEWS = ["approved", "args_invalid", "tool_rejected", "info_missing"] as const;
export type ArgsReview = (typeof ARGS_REVIEWS)[number];

/** Llamada candidata de Decisión 3 (parámetro de la vista, ≤ `caps.candidate`): ya saneada y recortada. */
export interface ReviewCandidate {
  readonly route: string;
  readonly tool: string;
  /** Descripción de la herramienta en el catálogo. */
  readonly description: string;
  /** Schema limpio de la herramienta (JSON en una línea): los tipos y requeridos contra los que se contrastan los `args`. */
  readonly schema: string;
  /** `args` tal como los propuso el modelo (refs sin resolver, strings recortados), en una línea. */
  readonly args: string;
}

/**
 * Lo que Decisión 3 recibe de `forReview` (8.3), ya saneado y recortado a los topes de 8.2: una línea por llamada, por
 * paso y por entrada del usuario; cada lectura es un bloque de varias líneas.
 */
export interface ReviewDecisionInput {
  readonly candidate: ReviewCandidate;
  /** Paso actual. */
  readonly step: { readonly instruction: string; readonly expected: string | null } | null;
  /** Pasos completados: solo en deliberativo. */
  readonly stepsDone: readonly string[];
  /** Llamadas hechas (aprobadas) que no son lecturas mostradas: solo en reactivo. */
  readonly done: readonly string[];
  /** Las mismas lecturas que vio LLM 2. */
  readonly lastReads: readonly string[];
  readonly stepFailures: readonly string[];
  readonly userInput: readonly string[];
  readonly env: readonly string[];
}

export type ReviewDecision = DecisionTrace & { readonly review: ArgsReview };

/**
 * Lo que Decisión 4 recibe de `forVerify` (8.3), ya saneado y recortado a los topes de 8.2. El criterio es el del paso.
 */
export interface VerifyDecisionInput {
  readonly criterion: { readonly instruction: string; readonly expected: string | null };
  /** La llamada evaluada: cabecera, `args`, resumen y ref, en varias líneas. */
  readonly call: string;
  /** Llamadas hechas (aprobadas): solo en reactivo. */
  readonly done: readonly string[];
  readonly userInput: readonly string[];
}

/**
 * Preguntas `noul` de la verificación (Decisión 4), en orden de precedencia: la primera que no se aprueba da la `reason` del
 * rechazo. El texto de cada una está en `DECISION_PROMPTS` (`VERIFY_QUESTIONS`, tipado contra esta tabla); la regla que las
 * combina es `verdictOf` (`engine/verify.ts`).
 */
export const VERIFY_CHECKS = [
  { key: "ok", reason: "no_usable_data" },
  { key: "cumple", reason: "not_accomplished" },
] as const satisfies readonly { readonly key: string; readonly reason: VerdictReason }[];
export type VerifyCheckKey = (typeof VERIFY_CHECKS)[number]["key"];

/** Decisión 4: la probabilidad de la afirmativa de cada pregunta de `VERIFY_CHECKS`, sin umbral aplicado. */
export type VerifyDecision = Omit<DecisionTrace, "probabilities"> & { readonly answers: Readonly<Record<VerifyCheckKey, number>> };

export interface IActionDecision {
  chooseRoute(input: RouteDecisionInput, signal?: AbortSignal): Promise<RouteDecision>;
  chooseTool(input: ToolDecisionInput, signal?: AbortSignal): Promise<ToolDecision>;
  /** Decisión 3: revisa la llamada candidata. Corre en cada intento, después de las comprobaciones deterministas. */
  reviewArgs(input: ReviewDecisionInput, signal?: AbortSignal): Promise<ReviewDecision>;
  /** Decisión 4: verifica el resultado de una llamada ejecutada (las preguntas de `VERIFY_CHECKS`). */
  verifyResult(input: VerifyDecisionInput, signal?: AbortSignal): Promise<VerifyDecision>;
}

// ───────────────────────── LLM: argumentos y pregunta (D17) ─────────────────────────

export interface ArgsFromViewInput {
  readonly tool: MCPTool;
  readonly cleanedSchema: ReturnType<typeof cleanInputSchema>;
  readonly environment: Awaited<ReturnType<typeof getUserEnvironment>>;
  /** Texto de `renderArgs(ctx.view.forArgs(...))`. */
  readonly view: string;
}

export interface QuestionInput {
  /** Texto de `renderAsk(ctx.view.forAsk())`. */
  readonly view: string;
}

export interface QuestionGenerationResult {
  readonly question: string;
  readonly rawInput: string;
  readonly rawOutput: string;
  readonly timing?: TimeSpan;
}

/** Paso que genera LLM 1, ya validado (ruta ejecutable, textos no vacíos). */
export interface GeneratedStep {
  readonly instruction: string;
  readonly route: ExecutableRoute;
  readonly expected: string;
}

export interface PlanFromViewInput {
  /** Texto de `renderPlan(ctx.view.forPlan(...))`. */
  readonly view: string;
  /** Por qué se planifica (lo deriva el contexto: `forPlan`). */
  readonly trigger: "initial" | "user_feedback" | "step_failure";
  /** Tope de pasos que puede traer el plan: `BUDGET.maxSteps` menos los pasos `completed` vigentes (FLUJO 3). */
  readonly maxSteps: number;
}

/** Plan generado: de 1 a `maxSteps` pasos. Un plan fuera de ese rango es salida inválida (`LLMValidationError`). */
export interface PlanGenerationResult {
  readonly steps: readonly GeneratedStep[];
  readonly rawInput: string;
  readonly rawOutput: string;
  readonly timing?: TimeSpan;
}

export interface FinalFromViewInput {
  /** Texto de `renderFinal(ctx.view.forFinal(...))`. */
  readonly view: string;
}

export interface FinalGenerationResult {
  readonly response: string;
  readonly rawInput: string;
  readonly rawOutput: string;
  readonly timing?: TimeSpan;
}

export interface PendingFromViewInput {
  /** Texto de `renderPending(ctx.view.forPending(...))`. */
  readonly view: string;
}

/** Lista de pendientes ya validada (textos no vacíos): el primero es la instrucción del paso; vacía = nada por hacer. */
export interface PendingGenerationResult {
  readonly pending: readonly string[];
  readonly rawInput: string;
  readonly rawOutput: string;
  readonly timing?: TimeSpan;
}

export interface EngineLLM {
  generateArgumentsFromView(input: ArgsFromViewInput, signal?: AbortSignal): Promise<ArgumentsGenerationResult>;
  generateQuestion(input: QuestionInput, signal?: AbortSignal): Promise<QuestionGenerationResult>;
  /** Lista de pendientes del reactivo, al inicio de cada vuelta. */
  generatePendingFromView(input: PendingFromViewInput, signal?: AbortSignal): Promise<PendingGenerationResult>;
  /** LLM 1: plan y replan (solo deliberativo). */
  generatePlanFromView(input: PlanFromViewInput, signal?: AbortSignal): Promise<PlanGenerationResult>;
  /** LLM 3: respuesta final. */
  generateFinalFromView(input: FinalFromViewInput, signal?: AbortSignal): Promise<FinalGenerationResult>;
}

// ───────────────────────── Dependencias del motor ─────────────────────────

export interface EngineDeps {
  /** Elección de ruta y herramienta (`chooseRoute`, `chooseTool`), revisión (`reviewArgs`) y verificación (`verifyResult`). */
  readonly decision: IActionDecision;
  readonly discovery: IDiscoveryEngine;
  readonly llm: EngineLLM;
  readonly vault: RefVault;
  /** Alcance de la regla B del Guard (D9, D20, D27). */
  readonly guardScope: ProtectedPaths;
  /** Receptor de la traza (D11). Sin él, no se captura nada. */
  readonly sink?: CaptureSink;
}

// ───────────────────────── Composición ─────────────────────────

export interface EngineServices {
  readonly vault: RefVault;
  readonly guardScope: ProtectedPaths;
}

let coherenceWarned = false;

/**
 * Aviso de coherencia: si Desktop Commander restringe los directorios (`allowedDirectories` no vacío; vacío = sin
 * restricción) y `refsDir` queda fuera, el modelo no podrá leer las refs con la lectura normal. Se avisa una sola vez.
 */
function warnIfRefsOutsideAllowed(refsDir: string, allowedDirectories: readonly string[]): void {
  if (coherenceWarned || allowedDirectories.length === 0) return;
  if (allowedDirectories.some((dir) => isPathInside(path.resolve(dir), refsDir))) return;
  coherenceWarned = true;
  console.warn(
    `[Engine] refsDir (${refsDir}) queda fuera de allowedDirectories de Desktop Commander: el modelo no podrá leer las refs ` +
    "con la lectura de archivos. Agregue esa carpeta a allowedDirectories o cambie refsDir.",
  );
}

/**
 * Crea una sola vez el almacén de refs (con `refsDir`) y el alcance de la regla B del Guard, y emite el aviso de
 * coherencia. La raíz de composición lo llama una vez y comparte el resultado entre tareas.
 *
 * Las rutas relativas que el modelo escriba se resuelven contra dos bases (D27): el directorio de trabajo de Jarvis y el
 * `cwd` de Desktop Commander si está configurado. No se comprobó contra qué base resuelve Desktop Commander las suyas.
 */
export function createEngineServices(config: JarvisConfig = ConfigManager.getConfig()): EngineServices {
  const refsDir = path.resolve(config.refsDir);
  const desktop = config.desktopCommanderMcp;
  warnIfRefsOutsideAllowed(refsDir, desktop.allowedDirectories ?? []);

  const bases = new Set<string>([process.cwd()]);
  if (desktop.cwd) bases.add(path.resolve(desktop.cwd));

  return {
    vault: createRefVault({ dir: refsDir }),
    guardScope: { protectedDirs: [refsDir], relativeBases: [...bases] },
  };
}