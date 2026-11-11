/**
 * `run_command`: tratamiento de la salida de un proceso.
 *
 * - `OutputDecoder` pasa los bytes a texto. Casi todo lo que corre en la terminal habla UTF-8 (PowerShell con el prólogo, git, node, npm); las herramientas del
 *   sistema de Windows (`ipconfig`, `chcp`, `ping`) escriben en la página OEM (850) o en la ANSI (1252) aunque la consola diga UTF-8. Un tramo que no es UTF-8
 *   válido se decodifica, línea por línea, con la página que da más letras acentuadas (`legacyDecoder`); lo que sí es UTF-8 no se toca.
 * - `cleanTerminalText` quita las secuencias de escape de color y cursor, los retrocesos (`\b`) y los caracteres de control sueltos.
 * - `LineAssembler` arma las líneas de UN flujo: `\r\n` es un salto, un `\r` suelto vuelve al principio de la línea (lo que reescribe una barra de progreso
 *   queda en su última versión) y la línea sin terminar se retiene hasta su salto. Con uno por flujo, stdout y stderr se unen por líneas enteras.
 * - `OutputBuffer` guarda lo que el modelo todavía no leyó con un tope de memoria: el inicio y el final, y cuenta lo omitido en el medio.
 */

import { isUtf8 } from "node:buffer";

import { omissionMarker } from "../../core/text.ts";

// ───────────────────────── Limpieza ─────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, "");

/** Sin escapes ANSI, con los retrocesos aplicados (un indicador giratorio `|\b/\b-` deja su último carácter) y sin otros caracteres de control (salvo `\t`, `\n`, `\r`). */
export function cleanTerminalText(text: string): string {
  let out = stripAnsi(text);
  if (out.includes("\b")) {
    // `x\b` se anula; un `\b` sin nada delante (llegó en otro fragmento) se descarta.
    let previous: string;
    do {
      previous = out;
      out = out.replace(/[^\b\n]\u0008/g, "");
    } while (out !== previous);
  }
  return out.replace(CONTROL, "");
}

// ───────────────────────── Decodificación ─────────────────────────

const hexTable = (hex: string): string => String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));

/** Mitad alta (0x80–0xFF) de las páginas OEM más comunes, tomada de .NET (`Encoding.GetEncoding(n)`). */
const OEM_TABLES: Readonly<Record<number, string>> = {
  437: hexTable(
    "00C700FC00E900E200E400E000E500E700EA00EB00E800EF00EE00EC00C400C500C900E600C600F400F600F200FB00F900FF00D600DC00A200A300A520A7019200E100ED00F300FA00F100D100AA00BA00BF231000AC00BD00BC00A100AB00BB259125922593250225242561256225562555256325512557255D255C255B251025142534252C251C2500253C255E255F255A25542569256625602550256C25672568256425652559255825522553256B256A2518250C25882584258C2590258003B100DF039303C003A303C300B503C403A6039803A903B4221E03C603B52229226100B1226522642320232100F7224800B0221900B7221A207F00B225A000A0",
  ),
  850: hexTable(
    "00C700FC00E900E200E400E000E500E700EA00EB00E800EF00EE00EC00C400C500C900E600C600F400F600F200FB00F900FF00D600DC00F800A300D800D7019200E100ED00F300FA00F100D100AA00BA00BF00AE00AC00BD00BC00A100AB00BB2591259225932502252400C100C200C000A9256325512557255D00A200A5251025142534252C251C2500253C00E300C3255A25542569256625602550256C00A400F000D000CA00CB00C8013100CD00CE00CF2518250C2588258400A600CC258000D300DF00D400D200F500D500B500FE00DE00DA00DB00D900FD00DD00AF00B400AD00B1201700BE00B600A700F700B800B000A800B700B900B300B225A000A0",
  ),
};

type BytesToText = (bytes: Uint8Array) => string;

