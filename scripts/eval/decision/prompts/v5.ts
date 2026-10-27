import type { TestCase } from "../core/types.ts";
import { buildStateBase } from "./v4.ts";

/* scripts/eval/prompts/v5.ts — Preguntas combinadas (Dual Check) con veto estricto AND.
 *
 * Base: mejores señales individuales de v4 (v4_analysis.txt):
 *   - N2_noul_criteria  (noul `cumple` con criteria true/false)   AUC 0.998
 *   - N1_four_way       (choice `effect` de 4 vías)               AUC 0.998
 *   - N3_read_status    (choice que lee la salida, sin comparar)  complemento
 *
 * Qué se mide:
 *   A) Preguntas AISLADAS (una llamada por pregunta): el AND se calcula offline (`decideDual`).
 *      Equivale a evaluarlas "secuencialmente" / en paralelo, cada una con su propio contexto.
 *   B) Preguntas CONJUNTAS (J*): las dos preguntas viajan en UN solo request a d3.
 *      Mide si compartir contexto cambia las probabilidades (sesgo de orden, contaminación).
 *
 * Reglas de decisión (por pareja de probabilidades p1, p2 de "aprobar"):
 *   - auto-aprobar : p1 >= APPROVE && p2 >= APPROVE
 *   - rechazar     : p1 <  REJECT  || p2 <  REJECT   (veto)
 *   - revisión     : cualquier otro caso
 *
 * NOTA: las variantes aisladas llevan nombres propios (C*_a / C*_b) para que el script de
 * análisis las combine con `decideDual`; no dependen de los nombres N* de v4.
 */

/* ---------- Umbrales y lógica de veto (usable desde el análisis offline) ---------- */

export const DUAL_BANDS = { approve: 0.9, reject: 0.6 } as const;

export type DualDecision = "auto_approve" | "review" | "reject";

export function decideDual(
    p1: number,
    p2: number,
    bands: { approve: number; reject: number } = DUAL_BANDS,
): DualDecision {
    if (p1 < bands.reject || p2 < bands.reject) return "reject";
    if (p1 >= bands.approve && p2 >= bands.approve) return "auto_approve";
    return "review";
}

/* ---------- Constantes copiadas de v4 (congeladas; no editar v4) ---------- */

const CHOICE_INSTRUCTIONS = "Does the effect of the tool match the step instruction?";
const CHOICE_NAME = "effect";

const CRITERIA_FOUR: Record<string, string> = {
    matches:
        "The output confirms that the action was carried out on the target and with the content or amount the instruction names, including every specific detail it gives (names, versions, quantities, language). Nothing relies on assumption.",
    mismatch:
        "The action ran without an error, but the target, content, amount or language differs from what the instruction names, or only part of the instruction was done.",
    failed: "The output shows an error, an empty result, zero matches, or that nothing changed.",
    unconfirmed:
        "No error and no difference is visible, but the output does not say what happened (for example only a generic status such as 'started', 'sent' or 'ok'), so the effect cannot be confirmed.",
};

const READ_INSTRUCTIONS = "What does the output of the tool report?";
const READ_NAME = "result_status";
const CRITERIA_READ: Record<string, string> = {
    effect_confirmed: "The output states that the action was carried out and says what it acted on.",
    error: "The output reports an error or a refusal.",
    nothing_changed:
        "The output reports zero matches, zero changes, an empty result, or that the target was not found.",
    unconfirmed:
        "The output only gives a generic status (for example 'started', 'sent', 'ok') without saying what was done.",
};

const NOUL_CRITERIA = {
    type: "noul",
    instructions: "Does the result accomplish the step instruction?",
    criteria: {
        true: "Every part of the instruction is confirmed by the output: target, content and completeness. Nothing relies on assumption.",
        false:
            "At least one part of the instruction is contradicted by the output or the arguments, or is not confirmed by the output.",
    },
};

/* ---------- Preguntas para requests conjuntos ----------
 * SUPUESTO: el runner acepta en `questions` entradas { type: "choice", instructions, criteria }
 * junto a las { type: "noul", ... } y las responde en la misma llamada a d3.
 * Si runNoul sólo admite noul, las variantes J* fallarán y se registran como error (try/catch). */

