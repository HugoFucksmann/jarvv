/**
 * Lo que el chat muestra cuando la tarea espera algo del usuario (un plan, una aprobación o una respuesta): el texto y los botones.
 * Es solo presentación; quien lo envía, lo registra y retira los botones es `bot.ts`.
 *
 * Los botones llevan en `callback_data` la acción (`pa`, `pm`, `pr`, `aa`, `al`, `ad`, `cx`) y una etiqueta corta de la espera (`tagOf`): Telegram limita
 * ese dato a 64 bytes y la etiqueta evita que un botón viejo resuelva otra espera.
 */

import { InlineKeyboard } from "grammy";
import type { Waiting } from "../core/types/waiting.ts";

/** Más largo no se puede revisar en el chat: con argumentos así no se ofrece aprobar. */
export const APPROVAL_ARGS_MAX = 1500;

export const waitKey = (w: Waiting): string => (w.kind === "question" ? `q${w.question.stepId}` : w.request.id);

/** Identifica la espera en el `callback_data` de los botones (Telegram lo limita a 64 bytes). */
export const tagOf = (w: Waiting): string => waitKey(w).slice(0, 8);

interface WaitingPrompt {
  /** Markdown del mensaje. */
  readonly markdown: string;
  readonly keyboard: InlineKeyboard;
}

export function describeWaiting(w: Waiting): WaitingPrompt {
  const tag = tagOf(w);

  if (w.kind === "plan") {
    const steps = w.request.steps.map((s, i) => `${i + 1}. ${s.instruction}`).join("\n");
    const keyboard = new InlineKeyboard()
      .text("✅ Aceptar", `pa:${tag}`)
      .text("✏️ Modificar", `pm:${tag}`)
      .row()
      .text("❌ Rechazar", `pr:${tag}`);
    return { markdown: `**📋 Plan propuesto**\n\n${steps}`, keyboard };
  }

  if (w.kind === "approval") {
    const r = w.request;
    const full = JSON.stringify(r.args, null, 2) ?? "";
    // Nunca se aprueba lo que no se pudo leer entero: con argumentos largos solo se ofrece denegar o cancelar.
    const reviewable = full.length <= APPROVAL_ARGS_MAX;
    const keyboard = new InlineKeyboard();
    if (reviewable) keyboard.text("✅ Aprobar una vez", `aa:${tag}`);
    // «Siempre» vive solo en la tarea y nunca se ofrece para lo obligatorio de Guard (rutas o datos sensibles), la lista negra ni lo no resoluble.
    if (reviewable && r.canRemember === true) keyboard.row().text("♾️ Aprobar siempre en esta tarea", `al:${tag}`);
    keyboard.row().text("🚫 Denegar", `ad:${tag}`).row().text("🛑 Cancelar", `cx:${tag}`);
    const body = reviewable
      ? `\`\`\`json\n${full}\n\`\`\``
      : `\`\`\`json\n${full.slice(0, APPROVAL_ARGS_MAX)}\n…\n\`\`\`\n⚠️ Los argumentos son demasiado largos para revisarlos aquí: apruébalo desde la interfaz.`;
    return { markdown: `**🔐 Aprobación requerida**\n\n**Tool:** \`${r.mcp}/${r.tool}\` (${r.capability})\n**Motivo:** ${r.reason}\n\n${body}`, keyboard };
  }

  return {
    markdown: `**❓ JARVIS pregunta**\n\n${w.question.question}\n\n_Responde con un mensaje._`,
    keyboard: new InlineKeyboard().text("🛑 Cancelar", `cx:${tag}`),
  };
}
