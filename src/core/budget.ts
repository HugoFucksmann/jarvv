/**
 * Tabla única de valores provisorios o tentativos (PLAN_CONTEXT.md v0.38, PLAN_FLUJO.md v0.9).
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
  /** Tope de `plans.feedback` (9). */
  feedbackMax: 1500,
  /** Profundidad máxima de un valor JSON escrito (`args`): niveles de contenedores contando la raíz (9). */
  jsonMaxDepth: 6,

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
  maxCallsPerStep: 8,
  planRegenerationRetries: 1,
  /** Tamaño de las ventanas recientes con 0, 1 y 2 o más escalaciones (9). */
  recentWindows: [2, 5, 10],

  // ── Ejecutor (Fase 5) ──
  /** Repeticiones de una consulta a un modelo ante una respuesta inválida (no ante desborde): verificador, pregunta, Decision (D4). */
  invalidResponseRetries: 1,
  /** Largo máximo del argumento principal dentro del `label` de una ref (D8). */
  refLabelChars: 200,
  /** Generación del texto de la pregunta al usuario (`ask_user`, D17). */
  ask: {
    /** Tope de tokens de salida de `generateQuestion`. */
    maxTokens: 300,
  },

  // ── Topes por sección y por elemento de las vistas (8.2, 9) ──
  /**
   * Los aplican los adaptadores y los renderizadores al armar el texto (nunca `apply`). Los recortes por elemento llevan el
   * marcador `…(+N)`; en `userInput` y `env` se muestran los elementos más recientes que quepan, sin cortar uno.
   * Los conteos (`done`, `stepsDone`, `lastReads`, `refs`, `evidence`) son elementos, el resto son caracteres.
   */
  caps: {
    request: 4000,
    step: 4000,
    /** Línea de llamada `L`. */
    line: 300,
    /** Fallo `F`: `L` + `args` + `summary`. */
    failureArgs: 500,
    failureSummary: 600,
    /** Lectura: `L` + `args` + `summary` completo + marca de ref. */
    readArgs: 600,
    readSummary: 2500,
    refMark: 250,
    /** Llamada evaluada (`forVerify`) y llamada rechazada (`forAsk`). */
    evaluatedArgs: 2000,
    rejectedSummary: 800,
    refLine: 400,
    done: 30,
    stepsDone: 30,
    stepsDoneInstruction: 400,
    stepsDoneOutcome: 500,
    nextInstruction: 600,
    lastResultSummary: 2500,
    lastReads: 3,
    refs: 8,
    userInput: 6000,
    env: 1000,
    /** Reserva común de efectos y posibles efectos: nunca se recortan; si no entran, la vista falla en voz alta. */
    effectsReserve: 12000,
    candidate: 6000,
    /** Schema limpio de la herramienta candidata (`forReview`, Decisión 3). */
    candidateSchema: 3000,
    previousFeedback: 4,
    finalNote: 600,
    finalStepInstruction: 300,
    evidence: 38,
    evidenceSummary: 1500,
  },

  // ── Extractores de resultados (Fase 4) ──
  /**
   * Lo que cada extractor deja en el `summary` antes de recortar al tope `summaryMax`. Son los literales de los
   * extractores (`result/extractors/*`), movidos a la tabla única (D7 de la Fase 4).
   */
  extract: {
    /** `list_directory`: entradas que se muestran. */
    listDirEntries: 40,
    /** `read_file`: líneas del inicio y del final que se muestran cuando el contenido es largo. */
    readFileHeadLines: 15,
    readFileTailLines: 15,
    /** Procesos: últimas líneas de la salida que se muestran. */
    processTailLines: 30,
    /** `search`: resultados que se muestran (antes `MAX_SCRATCHPAD_RESULTS`). */
    searchResultsShown: 10,
    /** `search`: largos de snippet que se intentan, de mayor a menor; gana el mayor que quepa en todos. */
    searchSnippetLengths: [240, 160, 100, 60, 40],
    /** `search`: largo máximo del lead. */
    searchLeadChars: 300,
    /** Texto largo sin extractor propio (genérico, `fetch`): caracteres del inicio y del final que se conservan. */
    textHeadChars: 750,
    textTailChars: 750,
  },
} as const;

export type BudgetKey = keyof typeof BUDGET;

export const BUDGET_META: { readonly [K in BudgetKey]: BudgetMeta } = {
  summaryMax: { provisional: false, source: "9", usedBy: "create.context → apply (regla 7); Fase 4 · processResult (red de seguridad)" },
  factValueMax: { provisional: false, source: "9", usedBy: "create.context → apply (regla 7)" },
  feedbackMax: { provisional: false, source: "9", usedBy: "create.context → apply (regla 7)" },
  jsonMaxDepth: { provisional: false, source: "9", usedBy: "create.context → apply (regla 7); Fase 5 · engine/args.ts (clipArgs)" },
  argsStringDefault: { provisional: false, source: "5.2, 9", usedBy: "Fase 5 · ejecutor (recorte antes de escribir); base de ARGS_MAX" },
  maxSteps: { provisional: false, source: "5.2", usedBy: "Fases 5 y 6 · ejecutor" },
  maxReplans: { provisional: false, source: "5.2", usedBy: "Fase 6 · recuperación" },
  maxEscalations: { provisional: false, source: "5.2", usedBy: "Fase 6 · recuperación" },
  maxCallsPerStep: { provisional: false, source: "FLUJO 3", usedBy: "Fase 5 · stepLoop" },
  planRegenerationRetries: { provisional: true, source: "5.2 (C14)", usedBy: "Fase 6 · proveedor deliberativo" },
  recentWindows: { provisional: false, source: "9", usedBy: "Fase 2 · vistas (ctx.view.*)" },
  invalidResponseRetries: { provisional: false, source: "FLUJO 2", usedBy: "Fase 5 · verify.ts, ask.ts, callRunner.ts, stepLoop.ts" },
  refLabelChars: { provisional: true, source: "D8; el valor es un supuesto de implementación", usedBy: "Fase 5 · engine/args.ts (callLabel)" },
  ask: { provisional: true, source: "D17; el valor es un supuesto de implementación", usedBy: "Fase 5 · qwen.ts (generateQuestion)" },
  caps: { provisional: true, source: "8.2, 9; topes ampliados por decisión del usuario (hay margen de contexto)", usedBy: "Fase 5b · adaptadores de Decisión y renderizadores" },
  extract: { provisional: true, source: "5.2 (summary), 9, 10.1; los valores son los literales de los extractores vigentes", usedBy: "Fase 4 · result/extractors/*" },
};