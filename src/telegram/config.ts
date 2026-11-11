/** Configuración del bot de Telegram a partir del entorno (`.env`): el token es un secreto y por eso no vive en `jarvis-config.json`. */

export type TelegramMode = "reactive" | "deliberative";

export interface TelegramConfig {
  /** Token de @BotFather. */
  token: string;
  /** Único chat privado autorizado: quien escribe desde otro chat se ignora. */
  chatId: number;
  /** URL base de la API de JARVIS. */
  apiBase: string;
  /** Modo de las tareas iniciadas desde Telegram; sin valor, el que use el servidor por defecto. */
  mode?: TelegramMode;
}

/** `config: null` con el motivo, para que el servidor lo diga al arrancar. */
export type TelegramSetup = { config: TelegramConfig; warnings: string[] } | { config: null; reason: string };

export function telegramConfigFromEnv(env: NodeJS.ProcessEnv, port: number): TelegramSetup {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { config: null, reason: "falta TELEGRAM_BOT_TOKEN (en el entorno o en .env; ver .env.example)" };

  const chatId = Number(env.TELEGRAM_CHAT_ID?.trim());
  // Los chats privados tienen id positivo; un grupo (negativo) dejaría decidir a cualquiera de sus miembros.
  if (!Number.isSafeInteger(chatId) || chatId <= 0) {
    return { config: null, reason: "TELEGRAM_CHAT_ID falta o no es el id numérico de un chat privado (@userinfobot lo dice)" };
  }

  const warnings: string[] = [];
  const rawMode = env.TELEGRAM_MODE?.trim();
  let mode: TelegramMode | undefined;
  if (rawMode === "reactive" || rawMode === "deliberative") mode = rawMode;
  else if (rawMode) warnings.push(`TELEGRAM_MODE='${rawMode}' no es válido (reactive o deliberative): se usa el modo por defecto.`);

  return { config: { token, chatId, apiBase: `http://127.0.0.1:${port}/api/jarvis`, ...(mode ? { mode } : {}) }, warnings };
}
