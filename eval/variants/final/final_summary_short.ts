import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 2. SYSTEM mínimo: tres frases. Mide cuánto del rendimiento de final_summary sale de la brevedad del prompt. */
const SYSTEM = `You are JARVIS. Answer the user in the language of REQUEST, using only DATA and EFFECTS: give the values asked for, say what was changed (or that nothing was), and if the task failed, say why and what is missing.
${DATA_NOTICE_EN}`;

const final_summary_short: Variant = { name: "final_summary_short", prompts: { PROMPTS: { FINAL_VIEW: { ...PROMPTS.FINAL_VIEW, SYSTEM } } } };
export default final_summary_short;
