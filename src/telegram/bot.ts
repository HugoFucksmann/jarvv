/**
 * Telegram como segunda vía de entrada de JARVIS: el usuario escribe una tarea desde su chat y el bot la ejecuta contra la API HTTP
 * (la de la interfaz web), muestra el progreso en un mensaje que se edita, pide en el chat los planes, aprobaciones y preguntas, y
 * responde con el texto final y, si la voz está activa, una nota de voz.
 *
 * Una tarea a la vez, y solo las que inicia el propio bot: las de la interfaz no generan mensajes. Solo atiende al chat privado
 * autorizado (`TelegramConfig.chatId`).
 *
 * `TelegramBridge` guarda el estado de esa única tarea y se organiza en tres partes: lo que se envía al chat, lo que llega de la API (eventos de las tareas)
 * y lo que llega del chat (comandos, botones y mensajes). El texto de los avisos, los interruptores y el mensaje de progreso están en sus módulos
 * (`waitingPrompt.ts`, `switches.ts`, `statusMessage.ts`).
 */

import { Bot, InputFile } from "grammy";
import type { Context, InlineKeyboard } from "grammy";
import { FIXED_TIMEOUTS } from "../core/timeouts.ts";
import { RESTART_RESULT_TEXT } from "../core/tasks.ts";
import type { TaskEvent, TaskSummary } from "../core/tasks.ts";
import type { Waiting } from "../core/types/waiting.ts";
import { speechExcerpt, streamSpeech } from "../voice/tts.ts";
import type { VoiceConfig } from "../voice/tts.ts";
import { ffmpegAvailable, pcmToOggOpus } from "../voice/opus.ts";
import { JarvisApi } from "./api.ts";
import { BOT_COMMANDS, MODE_LABEL, parseMode } from "./commands.ts";
import type { TelegramConfig } from "./config.ts";
import { chunk, mdToHtml } from "./format.ts";
import { StatusMessage } from "./statusMessage.ts";
import { AUTO_CONFIRM_CALLBACK, AUTO_SPEC, runSwitch, voiceSwitchOf } from "./switches.ts";
import { describeWaiting, tagOf, waitKey } from "./waitingPrompt.ts";

export interface TelegramDeps {
  cfg: TelegramConfig;
  /** Configuración de voz si Telegram debe sumar una nota de voz a la respuesta; `null` si está apagada. Se lee en cada respuesta. */
  getVoice: () => VoiceConfig | null;
  /** Tareas que quedaron abiertas al apagarse el servidor y se cerraron con `restart` al arrancar. */
  interruptedOnStartup?: readonly TaskSummary[];
  /** El bot de grammY; por defecto uno nuevo con `cfg.token`. Las pruebas pasan uno con una API simulada. */
  bot?: Bot;
  /** `false` no abre la conexión con Telegram (ni publica el menú de comandos): las pruebas entregan las actualizaciones a mano. Por defecto `true`. */
  polling?: boolean;
}

interface TaskState {
  /** El mensaje de progreso y su refresco. */
  status: StatusMessage;
  resultSent: boolean;
  /** Esperas ya mostradas (la API puede repetir el evento de una misma espera). */
  shown: Set<string>;
  /** Último aviso con botones: se le quitan los botones cuando deja de aplicar. */
  prompt?: { key: string; messageId: number };
  /** Pausa activa por modelo no disponible y temporizador breve para distinguir reanudación de cierre inmediato. */
  pausedModel?: string;
  resumeTimer?: ReturnType<typeof setTimeout>;
  finished?: Finish;
}

type Finish = { state: string; stopReason: string | null };

const modelLabel = (model: string): string =>
  model === "llm" ? "modelo generativo (LLM)" : model === "decision" ? "modelo de decisión" : model;

