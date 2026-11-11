/** Argumentos de los comandos de Telegram (`/auto on`, `/modo deliberativo`): acepta español e inglés y no distingue mayúsculas. */

import type { TelegramMode } from "./config.ts";

const ON = new Set(["on", "si", "sí", "activar", "activado", "activa", "true", "1"]);
const OFF = new Set(["off", "no", "desactivar", "desactivado", "desactiva", "false", "0"]);

/** `true` / `false` para encender / apagar; `null` si no es ninguna de las dos (o no hay argumento). */
export function parseSwitch(arg: string): boolean | null {
  const a = arg.trim().toLowerCase();
  if (ON.has(a)) return true;
  if (OFF.has(a)) return false;
  return null;
}

const MODES: Record<string, TelegramMode> = {
  r: "reactive",
  reactive: "reactive",
  reactivo: "reactive",
  d: "deliberative",
  deliberative: "deliberative",
  deliberativo: "deliberative",
};

export function parseMode(arg: string): TelegramMode | null {
  return MODES[arg.trim().toLowerCase()] ?? null;
}

export const MODE_LABEL: Record<TelegramMode, string> = { reactive: "reactivo", deliberative: "deliberativo" };

/** Menú de comandos que Telegram muestra al escribir `/`. Cada uno (salvo `start`) tiene un alias de una letra: `/a`, `/m`, `/v`, `/c`. */
export const BOT_COMMANDS = [
  { command: "auto", description: "Modo automático de Guard (/a): on | off" },
  { command: "modo", description: "Modo de las tareas (/m): r = reactivo, d = deliberativo" },
  { command: "voz", description: "Nota de voz (/v): on | off; /v ui on | off" },
  { command: "cancel", description: "Cancelar la tarea en curso (/c)" },
  { command: "start", description: "Ayuda" },
] as const;
