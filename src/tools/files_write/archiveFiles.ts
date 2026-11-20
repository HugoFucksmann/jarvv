/**
 * `jarvis_files_write`: herramienta `archive_files`.
 *
 * Comprime y extrae archivos `.zip` en Node.js puro (`node:zlib`) sin dependencias externas:
 * - `compress`: acepta múltiples rutas (`sources`) de archivos y carpetas; valida `allowedDirectories`,
 *   bloquea enlaces simbólicos que escapan de su raíz o de `allowedDirectories`, aplica topes de
 *   entradas/bytes/plazo/`AbortSignal` y escribe de forma atómica vía archivo temporal.
 * - `extract`: valida EOCD y Directorio Central, protege contra Zip Slip (rutas `..`, absolutas,
 *   letras de unidad Windows, bytes NUL y salida del directorio destino) y contra Zip Bombs
 *   controlando entradas totales y bytes reales descomprimidos (nunca confía solo en la cabecera).
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import type { UserEnvironment } from "../../core/environment.ts";
import { canonicalPath } from "../../core/policy/allowedDirs.ts";
import {
  dirnameOf,
  formatSize,
  isCanonicalDescendant,
  isCanonicalWithinAllowedDirs,
  isExcludedSubdir,
  joinEntryPath,
  resolveExistingPath,
  resolvePathTarget,
  yieldEventLoop,
} from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

const deflateRawAsync = promisify(zlib.deflateRaw);
const inflateRawAsync = promisify(zlib.inflateRaw);

export const DEFAULT_ARCHIVE_TIMEOUT_MS = 30_000;
export const DEFAULT_ARCHIVE_MAX_ENTRIES = 10_000;
export const DEFAULT_ARCHIVE_MAX_INPUT_BYTES = 256 * 1024 * 1024;
export const DEFAULT_ARCHIVE_MAX_EXTRACT_BYTES = 512 * 1024 * 1024;
const MAX_SOURCES = 100;
const YIELD_EVERY_ENTRIES = 64;

const VALID_ACTIONS = ["compress", "extract"] as const;
type ArchiveAction = (typeof VALID_ACTIONS)[number];

export interface ArchiveFilesDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly now: () => number;
  readonly defaultTimeoutMs?: number;
  readonly maxEntries?: number;
  readonly maxInputBytes?: number;
  readonly maxExtractBytes?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

// ───────────────────────── CRC32 & DOS Date/Time ─────────────────────────

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(mtime: Date): { readonly dosTime: number; readonly dosDate: number } {
  const year = Math.min(Math.max(mtime.getFullYear(), 1980), 2107);
  const month = mtime.getMonth() + 1;
  const day = mtime.getDate();
  const hours = mtime.getHours();
  const mins = mtime.getMinutes();
  const secs = Math.floor(mtime.getSeconds() / 2);
  const dosTime = (hours << 11) | (mins << 5) | secs;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

// ───────────────────────── ZIP Writer ─────────────────────────

interface ZipBuildEntry {
  readonly zipName: string; // POSIX relative path, trailing '/' for directories
  readonly isDir: boolean;
  readonly uncompressed: Buffer;
  readonly mtime: Date;
}

interface CentralRecord {
  readonly nameBuf: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly externalAttrs: number;
  readonly localHeaderOffset: number;
}

async function writeZipArchive(
  tempPath: string,
  entries: readonly ZipBuildEntry[],
  signal?: AbortSignal,
): Promise<{ readonly totalUncompressedBytes: number; readonly entryCount: number }> {
  const fd = await fs.promises.open(tempPath, "wx");
  const centralRecords: CentralRecord[] = [];
  let offset = 0;
  let totalUncompressedBytes = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      if (signal?.aborted) throw new Error("Archive operation cancelled");
      if (i > 0 && i % YIELD_EVERY_ENTRIES === 0) await yieldEventLoop();

      const entry = entries[i];
      const nameBuf = Buffer.from(entry.zipName, "utf8");
      const { dosTime, dosDate } = toDosDateTime(entry.mtime);

      let method = 0; // Store
      let payload = entry.uncompressed;
      let entryCrc = 0;

      if (!entry.isDir) {
        totalUncompressedBytes += entry.uncompressed.length;
        entryCrc = crc32(entry.uncompressed);
        if (entry.uncompressed.length > 0) {
          const deflated = await deflateRawAsync(entry.uncompressed, { level: 6 });
          if (deflated.length < entry.uncompressed.length) {
            method = 8; // Deflate
            payload = deflated;
          }
        }
      }

      // Local file header (30 bytes + name)
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4); // version needed: 2.0
      localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
      localHeader.writeUInt16LE(method, 8);
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(entryCrc, 14);
      localHeader.writeUInt32LE(payload.length, 18);
      localHeader.writeUInt32LE(entry.uncompressed.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28); // extra len

      const localHeaderOffset = offset;
      await fd.write(localHeader);
      await fd.write(nameBuf);
      if (payload.length > 0) await fd.write(payload);

      offset += 30 + nameBuf.length + payload.length;

      centralRecords.push({
        nameBuf,
        method,
        crc: entryCrc,
        compressedSize: payload.length,
        uncompressedSize: entry.uncompressed.length,
        dosTime,
        dosDate,
        externalAttrs: entry.isDir ? 0x10 : 0,
        localHeaderOffset,
      });
    }

    const centralStartOffset = offset;
    let centralSize = 0;

    for (const rec of centralRecords) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0x0800, 8); // UTF-8 flag
      cd.writeUInt16LE(rec.method, 10);
      cd.writeUInt16LE(rec.dosTime, 12);
      cd.writeUInt16LE(rec.dosDate, 14);
      cd.writeUInt32LE(rec.crc, 16);
      cd.writeUInt32LE(rec.compressedSize, 20);
      cd.writeUInt32LE(rec.uncompressedSize, 24);
      cd.writeUInt16LE(rec.nameBuf.length, 28);
      cd.writeUInt16LE(0, 30); // extra len
      cd.writeUInt16LE(0, 32); // comment len
      cd.writeUInt16LE(0, 34); // disk number start
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(rec.externalAttrs, 38);
      cd.writeUInt32LE(rec.localHeaderOffset, 42);

      await fd.write(cd);
      await fd.write(rec.nameBuf);
      centralSize += 46 + rec.nameBuf.length;
    }

    // End of Central Directory (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk with central dir
    eocd.writeUInt16LE(centralRecords.length, 8);
    eocd.writeUInt16LE(centralRecords.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStartOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment length
    await fd.write(eocd);

    return { totalUncompressedBytes, entryCount: centralRecords.length };
  } finally {
    await fd.close();
  }
}

// ───────────────────────── ZIP Reader & Safe Extractor ─────────────────────────

interface ParsedCentralEntry {
  readonly rawName: string;
  readonly method: number;
  readonly flags: number;
  readonly expectedCrc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly isDir: boolean;
}

function findEocdOffset(zipBuf: Buffer): number {
  const minOffset = Math.max(0, zipBuf.length - 22 - 65_535);
  for (let i = zipBuf.length - 22; i >= minOffset; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      const commentLen = zipBuf.readUInt16LE(i + 20);
      if (i + 22 + commentLen === zipBuf.length) {
        return i;
      }
    }
  }
  return -1;
}

function parseCentralDirectory(zipBuf: Buffer, maxEntries: number): ParsedCentralEntry[] {
  if (zipBuf.length < 22) {
    throw new Error("File is too small to be a valid ZIP archive.");
  }
  const eocdOffset = findEocdOffset(zipBuf);
  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: End of Central Directory signature not found.");
  }

  const diskNo = zipBuf.readUInt16LE(eocdOffset + 4);
  const cdDiskNo = zipBuf.readUInt16LE(eocdOffset + 6);
  const entryCount = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuf.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  if (diskNo !== 0 || cdDiskNo !== 0) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported yet.");
  }
  if (entryCount > maxEntries) {
    throw new Error(`ZIP archive has ${entryCount} entries, exceeding maxEntries limit (${maxEntries}).`);
  }
  if (cdOffset + cdSize > eocdOffset) {
    throw new Error("Corrupted ZIP archive: Central Directory extends past EOCD.");
  }

  const entries: ParsedCentralEntry[] = [];
  let cursor = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > cdOffset + cdSize) {
      throw new Error("Corrupted ZIP archive: truncated Central Directory entry.");
    }
    if (zipBuf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Corrupted ZIP archive: invalid Central Directory entry signature.");
    }

    const flags = zipBuf.readUInt16LE(cursor + 8);
    const method = zipBuf.readUInt16LE(cursor + 10);
    const expectedCrc = zipBuf.readUInt32LE(cursor + 16);
    const compressedSize = zipBuf.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuf.readUInt32LE(cursor + 24);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const externalAttrs = zipBuf.readUInt32LE(cursor + 38);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);

    const nameStart = cursor + 46;
    const nextCursor = nameStart + nameLen + extraLen + commentLen;
    if (nextCursor > cdOffset + cdSize) {
      throw new Error("Corrupted ZIP archive: Central Directory entry overflows bounds.");
    }

    const encoding: BufferEncoding = (flags & 0x0800) !== 0 ? "utf8" : "latin1";
    const rawName = zipBuf.subarray(nameStart, nameStart + nameLen).toString(encoding);
    const isDir = rawName.endsWith("/") || (externalAttrs & 0x10) !== 0;

    entries.push({
      rawName,
      method,
      flags,
      expectedCrc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDir,
    });
    cursor = nextCursor;
  }

  return entries;
}

/** Valida que el nombre dentro del ZIP no intente escape de ruta (Zip Slip). */
function sanitizeZipEntryRelPath(rawName: string): string {
  if (rawName.includes("\0")) {
    throw new Error(`Unsafe ZIP entry name containing NUL byte.`);
  }
  const normalizedSlashes = rawName.replace(/\\/g, "/");
  if (normalizedSlashes.startsWith("/") || /^[A-Za-z]:/.test(normalizedSlashes)) {
    throw new Error(`[DENIED] Unsafe absolute ZIP entry path: '${rawName}'.`);
  }
  const parts = normalizedSlashes.split("/").filter((seg) => seg !== "" && seg !== ".");
  for (const seg of parts) {
    if (seg === "..") {
      throw new Error(`[DENIED] ZIP path traversal detected in entry '${rawName}'.`);
    }
  }
  if (parts.length === 0) return "";
  return parts.join("/");
}