const STATUS_INTERVAL_MS = FIXED_TIMEOUTS.telegramStatusMs; // cada cuánto se actualiza, como mucho, el mensaje de progreso
const TYPING_INTERVAL_MS = FIXED_TIMEOUTS.telegramTypingMs; // el aviso "escribiendo…" dura 5 s en Telegram
const RESULT_WAIT_MS = FIXED_TIMEOUTS.telegramResultWaitMs; // espera máxima del resultado tras el fin de la tarea
const RESUME_DEBOUNCE_MS = 120; // tras salir de una pausa se espera un instante: si la tarea cierra enseguida, no se avisa «retomando»
const VOICE_MAX_CHARS = 1500; // la nota de voz lee solo el comienzo de una respuesta larga

const FINISH_TITLE: Record<string, string> = {
  completed: "✅ Tarea completada",
  partial: "⚠️ Tarea parcial",
  failed: "❌ Tarea fallida",
  cancelled: "🛑 Tarea cancelada",
};

class TelegramBridge {
  private readonly bot: Bot;
  private readonly api: JarvisApi;
  private readonly polling: boolean;
  private readonly abort = new AbortController();

  private readonly tasks = new Map<string, TaskState>();
  private current: { taskId: string; waiting: Waiting | null } | null = null;
  private awaitingFeedback = false;
  /** Modo de las tareas que se inician desde Telegram: parte del entorno y se cambia con /modo (en memoria: al reiniciar vuelve al del entorno). */
  private mode: TelegramConfig["mode"];

  /** Entre pedir iniciar la tarea y recibir su id pueden llegar eventos de ella: se guardan y se reproducen al conocer el id. */
  private starting = false;
  private readonly early: TaskEvent[] = [];
  /** Los eventos se procesan de a uno y en orden. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TelegramDeps) {
    this.bot = deps.bot ?? new Bot(deps.cfg.token);
    this.api = new JarvisApi(deps.cfg.apiBase);
    this.polling = deps.polling ?? true;
    this.mode = deps.cfg.mode;
  }

  private get chatId(): number {
    return this.deps.cfg.chatId;
  }

  /** Registra los manejadores del chat, escucha los eventos de la API y (salvo `polling: false`) abre la conexión con Telegram. Devuelve cómo apagarlo. */
  start(): () => void {
    this.registerChatHandlers();
    this.warnIfVoiceWithoutFfmpeg();
    this.announceInterruptedTasks();
    void this.api.listen((event) => this.enqueue(event), this.abort.signal);

    if (this.polling) {
      // Menú de comandos que Telegram ofrece al escribir "/".
      void this.bot.api.setMyCommands([...BOT_COMMANDS]).catch(() => { /* el menú es una comodidad */ });
      this.bot
        // Los mensajes que llegaron con JARVIS apagado se descartan: no deben lanzar tareas viejas al arrancar.
        .start({ drop_pending_updates: true, onStart: (me) => console.log(`[telegram] @${me.username} activo`) })
        .catch((e) => console.error("[telegram] no pudo iniciar (¿token inválido?):", e));
    }

    return () => {
      for (const t of this.tasks.values()) this.stopTimers(t);
      this.abort.abort();
      if (this.polling) void this.bot.stop();
    };
  }

  // ───────────────────────── Envío al chat ─────────────────────────

  /** Envía Markdown como HTML (o texto plano si Telegram lo rechaza); los botones van en el último mensaje. Devuelve su id. */
  private async sendRich(md: string, replyMarkup?: InlineKeyboard): Promise<number | undefined> {
    const parts = chunk(md);
    let last: number | undefined;
    for (const [i, part] of parts.entries()) {
      const markup = i === parts.length - 1 ? replyMarkup : undefined;
      try {
        last = (await this.bot.api.sendMessage(this.chatId, mdToHtml(part), { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: markup })).message_id;
      } catch {
        last = (await this.bot.api.sendMessage(this.chatId, part, { reply_markup: markup })).message_id;
      }
    }
    return last;
  }

