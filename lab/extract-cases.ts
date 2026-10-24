/**
 * JARVIS Lab — Extracción de Borradores de Casos desde Registro de Trazas (JSONL)
 *
 * MODO SOLO LECTURA sobre el archivo de trazas (por defecto jarvis-traces.jsonl).
 * Únicamente escribe archivos nuevos en lab/cases/<etapa>/_drafts/.
 *
 * Soporta las 8 etapas de JARVIS:
 * - Eos: decision_one, decision_two, step_verification
 * - Qwen: arguments, stage_verification, plan, replan, final_response
 *
 * No importa de src/. No tiene efectos colaterales ni simula respuestas.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type {
  CaseInputEos,
  CaseInputQwen,
  CaseReference,
  CaseReferenceToolRun,
  LabCase,
  Stage,
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
  seq?: number | string;
  id?: string;
  step?: number | string | null;
  stepId?: string;
  stepSeq?: number;
  stage: string;
  rawInput: unknown;
  rawOutput?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string | null;
}

interface TraceToolRun {
  callSeq?: number | string;
  step?: number | string | null;
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  error?: string | null;
  resultPreview?: string;
}

interface TraceTaskLine {
  v: number;
  taskId: string;
  startedAt?: string | number;
  endedAt?: string | number;
  mode?: string;
  userMessage?: string;
  status?: string;
  finalResponse?: string;
  plan?: unknown;
  calls?: TraceCall[];
  toolRuns?: TraceToolRun[];
  example?: boolean;
}

export interface ExtractSummary {
  countsByStage: Record<Stage, number>;
  skippedExistingCount: number;
  reconstructedRetryCount: number;
  omittedUnseparableRetryCount: number;
  // Campos de compatibilidad histórica
  decisionOneCount: number;
  argumentsCount: number;
}

const ALL_STAGES: readonly Stage[] = [
  "decision_one",
  "decision_two",
  "step_verification",
  "arguments",
  "stage_verification",
  "plan",
  "replan",
  "final_response",
] as const;

const STAGE_PREFIXES: Record<Stage, string> = {
  decision_one: "d1",
  decision_two: "d2",
  step_verification: "stepver",
  arguments: "args",
  stage_verification: "stagever",
  plan: "plan",
  replan: "replan",
  final_response: "final",
};

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

/**
 * Detecta y separa el bloque retryNote ("ERROR_PREVIO:...") del user prompt de Qwen.
 * Retorna el user prompt limpio sin la nota y un booleano indicando si era separable.
 */
function processRetryNote(userMsg: string): {
  cleanUserMsg: string;
  hasRetryNote: boolean;
  isSeparable: boolean;
} {
  const marker = "ERROR_PREVIO:";
  const idx = userMsg.indexOf(marker);
  if (idx < 0) {
    return { cleanUserMsg: userMsg, hasRetryNote: false, isSeparable: true };
  }

  // retryNote se concatena en prompts.ts como:
  // \n\nERROR_PREVIO: tu respuesta anterior fue inválida (...)
  let cutIdx = idx;
  if (idx >= 2 && userMsg.slice(idx - 2, idx) === "\n\n") {
    cutIdx = idx - 2;
  } else if (idx >= 1 && userMsg.slice(idx - 1, idx) === "\n") {
    cutIdx = idx - 1;
  }

  const clean = userMsg.slice(0, cutIdx).trimEnd();
  if (clean.length > 0) {
    return { cleanUserMsg: clean, hasRetryNote: true, isSeparable: true };
  }

  return { cleanUserMsg: userMsg, hasRetryNote: true, isSeparable: false };
}

/**
 * Busca el toolRun coincidente para una llamada dada.
 * Prioriza callSeq (agregado por instrumentación reciente) y recurre a step como fallback.
 */
