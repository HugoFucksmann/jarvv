/**
 * scripts/eval-next/core/clients/mock.ts
 *
 * Cliente determinista de modelo para tests unitarios y corridas offline.
 * Permite inyectar respuestas fijas o generar respuestas canónicas según la etapa.
 */

import type { ModelRequest, ModelResponse } from "../types.ts";
import type { ModelClient } from "./types.ts";

export type MockResponder = (request: ModelRequest) => ModelResponse | Promise<ModelResponse>;

export class MockModelClient implements ModelClient {
  readonly name = "MockModelClient";
  private customResponder?: MockResponder;

  constructor(responder?: MockResponder) {
    this.customResponder = responder;
  }

  setResponder(responder: MockResponder): void {
    this.customResponder = responder;
  }

  async call(request: ModelRequest): Promise<ModelResponse> {
    if (this.customResponder) {
      return this.customResponder(request);
    }

    // Respuestas sintéticas por defecto
    if (request.type === "generative") {
      const user = request.user || "";

      // Plan
      if (user.includes("MAX_STEPS") || user.includes("CATALOG")) {
        if (user.includes("step_failure")) {
          return {
            rawOutput: `<think>El paso anterior con nmap falló. Uso netstat como alternativa.</think>\n{"steps":[{"goal":"Verificar servicios activos con netstat","suggested_mcp":"terminal","expected_outcome":"Puertos listados con herramienta alternativa"}]}`,
            durationMs: 40,
            finishReason: "stop",
            tokens: { prompt: 160, completion: 35, total: 195 },
          };
        }
        if (user.includes("FEEDBACK") || user.includes("user_feedback")) {
          return {
            rawOutput: `<think>El usuario pidió cambiar a formato json.</think>\n{"steps":[{"goal":"Consultar base de datos y formatear salida en json","suggested_mcp":"terminal","expected_outcome":"Archivo json generado exitosamente"}]}`,
            durationMs: 40,
            finishReason: "stop",
            tokens: { prompt: 160, completion: 35, total: 195 },
          };
        }
        return {
          rawOutput: `<think>Razonamiento de prueba...</think>\n{"steps":[{"goal":"Buscar archivo","suggested_mcp":"locate","expected_outcome":"Archivo encontrado"},{"goal":"Leer archivo","suggested_mcp":"files","expected_outcome":"Contenido leído"}]}`,
          durationMs: 45,
          finishReason: "stop",
          tokens: { prompt: 150, completion: 40, total: 190 },
        };
      }

      // Arguments
      if (user.includes("TOOL:") || user.includes("SCHEMA:")) {
        return {
          rawOutput: `{"path":"C:\\\\Users\\\\eval\\\\Documents\\\\test.txt"}`,
          durationMs: 30,
          finishReason: "stop",
          tokens: { prompt: 100, completion: 15, total: 115 },
        };
      }

      // Question
      if (request.system.includes("ask_user") || request.system.includes("question for the user")) {
        return {
          rawOutput: "¿Deseas sobrescribir el archivo existente?",
          durationMs: 25,
          finishReason: "stop",
          tokens: { prompt: 80, completion: 10, total: 90 },
        };
      }

      // Final response
      return {
        rawOutput: "La tarea finalizó correctamente. El puerto encontrado es 5432 y el usuario es admin.",
        durationMs: 35,
        finishReason: "stop",
        tokens: { prompt: 120, completion: 20, total: 140 },
      };
    }

    if (request.type === "decision") {
      // Retorna respuesta estructurada de decisión
      const questions = request.questions as Record<string, { type: string }>;
      const answers: Record<string, unknown> = {};

      for (const [key, q] of Object.entries(questions)) {
        if (q.type === "choice") {
          if (key === "route") {
            answers[key] = { choice: "files", probabilities: { files: 0.95, locate: 0.05 } };
          } else if (key === "selected_tool") {
            answers[key] = { choice: "read_file", probabilities: { read_file: 0.92, write_file: 0.08 } };
          } else if (key === "review") {
            answers[key] = { choice: "approved", probabilities: { approved: 0.94, args_invalid: 0.06 } };
          }
        } else if (q.type === "noul") {
          answers[key] = { noul: 0.96, answer: "yes" };
        }
      }

      return {
        rawOutput: JSON.stringify({ answers }),
        durationMs: 20,
        finishReason: "stop",
        metadata: { answers },
      };
    }

    return {
      rawOutput: "mock-response",
      durationMs: 10,
      finishReason: "stop",
    };
  }
}