  private async sendVoice(text: string, voice: VoiceConfig): Promise<void> {
    const spoken = speechExcerpt(text, VOICE_MAX_CHARS);
    if (!spoken) return;
    const pcm: Buffer[] = [];
    for await (const part of streamSpeech(spoken, voice)) pcm.push(Buffer.from(part));
    if (!pcm.length) return;
    await this.bot.api.sendVoice(this.chatId, new InputFile(await pcmToOggOpus(Buffer.concat(pcm)), "jarvis.ogg"));
  }

  private async sendResult(t: TaskState, text: string): Promise<void> {
    if (t.resultSent) return;
    t.resultSent = true;
    await this.sendRich(text);
    // La nota de voz tarda (síntesis y conversión): va aparte para no frenar los eventos que siguen.
    const voice = this.deps.getVoice();
    if (voice) void this.sendVoice(text, voice).catch((e) => console.error("[telegram] voz:", e instanceof Error ? e.message : e));
  }

  /** Muestra la espera (plan, aprobación o pregunta) con sus botones, una sola vez. */
  private async showWaiting(t: TaskState, w: Waiting): Promise<void> {
    const key = waitKey(w);
    if (t.shown.has(key)) return;
    t.shown.add(key);
    const { markdown, keyboard } = describeWaiting(w);
    const messageId = await this.sendRich(markdown, keyboard);
    if (messageId !== undefined) t.prompt = { key, messageId };
  }

  /** Quita los botones del último aviso si ya no corresponde a la espera actual (resuelta aquí, en la interfaz o por cancelación). */
  private async retirePrompt(t: TaskState, activeKey: string | null): Promise<void> {
    if (!t.prompt || t.prompt.key === activeKey) return;
    const { messageId } = t.prompt;
    t.prompt = undefined;
    await this.bot.api.editMessageReplyMarkup(this.chatId, messageId).catch(() => { /* ya sin botones o borrado */ });
  }

  // ───────────────────────── Ciclo de vida de la tarea ─────────────────────────

  private begin(id: string): TaskState {
    const { api } = this.bot;
    const status = new StatusMessage(
      {
        send: async (html) => (await api.sendMessage(this.chatId, html, { parse_mode: "HTML" })).message_id,
        edit: async (messageId, html) => void (await api.editMessageText(this.chatId, messageId, html, { parse_mode: "HTML" })),
        typing: async () => void (await api.sendChatAction(this.chatId, "typing")),
      },
      { intervalMs: STATUS_INTERVAL_MS, typingMs: TYPING_INTERVAL_MS },
    );
    const t: TaskState = { status, resultSent: false, shown: new Set() };
    this.tasks.set(id, t);
    status.startTyping();
    return t;
  }

  private stopTimers(t: TaskState): void {
    t.status.stopTimers();
    if (t.resumeTimer) clearTimeout(t.resumeTimer);
    t.resumeTimer = undefined;
  }

  /** Pasado el plazo, si la respuesta no llegó por evento se la pide a la API y se da la tarea por cerrada. */
  private async settle(id: string, t: TaskState): Promise<void> {
    if (this.tasks.get(id) !== t) return;
    if (!t.resultSent) {
      const text = await this.api.resultText(id);
      if (text) await this.sendResult(t, text);
    }
    this.tasks.delete(id);
  }

