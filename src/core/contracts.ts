/**
 * JARVIS Core — Contratos del motor (Fase 5).
 *
 * Interfaces mínimas, sin implementaciones ni composición: el descubrimiento de herramientas, las decisiones (ruta,
 * herramienta, revisión de argumentos y verificación) y el modelo generativo (argumentos, pregunta, plan y respuesta final,
 * todos desde las vistas del contexto). Los motores (`models/`) los implementan y `engine/` los consume; ninguno de los
 * dos lados importa del otro. La composición (`createEngineServices`) vive en `engine/services.ts`.
 */

import type { UserEnvironment } from "./environment.ts";
import type { FirstQueryKind } from "./engine/firstQuery.ts";
import type { MemoryFact } from "./memory.ts";
import type { IMCPServer } from "./mcp/types.ts";
import type { TaskEndOutcome } from "./tools/provider.ts";
import type { Blacklist } from "./policy/blacklist.ts";
import type { ProtectedPaths } from "./policy/guard.ts";
import type { RefVault } from "./refs/refVault.ts";
import type { VerdictReason } from "./ctx/index.ts";
import type { ArgumentsGenerationResult, MCPTool, TimeSpan } from "./types.ts";
import type { ExecutableRoute } from "./types/routes.ts";
import type { cleanInputSchema } from "./utils.ts";
import type { CaptureSink } from "./trace/sink.ts";

// ───────────────────────── Descubrimiento de herramientas ─────────────────────────

export interface IDiscoveryEngine {
  getServer(name: string): IMCPServer | undefined;
  getDiscoveredTools(serverName: string, forceRefresh?: boolean): Promise<MCPTool[]>;
  getUnavailableServers(): Record<string, { reason: string; since: number }>;
  validateToolExists(serverName: string, toolName: string): Promise<boolean>;
  /** Avisa a los proveedores que terminó una tarea, para que cierren lo que dejó corriendo (los procesos de `run_command`). */
  notifyTaskEnd?(taskId: string, outcome: TaskEndOutcome): Promise<void>;
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
  /** La solicitud del usuario (reactivo), ya saneada y recortada; `null` o ausente en deliberativo. Solo la usa Decisión 1. */
  readonly request?: string | null;
}

export interface ToolDecisionInput extends DecisionFrame {
  /** Ruta elegida; los intentos del marco ya están filtrados a ella. */
  readonly route: ExecutableRoute;
  /** Herramientas usables de la ruta, ya filtradas. */
  readonly tools: MCPTool[];
}

/** Resultado de la revisión de argumentos: aprobar o el escenario del rechazo (se refleja en el `status` de la llamada). */
/** Resultados de la revisión. No hay `tool_rejected`: la herramienta la elige Decisión 2, y una herramienta equivocada la atrapa la verificación. */
export const ARGS_REVIEWS = ["approved", "args_invalid", "info_missing"] as const;
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
  /** Llamadas aprobadas previas a la evaluada, ya renderizadas como texto, la más reciente al final. */
  readonly recent: readonly string[];
  /** La solicitud completa del usuario. Solo cuando el ítem verificado es el último; `null` o ausente en el resto. */
  readonly request?: string | null;
  /** Preguntas que el código ya respondió (`engine/postcondition.ts`): no se le hacen al modelo y su valor entra al veredicto. */
  readonly known?: Partial<Readonly<Record<VerifyCheckKey, number>>>;
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

/**
 * Decisión 5: lo que recibe la consulta de cierre. Es el texto de `renderPending` con la lista vacía (REQUEST, STATE, USER, DONE completo y FAIL): la misma vista que hoy
 * recibe el LLM al confirmar que no falta nada, pero la responde el modelo de decisión con una sola pregunta.
 */
export interface CompletionDecisionInput {
  readonly view: string;
}

/** Clave de la pregunta `noul` de Decisión 5. */
export const COMPLETION_KEY = "request_complete";

/** Decisión 5: probabilidad de que la solicitud completa ya esté cumplida con lo hecho, sin umbral aplicado: el cierre es de `confirmCompletion` (`engine/completion.ts`). */
export type CompletionDecision = Omit<DecisionTrace, "probabilities"> & { readonly requestComplete: number };

/** La tarea anterior para el hilo (`engine/thread.ts`): su pedido y el comienzo de su respuesta. */
export interface PreviousTask {
  readonly request: string;
  readonly answer: string;
}

/** Una consulta `noul` de una sonda de verificación (`tools/probes.ts`): el estado ya armado y la pregunta con sus criterios. */
export interface ProbeQuery {
  readonly state: string;
  readonly question: { readonly instructions: string; readonly criteria: { readonly true: string; readonly false: string } };
}
/** `probability` es la de la afirmativa; la sonda decide qué es «bien» (`badWhenTrue`). */
export type ProbeAnswer = Omit<DecisionTrace, "probabilities"> & { readonly probability: number };

