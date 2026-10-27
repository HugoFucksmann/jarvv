import type { TestCase } from "../core/types.ts";

/* scripts/eval/prompts/v4.ts — solo definiciones de prompts + runEvaluation.
 * Variantes (cada una cambia UNA cosa respecto al control N0):
 *  N0 control (= M6) x2 -> mide ruido de repetición
 *  N1 cuatro opciones sin solapamiento
 *  N2 noul con `criteria` true/false
 *  N3 leer la salida (choice) + juzgar (noul); se combinan offline
 *  N4 tipo `score` (se ejecuta solo si el runner provee runScore; si no, se omite con un aviso)
 *  N5 estado en JSON */

/** Poner el texto EXACTO que usó v3 en M5/M6 si se quiere comparar contra M6. */
const CHOICE_INSTRUCTIONS = "Does the effect of the tool match the step instruction?";
const CHOICE_NAME = "outcome";

function clip(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Cabeza + cola: en logs largos el veredicto suele estar al final. */
function clipHT(s: string, n: number, headRatio = 0.4): string {
    if (s.length <= n) return s;
    const marker = "\n[…truncated…]\n";
    const budget = n - marker.length;
    const head = Math.floor(budget * headRatio);
    return s.slice(0, head) + marker + s.slice(s.length - (budget - head));
}

function formatArguments(args: Record<string, unknown>): string {
    return Object.entries(args)
        .map(([k, v]) => `${k}=${clip(typeof v === "string" ? v : JSON.stringify(v), 200)}`)
        .join(", ");
}

export function buildStateBase(c: TestCase): string {
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

/** N5: mismo contenido como JSON. */
export function buildStateJson(c: TestCase): string {
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.args)) args[k] = typeof v === "string" ? clip(v, 200) : v;
    return JSON.stringify(
        {
            step_instruction: clip(c.instruction, 1000),
            ...(c.expected_outcome ? { expected_outcome: clip(c.expected_outcome, 1000) } : {}),
            tool: c.tool,
            arguments: args,
            result: clipHT(c.result, 2500),
            observation: clipHT(c.observation, 2500),
        },
        null,
        2,
    );
}

/** N0: control (= M6). */
const CRITERIA_CONTROL: Record<string, string> = {
    matches:
        "Every part of the instruction is confirmed by the output: target, content, completeness and every specific detail it gives (names, versions, quantities, language). Nothing relies on assumption.",
    mismatch: "At least one part of the instruction is contradicted by the output or by the arguments.",
    unknown:
        "Nothing is contradicted, but at least one part of the instruction is not confirmed by the output.",
};

/** N1: cuatro opciones sin solapamiento. */
const CRITERIA_FOUR: Record<string, string> = {
    matches:
        "The output confirms that the action was carried out on the target and with the content or amount the instruction names, including every specific detail it gives (names, versions, quantities, language). Nothing relies on assumption.",
    mismatch:
        "The action ran without an error, but the target, content, amount or language differs from what the instruction names, or only part of the instruction was done.",
    failed: "The output shows an error, an empty result, zero matches, or that nothing changed.",
    unconfirmed:
        "No error and no difference is visible, but the output does not say what happened (for example only a generic status such as 'started', 'sent' or 'ok'), so the effect cannot be confirmed.",
};

/** N3 parte 1: leer la salida sin compararla con la instrucción. */
const CRITERIA_READ: Record<string, string> = {
    effect_confirmed: "The output states that the action was carried out and says what it acted on.",
    error: "The output reports an error or a refusal.",
    nothing_changed:
        "The output reports zero matches, zero changes, an empty result, or that the target was not found.",
    unconfirmed:
        "The output only gives a generic status (for example 'started', 'sent', 'ok') without saying what was done.",
};

/** N3 parte 2 (= M0): pregunta holística. */
const QUESTIONS_CUMPLE = {
    cumple: { type: "noul", instructions: "Does the result accomplish the step instruction?" },
};

/** N2: igual, con `criteria` true/false. */
const QUESTIONS_CRITERIA = {
    cumple: {
        ...QUESTIONS_CUMPLE.cumple,
        criteria: {
            true:
                "Every part of the instruction is confirmed by the output: target, content and completeness. Nothing relies on assumption.",
            false:
                "At least one part of the instruction is contradicted by the output or the arguments, or is not confirmed by the output.",
        },
    },
};

/** N4: niveles ordenados de menor a mayor. */
const SCORE_LEVELS = [
    "Not done, or contradicted",
    "Partly done, or only assumed",
    "Done, but a detail is not confirmed",
    "Done and fully confirmed",
];

export async function runEvaluation({
    runNoul,
    runChoice,
    runScore,
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
    cases: TestCase[];
}) {
    const STD: ("standard" | "reverse")[] = ["standard"]; // reverse no aportó en M5/M6

    await runChoice("N0_control_a", buildStateBase, CHOICE_NAME, CHOICE_INSTRUCTIONS, CRITERIA_CONTROL, ["matches"], STD);
    await runChoice("N0_control_b", buildStateBase, CHOICE_NAME, CHOICE_INSTRUCTIONS, CRITERIA_CONTROL, ["matches"], STD);
    await runChoice("N1_four_way", buildStateBase, CHOICE_NAME, CHOICE_INSTRUCTIONS, CRITERIA_FOUR, ["matches"], STD);
    await runNoul("N2_noul_criteria", buildStateBase, QUESTIONS_CRITERIA);
    await runChoice("N3_read_status", buildStateBase, "result_status", "What does the output of the tool report?", CRITERIA_READ, ["effect_confirmed"], STD);
    await runNoul("N3_cumple", buildStateBase, QUESTIONS_CUMPLE);
    if (runScore) {
        try {
            await runScore("N4_score", buildStateBase, "grado", "How completely does the output show that the step instruction was accomplished?", SCORE_LEVELS);
        } catch (e) {
            console.warn("N4_score falló; se continúa con las demás variantes:", e);
        }
    } else {
        console.warn("N4_score omitida: el runner no provee runScore.");
    }

    await runChoice("N5_json_state", buildStateJson, CHOICE_NAME, CHOICE_INSTRUCTIONS, CRITERIA_CONTROL, ["matches"], STD);
}