  private async onFinish(id: string, t: TaskState, finish: Finish): Promise<void> {
    t.finished = finish;
    const pausedBeforeFinish = t.pausedModel;
    t.pausedModel = undefined;
    t.status.close();
    this.stopTimers(t);
    await this.retirePrompt(t, null);
    if (pausedBeforeFinish !== undefined && finish.state !== "completed") {
      const msg =
        finish.state === "cancelled"
          ? `🛑 **Tarea cancelada durante la pausa** (${modelLabel(pausedBeforeFinish)}).`
          : `❌ **Se agotó la espera por ${modelLabel(pausedBeforeFinish)}.** Cerrando tarea (${finish.stopReason ?? finish.state}).`;
      await this.sendRich(msg).catch(() => { });
    }
    if (this.current?.taskId === id) {
      this.current = null;
      this.awaitingFeedback = false;
    }
    const reason = finish.stopReason ? ` (${finish.stopReason})` : "";
    await t.status.flush(`${FINISH_TITLE[finish.state] ?? "ℹ️ Tarea finalizada"}${reason}`);
    // La respuesta se escribe después del fin de la tarea: se espera su evento, con tope.
    if (t.resultSent) this.tasks.delete(id);
    else setTimeout(() => void this.settle(id, t), RESULT_WAIT_MS).unref();
  }

  // ───────────────────────── Eventos de la API ─────────────────────────

  private enqueue(event: TaskEvent): void {
    this.queue = this.queue.then(() => this.handle(event)).catch((e) => console.error("[telegram] evento:", e));
  }

  private async handle(event: TaskEvent): Promise<void> {
    const t = this.tasks.get(event.taskId);
    if (!t) {
      if (this.starting) this.early.push(event);
      return;
    }
    if (event.type === "waiting") return this.onWaiting(t, event.taskId, event.waiting);
    if (event.type === "paused") return this.onPaused(t, event.paused);
    if (event.type === "change") await this.onChange(t, event);
  }

  private async onWaiting(t: TaskState, taskId: string, waiting: Waiting | null): Promise<void> {
    if (this.current?.taskId === taskId) this.current.waiting = waiting;
    await this.retirePrompt(t, waiting ? waitKey(waiting) : null);
    if (waiting) await this.showWaiting(t, waiting);
    else this.awaitingFeedback = false;
  }

  private async onPaused(t: TaskState, paused: { readonly model: string } | null): Promise<void> {
    if (t.resumeTimer) {
      clearTimeout(t.resumeTimer);
      t.resumeTimer = undefined;
    }
    if (paused !== null) {
      t.pausedModel = paused.model;
      await this.sendRich(`⏸️ **${modelLabel(paused.model)} no disponible.** Pausando tarea y reintentando automáticamente… (usa /cancel para cancelar).`);
      return;
    }
    if (t.pausedModel === undefined || t.finished) return;
    const model = t.pausedModel;
    t.resumeTimer = setTimeout(() => {
      t.resumeTimer = undefined;
      if (t.pausedModel === model && (!t.finished || t.finished.state === "completed")) {
        t.pausedModel = undefined;
        void this.sendRich(`▶️ **${modelLabel(model)} disponible.** Retomando la tarea.`).catch(() => { });
      }
    }, RESUME_DEBOUNCE_MS);
  }

  private async onChange(t: TaskState, event: Extract<TaskEvent, { type: "change" }>): Promise<void> {
    let changed = false;
    for (const op of event.ops) {
      if (t.status.progress.apply(op)) changed = true;
      if (op.op === "set" && op.target === "result" && op.value.text) {
        await this.sendResult(t, op.value.text);
        if (t.finished) this.tasks.delete(event.taskId);
      }
      if (op.op === "finish") await this.onFinish(event.taskId, t, op.value);
    }
    if (changed && !t.finished) t.status.schedule();
  }

  // ───────────────────────── Chat: comandos, botones y mensajes ─────────────────────────

