/**
 * Telegram como segunda vía de entrada de JARVIS: el usuario escribe una tarea desde su chat y el bot la ejecuta contra la API HTTP
 * (la de la interfaz web), muestra el progreso en un mensaje que se edita, pide en el chat los planes, aprobaciones y preguntas, y
 * responde con el texto final y, si la voz está activa, una nota de voz.
 *
 * Una tarea a la vez, y solo las que inicia el propio bot: las de la interfaz no generan mensajes. Solo atiende al chat privado
 * autorizado (`TelegramConfig.chatId`).
 */

import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { Context } from "grammy";
import type { TaskEvent } from "../core/tasks.ts";
import type { Waiting } from "../core/engine/runtime.ts";
import { speechExcerpt, streamSpeech } from "../voice/tts.ts";
import type { VoiceConfig } from "../voice/tts.ts";
import { ffmpegAvailable, pcmToOggOpus } from "../voice/opus.ts";
import { JarvisApi } from "./api.ts";
import { BOT_COMMANDS, MODE_LABEL, parseMode, parseSwitch } from "./commands.ts";
import type { TelegramConfig } from "./config.ts";
import { chunk, mdToHtml } from "./format.ts";
import { Progress } from "./progress.ts";

export interface TelegramDeps {
  cfg: TelegramConfig;
  /** Configuración de voz si Telegram debe sumar una nota de voz a la respuesta; `null` si está apagada. Se lee en cada respuesta. */
  getVoice: () => VoiceConfig | null;
}

interface TaskState {
  progress: Progress;
  resultSent: boolean;
  /** Esperas ya mostradas (la API puede repetir el evento de una misma espera). */
  shown: Set<string>;
  /** Último aviso con botones: se le quitan los botones cuando deja de aplicar. */
  prompt?: { key: string; messageId: number };
  statusMsgId?: number;
  lastFlush: number;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** Aviso "escribiendo…" mientras la tarea trabaja. */
  typing?: ReturnType<typeof setInterval>;
  /** Serializa las ediciones del mensaje de progreso. */
  lock: Promise<void>;
  finished?: { state: string; stopReason: string | null };
}

const STATUS_INTERVAL_MS = 2500; // cada cuánto se actualiza, como mucho, el mensaje de progreso
const TYPING_INTERVAL_MS = 4500; // el aviso "escribiendo…" dura 5 s en Telegram
const RESULT_WAIT_MS = 30000; // espera máxima del resultado tras el fin de la tarea
const VOICE_MAX_CHARS = 1500; // la nota de voz lee solo el comienzo de una respuesta larga
const APPROVAL_ARGS_MAX = 1500; // más largo no se puede revisar en el chat

const FINISH_TITLE: Record<string, string> = {
  completed: "✅ Tarea completada",
  partial: "⚠️ Tarea parcial",
  failed: "❌ Tarea fallida",
  cancelled: "🛑 Tarea cancelada",
};

const waitKey = (w: Waiting): string => (w.kind === "question" ? `q${w.question.stepId}` : w.request.id);
/** Identifica la espera en el `callback_data` de los botones (Telegram lo limita a 64 bytes). */
const tagOf = (w: Waiting): string => waitKey(w).slice(0, 8);

