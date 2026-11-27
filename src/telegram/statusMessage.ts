/**
 * El mensaje de progreso de una tarea en el chat: un solo mensaje que se edita a medida que la tarea avanza, y el aviso «escribiendo…» mientras trabaja.
 *
 * - Las ediciones se serializan (`lock`) y se espacian: como mucho una cada `intervalMs`, aunque lleguen muchos cambios seguidos (`schedule`).
 * - Un fallo al editar (`message is not modified`, red) se ignora: el siguiente refresco lo corrige.
 * - Al `close()` se detienen los temporizadores y no se programan más refrescos; un `flush` explícito (el título final) sí se puede hacer.
 *
 * Solo conoce cómo enviar y editar texto (`StatusSink`): quién es el bot y el chat lo resuelve `bot.ts`.
 */

import { Progress } from "./progress.ts";

export interface StatusSink {
  /** Envía un mensaje nuevo (HTML) y devuelve su id. */
  send(html: string): Promise<number>;
  edit(messageId: number, html: string): Promise<void>;
  /** Avisa «escribiendo…». */
  typing(): Promise<void>;
}

interface StatusTiming {
  /** Cada cuánto se actualiza, como mucho, el mensaje de progreso. */
  readonly intervalMs: number;
  /** Cada cuánto se repite el aviso «escribiendo…» (en Telegram dura 5 s). */
  readonly typingMs: number;
}

export class StatusMessage {
  readonly progress = new Progress();
  private messageId: number | undefined;
  private lastFlush = 0;
  private dirty = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private typingTimer: ReturnType<typeof setInterval> | undefined;
  /** Serializa las ediciones del mensaje de progreso. */
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: StatusSink,
    private readonly timing: StatusTiming,
  ) {}

  /** Empieza a avisar «escribiendo…» hasta `close()`. */
  startTyping(): void {
    const ping = (): void => void this.sink.typing().catch(() => {});
    ping();
    this.typingTimer = setInterval(ping, this.timing.typingMs);
  }

  /** Escribe el progreso ya (con `header` como título): envía el mensaje la primera vez y lo edita después. */
  flush(header = "⏳ Trabajando…"): Promise<void> {
    this.lock = this.lock.then(async () => {
      this.dirty = false;
      this.lastFlush = Date.now();
      const html = this.progress.render(header);
      try {
        if (this.messageId !== undefined) await this.sink.edit(this.messageId, html);
        else this.messageId = await this.sink.send(html);
      } catch {
        /* "message is not modified" u otro fallo de edición: el siguiente refresco lo corrige */
      }
    });
    return this.lock;
  }

  /** Hubo cambios: se refresca el mensaje a más tardar `intervalMs` después del último refresco, juntando los cambios que lleguen entre tanto. */
  schedule(): void {
    this.dirty = true;
    if (this.timer || this.closed) return;
    const wait = Math.max(0, this.timing.intervalMs - (Date.now() - this.lastFlush));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.dirty && !this.closed) void this.flush();
    }, wait);
  }

  /** Detiene los temporizadores y no programa más refrescos. */
  close(): void {
    this.closed = true;
    this.stopTimers();
  }

  /** Detiene los temporizadores sin cerrar (el servidor se apaga). */
  stopTimers(): void {
    if (this.typingTimer) clearInterval(this.typingTimer);
    if (this.timer) clearTimeout(this.timer);
    this.typingTimer = this.timer = undefined;
  }
}
