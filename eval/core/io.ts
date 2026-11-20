/**
 * eval/core/io.ts
 *
 * Primitivos de E/S compartidos para `eval/`: escrituras atómicas (tmp + rename)
 * y lectura línea por línea en streaming de archivos JSONL sin cargar el archivo completo en RAM.
 */

import { closeSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync, createReadStream } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";

const CHUNK_BYTES = 64 * 1024;

/**
 * Escribe un archivo de texto de forma atómica vía archivo temporal en el mismo directorio y `renameSync`.
 * Si falla antes de reemplazar el destino, limpia el temporal.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

/**
 * Recorre un archivo línea a línea de forma síncrona por chunks acotados (sin `readFileSync` completo),
 * quitando BOM UTF-8 en la línea 1 y `\r` en CRLF. Preserva números de línea exactos (1-indexed).
 */
export function forEachJsonlLineSync(
  filePath: string,
  onLine: (line: string, lineNo: number) => void,
  onChunk?: (chunk: Buffer) => void,
): void {
  const fd = openSync(filePath, "r");
  const buf = Buffer.allocUnsafe(CHUNK_BYTES);
  const decoder = new StringDecoder("utf8");
  let carry = "";
  let lineNo = 0;

  const emit = (rawLine: string): void => {
    lineNo++;
    let line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (lineNo === 1 && line.startsWith("\uFEFF")) line = line.slice(1);
    onLine(line, lineNo);
  };

  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK_BYTES, null);
      if (n === 0) break;
      const slice = buf.subarray(0, n);
      onChunk?.(slice);
      carry += decoder.write(slice);
      let start = 0;
      for (;;) {
        const nl = carry.indexOf("\n", start);
        if (nl === -1) break;
        emit(carry.slice(start, nl));
        start = nl + 1;
      }
      if (start > 0) carry = carry.slice(start);
    }
    carry += decoder.end();
    if (carry.length > 0 || lineNo === 0) {
      // Equivalente a split(/\r?\n/): la línea final después del último '\n' (salvo archivo vacío tras trailing newline).
      if (carry.length > 0) emit(carry);
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Recorre un archivo línea a línea en streaming asíncrono (`readline`), quitando BOM en la línea 1.
 */
export async function forEachJsonlLineAsync(
  filePath: string,
  onLine: (line: string, lineNo: number) => Promise<void> | void,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const raw of rl) {
      lineNo++;
      const line = lineNo === 1 && raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
      await onLine(line, lineNo);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}
