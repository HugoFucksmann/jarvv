/**
 * Vistas por consumidor (sección 8): objetos estructurados, de solo lectura y deterministas. No contienen texto de
 * prompt ni recortes de caracteres: eso lo hacen los renderizadores (`src/core/render/`), que además sanean.
 * Lo único que traen de texto fijo son las frases por `status` y por `reason` (`messages.ts`).
 */

import type {
  CallKind,
  CallStatus,
  CallVerdict,
  JsonObject,
  StepState,
  StopReason,
  TaskMode,
  TaskState,
  VerdictReason,
} from "../types.ts";

// ───────────────────────── Opciones ─────────────────────────

/** Tamaños de las ventanas recientes con 0, 1 y 2 o más escalaciones (`BUDGET.recentWindows`). */
export interface WindowOptions {
  readonly recentWindows: readonly number[];
}

export interface PlanViewOptions extends WindowOptions {
  /** Pasos ya ejecutados que muestra la ventana de pasos de `forPlan` (no depende de las escalaciones). */
  readonly planStepsBefore: number;
  /** Pasos siguientes (`pending`) que muestra la ventana de pasos de `forPlan`. */
  readonly planStepsAfter: number;
}

/**
 * Nombres de los parámetros de la lectura de archivos con los que se deriva qué parte de una ref ya se mostró.
 * El contexto no conoce herramientas (principio 5): quien lo usa los toma del catálogo.
 */
export interface ReadArgKeys {
  readonly path: string;
  readonly offset: string;
  readonly length: string;
}

export interface ArgsViewOptions extends WindowOptions {
  readonly readArgKeys: ReadArgKeys;
}

// ───────────────────────── Piezas ─────────────────────────

export interface RefView {
  readonly id: string;
  /** Tamaño en caracteres. */
  readonly size: number;
  /** Ruta absoluta del archivo con el resultado crudo. */
  readonly where: string;
  readonly label: string;
}

export interface StepView {
  readonly id: string;
  readonly state: StepState;
  readonly superseded: boolean;
  /** `null` en reactivo. */
  readonly instruction: string | null;
  readonly route: string | null;
  readonly expected: string | null;
}

export interface CallView {
  readonly id: string;
  readonly stepId: string;
  readonly route: string;
  readonly tool: string;
  readonly kind: CallKind;
  readonly status: CallStatus;
  readonly verdict: CallVerdict | null;
  readonly reason: VerdictReason | null;
  /** Frase fija según el `status` (`null` con `ok`). */
  readonly statusNote: string | null;
  /** Frase fija según el `reason` (`null` si no hay rechazo del verificador). */
  readonly reasonNote: string | null;
  /** `args` de la llamada; solo donde la vista muestra lo que se quiso ejecutar (si no, `null`). */
  readonly args: JsonObject | null;
  readonly summary: string | null;
  readonly ref: RefView | null;
}

/** Un efecto o posible efecto es una llamada `write`; se muestra siempre con sus `args`. */
export type EffectView = CallView;

export interface AttemptView {
  readonly callId: string;
  readonly stepId: string;
  readonly route: string;
  readonly tool: string;
  readonly status: CallStatus;
  readonly verdict: CallVerdict | null;
  /** Fallo de llamada (5.4). */
  readonly failed: boolean;
}

export interface FactView {
  readonly key: string;
  readonly value: string;
  readonly stepId: string;
  readonly at: number;
}

export interface FeedbackView {
  readonly planId: string;
  readonly feedback: string;
}

export interface HandoffView {
  readonly stepId: string;
  readonly callId: string;
  readonly summary: string;
  readonly ref: RefView | null;
}

/** Tramo de una ref ya leído, tal como lo pidió una lectura (valores crudos de `args`; `null` si no venían). */
export interface ShownRange {
  readonly callId: string;
  readonly offset: number | null;
  readonly length: number | null;
}

export interface AvailableRefView extends RefView {
  readonly stepId: string;
  readonly shown: readonly ShownRange[];
}

// ───────────────────────── Vistas ─────────────────────────

export interface PlanView {
  readonly mode: TaskMode;
  readonly request: string;
  readonly steps: {
    /** Pasos vigentes ya ejecutados (`completed`, `failed`): los últimos de la ventana. */
    readonly before: readonly StepView[];
    readonly omittedBefore: number;
    /** Paso vigente `running`, si hay. */
    readonly current: StepView | null;
    /** Pasos vigentes `pending`: los primeros de la ventana. */
    readonly after: readonly StepView[];
    readonly omittedAfter: number;
  };
  /** Todos, sin recorte. */
  readonly effects: readonly EffectView[];
  readonly possibleEffects: readonly EffectView[];
  readonly facts: readonly FactView[];
  /** Fallos recientes (ventana por escalaciones). */
  readonly failures: readonly CallView[];
  /** `feedback` de los planes anteriores. */
  readonly feedbacks: readonly FeedbackView[];
}

export interface RouteView {
  /** Solo en reactivo (el paso no trae instrucción); `null` en deliberativo. */
  readonly request: string | null;
  readonly step: StepView | null;
  readonly attempts: readonly AttemptView[];
  readonly failures: readonly CallView[];
  readonly facts: readonly FactView[];
}

export interface ArgsView {
  /** Solo en reactivo; `null` en deliberativo. */
  readonly request: string | null;
  readonly step: StepView | null;
  /** Solo en deliberativo. */
  readonly handoff: HandoffView | null;
  /** Historial reciente de acciones; solo en reactivo (en deliberativo, vacío). */
  readonly history: readonly AttemptView[];
  readonly lastReads: readonly CallView[];
  /** Todas las refs, con lo ya leído de cada una. */
  readonly refs: readonly AvailableRefView[];
  readonly effects: readonly EffectView[];
  readonly facts: readonly FactView[];
  /** Fallos del paso actual (ventana por escalaciones). */
  readonly stepFailures: readonly CallView[];
}

export interface VerifyView {
  /** Solo en reactivo; `null` en deliberativo. */
  readonly request: string | null;
  readonly step: StepView;
  readonly call: CallView;
  /** Efectos del paso evaluado. */
  readonly stepEffects: readonly EffectView[];
}

export interface FinalView {
  readonly request: string;
  readonly state: TaskState;
  readonly stopReason: StopReason | null;
  /** Estado de cada paso, incluidos los reemplazados. */
  readonly steps: readonly StepView[];
  /** Evidencia: cada llamada con su resumen, veredicto y razón. */
  readonly evidence: readonly CallView[];
  readonly effects: readonly EffectView[];
  readonly possibleEffects: readonly EffectView[];
  readonly facts: readonly FactView[];
}

export interface FallbackView {
  readonly state: TaskState;
  readonly stopReason: StopReason | null;
  readonly failures: readonly CallView[];
  readonly effects: readonly EffectView[];
  readonly possibleEffects: readonly EffectView[];
  readonly facts: readonly FactView[];
  /** Últimas acciones (ventana por escalaciones). */
  readonly lastActions: readonly CallView[];
}

/** `ctx.view.<vista>(...)`. */
export interface ContextViews {
  forPlan(options: PlanViewOptions): PlanView;
  forRoute(options: WindowOptions): RouteView;
  forArgs(options: ArgsViewOptions): ArgsView;
  /** `callId`: la llamada evaluada. */
  forVerify(callId: string): VerifyView;
  forFinal(): FinalView;
  forFallback(options: WindowOptions): FallbackView;
}