/** Continuación: ¿el pedido nuevo depende de la tarea anterior? */
export interface ContinuationInput {
  readonly previous: PreviousTask;
  readonly request: string;
}
export type ContinuationDecision = Omit<DecisionTrace, "probabilities"> & { readonly follows: number };

/** D0: la solicitud con la que empieza una tarea reactiva. */
export interface FirstQueryInput {
  readonly request: string;
}

/** D0: charla, una acción o varias. `kind` lo decide el código con los umbrales de `engine/firstQuery.ts`; `probabilities` son las de la pregunta `kind` y `multi` la de "sí". */
export type FirstQueryDecision = Omit<DecisionTrace, "probabilities"> & {
  readonly kind: FirstQueryKind;
  readonly probabilities: Record<string, number>;
  readonly multi: number;
};

export interface IActionDecision {
  chooseRoute(input: RouteDecisionInput, signal?: AbortSignal): Promise<RouteDecision>;
  chooseTool(input: ToolDecisionInput, signal?: AbortSignal): Promise<ToolDecision>;
  /** Decisión 3: revisa la llamada candidata. Corre en cada intento, después de las comprobaciones deterministas. */
  reviewArgs(input: ReviewDecisionInput, signal?: AbortSignal): Promise<ReviewDecision>;
  /** Decisión 4: verifica el resultado de una llamada ejecutada (las preguntas de `VERIFY_CHECKS`). */
  verifyResult(input: VerifyDecisionInput, signal?: AbortSignal): Promise<VerifyDecision>;
  /** Decisión 5: con la lista de pendientes vacía, ¿la solicitud completa ya está cumplida? (reactivo; reemplaza a la confirmación del LLM cuando responde que sí) */
  checkCompletion(input: CompletionDecisionInput, signal?: AbortSignal): Promise<CompletionDecision>;
  /**
   * D0, primera consulta de una tarea reactiva: ¿charla, una acción o varias? Opcional: una implementación sin ella deja la tarea en el flujo de siempre.
   */
  firstQuery?(input: FirstQueryInput, signal?: AbortSignal): Promise<FirstQueryDecision>;
  /** Una pregunta de una sonda de verificación (`tools/probes.ts`) sobre una llamada. Opcional: sin ella no se comprueban las sondas. */
  probe?(input: ProbeQuery, signal?: AbortSignal): Promise<ProbeAnswer>;
  /** Hilo: ¿el pedido nuevo continúa la tarea anterior? Opcional: sin ella no hay hilo. */
  continuation?(input: ContinuationInput, signal?: AbortSignal): Promise<ContinuationDecision>;
}

// ───────────────────────── LLM: argumentos y pregunta (D17) ─────────────────────────

export interface ArgsFromViewInput {
  readonly tool: MCPTool;
  readonly cleanedSchema: ReturnType<typeof cleanInputSchema>;
  readonly environment: UserEnvironment;
  /** Texto de `renderArgs(ctx.view.forArgs(...))`. */
  readonly view: string;
  /** Intentos previos de esta herramienta en este paso que no se aprobaron; sube la temperatura (`argsTemperature`). Por defecto 0. */
  readonly priorAttempts?: number;
  /** Hechos del usuario que coinciden con el pedido (`memory.ts`), como líneas `clave: valor`; vacío u omitido = sin bloque. */
  readonly memory?: readonly string[];
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
  /** La tarea anterior, si el pedido la continúa. */
  readonly thread?: PreviousTask;
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
  /** La tarea anterior, si el pedido la continúa. */
  readonly thread?: PreviousTask;
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
  /** Elección de ruta y herramienta (`chooseRoute`, `chooseTool`), revisión (`reviewArgs`), verificación (`verifyResult`) y cierre (`checkCompletion`). */
  readonly decision: IActionDecision;
  readonly discovery: IDiscoveryEngine;
  readonly llm: EngineLLM;
  readonly vault: RefVault;
  /** Alcance de la regla B del Guard (D9, D20, D27). */
  readonly guardScope: ProtectedPaths;
  /** Lista negra de herramientas que modifican el sistema (`policy/blacklist.ts`). */
  readonly blacklist: Blacklist;
  /** Datos de esta PC (sistema operativo y carpetas del usuario): se consultan una vez por proceso. */
  readonly environment: () => Promise<UserEnvironment>;
  /** ¿Modo automático? (`autoMode` de la configuración, leído en cada llamada). */
  readonly autoMode: () => boolean;
  /** ¿Aprobación por niveles (`policy/tiers.ts`)? Opt-in; si está encendida reemplaza a `autoMode` en las escrituras. Omitida = apagada. */
  readonly approvalTiers?: () => boolean;
  /** Hechos guardados por el usuario (`data/memory.json`); omitido = sin memoria. */
  readonly memory?: () => readonly MemoryFact[];
  /** La tarea anterior vigente (menos de `THREAD_TTL_MS`) cuando esta tarea empezó; `null` u omitida = sin hilo. */
  readonly previousTask?: PreviousTask | null;
  /** Receptor de la traza (D11). Sin él, no se captura nada. */
  readonly sink?: CaptureSink;
}