  private registerChatHandlers(): void {
    const { bot, api } = this;

    // Solo el chat privado autorizado: en un grupo, cualquiera de sus miembros podría aprobar operaciones en esta PC.
    bot.use(async (ctx, next) => {
      if (ctx.chat?.id === this.chatId && ctx.chat.type === "private") return void (await next());
      console.warn(`[telegram] mensaje ignorado del chat ${ctx.chat?.id}: no es el chat privado autorizado (TELEGRAM_CHAT_ID).`);
    });

    bot.command("start", (ctx) =>
      ctx.reply(`JARVIS listo. Envíame una tarea.\n\n${BOT_COMMANDS.filter((c) => c.command !== "start").map((c) => `/${c.command} — ${c.description}`).join("\n")}`),
    );

    // Interruptores de la configuración viva (la interfaz también los cambia): `/auto` (modo automático de Guard) y `/voz` (voz). Cada comando tiene un alias de una letra.
    bot.command(["auto", "a"], (ctx) => runSwitch(api, ctx, AUTO_SPEC, ctx.match.trim()));
    // `/voz on|off`: notas de voz de Telegram. `/voz ui on|off`: lectura en voz alta en la interfaz.
    bot.command(["voz", "v"], (ctx) => {
      const { spec, arg } = voiceSwitchOf(ctx.match);
      return runSwitch(api, ctx, spec, arg);
    });

    bot.command(["modo", "m"], (ctx) => this.onModeCommand(ctx));
    bot.command(["cancel", "c"], (ctx) => this.onCancelCommand(ctx));
    bot.on("callback_query:data", (ctx) => this.onButton(ctx));
    bot.on("message:text", (ctx) => this.onText(ctx));

    bot.catch((err) => {
      console.error("[telegram]", err.error);
      void err.ctx.reply("⚠️ Error interno al procesar el mensaje.").catch(() => { });
    });
  }

  private async onModeCommand(ctx: Context & { match: string }): Promise<void> {
    const arg = ctx.match.trim();
    const wanted = parseMode(arg);
    if (arg && !wanted) return void (await ctx.reply("Uso: /modo r (reactivo) o /modo d (deliberativo). Sin argumento muestra el actual."));
    if (wanted) this.mode = wanted;
    const text = this.mode ? MODE_LABEL[this.mode] : "el del servidor (reactivo)";
    await ctx.reply(
      wanted
        ? `Modo ${text}. Vale para las tareas que inicies desde ahora${this.current ? " (la que está en curso sigue como estaba)" : ""}.`
        : `Modo de las tareas de Telegram: ${text}.`,
    );
  }

  private async onCancelCommand(ctx: Context): Promise<void> {
    if (!this.current) return void (await ctx.reply("No hay tarea en curso."));
    const res = await this.api.post("/cancel", { taskId: this.current.taskId });
    if (!res.ok) await ctx.reply(`⚠️ ${res.error}`);
  }

  /** Un botón de un aviso: la decisión sobre la espera actual (si el botón es de otra, ya no aplica). */
  private async onButton(ctx: Context): Promise<void> {
    const [act, tag] = (ctx.callbackQuery?.data ?? "").split(":");

    if (act === AUTO_CONFIRM_CALLBACK) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup().catch(() => { });
      if (tag !== "y") return void (await ctx.reply("Modo automático sin cambios."));
      const res = await this.api.post("/config", { autoMode: true });
      return void (await ctx.reply(res.ok ? "⚡ Modo automático activado. Desactívalo con /auto off." : `⚠️ ${res.error}`));
    }

    const w = this.current?.waiting;
    if (!this.current || !w || tagOf(w) !== tag) {
      await ctx.answerCallbackQuery({ text: "Ya no aplica." });
      return;
    }

