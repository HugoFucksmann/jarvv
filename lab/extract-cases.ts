/**
 * JARVIS Lab — Extracción de Borradores de Casos desde Registro de Trazas (JSONL)
 *
 * MODO SOLO LECTURA sobre el archivo de trazas (por defecto jarvis-traces.jsonl).
 * Únicamente escribe archivos nuevos en lab/cases/<etapa>/_drafts/.
 *
 * No importa de src/. No tiene efectos colaterales ni simula respuestas.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type {
  CaseInputArguments,
  CaseInputDecisionOne,
  CaseReference,
  LabCase,
} from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LabConfig {
  tracesFilePath?: string;
}

export interface ExtractOptions {
  filePath?: string;
  taskId?: string;
}

interface TraceCall {
  seq: number;
  step?: number | string;
  stage: string;
  rawInput: unknown;
  rawOutput?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  retried?: boolean;
  error?: string | null;
}

interface TraceToolRun {
  step?: number | string;
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  error?: string | null;
}

interface TraceTaskLine {
  v: number;
  taskId: string;
  startedAt?: string | number;
  endedAt?: string | number;
  mode?: "fast" | "plan";
  userMessage?: string;
  status?: string;
  finalResponse?: string;
  plan?: unknown;
  calls?: TraceCall[];
  toolRuns?: TraceToolRun[];
  example?: boolean;
}

function loadConfig(): LabConfig {
  const configPath = path.resolve(__dirname, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      // Usar defaults
    }
  }
  return {};
}

/**
 * Extrae el primer objeto JSON balanceado a partir de una posición dada,
 * respetando llaves dentro de cadenas de texto y secuencias de escape.
 * Implementación propia de lab/ sin importar de src/.
 */
function extractBalancedJsonObject(
  text: string,
  startIndex: number
): { json: Record<string, unknown>; raw: string } | null {
  const start = text.indexOf("{", startIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let matchEnd = -1;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        matchEnd = i;
        break;
      }
    }
  }

  if (matchEnd >= 0) {
    const candidate = text.slice(start, matchEnd + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return { json: parsed as Record<string, unknown>, raw: candidate };
      }
    } catch {
      return null;
    }
  }
  return null;
}

function extractSchemaFromUserPrompt(userPrompt: string): {
  schema: Record<string, unknown>;
  success: boolean;
} {
  const schemaMatch = /SCHEMA:\s*/i.exec(userPrompt);
  if (schemaMatch) {
    const extracted = extractBalancedJsonObject(userPrompt, schemaMatch.index + schemaMatch[0].length);
    if (extracted) {
      return { schema: extracted.json, success: true };
    }
  }
  return { schema: {}, success: false };
}

function extractToolNameFromUserPrompt(userPrompt: string): string | undefined {
  const match = /TOOL:\s*([a-zA-Z0-9_-]+)/i.exec(userPrompt);
  return match ? match[1] : undefined;
}

