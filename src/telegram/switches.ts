/**
 * Interruptores de la configuración viva que se manejan desde el chat: `/auto` (modo automático de Guard) y `/voz` (notas de voz de Telegram o voz de la
 * interfaz). La interfaz web cambia los mismos valores: el estado siempre se lee de la API, nunca se guarda acá.
 *
 * Cada comando acepta `on` / `off`; sin argumento muestra el estado.
 */

import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import type { JarvisApi } from "./api.ts";
import { parseSwitch } from "./commands.ts";

export type SwitchKey = "autoMode" | "telegramVoice" | "voiceEnabled";

export interface SwitchSpec {
  readonly key: SwitchKey;
  readonly usage: string;
  readonly name: string;
  readonly states: readonly [off: string, on: string];
  readonly done: readonly [off: string, on: string];
  /** Encender pide confirmar con un botón: su `callback_data` es `<callback>:y` o `<callback>:n`. */
  readonly confirmOn?: { readonly text: string; readonly callback: string };
}

/** Callback con el que el botón de confirmación del modo automático vuelve a `bot.ts` (`ao:y` / `ao:n`). */
export const AUTO_CONFIRM_CALLBACK = "ao";

export const AUTO_SPEC: SwitchSpec = {
  key: "autoMode",
  usage: "/auto on o /auto off",
  name: "Modo automático de Guard",
  states: ["desactivado (pide aprobación)", "activado"],
  // Encenderlo delega escrituras amarillas en Decision 3; lo rojo (borrar/sobrescribir/comandos/procesos), rutas sensibles y lista negra siguen pidiendo aprobación.
  confirmOn: {
    text: "Niveles de riesgo: 🟢 verde (crear algo nuevo en tus carpetas) y lectura pasan sin preguntar; 🟡 amarillo (p. ej. agregar a un archivo): con el modo automático lo revisa Decision 3 sin pedirte confirmación, sin él te lo pregunta; 🔴 rojo (eliminar, sobrescribir, comandos o procesos), rutas sensibles y lista negra te piden confirmación siempre, con o sin modo automático. ¿Activar el modo automático?",
    callback: AUTO_CONFIRM_CALLBACK,
  },
  done: ["🔒 Modo automático desactivado.", "⚡ Modo automático activado (amarillo revisado por Decision 3; rojo sigue pidiendo confirmación). Desactívalo con /auto off."],
};

const TELEGRAM_VOICE_SPEC: SwitchSpec = {
  key: "telegramVoice",
  usage: "/voz on, /voz off o /voz ui on|off",
  name: "Nota de voz en Telegram",
  states: ["desactivada", "activada"],
  done: ["🔇 Notas de voz desactivadas: solo texto.", "🔊 Notas de voz activadas: texto y audio."],
};

const UI_VOICE_SPEC: SwitchSpec = {
  key: "voiceEnabled",
  usage: "/voz ui on o /voz ui off",
  name: "Voz en la interfaz",
  states: ["desactivada", "activada"],
  done: ["🔇 Voz de la interfaz desactivada.", "🔊 Voz de la interfaz activada."],
};

/** `/voz on|off` (nota de voz de Telegram) o `/voz ui on|off` (voz de la interfaz): qué interruptor y qué argumento le toca. */
export function voiceSwitchOf(match: string): { readonly spec: SwitchSpec; readonly arg: string } {
  const [first = "", ...rest] = match.trim().split(/\s+/);
  return first.toLowerCase() === "ui" ? { spec: UI_VOICE_SPEC, arg: rest.join(" ") } : { spec: TELEGRAM_VOICE_SPEC, arg: first };
}

async function switchState(api: JarvisApi, key: SwitchKey): Promise<boolean | null> {
  const res = await api.get<Partial<Record<SwitchKey, boolean>>>("/config");
  return res.ok ? Boolean(res.data[key]) : null;
}

/** Aplica `/comando on|off`; sin argumento muestra el estado. Si `confirmOn` está definido, encender pide confirmar con un botón. */
export async function runSwitch(api: JarvisApi, ctx: Context, spec: SwitchSpec, arg: string): Promise<void> {
  const wanted = parseSwitch(arg);
  if (arg && wanted === null) return void (await ctx.reply(`Uso: ${spec.usage}. Sin argumento muestra el estado.`));
  const now = await switchState(api, spec.key);
  if (now === null) return void (await ctx.reply("⚠️ No se pudo leer la configuración de JARVIS."));
  const label = (on: boolean) => spec.states[on ? 1 : 0];
  if (wanted === null) return void (await ctx.reply(`${spec.name}: ${label(now)}.`));
  if (wanted === now) return void (await ctx.reply(`${spec.name} ya está ${label(now)}.`));
  if (wanted && spec.confirmOn) {
    const kb = new InlineKeyboard().text("⚠️ Sí, activar", `${spec.confirmOn.callback}:y`).text("Cancelar", `${spec.confirmOn.callback}:n`);
    return void (await ctx.reply(spec.confirmOn.text, { reply_markup: kb }));
  }
  const res = await api.post("/config", { [spec.key]: wanted });
  await ctx.reply(res.ok ? spec.done[wanted ? 1 : 0] : `⚠️ ${res.error}`);
}