function findMatchingToolRun(
  toolRuns: TraceToolRun[] | undefined,
  seq: number | string,
  step: number | string | null | undefined
): CaseReferenceToolRun | undefined {
  if (!Array.isArray(toolRuns) || toolRuns.length === 0) return undefined;

  // 1. Coincidencia directa por callSeq
  const byCallSeq = toolRuns.find(
    (tr) => tr.callSeq !== undefined && tr.callSeq !== null && String(tr.callSeq) === String(seq)
  );
  if (byCallSeq) {
    return {
      callSeq: byCallSeq.callSeq,
      step: byCallSeq.step,
      tool: byCallSeq.tool,
      ok: byCallSeq.ok,
      error: byCallSeq.error ?? null,
      resultPreview: byCallSeq.resultPreview,
    };
  }

  // 2. Coincidencia por step (cuando step no es nulo)
  if (step !== undefined && step !== null) {
    const byStep = toolRuns.find(
      (tr) => tr.step !== undefined && tr.step !== null && String(tr.step) === String(step)
    );
    if (byStep) {
      return {
        callSeq: byStep.callSeq,
        step: byStep.step,
        tool: byStep.tool,
        ok: byStep.ok,
        error: byStep.error ?? null,
        resultPreview: byStep.resultPreview,
      };
    }
  }

  return undefined;
}

