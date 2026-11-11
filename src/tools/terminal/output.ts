/**
 * `run_command`: tratamiento de la salida de un proceso.
 *
 * - `stripAnsi` quita las secuencias de escape de color y cursor.
 * - `LineNormalizer` unifica los saltos de línea (`\r\n` y `\r` solo pasan a `\n`) aunque un `\r\n` llegue partido entre dos fragmentos.
 * - `OutputBuffer` guarda lo que el modelo todavía no leyó con un tope de memoria: el inicio y el final, y cuenta lo omitido en el medio.
 */

import { omissionMarker } from "../../core/text.ts";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, "");

/** Lleva los saltos de línea a `\n`; recuerda un `\r` final para decidir con el fragmento siguiente si era parte de un `\r\n`. */
export class LineNormalizer {
  private pendingCr = false;

  push(text: string): string {
    let out = "";
    for (const ch of text) {
      if (this.pendingCr) {
        this.pendingCr = false;
        out += "\n";
        if (ch === "\n") continue;
      }
      if (ch === "\r") this.pendingCr = true;
      else out += ch;
    }
    return out;
  }

  /** Lo que queda al terminar el flujo (un `\r` suelto al final es un salto de línea). */
  flush(): string {
    if (!this.pendingCr) return "";
    this.pendingCr = false;
    return "\n";
  }
}

/** Caracteres del inicio y del final que se conservan de lo no leído. El resto se omite y se cuenta. */
export const UNREAD_HEAD_CAP = 500_000;
export const UNREAD_TAIL_CAP = 500_000;

export class OutputBuffer {
  private head = "";
  private tail = "";
  private dropped = 0;

  append(text: string): void {
    if (text.length === 0) return;
    if (this.tail.length === 0 && this.head.length < UNREAD_HEAD_CAP) {
      const room = UNREAD_HEAD_CAP - this.head.length;
      this.head += text.slice(0, room);
      text = text.slice(room);
      if (text.length === 0) return;
    }
    this.tail += text;
    if (this.tail.length > UNREAD_TAIL_CAP * 2) {
      this.dropped += this.tail.length - UNREAD_TAIL_CAP;
      this.tail = this.tail.slice(-UNREAD_TAIL_CAP);
    }
  }

  /** Lo no leído, con el marcador de omisión en el medio si hubo recorte; vacía el búfer. */
  take(): { text: string; omitted: number } {
    let omitted = this.dropped;
    let tail = this.tail;
    if (tail.length > UNREAD_TAIL_CAP) {
      omitted += tail.length - UNREAD_TAIL_CAP;
      tail = tail.slice(-UNREAD_TAIL_CAP);
    }
    const text = omitted > 0 ? `${this.head}\n${omissionMarker(omitted)}\n${tail}` : this.head + tail;
    this.head = "";
    this.tail = "";
    this.dropped = 0;
    return { text, omitted };
  }
}