async function extractZipEntries(params: {
  readonly zipBuf: Buffer;
  readonly entries: readonly ParsedCentralEntry[];
  readonly destinationDir: string;
  readonly overwrite: boolean;
  readonly maxExtractBytes: number;
  readonly now: () => number;
  readonly deadline: number;
  readonly signal?: AbortSignal;
}): Promise<{ readonly filesExtracted: number; readonly dirsCreated: number; readonly bytesExtracted: number }> {
  const { zipBuf, entries, destinationDir, overwrite, maxExtractBytes, now, deadline, signal } = params;

  await fs.promises.mkdir(destinationDir, { recursive: true });
  const realDest = await fs.promises.realpath(destinationDir);

  let filesExtracted = 0;
  let dirsCreated = 0;
  let bytesExtracted = 0;

  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) throw new Error("Archive operation cancelled");
    if (now() >= deadline) throw new Error(`Extraction timed out after ${filesExtracted} file(s).`);
    if (i > 0 && i % YIELD_EVERY_ENTRIES === 0) await yieldEventLoop();

    const entry = entries[i];
    if ((entry.flags & 0x0001) !== 0) {
      throw new Error(`Encrypted ZIP entry '${entry.rawName}' is not supported.`);
    }

    const relPosix = sanitizeZipEntryRelPath(entry.rawName);
    if (relPosix === "") continue;

    const targetPath = path.join(realDest, ...relPosix.split("/"));
    const resolvedCheck = path.resolve(targetPath);
    if (!isCanonicalDescendant(realDest, resolvedCheck) || resolvedCheck === realDest) {
      throw new Error(`[DENIED] ZIP entry escapes destination folder: '${entry.rawName}'.`);
    }

    if (entry.isDir) {
      await fs.promises.mkdir(resolvedCheck, { recursive: true });
      dirsCreated++;
      continue;
    }

    if (entry.localHeaderOffset + 30 > zipBuf.length) {
      throw new Error(`Corrupted ZIP entry '${entry.rawName}': invalid local header offset.`);
    }
    if (zipBuf.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Corrupted ZIP entry '${entry.rawName}': invalid local header signature.`);
    }

    const localNameLen = zipBuf.readUInt16LE(entry.localHeaderOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > zipBuf.length) {
      throw new Error(`Corrupted ZIP entry '${entry.rawName}': compressed payload out of bounds.`);
    }

    if (bytesExtracted + entry.uncompressedSize > maxExtractBytes) {
      throw new Error(`Extraction exceeded maximum allowed size (${formatSize(maxExtractBytes)}).`);
    }

    const compressedSlice = zipBuf.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (entry.method === 0) {
      data = compressedSlice;
    } else if (entry.method === 8) {
      data = await inflateRawAsync(compressedSlice, {
        maxOutputLength: Math.max(maxExtractBytes - bytesExtracted, 0) + 1,
      });
    } else {
      throw new Error(`Unsupported ZIP compression method (${entry.method}) for '${entry.rawName}'.`);
    }

    if (bytesExtracted + data.length > maxExtractBytes) {
      throw new Error(`Extraction exceeded maximum allowed size (${formatSize(maxExtractBytes)}).`);
    }
    if (crc32(data) !== entry.expectedCrc) {
      throw new Error(`CRC32 mismatch extracting '${entry.rawName}'.`);
    }

    await fs.promises.mkdir(path.dirname(resolvedCheck), { recursive: true });
    // Asegurar que ningún ancestro existente escape mediante symlink
    const realParent = await fs.promises.realpath(path.dirname(resolvedCheck));
    if (!isCanonicalDescendant(realDest, realParent)) {
      throw new Error(`[DENIED] Parent folder of '${entry.rawName}' resolves outside destination.`);
    }

    await fs.promises.writeFile(resolvedCheck, data, { flag: overwrite ? "w" : "wx" });
    filesExtracted++;
    bytesExtracted += data.length;
  }

  return { filesExtracted, dirsCreated, bytesExtracted };
}

// ───────────────────────── Collect Inputs for Compress ─────────────────────────

async function collectCompressEntries(params: {
  readonly sources: readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly allowedDirs: readonly string[];
  readonly destinationCanon: string;
  readonly includeHidden: boolean;
  readonly maxEntries: number;
  readonly maxInputBytes: number;
  readonly now: () => number;
  readonly deadline: number;
  readonly signal?: AbortSignal;
}): Promise<{ readonly ok: true; readonly entries: readonly ZipBuildEntry[] } | { readonly ok: false; readonly denied?: boolean; readonly cancelled?: boolean; readonly message: string }> {
  const { sources, getEnvironment, allowedDirs, destinationCanon, includeHidden, maxEntries, maxInputBytes, now, deadline, signal } = params;
  const collected: ZipBuildEntry[] = [];
  const usedNames = new Set<string>();
  let totalBytes = 0;

  for (const rawSource of sources) {
    if (signal?.aborted) return { ok: false, cancelled: true, message: "cancelled" };

    const resolved = await resolveExistingPath(rawSource, getEnvironment, allowedDirs, {
      expectedKind: "any",
      followSymlinkForAllowedCheck: true,
      paramName: "sources",
    });
    if (!resolved.ok) {
      return { ok: false, denied: resolved.denied, message: resolved.message };
    }

    if (resolved.isDirectory && isCanonicalDescendant(resolved.realTarget, destinationCanon)) {
      return {
        ok: false,
        message: `Destination archive '${destinationCanon}' cannot be inside source folder '${resolved.targetPath}'.`,
      };
    }

    const baseName = path.basename(resolved.targetPath);
    if (!resolved.isDirectory) {
      if (collected.length + 1 > maxEntries) {
        return { ok: false, message: `Archive exceeded maxEntries limit (${maxEntries}).` };
      }
      if (totalBytes + resolved.size > maxInputBytes) {
        return { ok: false, message: `Archive input exceeded maxBytes limit (${formatSize(maxInputBytes)}).` };
      }
      if (usedNames.has(baseName)) {
        return { ok: false, message: `Duplicate entry name '${baseName}' in sources.` };
      }
      usedNames.add(baseName);
      const buf = await fs.promises.readFile(resolved.realTarget);
      const st = await fs.promises.stat(resolved.realTarget);
      collected.push({ zipName: baseName, isDir: false, uncompressed: buf, mtime: st.mtime });
      totalBytes += buf.length;
      continue;
    }

    const realRoot = resolved.realTarget;
    const visitedDirs = new Set<string>([realRoot]);
    const queue: Array<{ readonly dirPath: string; readonly zipPrefix: string }> = [
      { dirPath: resolved.targetPath, zipPrefix: `${baseName}/` },
    ];
    if (!usedNames.has(`${baseName}/`)) {
      usedNames.add(`${baseName}/`);
      const rootSt = await fs.promises.stat(realRoot);
      collected.push({ zipName: `${baseName}/`, isDir: true, uncompressed: Buffer.alloc(0), mtime: rootSt.mtime });
    }

    for (let qi = 0; qi < queue.length; qi++) {
      if (signal?.aborted) return { ok: false, cancelled: true, message: "cancelled" };
      if (now() >= deadline) return { ok: false, message: "Compression timed out while scanning source folders." };

      const current = queue[qi];
      const dirEntries = await fs.promises.readdir(current.dirPath, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (signal?.aborted) return { ok: false, cancelled: true, message: "cancelled" };
        if (now() >= deadline) return { ok: false, message: "Compression timed out while scanning source folders." };
        if (!includeHidden && entry.name.startsWith(".")) continue;

        const fullPath = joinEntryPath(current.dirPath, entry.name);
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        let realTarget = fullPath;

        if (entry.isSymbolicLink()) {
          realTarget = await fs.promises.realpath(fullPath);
          if (!isCanonicalDescendant(realRoot, realTarget) || !isCanonicalWithinAllowedDirs(realTarget, allowedDirs, resolved.env.home)) {
            return {
              ok: false,
              denied: true,
              message: `[DENIED] Symbolic link '${fullPath}' points outside source tree or allowedDirectories.`,
            };
          }
          const st = await fs.promises.stat(realTarget);
          isDir = st.isDirectory();
          isFile = st.isFile();
        }

        if (isDir) {
          if (isExcludedSubdir(entry.name, fullPath)) continue;
          if (visitedDirs.has(realTarget)) continue;
          visitedDirs.add(realTarget);
          if (collected.length + 1 > maxEntries) {
            return { ok: false, message: `Archive exceeded maxEntries limit (${maxEntries}).` };
          }
          const zipDirName = `${current.zipPrefix}${entry.name}/`;
          const st = await fs.promises.stat(realTarget);
          usedNames.add(zipDirName);
          collected.push({ zipName: zipDirName, isDir: true, uncompressed: Buffer.alloc(0), mtime: st.mtime });
          queue.push({ dirPath: fullPath, zipPrefix: zipDirName });
        } else if (isFile) {
          if (collected.length + 1 > maxEntries) {
            return { ok: false, message: `Archive exceeded maxEntries limit (${maxEntries}).` };
          }
          const st = await fs.promises.stat(realTarget);
          if (totalBytes + st.size > maxInputBytes) {
            return { ok: false, message: `Archive input exceeded maxBytes limit (${formatSize(maxInputBytes)}).` };
          }
          const zipFileName = `${current.zipPrefix}${entry.name}`;
          if (usedNames.has(zipFileName)) continue;
          usedNames.add(zipFileName);
          const buf = await fs.promises.readFile(realTarget);
          totalBytes += buf.length;
          collected.push({ zipName: zipFileName, isDir: false, uncompressed: buf, mtime: st.mtime });
        }

        if (collected.length % YIELD_EVERY_ENTRIES === 0) await yieldEventLoop();
      }
    }
  }

  return { ok: true, entries: collected };
}

// ───────────────────────── Public Entry Point ─────────────────────────

export async function runArchiveFiles(
  rawArgs: Record<string, unknown>,
  deps: ArchiveFilesDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.action !== "string" || !(VALID_ACTIONS as readonly string[]).includes(rawArgs.action)) {
    return fail(`'action' is required and must be one of: ${VALID_ACTIONS.join(", ")}.`);
  }
  const action = rawArgs.action as ArchiveAction;

  let overwrite = false;
  if (rawArgs.overwrite !== undefined && rawArgs.overwrite !== null) {
    if (typeof rawArgs.overwrite !== "boolean") return fail("'overwrite' must be true or false.");
    overwrite = rawArgs.overwrite;
  }

  let includeHidden = false;
  if (rawArgs.includeHidden !== undefined && rawArgs.includeHidden !== null) {
    if (typeof rawArgs.includeHidden !== "boolean") return fail("'includeHidden' must be true or false.");
    includeHidden = rawArgs.includeHidden;
  }

  const defaultTimeout = deps.defaultTimeoutMs ?? DEFAULT_ARCHIVE_TIMEOUT_MS;
  const limitMs =
    options.timeoutMs !== undefined
      ? Math.min(defaultTimeout, Math.max(options.timeoutMs > 2_000 ? options.timeoutMs - 1_500 : options.timeoutMs, 1))
      : defaultTimeout;
  const deadline = deps.now() + limitMs;
  const maxEntries = deps.maxEntries ?? DEFAULT_ARCHIVE_MAX_ENTRIES;
  const maxInputBytes = deps.maxInputBytes ?? DEFAULT_ARCHIVE_MAX_INPUT_BYTES;
  const maxExtractBytes = deps.maxExtractBytes ?? DEFAULT_ARCHIVE_MAX_EXTRACT_BYTES;
  const allowedDirs = deps.getAllowedDirectories();

  if (action === "compress") {
    if (!Array.isArray(rawArgs.sources) || rawArgs.sources.length === 0) {
      return fail("'sources' is required when action is 'compress' (non-empty array of file/folder paths).");
    }
    if (rawArgs.sources.length > MAX_SOURCES) {
      return fail(`'sources' supports at most ${MAX_SOURCES} entries.`);
    }
    const sources: string[] = [];
    for (let i = 0; i < rawArgs.sources.length; i++) {
      const s = rawArgs.sources[i];
      if (typeof s !== "string" || s.trim() === "") {
        return fail(`sources[${i}] must be a non-empty path string.`);
      }
      sources.push(s.trim());
    }
    if (typeof rawArgs.destination !== "string" || rawArgs.destination.trim() === "") {
      return fail("'destination' is required: output .zip file path.");
    }

    const dstResolved = await resolvePathTarget(rawArgs.destination, deps.getEnvironment, allowedDirs, {
      allowEmptyAsHome: false,
      paramName: "destination",
    });
    if (!dstResolved.ok) {
      return fail(dstResolved.message, dstResolved.denied ? { reason: "denied" } : {});
    }

    const dstPath = dstResolved.targetPath;
    if (!dstPath.toLowerCase().endsWith(".zip")) {
      return fail(`Only '.zip' archives are supported for 'destination' (got '${dstPath}').`);
    }

    const parentDir = dirnameOf(dstPath);
    try {
      const parentStat = await fs.promises.stat(parentDir);
      if (!parentStat.isDirectory()) return fail(`Destination parent '${parentDir}' is not a folder.`);
    } catch {
      return fail(`Destination parent folder does not exist: '${parentDir}'.`);
    }

    try {
      const dstLst = await fs.promises.lstat(dstPath);
      if (dstLst.isSymbolicLink()) {
        const realDst = await fs.promises.realpath(dstPath);
        if (!isCanonicalWithinAllowedDirs(realDst, allowedDirs, dstResolved.env.home)) {
          return fail(`[DENIED] Destination symlink '${dstPath}' points outside allowedDirectories.`, {
            reason: "denied",
          });
        }
      }
      const dstStat = await fs.promises.stat(dstPath);
      if (dstStat.isDirectory()) return fail(`Destination '${dstPath}' is a folder, not a file.`);
      if (!overwrite) {
        return fail(`Destination archive already exists: '${dstPath}'. Pass overwrite: true to replace.`, {
          reason: "already_exists",
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return fail(`Cannot inspect destination '${dstPath}': ${errorMessage(error)}`);
      }
    }

    const gathered = await collectCompressEntries({
      sources,
      getEnvironment: deps.getEnvironment,
      allowedDirs,
      destinationCanon: canonicalPath(dstPath),
      includeHidden,
      maxEntries,
      maxInputBytes,
      now: deps.now,
      deadline,
      signal: options.signal,
    });
    if (!gathered.ok) {
      if (gathered.cancelled) return cancelledResult();
      return fail(gathered.message, gathered.denied ? { reason: "denied" } : {});
    }

    const tempZip = `${dstPath}.jarvis-zip-${process.pid}-${Date.now()}.tmp`;
    try {
      const written = await writeZipArchive(tempZip, gathered.entries, options.signal);
      if (options.signal?.aborted) return cancelledResult();
      await fs.promises.rename(tempZip, dstPath);
      const outStat = await fs.promises.stat(dstPath);

      const text = `status: ok · compressed ${written.entryCount} entry(ies) (${formatSize(written.totalUncompressedBytes)} -> ${formatSize(outStat.size)}) into ${dstPath}`;
      return toolResult({
        text,
        raw: text,
        data: {
          state: "ok",
          action: "compress",
          destination: dstPath,
          entries: written.entryCount,
          uncompressedBytes: written.totalUncompressedBytes,
          archiveBytes: outStat.size,
          truncated: false,
        },
      });
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return fail(`Compression failed: ${errorMessage(error)}`);
    } finally {
      await fs.promises.rm(tempZip, { force: true }).catch(() => {});
    }
  }

  // action === "extract"
  if (typeof rawArgs.source !== "string" || rawArgs.source.trim() === "") {
    return fail("'source' is required when action is 'extract': existing .zip file path.");
  }
  if (typeof rawArgs.destination !== "string" || rawArgs.destination.trim() === "") {
    return fail("'destination' is required when action is 'extract': target folder path.");
  }

  const srcResolved = await resolveExistingPath(rawArgs.source, deps.getEnvironment, allowedDirs, {
    expectedKind: "file",
    followSymlinkForAllowedCheck: true,
    paramName: "source",
  });
  if (!srcResolved.ok) {
    return fail(srcResolved.message, {
      ...(srcResolved.denied ? { reason: "denied" } : srcResolved.notFound ? { reason: "not_found" } : {}),
    });
  }
  if (srcResolved.size > maxExtractBytes) {
    return fail(`Archive '${srcResolved.targetPath}' exceeds maximum allowed size (${formatSize(maxExtractBytes)}).`);
  }

  const dstResolved = await resolvePathTarget(rawArgs.destination, deps.getEnvironment, allowedDirs, {
    allowEmptyAsHome: false,
    paramName: "destination",
  });
  if (!dstResolved.ok) {
    return fail(dstResolved.message, dstResolved.denied ? { reason: "denied" } : {});
  }

  try {
    const dstLst = await fs.promises.lstat(dstResolved.targetPath);
    if (dstLst.isSymbolicLink()) {
      const realDst = await fs.promises.realpath(dstResolved.targetPath);
      if (!isCanonicalWithinAllowedDirs(realDst, allowedDirs, dstResolved.env.home)) {
        return fail(`[DENIED] Destination symlink '${dstResolved.targetPath}' points outside allowedDirectories.`, {
          reason: "denied",
        });
      }
    }
    const dstStat = await fs.promises.stat(dstResolved.targetPath);
    if (!dstStat.isDirectory()) {
      return fail(`Destination '${dstResolved.targetPath}' is a file, not a folder.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return fail(`Cannot inspect destination '${dstResolved.targetPath}': ${errorMessage(error)}`);
    }
  }

  try {
    const zipBuf = await fs.promises.readFile(srcResolved.realTarget);
    if (options.signal?.aborted) return cancelledResult();
    const entries = parseCentralDirectory(zipBuf, maxEntries);
    const extracted = await extractZipEntries({
      zipBuf,
      entries,
      destinationDir: dstResolved.targetPath,
      overwrite,
      maxExtractBytes,
      now: deps.now,
      deadline,
      signal: options.signal,
    });
    if (options.signal?.aborted) return cancelledResult();

    const text = `status: ok · extracted ${extracted.filesExtracted} file(s) and ${extracted.dirsCreated} folder(s) (${formatSize(extracted.bytesExtracted)}) to ${dstResolved.targetPath}`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        action: "extract",
        source: srcResolved.targetPath,
        destination: dstResolved.targetPath,
        filesExtracted: extracted.filesExtracted,
        dirsCreated: extracted.dirsCreated,
        bytesExtracted: extracted.bytesExtracted,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    const msg = errorMessage(error);
    return fail(msg, {
      ...(msg.startsWith("[DENIED]") ? { reason: "denied" } : (error as NodeJS.ErrnoException).code === "EEXIST" ? { reason: "already_exists" } : {}),
    });
  }
}
