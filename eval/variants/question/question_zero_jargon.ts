import { DATA_NOTICE_EN, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * question_zero_jargon: evita fugas de nombres técnicos (cmdlets, códigos HTTP/ENOENT/EADDRINUSE,
 * parámetros JSON, nombres de herramientas o flags) traduciendo REJECTED y DATA a una única pregunta cotidiana y breve.
 */
const SYSTEM = `You are JARVIS. One piece of information from the user is missing before the task can proceed.
Write ONE short, polite question in the exact language of GOAL. Output ONLY that single question (one sentence ending in one '?').

Strict rules:
- Use everyday language only. NEVER mention tool names, commands, cmdlets, flags, JSON fields, internal IDs, PIDs, HTTP codes, or OS error codes (no ENOENT, EADDRINUSE, EEXIST, 404, stdin, etc.).
- Check USER so you never ask for information the user already gave.
- If REJECTED explains a missing parameter or conflict (duplicate file, full disk, password needed, sheet not found), ask for the missing choice/value in plain words.
- If DATA lists specific candidates/options (files, folders, printers, Excel sheets, branches), briefly present the candidate options inside your single question so the user can choose.
${DATA_NOTICE_EN}`;

const question_zero_jargon: Variant = {
  name: "question_zero_jargon",
  prompts: {
    PROMPTS: {
      QUESTION: {
        ...PROMPTS.QUESTION,
        SYSTEM,
      },
    },
  },
};

export default question_zero_jargon;
