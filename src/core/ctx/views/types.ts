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
  /** PARAM: el `feedback` del plan en curso. Obligatorio en `user_feedback` (el plan todavía no está en el contexto). */
  readonly feedback: string | null;
  /** Planes anteriores con `feedback` que muestra la vista (`BUDGET.caps.previousFeedback`). */
  readonly previousFeedback: number;
  /** Pasos `completed` que muestra `steps.done` (`BUDGET.caps.stepsDone`). */
  readonly stepsDone: number;
}

export interface FinalViewOptions {
  /** Lecturas completas que muestra la vista (`BUDGET.caps.lastReads`). */
  readonly lastReads: number;
  /** Llamadas de `evidence` (`BUDGET.caps.evidence`). */
  readonly evidence: number;
  /** Pasos vigentes que muestra `steps` (`BUDGET.caps.stepsDone`). */
  readonly steps: number;
}

export interface RouteViewOptions extends WindowOptions {
  /** Decisión 2: la ruta elegida; los intentos se filtran a ella. Sin valor (Decisión 1) no se filtra. */
  readonly route?: string;
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

export interface ReviewViewOptions extends WindowOptions {
  /** Últimas lecturas aprobadas que muestra la vista (`BUDGET.caps.lastReads`): no depende de las escalaciones. */
  readonly lastReads: number;
}

export interface ArgsViewOptions extends ReviewViewOptions {
  readonly readArgKeys: ReadArgKeys;
  /** Refs más recientes que muestra la vista (`BUDGET.caps.refs`). */
  readonly refs: number;
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
  /** Fallo de llamada (5.4): `status` distinto de `ok` o `verdict = rejected`. */
  readonly failed: boolean;
  /** `args` de la llamada; solo donde la vista muestra lo que se quiso ejecutar (si no, `null`). */
  readonly args: JsonObject | null;
  readonly summary: string | null;
  readonly ref: RefView | null;
}

/** Un efecto o posible efecto es una llamada `write`; se muestra siempre con sus `args`. */
export type EffectView = CallView;

export interface FactView {
  readonly key: string;
  readonly value: string;
  readonly stepId: string;
  readonly at: number;
}

/** Entrada del usuario (5.4): respuesta a una pregunta o instrucción al rechazar una mutación. */
export interface UserInputView {
  readonly kind: "answer" | "rejection";
  readonly stepId: string;
  readonly text: string;
}

export interface FeedbackView {
  readonly planId: string;
  readonly feedback: string;
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

/** Por qué se genera el plan (derivado del contexto, no se pasa): 8.3. */
export type PlanTriggerView =
  | { readonly kind: "initial" }
  | { readonly kind: "user_feedback"; readonly feedback: string }
  | { readonly kind: "step_failure"; readonly failedStepId: string };

/**
 * `forPlan` (8.3): LLM 1, plan y replan.
 * - `initial`: solo `request`.
 * - `user_feedback` (durante la confirmación, sin nada ejecutado): `request`, `trigger`, `previousFeedback` y
 *   `steps.current` + `steps.next`, que son el plan propuesto que el usuario pidió cambiar.
 * - `step_failure`: todas las secciones; `failures` lleva los `args` para saber qué se probó.
 */
export interface PlanView {
  readonly request: string;
  readonly trigger: PlanTriggerView;
  /** `feedback` de los últimos planes anteriores que lo tengan, del más antiguo al más reciente. */
  readonly previousFeedback: readonly FeedbackView[];
  readonly steps: {
    /** Pasos `completed` vigentes (los últimos `options.stepsDone`). */
    readonly done: readonly StepDoneView[];
    /** El paso actual o el fallido, con su `state`. */
    readonly current: StepView | null;
    /** Pasos vigentes `pending` que siguen. */
    readonly next: readonly StepView[];
  };
  /** Solo en `step_failure`: intentos del paso fallido (ventana por escalaciones), con `args`. */
  readonly failures: readonly CallView[];
  readonly userInput: readonly UserInputView[];
  readonly env: readonly FactView[];
  /** Todos, sin recorte. */
  readonly effects: readonly EffectView[];
  readonly possibleEffects: readonly EffectView[];
}

/**
 * `forRoute` (8.3): Decisión 1 y Decisión 2. Las llamadas van como línea `L` (sin `args` ni `summary`), salvo `lastResult`,
 * que lleva su resumen. Una llamada aparece una sola vez: `lastResult` no se repite en `done`.
 */
export interface RouteView {
  /** Solo en reactivo; `null` en deliberativo. */
  readonly request: string | null;
  /** Solo en deliberativo: el paso actual; `null` en reactivo. */
  readonly step: StepView | null;
  /** Solo en reactivo: la última llamada aprobada que no es efecto. */
  readonly lastResult: CallView | null;
  /** Solo en reactivo: llamadas hechas (aprobadas), sin `lastResult`. */
  readonly done: readonly CallView[];
  /** Intentos no aprobados, ventana por escalaciones: de la tarea (reactivo) o del paso actual (deliberativo). */
  readonly attempts: readonly CallView[];
  readonly userInput: readonly UserInputView[];
  /** Hechos de entorno (hoy, `process`). */
  readonly env: readonly FactView[];
}

/** Paso `completed` de un plan (deliberativo): su instrucción y su resultado (`outcome`, 5.4), si es una lectura. */
export interface StepDoneView {
  readonly id: string;
  readonly instruction: string | null;
  readonly outcome: CallView | null;
}

/**
 * `forArgs` (8.3). Una llamada aparece una sola vez: `effects` > `lastReads` > `done` / `stepsDone` > `stepFailures`; las
 * refs ya mostradas en otra sección no se repiten en `refs`.
 */
export interface ArgsView {
  /** Solo en reactivo; `null` en deliberativo. */
  readonly request: string | null;
  /** Solo en reactivo: llamadas aprobadas como línea `L`, sin las que ya muestran `effects` o `lastReads`. */
  readonly done: readonly CallView[];
  /** Solo en deliberativo: el paso actual; `null` en reactivo. */
  readonly step: StepView | null;
  /** Solo en deliberativo: pasos `completed` vigentes, con su resultado. */
  readonly stepsDone: readonly StepDoneView[];
  /** Últimas lecturas aprobadas, con sus `args`, resumen y ref. */
  readonly lastReads: readonly CallView[];
  /** Las refs más recientes que no se muestran en otra sección, con lo ya leído de cada una. */
  readonly refs: readonly AvailableRefView[];
  /** Fallos del paso actual (ventana por escalaciones). */
  readonly stepFailures: readonly CallView[];
  readonly userInput: readonly UserInputView[];
  readonly env: readonly FactView[];
  /** Todos, con sus `args` y sin recorte. */
  readonly effects: readonly EffectView[];
}

/**
 * `forReview` (8.3): Decisión 3. Lo mismo que vio LLM 2 (`forArgs`) sin `refs` ni `effects`: las refs sin resolver y el
 * anti-loop se resuelven antes, de forma determinista, y la seguridad de una escritura es del Guard y de la confirmación del
 * usuario. El candidato (ruta, herramienta, descripción y `args`) es un parámetro: lo pasa el motor, no vive en el contexto.
 */
export interface ReviewView {
  /** Solo en reactivo; `null` en deliberativo. */
  readonly request: string | null;
  /** Solo en reactivo: llamadas aprobadas como línea `L`, sin las que ya muestra `lastReads`. */
  readonly done: readonly CallView[];
  /** Solo en deliberativo: el paso actual; `null` en reactivo. */
  readonly step: StepView | null;
  /** Solo en deliberativo: pasos `completed` vigentes, con su resultado. */
  readonly stepsDone: readonly StepDoneView[];
  /** Las mismas lecturas que vio LLM 2: para contrastar los `args` con los datos. */
  readonly lastReads: readonly CallView[];
  readonly stepFailures: readonly CallView[];
  /** Para decidir `info_missing`. */
  readonly userInput: readonly UserInputView[];
  readonly env: readonly FactView[];
}

/** Criterio contra el que se juzga la llamada: el del paso (deliberativo) o la solicitud (reactivo, avanza lo pedido). */
export type CriterionView =
  | { readonly source: "step"; readonly instruction: string | null; readonly expected: string | null }
  | { readonly source: "request"; readonly text: string };

/**
 * `forVerify` (8.3): Decisión 4. El criterio, la llamada evaluada (con `args`, resumen y ref), lo hecho para juzgar si la
 * llamada avanza lo pedido (solo reactivo) y la entrada del usuario, que precisa el criterio. No lleva efectos del paso: la
 * llamada evaluada ya muestra su propio efecto.
 */
export interface VerifyView {
  readonly criterion: CriterionView;
  readonly call: CallView;
  /** Solo en reactivo: llamadas aprobadas como línea `L`. */
  readonly done: readonly CallView[];
  readonly userInput: readonly UserInputView[];
}

/**
 * `forAsk` (8.3): LLM 4, la pregunta de `ask_user`. Lo ya preguntado y respondido (`userInput`: no repetir), la última
 * llamada no aprobada del paso (por qué falta información) y la última lectura con datos (de ahí salen las opciones).
 */
export interface AskView {
  /** Solo en reactivo; `null` en deliberativo. */
  readonly request: string | null;
  /** Solo en deliberativo: el paso actual; `null` en reactivo. */
  readonly step: StepView | null;
  readonly userInput: readonly UserInputView[];
  /** Última llamada no aprobada del paso, con `args` y resumen; `null` si no hay. */
  readonly rejectedCall: CallView | null;
  /** Última lectura aprobada con datos; `null` si no hay. */
  readonly lastRead: CallView | null;
}

/** Estado de la tarea con su frase fija (`note`). */
export interface TaskView {
  readonly state: TaskState;
  readonly stopReason: StopReason | null;
  /** Frase fija del estado y del motivo de detención. */
  readonly note: string;
}

/**
 * `forFinal` (8.3): LLM 3, respuesta final. Una llamada aparece una sola vez: efectos y posibles efectos > lecturas >
 * `evidence`. `evidence`: aprobadas primero (con resumen), luego las más recientes (líneas `L`).
 */
export interface FinalView {
  readonly request: string;
  readonly task: TaskView;
  /** Solo en deliberativo: pasos vigentes con su estado. */
  readonly steps: readonly StepView[];
  /** Las últimas lecturas con datos, completas. */
  readonly lastReads: readonly CallView[];
  readonly evidence: readonly CallView[];
  readonly userInput: readonly UserInputView[];
  readonly env: readonly FactView[];
  readonly effects: readonly EffectView[];
  readonly possibleEffects: readonly EffectView[];
}

/** `forFallback` (8.3): respuesta de respaldo sin modelo, también la usada en `cancelled`. Sin reserva ni tope. */
export interface FallbackView {
  readonly task: TaskView;
  /** Últimas llamadas que no son efectos, de cualquier veredicto (ventana por escalaciones), como líneas `L`. */
  readonly lastActions: readonly CallView[];
  readonly env: readonly FactView[];
  readonly effects: readonly EffectView[];
  readonly possibleEffects: readonly EffectView[];
}

/** `ctx.view.<vista>(...)`. */
export interface ContextViews {
  forPlan(options: PlanViewOptions): PlanView;
  forRoute(options: RouteViewOptions): RouteView;
  forArgs(options: ArgsViewOptions): ArgsView;
  forReview(options: ReviewViewOptions): ReviewView;
  forAsk(): AskView;
  /** `callId`: la llamada evaluada. */
  forVerify(callId: string): VerifyView;
  forFinal(options: FinalViewOptions): FinalView;
  forFallback(options: WindowOptions): FallbackView;
}