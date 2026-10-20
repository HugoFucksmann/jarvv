/**
 * JARVIS Lab — Extracción de Borradores de Casos desde jarvis-tasks.json
 *
 * MODO SOLO LECTURA sobre jarvis-tasks.json.
 * Únicamente escribe archivos nuevos en lab/cases/<etapa>/_drafts/.
 *
 * No importa de src/.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseInputArguments, CaseInputDecisionOne, LabCase } from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LabConfig {
  tasksFilePath?: string;
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

export function extractCases(): { decisionOneCount: number; argumentsCount: number } {
  const config = loadConfig();
  const tasksPath = path.resolve(process.cwd(), config.tasksFilePath || "./jarvis-tasks.json");

  console.log(`[extract-cases] Leyendo tareas desde: ${tasksPath}`);

  if (!fs.existsSync(tasksPath)) {
    console.warn(
      `[extract-cases] El archivo '${tasksPath}' no existe actualmente. No hay tareas históricas para extraer borradores.`
    );
    return { decisionOneCount: 0, argumentsCount: 0 };
  }

  let tasks: unknown[];
  try {
    const raw = fs.readFileSync(tasksPath, "utf-8");
    tasks = JSON.parse(raw);
    if (!Array.isArray(tasks)) {
      console.warn(`[extract-cases] '${tasksPath}' no contiene un arreglo de tareas.`);
      return { decisionOneCount: 0, argumentsCount: 0 };
    }
  } catch (err) {
    console.error(`[extract-cases] Error al leer '${tasksPath}':`, err);
    return { decisionOneCount: 0, argumentsCount: 0 };
  }

  const d1Dir = path.resolve(__dirname, "cases", "decision_one", "_drafts");
  const argsDir = path.resolve(__dirname, "cases", "arguments", "_drafts");
  fs.mkdirSync(d1Dir, { recursive: true });
  fs.mkdirSync(argsDir, { recursive: true });

  let d1Count = 0;
  let argsCount = 0;

  for (const task of tasks as any[]) {
    if (!task || typeof task !== "object") continue;
    const taskId = task.id || "unknown_task";

    // 1. Recorrer modelIterations si existen
    const iterations = Array.isArray(task.modelIterations) ? task.modelIterations : [];
    for (const iter of iterations) {
      if (!iter || typeof iter !== "object") continue;
      const stage = String(iter.stage || "").toUpperCase();

      // Etapa Decision #1
      if (stage === "DECISION_ONE") {
        if (!iter.rawInput) continue;
        let parsedInput: any;
        try {
          parsedInput = typeof iter.rawInput === "string" ? JSON.parse(iter.rawInput) : iter.rawInput;
        } catch {
          continue;
        }

        if (parsedInput && parsedInput.state && parsedInput.questions) {
          const draftId = `draft_d1_${taskId}_${iter.id || iter.stepId || d1Count + 1}`;
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
              taskId,
              iterationId: iter.id,
              originalOutput: iter.rawOutput,
            },
            notes: `Borrador extraído de la tarea ${taskId} (iteración ${iter.id}).`,
          };

          const filePath = path.join(d1Dir, `${draftId}.json`);
          fs.writeFileSync(filePath, JSON.stringify(draftCase, null, 2), "utf-8");
          d1Count++;
        }
      }

      // Etapa Arguments (Qwen)
      if (stage === "ARGUMENT_GENERATION") {
        if (!iter.rawInput) continue;
        let parsedInput: any;
        try {
          parsedInput = typeof iter.rawInput === "string" ? JSON.parse(iter.rawInput) : iter.rawInput;
        } catch {
          continue;
        }

        const messages = Array.isArray(parsedInput?.messages) ? parsedInput.messages : [];
        const userMsg = messages.find((m: any) => m.role === "user")?.content || "";
        const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";

        if (userMsg) {
          const { schema, success: schemaSuccess } = extractSchemaFromUserPrompt(userMsg);
          const toolName = extractToolNameFromUserPrompt(userMsg);
          const draftId = `draft_args_${taskId}_${iter.id || iter.stepId || argsCount + 1}`;

          let notes = `Borrador extraído de la tarea ${taskId} para herramienta '${toolName || "desconocida"}'.`;
          if (!schemaSuccess || Object.keys(schema).length === 0) {
            const warnMsg = `[ADVERTENCIA] No se pudo extraer SCHEMA para el borrador '${draftId}'. Se guardó schema vacío: verificar manualmente.`;
            console.warn(`[extract-cases] ${warnMsg}`);
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
              schema,
            },
            expect: null, // El usuario lo completa a mano
            source: {
              taskId,
              iterationId: iter.id,
              originalOutput: iter.rawOutput,
            },
            notes,
          };

          const filePath = path.join(argsDir, `${draftId}.json`);
          fs.writeFileSync(filePath, JSON.stringify(draftCase, null, 2), "utf-8");
          argsCount++;
        }
      }
    }
  }

  console.log(`[extract-cases] Extracción finalizada.`);
  console.log(` - Borradores para decision_one: ${d1Count} guardados en ${d1Dir}`);
  console.log(` - Borradores para arguments:    ${argsCount} guardados en ${argsDir}`);

  return { decisionOneCount: d1Count, argumentsCount: argsCount };
}

// Ejecución directa si se invoca desde CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  extractCases();
}
