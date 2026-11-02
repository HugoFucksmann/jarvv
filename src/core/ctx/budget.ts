/**
 * Tabla única de valores provisorios o tentativos (PLAN_CONTEXT.md v0.28).
 *
 * Vive FUERA de `ctx/` y el contexto no la importa (principio 5): quien crea el contexto toma de aquí los valores y se
 * los pasa a `create.context` como parámetros. Cada entrada declara si es provisoria, qué sección del diseño la
 * origina y qué fase la consume. Las fases siguientes agregan sus valores a esta misma tabla.
 */

export interface BudgetMeta {
  /** true si el diseño la marca como provisoria o tentativa. */
  readonly provisional: boolean;
  /** Sección del diseño (o "supuesto de implementación") de donde sale el valor. */
  readonly source: string;
  /** Dónde se aplica. */
  readonly usedBy: string;
}

export const BUDGET = {
  // ── Topes que `apply` valida (se pasan a `create.context`) ──
  /** Tope de largo de `summary` (9). */
  summaryMax: 2500,
  /** Tope del valor de un hecho (9). */
  factValueMax: 500,
  /** Profundidad máxima de un valor JSON (6, regla 7). */
  jsonMaxDepth: 32,

  // ── Recorte que aplica quien ejecuta (no lo valida `apply`) ──
  /**
   * Recorte por defecto de los strings de `args` (5.2, 9). `ARGS_MAX` (el máximo que valida `apply`) NO está en esta
   * tabla: se calcula desde el catálogo de herramientas como el mayor de este valor y de las excepciones `argCaps`.
   */
  argsStringDefault: 300,

  // ── Límites del motor (5.2) ──
  maxSteps: 15,
  maxReplans: 2,
  maxEscalations: 2,
  stepRetriesArgs: 1,
  stepRetriesResult: 1,
  maxCallsPerStep: 8,
  maxUserQuestionsPerStep: 1,
  planRegenerationRetries: 1,
  /** Tamaño de las ventanas recientes con 0, 1 y 2 o más escalaciones (9). */
  recentWindows: [2, 5, 10],

  // ── Vistas y renderizadores (Fase 2) ──
  /** Pasos ya ejecutados que muestra la ventana de pasos de `forPlan`. */
  planStepsBefore: 5,
  /** Pasos siguientes (`pending`) que muestra la ventana de pasos de `forPlan`. */
  planStepsAfter: 5,
  /** Recorte de una línea de lista (fallos, intentos, instrucciones de pasos) en los renderizadores. */
  viewLineChars: 600,
  /** Recorte de la solicitud o la instrucción dentro de un prompt. */
  viewRequestChars: 1500,
  /** Recorte de cada `feedback` de un plan anterior. */
  viewFeedbackChars: 1500,
  /**
   * Máximo de caracteres de cada vista que no depende del modelo. `forPlan` no tiene valor aquí: su límite es el del
   * modelo y lo pasa quien llama a `renderPlan`.
   */
  viewMaxChars: { route: 6000, args: 12000, verify: 6000, final: 12000, fallback: 4000 },
} as const;

export type BudgetKey = keyof typeof BUDGET;

export const BUDGET_META: { readonly [K in BudgetKey]: BudgetMeta } = {
  summaryMax: { provisional: false, source: "9", usedBy: "create.context → apply (regla 7)" },
  factValueMax: { provisional: true, source: "5.1, 9, 10.1", usedBy: "create.context → apply (regla 7)" },
  jsonMaxDepth: { provisional: true, source: "6 regla 7; el valor es un supuesto de implementación", usedBy: "create.context → apply (regla 7)" },
  argsStringDefault: { provisional: true, source: "5.2, 9, 10.1", usedBy: "Fase 5 · ejecutor (recorte antes de escribir); base de ARGS_MAX" },
  maxSteps: { provisional: false, source: "5.2", usedBy: "Fases 5 y 6 · ejecutor" },
  maxReplans: { provisional: false, source: "5.2", usedBy: "Fase 6 · recuperación" },
  maxEscalations: { provisional: false, source: "5.2", usedBy: "Fase 6 · recuperación" },
  stepRetriesArgs: { provisional: true, source: "5.2, 10.1", usedBy: "Fase 5 · stepLoop" },
  stepRetriesResult: { provisional: true, source: "5.2, 10.1", usedBy: "Fase 5 · stepLoop" },
  maxCallsPerStep: { provisional: true, source: "5.2, 10.1", usedBy: "Fase 5 · stepLoop" },
  maxUserQuestionsPerStep: { provisional: false, source: "5.2", usedBy: "Fase 5 · stepLoop" },
  planRegenerationRetries: { provisional: true, source: "5.2 (C14)", usedBy: "Fase 6 · proveedor deliberativo" },
  recentWindows: { provisional: true, source: "9, 10.1", usedBy: "Fase 2 · vistas (ctx.view.*)" },
  planStepsBefore: { provisional: true, source: "8, 10.1; el valor es un supuesto de implementación", usedBy: "Fase 2 · ctx.view.forPlan" },
  planStepsAfter: { provisional: true, source: "8, 10.1; el valor es un supuesto de implementación", usedBy: "Fase 2 · ctx.view.forPlan" },
  viewLineChars: { provisional: true, source: "9, 10.1; el valor es un supuesto de implementación", usedBy: "Fase 2 · renderizadores" },
  viewRequestChars: { provisional: true, source: "9, 10.1; el valor es un supuesto de implementación", usedBy: "Fase 2 · renderizadores" },
  viewFeedbackChars: { provisional: true, source: "9, 10.1; el valor es un supuesto de implementación", usedBy: "Fase 2 · renderPlan" },
  viewMaxChars: { provisional: true, source: "9, 10.1; los valores son un supuesto de implementación", usedBy: "Fase 2 · renderizadores (route, args, verify, final, fallback)" },
};