export async function extractCases(options?: ExtractOptions): Promise<ExtractSummary> {
  const config = loadConfig();
  const rawPath = options?.filePath || config.tracesFilePath || "./jarvis-traces.jsonl";
  const tracesPath = path.resolve(process.cwd(), rawPath);

  console.log(`[extract-cases] Leyendo registro de trazas desde: ${tracesPath}`);

  const countsByStage: Record<Stage, number> = {
    decision_one: 0,
    decision_two: 0,
    step_verification: 0,
    arguments: 0,
    stage_verification: 0,
    plan: 0,
    replan: 0,
    final_response: 0,
  };

  if (!fs.existsSync(tracesPath)) {
    console.warn(
      `\n[extract-cases] El archivo de trazas '${tracesPath}' no existe actualmente.\n` +
      `Para generar trazas, asegúrese de que el registro de tareas esté activo en JARVIS y ejecute tareas reales en el sistema.\n` +
      `No se simularán datos ni respuestas.\n`
    );
    return {
      countsByStage,
      skippedExistingCount: 0,
      reconstructedRetryCount: 0,
      omittedUnseparableRetryCount: 0,
      decisionOneCount: 0,
      argumentsCount: 0,
    };
  }

  // Crear directorios _drafts para las 8 etapas
  const stageDirs: Record<Stage, string> = {} as Record<Stage, string>;
  for (const st of ALL_STAGES) {
    const dir = path.resolve(__dirname, "cases", st, "_drafts");
    fs.mkdirSync(dir, { recursive: true });
    stageDirs[st] = dir;
  }

  const fileStream = fs.createReadStream(tracesPath, { encoding: "utf-8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineIndex = 0;
  let invalidLinesCount = 0;
  let processedTasksCount = 0;
  let skippedExistingCount = 0;
  let reconstructedRetryCount = 0;
  let omittedUnseparableRetryCount = 0;

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

    for (const [callIndex, call] of calls.entries()) {
      if (!call || typeof call !== "object") continue;
      const rawStage = String(call.stage || "").toUpperCase();

      // Resolución tolerante de seq y step
      let seq: number | string;
      if (call.seq !== undefined && call.seq !== null) {
        seq = call.seq;
      } else if (call.id !== undefined && call.id !== null) {
        seq = String(call.id);
        console.warn(`[extract-cases] Tarea '${task.taskId}': llamada ${callIndex} no tiene 'seq'; usando id='${seq}'.`);
      } else {
        seq = callIndex + 1;
        console.warn(`[extract-cases] Tarea '${task.taskId}': llamada ${callIndex} sin 'seq' ni 'id'; usando posición ${seq}.`);
      }

      let step: number | string | null = null;
      if (call.step !== undefined && call.step !== null) {
        step = call.step;
      } else if (call.stepId !== undefined && call.stepId !== null) {
        step = call.stepId;
      } else if (call.stepSeq !== undefined && call.stepSeq !== null) {
        step = call.stepSeq;
      }

      // ------------------------------------------------------------
      // 1. Mapeo de etapa de traza a etapa de laboratorio
      // ------------------------------------------------------------
      let targetStage: Stage | null = null;

      if (rawStage === "DECISION_ONE") {
        targetStage = "decision_one";
      } else if (rawStage === "DECISION_TWO") {
        targetStage = "decision_two";
      } else if (rawStage === "STEP_VERIFICATION") {
        targetStage = "step_verification";
      } else if (rawStage === "ARGUMENT_GENERATION") {
        targetStage = "arguments";
      } else if (rawStage === "STAGE_VERIFICATION" || rawStage === "STAGE_VERIFIED") {
        targetStage = "stage_verification";
      } else if (rawStage === "REPLAN") {
        targetStage = "replan";
      } else if (rawStage === "PLAN_GENERATION") {
        targetStage = "plan";
      } else if (rawStage === "FINAL_RESPONSE") {
        targetStage = "final_response";
      } else {
        // Etapa desconocida o no evaluable
        continue;
      }

      if (!call.rawInput) continue;

      let parsedInput: any;
      try {
        parsedInput = typeof call.rawInput === "string" ? JSON.parse(call.rawInput) : call.rawInput;
      } catch {
        console.warn(`[extract-cases] Tarea '${task.taskId}' (seq ${seq}): no se pudo parsear rawInput.`);
        continue;
      }

      // ------------------------------------------------------------
      // 2. Extracción para etapas Eos (decision_one, decision_two, step_verification)
      // ------------------------------------------------------------
      if (targetStage === "decision_one" || targetStage === "decision_two" || targetStage === "step_verification") {
        // Descartar atajo sintético de DECISION_TWO (herramienta única que no invocó modelo)
        if (targetStage === "decision_two") {
          const rawOutStr = typeof call.rawOutput === "string" ? call.rawOutput : JSON.stringify(call.rawOutput || "");
          const rawInStr = typeof call.rawInput === "string" ? call.rawInput : JSON.stringify(call.rawInput || "");
          if (rawOutStr.includes("single_tool_shortcut") || rawInStr.includes('"single_tool"')) {
            continue;
          }
        }

        if (!parsedInput || typeof parsedInput !== "object" || !parsedInput.state || !parsedInput.questions) {
          continue;
        }

        const prefix = STAGE_PREFIXES[targetStage];
        const draftId = `draft_${prefix}_${task.taskId}_seq${seq}`;
        const filePath = path.join(stageDirs[targetStage], `${draftId}.json`);

        if (fs.existsSync(filePath)) {
          skippedExistingCount++;
          continue;
        }

        const matchingTool = findMatchingToolRun(task.toolRuns, seq, step);
        const reference: CaseReference = {
          originalOutput: typeof call.rawOutput === "string" ? call.rawOutput : JSON.stringify(call.rawOutput),
          error: call.error ?? null,
          toolRun: matchingTool,
        };

        const draftCase: LabCase<CaseInputEos> = {
          id: draftId,
          stage: targetStage,
          split: "dev",
          input: {
            state: String(parsedInput.state),
            questions: parsedInput.questions,
          },
          expect: null,
          source: {
            taskId: task.taskId,
            seq,
          },
          reference,
          notes: `Borrador extraído de la tarea '${task.taskId}' (seq ${seq}, etapa: ${targetStage}, modo: ${task.mode || "desconocido"}).`,
        };

        fs.writeFileSync(filePath, JSON.stringify(draftCase, null, 2), "utf-8");
        countsByStage[targetStage]++;
        continue;
      }

      // ------------------------------------------------------------
      // 3. Extracción para etapas Qwen (arguments, stage_verification, plan, replan, final_response)
      // ------------------------------------------------------------
      const messages = Array.isArray(parsedInput?.messages) ? parsedInput.messages : [];
      const rawUserMsg = messages.find((m: any) => m.role === "user")?.content || "";
      const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";

      if (!rawUserMsg) continue;

      // Detección y saneamiento de reintentos por ERROR_PREVIO
      const retryResult = processRetryNote(rawUserMsg);
      if (retryResult.hasRetryNote && !retryResult.isSeparable) {
        omittedUnseparableRetryCount++;
        console.warn(
          `[extract-cases] Tarea '${task.taskId}' (seq ${seq}, ${targetStage}): reintento no separable (user prompt vacío sin retryNote). Omitido.`
        );
        continue;
      }

      const cleanUserMsg = retryResult.cleanUserMsg;
      if (retryResult.hasRetryNote) {
        reconstructedRetryCount++;
      }

      const prefix = STAGE_PREFIXES[targetStage];
      const draftId = `draft_${prefix}_${task.taskId}_seq${seq}`;
      const filePath = path.join(stageDirs[targetStage], `${draftId}.json`);

      if (fs.existsSync(filePath)) {
        skippedExistingCount++;
        continue;
      }

      const matchingTool = findMatchingToolRun(task.toolRuns, seq, step);

      // Extraer parámetros grabados del body (para chequeo de fidelidad en Qwen)
      const recordedParams: Record<string, unknown> = {};
      if (typeof parsedInput === "object" && parsedInput !== null) {
        if (parsedInput.temperature !== undefined) recordedParams.temperature = parsedInput.temperature;
        if (parsedInput.max_tokens !== undefined) recordedParams.max_tokens = parsedInput.max_tokens;
        if (parsedInput.reasoning_effort !== undefined) recordedParams.reasoning_effort = parsedInput.reasoning_effort;
        if (parsedInput.response_format !== undefined) recordedParams.response_format = parsedInput.response_format;
      }

      const reference: CaseReference = {
        originalOutput: typeof call.rawOutput === "string" ? call.rawOutput : JSON.stringify(call.rawOutput),
        error: call.error ?? null,
        toolRun: matchingTool,
        recordedParams: Object.keys(recordedParams).length > 0 ? recordedParams : undefined,
      };

      const caseInput: CaseInputQwen = {
        user: cleanUserMsg,
        system: systemMsg || undefined,
      };

      let notes = `Borrador extraído de la tarea '${task.taskId}' (seq ${seq}, etapa: ${targetStage}, modo: ${task.mode || "desconocido"}).`;

      if (retryResult.hasRetryNote) {
        notes += ` [Reconstruido: se eliminó retryNote del user prompt; la salida en 'reference' pertenece al reintento tras el fallo previo].`;
      }

      // Caso especial de retrocompatibilidad en arguments: conservar schema y toolName
      if (targetStage === "arguments") {
        const schemaResult = extractSchemaFromUserPrompt(cleanUserMsg);
        const toolName = extractToolNameFromUserPrompt(cleanUserMsg);
        caseInput.schema = schemaResult.schema;
        caseInput.toolName = toolName;
        if (!schemaResult.success || Object.keys(schemaResult.schema).length === 0) {
          notes += ` [ADVERTENCIA: SCHEMA no se pudo extraer automáticamente del prompt; requiere revisión manual].`;
        }
      }

      const draftCase: LabCase<CaseInputQwen> = {
        id: draftId,
        stage: targetStage,
        split: "dev",
        input: caseInput,
        expect: null,
        source: {
          taskId: task.taskId,
          seq,
        },
        reference,
        notes,
      };

      fs.writeFileSync(filePath, JSON.stringify(draftCase, null, 2), "utf-8");
      countsByStage[targetStage]++;
    }
  }

  console.log(`\n============================================================`);
  console.log(`[extract-cases] Resumen de Extracción (8 etapas de JARVIS):`);
  console.log(` - Líneas leídas:                   ${lineIndex}`);
  console.log(` - Líneas inválidas/omitidas:       ${invalidLinesCount}`);
  console.log(` - Tareas procesadas:               ${processedTasksCount}`);
  console.log(` - Reintentos reconstruidos:        ${reconstructedRetryCount}`);
  if (omittedUnseparableRetryCount > 0) {
    console.log(` - Reintentos no separables omitidos: ${omittedUnseparableRetryCount}`);
  }
  if (skippedExistingCount > 0) {
    console.log(` - Borradores preexistentes omitidos: ${skippedExistingCount}`);
  }
  console.log(` --- Desglose por Etapa ---`);
  for (const st of ALL_STAGES) {
    console.log(`   * ${st.padEnd(20)}: ${countsByStage[st]} borrador(es) en ${stageDirs[st]}`);
  }
  console.log(`============================================================\n`);

  return {
    countsByStage,
    skippedExistingCount,
    reconstructedRetryCount,
    omittedUnseparableRetryCount,
    decisionOneCount: countsByStage.decision_one,
    argumentsCount: countsByStage.arguments,
  };
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