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
  // Reintentos y fallos seguidos: todos en 2 (un intento y un reintento); los topes de pasos y llamadas, ajustados al uso real.
  maxSteps: 20,
  maxReplans: 3,
  maxEscalations: 2,
  /** Pasos fallidos seguidos sobre el mismo ítem de la lista antes de abandonarlo (si quedan otros): ver `runReactive`. */
  maxItemFailures: 2,
  /** Ejecuciones por paso: llamadas que llegaron a la herramienta (lo que cuesta de verdad). Ver `engine/limits.ts`. */
  maxCallsPerStep: 6,
  /** Intentos por paso: toda llamada registrada salvo `user_rejected`, incluidas las que no tocaron la herramienta (bloqueadas, argumentos inválidos...). Techo contra un modelo que da vueltas. */
  maxAttemptsPerStep: 10,
  /** Rechazos `not_accomplished` de Decisión 4 que agotan una ruta en un paso (deja de ofrecerse a Decisión 1 en ese paso). */
  maxNotAccomplishedPerRoute: 2,
  /** Llamadas bloqueadas por repetición (`loop_blocked`) que fallan el paso: 2 = un solo reintento. */
  maxRepeatsPerStep: 2,
  /** Llamadas rechazadas por la revisión (`args_invalid`) que fallan el paso: 2 = un solo reintento. */
  maxReviewRejectionsPerStep: 2,
  /** Llamadas rechazadas por la verificación (Decisión 4, `verdict = rejected`) que fallan el paso: 2 = un solo reintento. Tras eso la recuperación del modo reescribe el ítem (reactivo) o replanifica (deliberativo). */
  maxVerifyRejectionsPerStep: 2,
  /** Rechazos del usuario (`user_rejected`) que fallan el paso: 2 = el usuario ya dijo que no dos veces; no se le vuelve a pedir lo mismo. No cuentan para el tope de llamadas. */
  maxUserRejectionsPerStep: 2,
  /**
   * Denegaciones que fallan el paso: llamadas que la política no deja ejecutar (Guard o lista negra: `tool_rejected`) o que el servidor de la
   * herramienta rechaza (`denied`). 2 = el modelo ve el motivo y prueba otro camino una vez; si vuelve a chocar, el paso falla (no la tarea).
   */
  maxDeniedPerStep: 2,
  /**
   * Umbral de D3 para un comando del nivel 2 de la lista negra (`sensitive`) con `autoMode` encendido: aprueba solo si la
   * probabilidad de `approved` llega a este valor (el resto de las escrituras usa `REVIEW_APPROVE`, 0,6). Provisorio: medir con el eval.
   */
  sensitiveApprove: 0.65,
  /** Preguntas al usuario (`ask_user`) por paso: las que redacta el modelo (falta un dato, el paso se atascó). */
  maxQuestionsPerStep: 1,
  /**
   * Preguntas al usuario por paso con lo que pide un proceso (`waiting_input` de `run_command`): no gastan `maxQuestionsPerStep`. 3 = un instalador
   * que pregunta dos o tres veces; cada respuesta es además una ejecución, así que `maxCallsPerStep` sigue acotando el paso.
   */
  maxProcessPromptsPerStep: 3,
  /** Tamaño de las ventanas recientes con 0, 1 y 2 o más escalaciones (9). */
  recentWindows: [2, 5, 10],

  // ── Ejecutor (Fase 5) ──
  /** Repeticiones de una consulta al LLM (Qwen) ante una respuesta inválida o truncada (no ante desborde). Decision usa 0 reintentos (DN-3.4). */
  invalidResponseRetries: 1,
  /** Largo máximo del argumento principal dentro del `label` de una ref (D8). */
  refLabelChars: 200,
  /** Generación del texto de la pregunta al usuario (`ask_user`, D17). */
  ask: {
    /** Tope de tokens de salida de `generateQuestion`. */
    maxTokens: 300,
  },
  /** Lista de pendientes del reactivo (sin thinking). */
  pending: {
    /** Tope de tokens de salida de `generatePendingFromView`. */
    maxTokens: 1024,
  },

  // ── Topes por sección y por elemento de las vistas (8.2, 9) ──
  /**
   * Los aplican los adaptadores y los renderizadores al armar el texto (nunca `apply`). Los recortes por elemento llevan el
   * marcador `…(+N)`; en `userInput` y `env` se muestran los elementos más recientes que quepan, sin cortar uno.
   * Los conteos (`done`, `stepsDone`, `lastReads`, `refs`, `evidence`) son elementos, el resto son caracteres.
   */
  caps: {
    request: 4000,
    /** Solicitud completa que ve Decisión 1 (reactivo): la pista de dónde o cómo hacerlo suele estar al principio; el resto cuesta tokens de decisión. */
    routeRequest: 1000,
    step: 4000,
    /** Línea de llamada `L`. */
    line: 300,
    /** Llamada hecha en `forPending`: `args` y `summary`, cada uno con este tope. */
    pendingEntry: 600,
    /** Fallo `F`: `L` + `args` + `summary`. */
    failureArgs: 500,
    failureSummary: 600,
    /** Resumen de un intento no aprobado que ven Decisión 1 y 2 (solo si explica el fallo). */
    attemptSummary: 200,
    /** Resultado del último intento fallido de la misma herramienta (`forArgs`, `lastError`). */
    lastErrorSummary: 800,
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
    /** Texto largo sin extractor propio (genérico): caracteres del inicio y del final que se conservan. */
    textHeadChars: 750,
    textTailChars: 750,
  },
} as const;

export type BudgetKey = keyof typeof BUDGET;