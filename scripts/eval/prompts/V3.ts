import type { TestCase } from "../core/types.ts";


/* =====================================================================
 * prompts3.ts — tercera ronda. Diseñada a partir de 98 casos (v1 + v2)
 * y 22 variantes ya corridas. Lo que sabemos del modelo:
 *
 *  1. SABE más de lo que su umbral 0.5 deja ver. AUC de `cumple` = 0.98:
 *     separa buenos de malos casi perfecto, pero con un sesgo fuerte a "sí".
 *     Subir el umbral a 0.70–0.85 gana 5–10 puntos SIN tocar el prompt
 *     (meseta estable en v1 y v2).
 *  2. La pregunta HOLÍSTICA ("¿cumple la instrucción?") es la mejor señal
 *     (AUC 0.96–0.98). Las preguntas descompuestas son peores:
 *       target_ok AUC 0.73–0.88, ok AUC 0.75–0.90.
 *  3. Pedir comparación "exacta" / "pieza por pieza" ROMPE la calibración:
 *     en R5 target_ok dio 0.09 en un caso trivial y correcto (n2-e1-good).
 *     Con redacción natural se mantiene bien. Evitar "exactly", "piece by piece".
 *  4. Para EVIDENCIA ("¿falta algo que la salida debería mostrar?") la
 *     polaridad NEGATIVA funciona mejor (any_missing_evidence AUC 0.95)
 *     que la positiva (evidence_ok AUC 0.80). Atrapa los casos "unknown"
 *     (proceso sin PID) que ninguna otra señal ve.
 *  5. Reescribir preguntas / añadir preámbulos empeoró (R2, R3). Regla de
 *     trabajo: REUTILIZAR redacciones validadas y cambiar UNA cosa por corrida.
 *  6. Hay errores que ningún prompt arregla con este modelo: diferencia de
 *     una letra (log vs logs, h03-bad). Eso va en validación por código.
 *
 *  Casos sin solución por prompt (se reportan aparte, ver README al final):
 *   - n2-h03-bad : near-miss de 1 letra.
 *   - n2-h19-bad : etiqueta discutible (respaldo en Temp). Revisar el gold.
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * 0) UTILIDADES
 * ------------------------------------------------------------------- */