export function startTelegram({ cfg, getVoice }: TelegramDeps): () => void {
  const bot = new Bot(cfg.token);
  const api = new JarvisApi(cfg.apiBase);
  const abort = new AbortController();

  const tasks = new Map<string, TaskState>();
  let current: { taskId: string; waiting: Waiting | null } | null = null;
  let awaitingFeedback = false;
  // Modo de las tareas que se inician desde Telegram: parte del entorno y se cambia con /modo (en memoria: al reiniciar vuelve al del entorno).
  let mode = cfg.mode;

  // Entre pedir iniciar la tarea y recibir su id pueden llegar eventos de ella: se guardan y se reproducen al conocer el id.
  let starting = false;
  const early: TaskEvent[] = [];

  // ---------- envío ----------

  /** Envía Markdown como HTML (o texto plano si Telegram lo rechaza); los botones van en el último mensaje. Devuelve su id. */
  async function sendRich(md: string, replyMarkup?: InlineKeyboard): Promise<number | undefined> {
    const parts = chunk(md);
    let last: number | undefined;
    for (const [i, part] of parts.entries()) {
      const markup = i === parts.length - 1 ? replyMarkup : undefined;
      try {
        last = (await bot.api.sendMessage(cfg.chatId, mdToHtml(part), { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: markup })).message_id;
      } catch {
        last = (await bot.api.sendMessage(cfg.chatId, part, { reply_markup: markup })).message_id;
      }
    }
    return last;
  }

  async function sendVoice(text: string, voice: VoiceConfig): Promise<void> {
    const spoken = speechExcerpt(text, VOICE_MAX_CHARS);
    if (!spoken) return;
    const pcm: Buffer[] = [];
    for await (const part of streamSpeech(spoken, voice)) pcm.push(Buffer.from(part));
    if (!pcm.length) return;
    await bot.api.sendVoice(cfg.chatId, new InputFile(await pcmToOggOpus(Buffer.concat(pcm)), "jarvis.ogg"));
  }

  async function sendResult(t: TaskState, text: string): Promise<void> {
    if (t.resultSent) return;
    t.resultSent = true;
    await sendRich(text);
    // La nota de voz tarda (síntesis y conversión): va aparte para no frenar los eventos que siguen.
    const voice = getVoice();
    if (voice) void sendVoice(text, voice).catch((e) => console.error("[telegram] voz:", e instanceof Error ? e.message : e));
  }

  // ---------- esperas (plan, aprobación, pregunta) ----------

  async function showWaiting(t: TaskState, w: Waiting): Promise<void> {
    const key = waitKey(w);
    if (t.shown.has(key)) return;
    t.shown.add(key);
    const tag = tagOf(w);
    let messageId: number | undefined;

    if (w.kind === "plan") {
      const steps = w.request.steps.map((s, i) => `${i + 1}. ${s.instruction}`).join("\n");
      const kb = new InlineKeyboard()
        .text("✅ Aceptar", `pa:${tag}`)
        .text("✏️ Modificar", `pm:${tag}`)
        .row()
        .text("❌ Rechazar", `pr:${tag}`);
      messageId = await sendRich(`**📋 Plan propuesto**\n\n${steps}`, kb);
    } else if (w.kind === "approval") {
      const r = w.request;
      const full = JSON.stringify(r.args, null, 2) ?? "";
      // Nunca se aprueba lo que no se pudo leer entero: con argumentos largos solo se ofrece denegar o cancelar.
      const reviewable = full.length <= APPROVAL_ARGS_MAX;
      const kb = new InlineKeyboard();
      if (reviewable) kb.text("✅ Aprobar", `aa:${tag}`);
      kb.text("🚫 Denegar", `ad:${tag}`).row().text("🛑 Cancelar", `cx:${tag}`);
      const body = reviewable
        ? `\`\`\`json\n${full}\n\`\`\``
        : `\`\`\`json\n${full.slice(0, APPROVAL_ARGS_MAX)}\n…\n\`\`\`\n⚠️ Los argumentos son demasiado largos para revisarlos aquí: apruébalo desde la interfaz.`;
      messageId = await sendRich(`**🔐 Aprobación requerida**\n\n**Tool:** \`${r.mcp}/${r.tool}\` (${r.capability})\n**Motivo:** ${r.reason}\n\n${body}`, kb);
    } else {
      const kb = new InlineKeyboard().text("🛑 Cancelar", `cx:${tag}`);
      messageId = await sendRich(`**❓ JARVIS pregunta**\n\n${w.question.question}\n\n_Responde con un mensaje._`, kb);
    }
    if (messageId !== undefined) t.prompt = { key, messageId };
  }

  /** Quita los botones del último aviso si ya no corresponde a la espera actual (resuelta aquí, en la interfaz o por cancelación). */
  async function retirePrompt(t: TaskState, activeKey: string | null): Promise<void> {
    if (!t.prompt || t.prompt.key === activeKey) return;
    const { messageId } = t.prompt;
    t.prompt = undefined;
    await bot.api.editMessageReplyMarkup(cfg.chatId, messageId).catch(() => { /* ya sin botones o borrado */ });
  }

  // ---------- progreso ----------

  function begin(id: string): TaskState {
    const t: TaskState = { progress: new Progress(), resultSent: false, shown: new Set(), lastFlush: 0, dirty: false, lock: Promise.resolve() };
    tasks.set(id, t);
    const typing = (): void => void bot.api.sendChatAction(cfg.chatId, "typing").catch(() => { });
    typing();
    t.typing = setInterval(typing, TYPING_INTERVAL_MS);
    return t;
  }

  function stopTimers(t: TaskState): void {
    if (t.typing) clearInterval(t.typing);
    if (t.timer) clearTimeout(t.timer);
    t.typing = t.timer = undefined;
  }

  function flushStatus(t: TaskState, header = "⏳ Trabajando…"): Promise<void> {
    t.lock = t.lock.then(async () => {
      t.dirty = false;
      t.lastFlush = Date.now();
      const text = t.progress.render(header);
      try {
        if (t.statusMsgId) await bot.api.editMessageText(cfg.chatId, t.statusMsgId, text, { parse_mode: "HTML" });
        else t.statusMsgId = (await bot.api.sendMessage(cfg.chatId, text, { parse_mode: "HTML" })).message_id;
      } catch {
        /* "message is not modified" u otro fallo de edición: el siguiente refresco lo corrige */
      }
    });
    return t.lock;
  }

  function scheduleStatus(t: TaskState): void {
    t.dirty = true;
    if (t.timer || t.finished) return;
    const wait = Math.max(0, STATUS_INTERVAL_MS - (Date.now() - t.lastFlush));
    t.timer = setTimeout(() => {
      t.timer = undefined;
      if (t.dirty && !t.finished) void flushStatus(t);
    }, wait);
  }

  /** Pasado el plazo, si la respuesta no llegó por evento se la pide a la API y se da la tarea por cerrada. */
  async function settle(id: string, t: TaskState): Promise<void> {
    if (tasks.get(id) !== t) return;
    if (!t.resultSent) {
      const text = await api.resultText(id);
      if (text) await sendResult(t, text);
    }
    tasks.delete(id);
  }

  async function onFinish(id: string, t: TaskState, finish: { state: string; stopReason: string | null }): Promise<void> {
    t.finished = finish;
    stopTimers(t);
    await retirePrompt(t, null);
    if (current?.taskId === id) {
      current = null;
      awaitingFeedback = false;
    }
    const reason = finish.stopReason ? ` (${finish.stopReason})` : "";
    await flushStatus(t, `${FINISH_TITLE[finish.state] ?? "ℹ️ Tarea finalizada"}${reason}`);
    // La respuesta se escribe después del fin de la tarea: se espera su evento, con tope.
    if (t.resultSent) tasks.delete(id);
    else setTimeout(() => void settle(id, t), RESULT_WAIT_MS).unref();
  }

  // ---------- eventos de la API ----------

  async function handle(event: TaskEvent): Promise<void> {
    const t = tasks.get(event.taskId);
    if (!t) {
      if (starting) early.push(event);
      return;
    }

    if (event.type === "waiting") {
      if (current?.taskId === event.taskId) current.waiting = event.waiting;
      await retirePrompt(t, event.waiting ? waitKey(event.waiting) : null);
      if (event.waiting) await showWaiting(t, event.waiting);
      else awaitingFeedback = false;
      return;
    }
    if (event.type !== "change") return;

    let changed = false;
    for (const op of event.ops) {
      if (t.progress.apply(op)) changed = true;
      if (op.op === "set" && op.target === "result" && op.value.text) {
        await sendResult(t, op.value.text);
        if (t.finished) tasks.delete(event.taskId);
      }
      if (op.op === "finish") await onFinish(event.taskId, t, op.value);
    }
    if (changed && !t.finished) scheduleStatus(t);
  }

  // Los eventos se procesan de a uno y en orden.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (event: TaskEvent): void => {
    queue = queue.then(() => handle(event)).catch((e) => console.error("[telegram] evento:", e));
  };

  // ---------- chat ----------

  // Solo el chat privado autorizado: en un grupo, cualquiera de sus miembros podría aprobar operaciones en esta PC.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.id === cfg.chatId && ctx.chat.type === "private") return void (await next());
    console.warn(`[telegram] mensaje ignorado del chat ${ctx.chat?.id}: no es el chat privado autorizado (TELEGRAM_CHAT_ID).`);
  });

  bot.command("start", (ctx) =>
    ctx.reply(
      `JARVIS listo. Envíame una tarea.\n\n${BOT_COMMANDS.filter((c) => c.command !== "start").map((c) => `/${c.command} — ${c.description}`).join("\n")}`
    )
  );

  // Interruptores de la configuración viva (la interfaz también los cambia): `/auto` (modo automático de Guard) y `/voz` (voz).
  // Cada comando tiene un alias de una letra.
  type SwitchKey = "autoMode" | "telegramVoice" | "voiceEnabled";

  interface SwitchSpec {
    readonly key: SwitchKey;
    readonly usage: string;
    readonly name: string;
    readonly states: readonly [off: string, on: string];
    readonly done: readonly [off: string, on: string];
    readonly confirmOn?: { readonly text: string; readonly callback: string };
  }

  async function switchState(key: SwitchKey): Promise<boolean | null> {
    const res = await api.get<Partial<Record<SwitchKey, boolean>>>("/config");
    return res.ok ? Boolean(res.data[key]) : null;
  }

  /** Aplica `/comando on|off`; sin argumento muestra el estado. `confirmOn`: encender pide confirmar con un botón (callback `cb:y`). */
  async function runSwitch(
    ctx: Context,
    spec: SwitchSpec,
    arg: string
  ): Promise<void> {
    const wanted = parseSwitch(arg);
    if (arg && wanted === null) return void (await ctx.reply(`Uso: ${spec.usage}. Sin argumento muestra el estado.`));
    const now = await switchState(spec.key);
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

  const AUTO_SPEC = {
    key: "autoMode",
    usage: "/auto on o /auto off",
    name: "Modo automático de Guard",
    states: ["desactivado (pide aprobación)", "activado"],
    // Encenderlo quita la aprobación humana de escrituras y comandos: se confirma.
    confirmOn: {
      text: "Con el modo automático JARVIS ejecuta escrituras y comandos SIN pedirte aprobación (solo los revisa la validación de argumentos; lo prohibido sigue bloqueado). ¿Activarlo?",
      callback: "ao",
    },
    done: ["🔒 Modo automático desactivado: vuelve a pedir aprobación.", "⚡ Modo automático activado. Desactívalo con /auto off."],
  } as const;

  bot.command(["auto", "a"], (ctx) => runSwitch(ctx, AUTO_SPEC, ctx.match.trim()));

  // `/voz on|off`: notas de voz de Telegram. `/voz ui on|off`: lectura en voz alta en la interfaz.
  bot.command(["voz", "v"], (ctx) => {
    const [first = "", ...rest] = ctx.match.trim().split(/\s+/);
    const ui = first.toLowerCase() === "ui";
    return runSwitch(
      ctx,
      ui
        ? { key: "voiceEnabled", usage: "/voz ui on o /voz ui off", name: "Voz en la interfaz", states: ["desactivada", "activada"], done: ["🔇 Voz de la interfaz desactivada.", "🔊 Voz de la interfaz activada."] }
        : { key: "telegramVoice", usage: "/voz on, /voz off o /voz ui on|off", name: "Nota de voz en Telegram", states: ["desactivada", "activada"], done: ["🔇 Notas de voz desactivadas: solo texto.", "🔊 Notas de voz activadas: texto y audio."] },
      ui ? rest.join(" ") : first
    );
  });

  bot.command(["modo", "m"], async (ctx) => {
    const arg = ctx.match.trim();
    const wanted = parseMode(arg);
    if (arg && !wanted) return void (await ctx.reply("Uso: /modo r (reactivo) o /modo d (deliberativo). Sin argumento muestra el actual."));
    if (wanted) mode = wanted;
    const text = mode ? MODE_LABEL[mode] : "el del servidor (reactivo)";
    await ctx.reply(wanted ? `Modo ${text}. Vale para las tareas que inicies desde ahora${current ? " (la que está en curso sigue como estaba)" : ""}.` : `Modo de las tareas de Telegram: ${text}.`);
  });

  bot.command(["cancel", "c"], async (ctx) => {
    if (!current) return void (await ctx.reply("No hay tarea en curso."));
    const res = await api.post("/cancel", { taskId: current.taskId });
    if (!res.ok) await ctx.reply(`⚠️ ${res.error}`);
  });

  bot.on("callback_query:data", async (ctx) => {
    const [act, tag] = ctx.callbackQuery.data.split(":");

    if (act === "ao") {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup().catch(() => { });
      if (tag !== "y") return void (await ctx.reply("Modo automático sin cambios."));
      const res = await api.post("/config", { autoMode: true });
      return void (await ctx.reply(res.ok ? "⚡ Modo automático activado. Desactívalo con /auto off." : `⚠️ ${res.error}`));
    }

    const w = current?.waiting;
    if (!current || !w || tagOf(w) !== tag) {
      await ctx.answerCallbackQuery({ text: "Ya no aplica." });
      return;
    }
    const taskId = current.taskId;

    let res: Awaited<ReturnType<typeof api.post>> | null = null;
    if (act === "cx") res = await api.post("/cancel", { taskId });
    else if (w.kind === "plan" || w.kind === "approval") {
      const decision = { taskId, waitId: w.request.id };
      if (w.kind === "plan" && act === "pa") res = await api.post("/confirm-plan", decision);
      else if (w.kind === "plan" && act === "pr") res = await api.post("/reject-plan", decision);
      else if (w.kind === "plan" && act === "pm") {
        awaitingFeedback = true;
        await ctx.reply("✏️ Escribe los cambios que quieres en el plan.");
      } else if (w.kind === "approval" && act === "aa") res = await api.post("/approve", decision);
      else if (w.kind === "approval" && act === "ad") res = await api.post("/deny", decision);
    }

    await ctx.answerCallbackQuery();
    if (res && !res.ok) await ctx.reply(`⚠️ ${res.error}`);
    // Los botones se quitan al llegar el evento de que la espera se resolvió (retirePrompt), no antes: si la API rechazó la decisión siguen vigentes.
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;
    const w = current?.waiting;

    if (current && awaitingFeedback && w?.kind === "plan") {
      awaitingFeedback = false;
      const res = await api.post("/modify-plan", { taskId: current.taskId, waitId: w.request.id, feedback: text });
      await ctx.reply(res.ok ? "✏️ Cambios enviados." : `⚠️ ${res.error}`);
      return;
    }
    if (current && w?.kind === "question") {
      const res = await api.post("/user-answer", { taskId: current.taskId, answer: text });
      if (!res.ok) await ctx.reply(`⚠️ ${res.error}`);
      return;
    }
    if (current || starting) return void (await ctx.reply("Hay una tarea en curso. Usa /cancel para cancelarla."));

    starting = true;
    early.length = 0;
    try {
      const res = await api.post<{ task: { task: { id: string } } }>("/process", { message: text, ...(mode ? { mode } : {}) });
      if (!res.ok) return void (await ctx.reply(`⚠️ ${res.error}`));
      const id = res.data.task.task.id;
      const t = begin(id);
      current = { taskId: id, waiting: null };
      for (const event of early.filter((e) => e.taskId === id)) enqueue(event);
      await flushStatus(t);
    } finally {
      starting = false;
      early.length = 0;
    }
  });

  bot.catch((err) => {
    console.error("[telegram]", err.error);
    void err.ctx.reply("⚠️ Error interno al procesar el mensaje.").catch(() => { });
  });

  // ---------- arranque ----------

  // Las notas de voz necesitan ffmpeg: se avisa al arrancar y no recién con la primera respuesta.
  if (getVoice()) {
    void ffmpegAvailable().then((ok) => {
      if (!ok) console.warn("[telegram] telegramVoice está activo pero no se encuentra ffmpeg: no habrá notas de voz (winget install Gyan.FFmpeg).");
    });
  }

  // Menú de comandos que Telegram ofrece al escribir "/".
  void bot.api.setMyCommands([...BOT_COMMANDS]).catch(() => { /* el menú es una comodidad */ });

  void api.listen(enqueue, abort.signal);
  bot
    // Los mensajes que llegaron con JARVIS apagado se descartan: no deben lanzar tareas viejas al arrancar.
    .start({ drop_pending_updates: true, onStart: (me) => console.log(`[telegram] @${me.username} activo`) })
    .catch((e) => console.error("[telegram] no pudo iniciar (¿token inválido?):", e));

  return () => {
    for (const t of tasks.values()) stopTimers(t);
    abort.abort();
    void bot.stop();
  };
}