const Q_NOUL = { cumple: NOUL_CRITERIA };
const Q_FOUR = { [CHOICE_NAME]: { type: "choice", instructions: CHOICE_INSTRUCTIONS, criteria: CRITERIA_FOUR } };
const Q_READ = { [READ_NAME]: { type: "choice", instructions: READ_INSTRUCTIONS, criteria: CRITERIA_READ } };

/** Orden normal: choice primero, noul después. */
const JOINT_FOUR_NOUL = { ...Q_FOUR, ...Q_NOUL };
/** Orden invertido: mide sesgo de posición. */
const JOINT_NOUL_FOUR = { ...Q_NOUL, ...Q_FOUR };
const JOINT_READ_NOUL = { ...Q_READ, ...Q_NOUL };

/* ---------- Evaluación ---------- */

export async function runEvaluation({
    runNoul,
    runChoice,
    runScore,
    runMulti,
}: {
    runNoul: (
        name: string,
        stateFn: (c: TestCase) => string,
        questions: Record<string, any>,
        preamble?: string,
    ) => Promise<void>;
    runChoice: (
        name: string,
        stateFn: (c: TestCase) => string,
        questionName: string,
        instructions: string,
        criteria: Record<string, string>,
        acceptedChoices: string[],
        modes?: ("standard" | "reverse")[],
    ) => Promise<void>;
    runScore?: (
        name: string,
        stateFn: (c: TestCase) => string,
        questionName: string,
        instructions: string,
        levels: string[],
    ) => Promise<void>;
    /** NUEVO (a implementar en runner.ts): un único request con varias preguntas (choice + noul).
     *  `acceptedChoices` va POR pregunta, porque cada choice tiene su propia opción "buena":
     *  { effect: ["matches"], result_status: ["effect_confirmed"] }. Las preguntas noul se omiten del mapa.
     *  Debe guardar en RunRecord.parsed el mapa completo de respuestas (answers) de d3. */
    runMulti?: (
        name: string,
        stateFn: (c: TestCase) => string,
        questions: Record<string, any>,
        acceptedChoices: Record<string, string[]>,
    ) => Promise<void>;
    cases: TestCase[];
}) {
    const STD: ("standard" | "reverse")[] = ["standard"];
    // runScore no se usa en v5 (N4_score fue peor que las demás); se acepta por compatibilidad con el runner.
    void runScore;

    const safe = async (name: string, fn: () => Promise<void>) => {
        try {
            await fn();
        } catch (e) {
            console.warn(`${name} falló; se continúa con las demás variantes:`, e);
        }
    };

    // --- A) Preguntas aisladas; el AND (min de probabilidades == decideDual) se aplica offline ---
    // C1 = C1_four_a + C_noulCriteria ; C2 = C2_read_a + C_noulCriteria
    // `cumple` se corre UNA sola vez: con temperatura 0 la repetición da 0.000 de diferencia (v4 N0_a vs N0_b).
    await runChoice("C1_four_a", buildStateBase, CHOICE_NAME, CHOICE_INSTRUCTIONS, CRITERIA_FOUR, ["matches"], STD);
    await runChoice("C2_read_a", buildStateBase, READ_NAME, READ_INSTRUCTIONS, CRITERIA_READ, ["effect_confirmed"], STD);
    await runNoul("C_noulCriteria", buildStateBase, Q_NOUL);

    // --- B) Preguntas conjuntas: UN request con las dos preguntas ---
    if (!runMulti) {
        console.warn("Variantes J* omitidas: el runner no provee runMulti.");
        return;
    }
    await safe("J1_joint_four_noulCriteria", () =>
        runMulti("J1_joint_four_noulCriteria", buildStateBase, JOINT_FOUR_NOUL, { [CHOICE_NAME]: ["matches"] }),
    );
    await safe("J2_joint_read_noulCriteria", () =>
        runMulti("J2_joint_read_noulCriteria", buildStateBase, JOINT_READ_NOUL, { [READ_NAME]: ["effect_confirmed"] }),
    );
    // Robustez al orden (secundario): mismas preguntas que J1, claves invertidas.
    await safe("J1r_joint_noulCriteria_four", () =>
        runMulti("J1r_joint_noulCriteria_four", buildStateBase, JOINT_NOUL_FOUR, { [CHOICE_NAME]: ["matches"] }),
    );
}