function clip(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Conserva cabeza y cola (en logs largos el veredicto suele estar al final). */
export function clipHT(s: string, n: number, headRatio = 0.4): string {
    if (s.length <= n) return s;
    const marker = "\n[…truncated…]\n";
    const budget = n - marker.length;
    const head = Math.floor(budget * headRatio);
    return s.slice(0, head) + marker + s.slice(s.length - (budget - head));
}

function formatArguments(args: Record<string, unknown>): string {
    return Object.entries(args)
        .map(([k, v]) => {
            const s = typeof v === "string" ? v : JSON.stringify(v);
            return `${k}=${clip(s, 200)}`;
        })
        .join(", ");
}

/* ---------------------------------------------------------------------
 * 1) ESTADO
 *    Mantiene el estado S+ (con Arguments) + clip cabeza/cola. Sin el
 *    bloque de "targets extraídos": no aportó (su regex ignoraba nombres
 *    sueltos como `logs`) y alargaba el prompt.
 * ------------------------------------------------------------------- */

/** P3-S: estado base. Control de la ronda. */
export function buildStateP3(c: TestCase): string {
    return [
        `Step instruction: ${clip(c.instruction, 1000)}`,
        c.expected_outcome ? `Expected outcome: ${clip(c.expected_outcome, 1000)}` : null,
        `Tool: ${c.tool}`,
        `Arguments: ${formatArguments(c.args)}`,
        `Result: ${clipHT(c.result, 2500)}`,
        `Observation: ${clipHT(c.observation, 2500)}`,
    ]
        .filter(Boolean)
        .join("\n");
}

/**
 * P3-S2: igual, pero el expected_outcome se presenta como criterio de éxito.
 * Hipótesis: el modelo ignora expected_outcome como restricción (ver h19, h18).
 * Único cambio respecto a P3-S: la etiqueta de esa línea.
 */
export function buildStateP3Criteria(c: TestCase): string {
    return [
        `Step instruction: ${clip(c.instruction, 1000)}`,
        c.expected_outcome
            ? `Success criteria (the step is done only if this holds): ${clip(c.expected_outcome, 1000)}`
            : null,
        `Tool: ${c.tool}`,
        `Arguments: ${formatArguments(c.args)}`,
        `Result: ${clipHT(c.result, 2500)}`,
        `Observation: ${clipHT(c.observation, 2500)}`,
    ]
        .filter(Boolean)
        .join("\n");
}

/* ---------------------------------------------------------------------
 * 2) PREGUNTAS NOUL
 *    Las claves coinciden con las de las corridas anteriores (cumple,
 *    any_mismatch, any_missing_evidence) para poder comparar offline.
 * ------------------------------------------------------------------- */

/** Control: redacción original de `cumple`, sin cambios. */
export const QUESTIONS_P3_CONTROL = {
    cumple: {
        type: "noul",
        instructions: "Does the result accomplish the step instruction?",
    },
};

/**
 * Variante con detalles. Único cambio: enumera qué detalles de la
 * instrucción importan. Sin "exactly" ni "piece by piece" (ver punto 3).
 */
export const QUESTIONS_P3_DETAIL = {
    cumple: {
        type: "noul",
        instructions:
            "Does the result accomplish the step instruction, respecting every detail the instruction specifies (names, locations, versions, quantities, language)?",
    },
};

/**
 * P3-B (candidata principal): señal holística + veto de evidencia faltante.
 * `any_missing_evidence` usa la redacción EXACTA de R10 (ya validada).
 * Regla: aprobar si cumple >= 0.75 Y any_missing_evidence <= 0.40.
 */
export const QUESTIONS_P3_B = {
    cumple: QUESTIONS_P3_CONTROL.cumple,
    any_missing_evidence: {
        type: "noul",
        polarity: "negative",
        instructions:
            "Is there anything the instruction needs that the output does not show (for example no identifier, no confirmation, no content)?",
    },
};

/** P3-C: P3-B + `any_mismatch` (redacción exacta de R10). */
export const QUESTIONS_P3_C = {
    ...QUESTIONS_P3_B,
    any_mismatch: {
        type: "noul",
        polarity: "negative",
        instructions:
            "Is there any difference between what the instruction asks for and what the tool actually acted on or produced (different target, different content, or only part of it)?",
    },
};

/* ---------------------------------------------------------------------
 * 3) CRITERIOS CHOICE (3 etiquetas)
 *    R8 (CRITERIA_V1_3_C) tuvo el mejor AUC entre los choice (0.98) y fue
 *    estable en orden estándar/invertido. Se conserva tal cual como base.
 * ------------------------------------------------------------------- */
export const CRITERIA_P3_CHOICE = {
    matches:
        "Every part of the instruction is confirmed by the output: target, content and completeness. Nothing relies on assumption.",
    mismatch:
        "At least one part of the instruction is contradicted by the output or by the arguments.",
    unknown:
        "Nothing is contradicted, but at least one part of the instruction is not confirmed by the output.",
};

/** Único cambio: 'matches' incluye explícitamente los detalles concretos. */
export const CRITERIA_P3_CHOICE_DETAIL = {
    ...CRITERIA_P3_CHOICE,
    matches:
        "Every part of the instruction is confirmed by the output: target, content, completeness and every specific detail it gives (names, versions, quantities, language). Nothing relies on assumption.",
};

/* ---------------------------------------------------------------------
 * 4) REGLAS DE DECISIÓN (se evalúan offline sobre las probabilidades crudas)
 *    Reemplazan la regla "todas >= 0.5". Umbrales elegidos en la meseta
 *    estable observada en v1 y v2 (ver analyze_scores.py).
 * ------------------------------------------------------------------- */
export interface Rule {
    /** pregunta -> umbral mínimo (aprobar si prob >= umbral) */
    positive?: Record<string, number>;
    /** pregunta negativa -> umbral máximo (aprobar si prob <= umbral) */
    negative?: Record<string, number>;
    /** run choice: aprobar si P(matches) >= umbral */
    choiceMatches?: number;
}

export const RULE_P3_A: Rule = { positive: { cumple: 0.75 } };
export const RULE_P3_B: Rule = { positive: { cumple: 0.75 }, negative: { any_missing_evidence: 0.4 } };
export const RULE_P3_C: Rule = {
    positive: { cumple: 0.75 },
    negative: { any_missing_evidence: 0.4, any_mismatch: 0.4 },
};
export const RULE_P3_CHOICE: Rule = { choiceMatches: 0.7 };

export function decide(
    out: { noul?: Record<string, number>; choice?: string; prob?: number },
    rule: Rule,
): boolean {
    if (rule.choiceMatches !== undefined) {
        const p = out.choice === "matches" ? (out.prob ?? 0) : 1 - (out.prob ?? 1);
        if (p < rule.choiceMatches) return false;
    }
    for (const [q, t] of Object.entries(rule.positive ?? {})) {
        if ((out.noul?.[q] ?? 0) < t) return false;
    }
    for (const [q, t] of Object.entries(rule.negative ?? {})) {
        if ((out.noul?.[q] ?? 1) > t) return false;
    }
    return true;
}

/* =====================================================================
 * MATRIZ DE CORRIDAS (correr cada una sobre v1 (54) Y v2 (44) = 98 casos)
 *
 *  M0  control                 buildStateP3         + QUESTIONS_P3_CONTROL
 *  M1  criterio de éxito       buildStateP3Criteria + QUESTIONS_P3_CONTROL
 *  M2  redacción con detalles  buildStateP3         + QUESTIONS_P3_DETAIL
 *  M3  holística + evidencia   buildStateP3         + QUESTIONS_P3_B      (RULE_P3_B)
 *  M4  M3 + mismatch           buildStateP3         + QUESTIONS_P3_C      (RULE_P3_C)
 *  M5  choice base (std+rev)   buildStateP3         + CRITERIA_P3_CHOICE
 *  M6  choice detalle (std+rev)buildStateP3         + CRITERIA_P3_CHOICE_DETAIL
 *
 * Qué comparar (cada par cambia UNA cosa):
 *   M0 vs M1  -> ¿etiquetar expected_outcome como criterio ayuda?
 *   M0 vs M2  -> ¿enumerar detalles ayuda o descalibra?
 *   M0 vs M3  -> ¿el veto de evidencia atrapa los 'unknown' sin costar FN?
 *   M3 vs M4  -> ¿any_mismatch aporta algo sobre cumple?
 *   M5 vs M6  -> ídem para choice
 *   M0/M3 vs M5 -> ¿una llamada choice reemplaza a 2 preguntas noul (más barata)?
 *
 * Protocolo anti-sobreajuste:
 *   - Guardar SIEMPRE probabilidades crudas (ya se hace) y decidir umbrales offline.
 *   - Elegir umbral en un dataset y reportar en el otro (analyze_scores.py lo hace).
 *   - Reportar por categoría, no solo exactitud global (1 caso = ~1 punto).
 *   - Excluir de la métrica de prompt n2-h03-bad (la cubre el código) y revisar
 *     la etiqueta de n2-h19-bad antes de comparar.
 * ===================================================================== */

export async function runEvaluation({
    runNoul,
    runChoice,
}: {
    runNoul: (name: string, stateFn: (c: TestCase) => string, questions: Record<string, any>, preamble?: string) => Promise<void>;
    runChoice: (name: string, stateFn: (c: TestCase) => string, questionName: string, instructions: string, criteria: Record<string, string>, acceptedChoices: string[], modes?: ("standard" | "reverse")[]) => Promise<void>;
    cases: TestCase[];
}) {
    // M0: control — cumple sin cambios (umbral 0.5, señal base)
    await runNoul("M0_control", buildStateP3, QUESTIONS_P3_CONTROL);

    // M1: expected_outcome presentado como criterio de éxito
    await runNoul("M1_criteria_label", buildStateP3Criteria, QUESTIONS_P3_CONTROL);

    // M2: cumple con enumeración de detalles (sin "exactly")
    await runNoul("M2_detail_q", buildStateP3, QUESTIONS_P3_DETAIL);

    // M3: holística + veto de evidencia faltante (candidata principal)
    await runNoul("M3_cumple_evidence", buildStateP3, QUESTIONS_P3_B);

    // M4: M3 + any_mismatch
    await runNoul("M4_cumple_evidence_mismatch", buildStateP3, QUESTIONS_P3_C);

    // M5: choice base (CRITERIA_V1_3_C de r8, la mejor choice hasta ahora)
    await runChoice(
        "M5_choice_base",
        buildStateP3,
        "effect",
        "Compare the step instruction with the arguments used and the tool output. What best describes the effect of the tool call?",
        CRITERIA_P3_CHOICE,
        ["matches"],
        ["standard", "reverse"]
    );

    // M6: choice con 'matches' que enumera detalles concretos
    await runChoice(
        "M6_choice_detail",
        buildStateP3,
        "effect",
        "Compare the step instruction with the arguments used and the tool output. What best describes the effect of the tool call?",
        CRITERIA_P3_CHOICE_DETAIL,
        ["matches"],
        ["standard", "reverse"]
    );
}