export async function extractCases(options?: ExtractOptions): Promise<{
  decisionOneCount: number;
  argumentsCount: number;
  skippedExistingCount: number;
}> {
  const config = loadConfig();
  const rawPath = options?.filePath || config.tracesFilePath || "./jarvis-traces.jsonl";
  const tracesPath = path.resolve(process.cwd(), rawPath);

  console.log(`[extract-cases] Leyendo registro de trazas desde: ${tracesPath}`);

  if (!fs.existsSync(tracesPath)) {
    console.warn(
      `\n[extract-cases] El archivo de trazas '${tracesPath}' no existe actualmente.\n` +
      `Para generar trazas, asegúrese de que el registro de tareas esté activo en JARVIS y ejecute tareas reales en el sistema.\n` +
      `No se simularán datos ni respuestas.\n`
    );
    return { decisionOneCount: 0, argumentsCount: 0, skippedExistingCount: 0 };
  }

  const d1Dir = path.resolve(__dirname, "cases", "decision_one", "_drafts");
  const argsDir = path.resolve(__dirname, "cases", "arguments", "_drafts");
  fs.mkdirSync(d1Dir, { recursive: true });
  fs.mkdirSync(argsDir, { recursive: true });

  const fileStream = fs.createReadStream(tracesPath, { encoding: "utf-8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineIndex = 0;
  let invalidLinesCount = 0;
  let processedTasksCount = 0;
  let d1Count = 0;
  let argsCount = 0;
  let skippedExistingCount = 0;

  for await (const line of rl) {
    lineIndex++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let task: TraceTaskLine;
    try {
      task = JSON.parse(trimmed);
    } catch {
      invalidLinesCount++;
      console.warn(`[extract-cases] Línea ${lineIndex}: JSON inválido, omitiendo.`);
      continue;
    }

    if (!task || typeof task !== "object") {
      invalidLinesCount++;
      console.warn(`[extract-cases] Línea ${lineIndex}: no contiene un objeto válido.`);
      continue;
    }

    if (typeof task.v !== "number" || task.v !== 1) {
      invalidLinesCount++;
      console.warn(
        `[extract-cases] Línea ${lineIndex}: versión de contrato de trazas no soportada (esperada v=1, recibida: ${task.v}). Omitiendo.`
      );
      continue;
    }

    if (!task.taskId || typeof task.taskId !== "string") {
      invalidLinesCount++;
      console.warn(`[extract-cases] Línea ${lineIndex}: falta o es inválido el campo 'taskId'. Omitiendo.`);
      continue;
    }

    if (options?.taskId && task.taskId !== options.taskId) {
      continue;
    }

    processedTasksCount++;

    const calls = Array.isArray(task.calls) ? task.calls : [];
    for (const call of calls) {
      if (!call || typeof call !== "object") continue;
      const stage = String(call.stage || "").toUpperCase();

      // 1. Etapa DECISION_ONE (Eos)
      if (stage === "DECISION_ONE") {
        if (!call.rawInput) continue;
        let parsedInput: any;
        try {
          parsedInput = typeof call.rawInput === "string" ? JSON.parse(call.rawInput) : call.rawInput;
        } catch {
          console.warn(`[extract-cases] Tarea '${task.taskId}' (seq ${call.seq}): no se pudo parsear rawInput.`);
          continue;
        }

        if (parsedInput && parsedInput.state && parsedInput.questions) {
          const draftId = `draft_d1_${task.taskId}_seq${call.seq}`;
          const filePath = path.join(d1Dir, `${draftId}.json`);

          if (fs.existsSync(filePath)) {
            skippedExistingCount++;
            continue;
          }

          const reference: CaseReference = {
            originalOutput: typeof call.rawOutput === "string" ? call.rawOutput : JSON.stringify(call.rawOutput),
            retried: Boolean(call.retried),
            error: call.error ?? null,
          };

          const draftCase: LabCase<CaseInputDecisionOne> = {
            id: draftId,
            stage: "decision_one",
            split: "dev",
            input: {
              state: String(parsedInput.state),
              questions: parsedInput.questions,
            },
            expect: null, // El usuario lo completa a mano
            source: {
              taskId: task.taskId,
              seq: call.seq,
            },
            reference,
            notes: `Borrador extraído de la tarea '${task.taskId}' (seq ${call.seq}, modo: ${task.mode || "desconocido"}).`,
          };

          fs.writeFileSync(filePath, JSON.stringify(draftCase, null, 2), "utf-8");
          d1Count++;
        }
      }

      // 2. Etapa ARGUMENT_GENERATION (Qwen)
      if (stage === "ARGUMENT_GENERATION") {
        if (!call.rawInput) continue;
        let parsedInput: any;
        try {
          parsedInput = typeof call.rawInput === "string" ? JSON.parse(call.rawInput) : call.rawInput;
        } catch {
          console.warn(`[extract-cases] Tarea '${task.taskId}' (seq ${call.seq}): no se pudo parsear rawInput.`);
          continue;
        }

        const messages = Array.isArray(parsedInput?.messages) ? parsedInput.messages : [];
        const userMsg = messages.find((m: any) => m.role === "user")?.content || "";
        const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";

        if (userMsg) {
          const schemaResult = extractSchemaFromUserPrompt(userMsg);
          const toolName = extractToolNameFromUserPrompt(userMsg);
          const draftId = `draft_args_${task.taskId}_seq${call.seq}`;
          const filePath = path.join(argsDir, `${draftId}.json`);

          if (fs.existsSync(filePath)) {
            skippedExistingCount++;
            continue;
          }

          // Encontrar toolRun coincidente del mismo paso si existe
          const matchingTool = Array.isArray(task.toolRuns)
            ? task.toolRuns.find((tr) => String(tr.step) === String(call.step))
            : undefined;

          const reference: CaseReference = {
            originalOutput: typeof call.rawOutput === "string" ? call.rawOutput : JSON.stringify(call.rawOutput),
            retried: Boolean(call.retried),
            error: call.error ?? null,
            toolRun: matchingTool
              ? {
                  tool: matchingTool.tool,
                  ok: matchingTool.ok,
                  error: matchingTool.error ?? null,
                }
              : undefined,
          };

          let notes = `Borrador extraído de la tarea '${task.taskId}' (seq ${call.seq}, herramienta: '${toolName || "desconocida"}', modo: ${task.mode || "desconocido"}).`;
          if (!schemaResult.success || Object.keys(schemaResult.schema).length === 0) {
            console.warn(
              `[extract-cases] [ADVERTENCIA] No se pudo extraer SCHEMA para el borrador '${draftId}'. Requiere revisión manual.`
            );
            notes += ` [ADVERTENCIA: SCHEMA no se pudo extraer automáticamente del prompt; requiere revisión manual].`;
          }

          const draftCase: LabCase<CaseInputArguments> = {
            id: draftId,
            stage: "arguments",
            split: "dev",
            input: {
              toolName,
              user: userMsg,
              system: systemMsg || undefined,
              schema: schemaResult.schema,
            },
            expect: null, // El usuario lo completa a mano
            source: {
              taskId: task.taskId,
              seq: call.seq,
            },
            reference,
            notes,
          };

          fs.writeFileSync(filePath, JSON.stringify(draftCase, null, 2), "utf-8");
          argsCount++;
        }
      }
    }
  }

  console.log(`\n============================================================`);
  console.log(`[extract-cases] Resumen de Extracción:`);
  console.log(` - Líneas leídas:             ${lineIndex}`);
  console.log(` - Líneas inválidas/omitidas: ${invalidLinesCount}`);
  console.log(` - Tareas procesadas:         ${processedTasksCount}`);
  console.log(` - Borradores para decision_one creados: ${d1Count} en ${d1Dir}`);
  console.log(` - Borradores para arguments creados:    ${argsCount} en ${argsDir}`);
  if (skippedExistingCount > 0) {
    console.log(` - Borradores preexistentes omitidos:   ${skippedExistingCount}`);
  }
  console.log(`============================================================\n`);

  return { decisionOneCount: d1Count, argumentsCount: argsCount, skippedExistingCount };
}

// Ejecución directa desde CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const options: ExtractOptions = {};

  const fileIdx = args.indexOf("--file");
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    options.filePath = args[fileIdx + 1];
  }

  const taskIdx = args.indexOf("--task");
  if (taskIdx >= 0 && args[taskIdx + 1]) {
    options.taskId = args[taskIdx + 1];
  }

  extractCases(options).catch((err) => {
    console.error(`[FATAL] Error en la extracción de casos: ${err.message}`);
    process.exit(1);
  });
}
