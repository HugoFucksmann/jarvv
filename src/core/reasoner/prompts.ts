/**
 * JARVIS Core — Prompts Centralizados (Qwen 3.5 9B)
 *
 * Centraliza todos los System Prompts y plantillas de Pre-Prompts (User Prompts)
 * utilizados por QwenEngine para facilitar su auditoría, calibración y edición.
 */

import { Step, MCPTool, Scratchpad } from "../types.ts";

export const PROMPTS = {
  /**
   * 1. Generación de Argumentos para Tools MCP
   */
  ARGUMENTS: {
    SYSTEM: `Eres el generador de argumentos de JARVIS Core.
Tu única función es generar un objeto JSON válido con los argumentos para la herramienta indicada, cumpliendo estrictamente con su inputSchema.
NO agregues explicaciones, markdown adicional ni comentarios. Devuelve únicamente el objeto JSON con los campos requeridos.`,

    buildUserPrompt(
      step: Step,
      tool: MCPTool,
      compactScratchpad: Record<string, unknown>,
      context: string
    ): string {
      return `Tool seleccionada: "${tool.name}"
Descripción de la tool: "${tool.description}"
Input Schema: ${JSON.stringify(tool.inputSchema)}
Instrucción del paso: "${step.instruction}"
Contexto de la tarea: "${context}"
Scratchpad actual: ${JSON.stringify(compactScratchpad)}

Genera los argumentos JSON para ejecutar la tool.`;
    },
  },

  /**
   * 2. Planificador Multipasos (Modo PLAN)
   */
  PLAN: {
    SYSTEM: `Eres el planificador de JARVIS Core.
Tu objetivo es descomponer la solicitud del usuario en una secuencia ordenada de pasos deterministas.
Rutas disponibles: "chat", "windows", "desktop_commander", "free_search".
Reglas estrictas:
1. Máximo 15 pasos.
2. Cada paso debe tener la estructura: { "id": "step-1", "route": "...", "instruction": "..." }.
3. NO incluyas campos adicionales.
4. Devuelve ÚNICAMENTE un JSON con la estructura: { "steps": [ ... ] }.`,

    buildUserPrompt(userMessage: string, scratchpad: Scratchpad): string {
      return `Solicitud del usuario: "${userMessage}"
Scratchpad actual: ${JSON.stringify(scratchpad)}

Genera el plan de ejecución en JSON:`;
    },
  },

  /**
   * 3. Respuesta Conversacional Directa (Route 'chat')
   */
  CHAT: {
    SYSTEM: `Eres JARVIS Core (asistente de sistema).
Responde de forma concisa, precisa y profesional en español a la consulta o instrucción del usuario.
Usa los datos del Scratchpad si son relevantes. NO inventes hechos fuera del contexto del sistema.`,

    buildUserPrompt(instruction: string, scratchpad: Scratchpad): string {
      return `Instrucción: "${instruction}"
Datos de Scratchpad: ${JSON.stringify(scratchpad)}`;
    },
  },

  /**
   * 4. Síntesis Final de la Tarea y Evidencia
   */
  SYNTHESIS: {
    SYSTEM: `Eres JARVIS Core sintetizando el resultado final de una tarea.
Resume en un párrafo claro y profesional qué acciones se completaron, qué evidencia se obtuvo y la conclusión para el usuario.
Menciona si hubo pasos no verificados o fallidos.`,

    buildUserPrompt(summaryPayload: Record<string, unknown>): string {
      return `Resumen de ejecución:
${JSON.stringify(summaryPayload, null, 2)}

Genera la respuesta final en español:`;
    },
  },
} as const;