/** Decodificador de una página de códigos de Windows, o `null` si Node no la conoce (ni hay tabla propia). */
export function codePageDecoder(codePage: number): BytesToText | null {
  const table = OEM_TABLES[codePage];
  if (table !== undefined) {
    return (bytes) => {
      let out = "";
      for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : table[b - 0x80];
      return out;
    };
  }
  const label = codePage === 866 ? "ibm866" : codePage >= 1250 && codePage <= 1258 ? `windows-${codePage}` : codePage === 65001 ? "utf-8" : null;
  if (label === null) return null;
  try {
    const decoder = new TextDecoder(label);
    return (bytes) => decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** Letras latinas acentuadas (À–ÿ salvo × y ÷): cuántas da una decodificación es la señal de que la página es la correcta. */
const ACCENTED = /[À-ÖØ-öø-ÿ]/g;
export const accentScore = (text: string): number => text.match(ACCENTED)?.length ?? 0;

/**
 * Decodificador de un tramo que no es UTF-8: prueba la página OEM y la ANSI del sistema y se queda con la que da más letras acentuadas (`ipconfig` escribe
 * en OEM, `chcp` en ANSI). Empate: OEM (la de casi todas las herramientas de consola). Sin ninguna de las dos, el UTF-8 de siempre (con `�`).
 */
export function legacyDecoder(oem: number, ansi: number): BytesToText {
  const candidates = [codePageDecoder(oem), codePageDecoder(ansi)].filter((d): d is BytesToText => d !== null);
  if (candidates.length === 0) return (bytes) => Buffer.from(bytes).toString("utf8");
  return (bytes) => {
    let best = "";
    let bestScore = -1;
    for (const decode of candidates) {
      const text = decode(bytes);
      const score = accentScore(text);
      if (score > bestScore) {
        best = text;
        bestScore = score;
      }
    }
    return best;
  };
}

/** Dónde empieza una secuencia UTF-8 que quedó a medias al final de `bytes` (para esperar el resto en el fragmento siguiente); `bytes.length` si no hay. */
function incompleteTail(bytes: Uint8Array): number {
  const len = bytes.length;
  for (let i = len - 1; i >= Math.max(0, len - 3); i--) {
    const b = bytes[i];
    if (b >= 0x80 && b <= 0xbf) continue; // byte de continuación: seguir buscando el inicio
    const need = b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
    return need > 0 && len - i < need ? i : len;
  }
  return len;
}

/** Bytes → texto: UTF-8 si lo es; si no, cada línea inválida con `fallback` (las líneas válidas siguen en UTF-8). */
export function decodeBytes(bytes: Uint8Array, fallback: BytesToText): string {
  if (bytes.length === 0) return "";
  if (isUtf8(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
  let out = "";
  let start = 0;
  while (start < bytes.length) {
    const nl = bytes.indexOf(0x0a, start);
    const end = nl < 0 ? bytes.length : nl + 1;
    const line = bytes.subarray(start, end);
    out += isUtf8(line) ? Buffer.from(line).toString("utf8") : fallback(line);
    start = end;
  }
  return out;
}

/** Decodificador de un flujo de bytes: retiene una secuencia UTF-8 partida entre dos fragmentos y decodifica lo demás con `decodeBytes`. */
export class OutputDecoder {
  private carry: Uint8Array = new Uint8Array(0);
  /** Líneas que no eran UTF-8 y se decodificaron con la página heredada (diagnóstico). */
  legacyChunks = 0;

  constructor(private readonly fallback: BytesToText) {}

  write(chunk: Uint8Array): string {
    const data = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    const cut = incompleteTail(data);
    this.carry = cut < data.length ? Uint8Array.from(data.subarray(cut)) : new Uint8Array(0);
    return this.decode(data.subarray(0, cut));
  }

  end(): string {
    const rest = this.carry;
    this.carry = new Uint8Array(0);
    return this.decode(rest);
  }

  private decode(bytes: Uint8Array): string {
    if (bytes.length > 0 && !isUtf8(bytes)) this.legacyChunks++;
    return decodeBytes(bytes, this.fallback);
  }
}

// ───────────────────────── Líneas ─────────────────────────

/** Una línea sin salto que pasa de este largo se entrega tal cual (no se retiene más): no es un prompt y no debe crecer sin tope. */
export const MAX_OPEN_LINE = 64 * 1024;

/**
 * Arma las líneas de un flujo. `push` devuelve lo que ya se puede entregar (líneas completas); la línea abierta se retiene, se consulta con `current`
 * (para detectar un prompt) y se entrega con `flushPartial` cuando hay que devolver la salida antes de su salto.
 */
export class LineAssembler {
  private pendingCr = false;
  private line = "";
  /** Caracteres de `line` que ya se entregaron con `flushPartial`. */
  private flushed = 0;
  /** La línea abierta superó `MAX_OPEN_LINE` y se entregó en partes. */
  private long = false;
  /** Última línea completa no vacía. */
  lastCompleted = "";

  push(text: string): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
      if (this.pendingCr) {
        this.pendingCr = false;
        if (text[i] === "\n") {
          out += this.complete();
          i++;
          continue;
        }
        // `\r` suelto: vuelve al principio de la línea. Si parte de ella ya se entregó, se cierra ahí para no pegarle lo nuevo.
        if (this.flushed > 0) out += "\n";
        this.line = "";
        this.flushed = 0;
      }
      // Tramo sin saltos de un solo golpe (las líneas largas no se recorren carácter por carácter).
      let j = i;
      while (j < text.length && text[j] !== "\r" && text[j] !== "\n") j++;
      if (j > i) {
        this.line += text.slice(i, j);
        if (this.line.length > MAX_OPEN_LINE) {
          out += this.line.slice(this.flushed);
          this.line = "";
          this.flushed = 0;
          this.long = true;
        }
      }
      if (j >= text.length) break;
      if (text[j] === "\n") out += this.complete();
      else this.pendingCr = true;
      i = j + 1;
    }
    return out;
  }

  /** La línea abierta entera (aunque una parte ya se haya entregado). */
  get current(): string {
    return this.line;
  }

  /** ¿La línea abierta es más larga que `MAX_OPEN_LINE`? Entonces no es un prompt. */
  get currentIsLong(): boolean {
    return this.long;
  }

  /** Lo que falta entregar de la línea abierta; queda marcado como entregado. */
  flushPartial(): string {
    const part = this.line.slice(this.flushed);
    this.flushed = this.line.length;
    return part;
  }

  /**
   * La línea abierta se respondió (era un prompt): se entrega lo que faltaba y se da por cerrada, sin agregar un salto. Lo que escriba el proceso después
   * empieza una línea nueva (sin esto, el prompt siguiente de un REPL se leería como `>>> >>>`).
   */
  closeAnswered(): string {
    const part = this.flushPartial();
    if (this.line.trim() !== "") this.lastCompleted = this.line;
    this.line = "";
    this.flushed = 0;
    this.long = false;
    this.pendingCr = false;
    return part;
  }

  /** Fin del flujo: lo que queda sin entregar (un `\r` final es un salto de línea). */
  end(): string {
    const rest = this.line.slice(this.flushed) + (this.pendingCr ? "\n" : "");
    if (this.line.trim() !== "") this.lastCompleted = this.line;
    this.pendingCr = false;
    this.line = "";
    this.flushed = 0;
    return rest;
  }

  private complete(): string {
    const piece = `${this.line.slice(this.flushed)}\n`;
    if (this.line.trim() !== "") this.lastCompleted = this.line;
    this.line = "";
    this.flushed = 0;
    this.long = false;
    return piece;
  }
}

// ───────────────────────── Búfer de lo no leído ─────────────────────────

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