    const res = await this.decide(ctx, this.current.taskId, w, act);
    await ctx.answerCallbackQuery();
    if (res && !res.ok) await ctx.reply(`⚠️ ${res.error}`);
    // Los botones se quitan al llegar el evento de que la espera se resolvió (retirePrompt), no antes: si la API rechazó la decisión siguen vigentes.
  }

  /** Manda a la API la decisión que eligió el botón `act`; `null` si no hay nada que mandar (p. ej. «modificar» solo pide el texto). */
  private async decide(ctx: Context, taskId: string, w: Waiting, act: string): Promise<Awaited<ReturnType<JarvisApi["post"]>> | null> {
    if (act === "cx") return this.api.post("/cancel", { taskId });
    if (w.kind === "question") return null;

    const decision = { taskId, waitId: w.request.id };
    if (w.kind === "plan") {
      if (act === "pa") return this.api.post("/confirm-plan", decision);
      if (act === "pr") return this.api.post("/reject-plan", decision);
      if (act === "pm") {
        this.awaitingFeedback = true;
        await ctx.reply("✏️ Escribe los cambios que quieres en el plan.");
      }
      return null;
    }
    if (act === "aa") return this.api.post("/approve", decision);
    if (act === "al" && w.request.canRemember === true) return this.api.post("/approve", { ...decision, remember: true });
    if (act === "ad") return this.api.post("/deny", decision);
    return null;
  }

  /** Un mensaje de texto: cambios al plan, respuesta a la pregunta abierta, o una tarea nueva. */
  private async onText(ctx: Context & { message: { text: string } }): Promise<void> {
    const text = ctx.message.text.trim();
    if (!text) return;
    const w = this.current?.waiting;

    if (this.current && this.awaitingFeedback && w?.kind === "plan") {
      this.awaitingFeedback = false;
      const res = await this.api.post("/modify-plan", { taskId: this.current.taskId, waitId: w.request.id, feedback: text });
      await ctx.reply(res.ok ? "✏️ Cambios enviados." : `⚠️ ${res.error}`);
      return;
    }
    if (this.current && w?.kind === "question") {
      const res = await this.api.post("/user-answer", { taskId: this.current.taskId, answer: text });
      if (!res.ok) await ctx.reply(`⚠️ ${res.error}`);
      return;
    }
    if (this.current || this.starting) return void (await ctx.reply("Hay una tarea en curso. Usa /cancel para cancelarla."));
    await this.startTask(ctx, text);
  }

  private async startTask(ctx: Context, text: string): Promise<void> {
    this.starting = true;
    this.early.length = 0;
    try {
      const res = await this.api.post<{ task: { task: { id: string } } }>("/process", { message: text, ...(this.mode ? { mode: this.mode } : {}) });
      if (!res.ok) return void (await ctx.reply(`⚠️ ${res.error}`));
      const id = res.data.task.task.id;
      const t = this.begin(id);
      this.current = { taskId: id, waiting: null };
      for (const event of this.early.filter((e) => e.taskId === id)) this.enqueue(event);
      await t.status.flush();
    } finally {
      this.starting = false;
      this.early.length = 0;
    }
  }

  // ───────────────────────── Arranque ─────────────────────────

  /** Las notas de voz necesitan ffmpeg: se avisa al arrancar y no recién con la primera respuesta. */
  private warnIfVoiceWithoutFfmpeg(): void {
    if (!this.deps.getVoice()) return;
    void ffmpegAvailable().then((ok) => {
      if (!ok) console.warn("[telegram] telegramVoice está activo pero no se encuentra ffmpeg: no habrá notas de voz (winget install Gyan.FFmpeg).");
    });
  }

  /** Aviso tras un reinicio si quedaron tareas interrumpidas (incluidas las que esperaban aprobación o respuesta). */
  private announceInterruptedTasks(): void {
    for (const task of this.deps.interruptedOnStartup ?? []) {
      const excerpt = task.request.length > 140 ? `${task.request.slice(0, 140)}…` : task.request;
      const outcome = task.state === "partial" ? "⚠️ Parcial (hubo cambios aplicados)" : "❌ Fallida";
      void this.sendRich(
        `🔄 **Tarea interrumpida por reinicio**\n\n**Pedido:** ${excerpt}\n**Estado:** ${outcome} (\`restart\`)\n${RESTART_RESULT_TEXT}.`,
      ).catch((e) => console.error("[telegram] aviso de reinicio:", e instanceof Error ? e.message : e));
    }
  }
}

export function startTelegram(deps: TelegramDeps): () => void {
  return new TelegramBridge(deps).start();
}
