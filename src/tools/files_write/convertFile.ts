/**
 * `jarvis_files_write`: herramienta `convert_file`.
 *
 * Convierte y redimensiona imágenes, audio y video mediante driver inyectable (`ConvertDriver`):
 * - Valida origen y destino contra `allowedDirectories` y enlaces simbólicos salientes.
 * - Impide conversiones sin sentido entre categorías incompatibles (p. ej. audio -> imagen),
 *   permitiendo extraer audio o GIF desde video.
 * - Driver por defecto invoca `ffmpeg` sin shell (argumentos en arreglo) con límite de tiempo,
 *   `AbortSignal` y limpieza garantizada en `finally`; para imágenes básicas en Windows cae en
 *   `System.Drawing` por PowerShell (variables de entorno) si no hay `ffmpeg` instalado.
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { UserEnvironment } from "../../core/environment.ts";
import {
  dirnameOf,
  effectiveTimeoutMs,
  formatSize,
  inspectDestinationTarget,
  joinEntryPath,
  resolveExistingPath,
  resolvePathTarget,
  pathFailureData,
  type ResolvedExistingTarget,
  type ResolvedTarget,
} from "../../core/tools/filePaths.ts";
import { cancelledResult, toolResult, toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_CONVERT_TIMEOUT_MS = 60_000;
const MAX_DIMENSION = 16_384;
const MAX_STDERR_BYTES = 64 * 1024;

const IMAGE_EXTS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "ico", "avif"]);
const AUDIO_EXTS: ReadonlySet<string> = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "opus", "wma"]);
const VIDEO_EXTS: ReadonlySet<string> = new Set(["mp4", "mkv", "webm", "mov", "avi"]);

type MediaCategory = "image" | "audio" | "video";

export interface ConvertRequest {
  readonly sourcePath: string;
  readonly realSourcePath: string;
  readonly destinationPath: string;
  readonly sourceExt: string;
  readonly targetExt: string;
  readonly sourceCategory: MediaCategory;
  readonly targetCategory: MediaCategory;
  readonly width?: number;
  readonly height?: number;
  readonly quality?: number;
  readonly overwrite: boolean;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ConvertResultInfo {
  readonly backend: string;
  readonly details?: string;
}

export interface ConvertDriver {
  convert(req: ConvertRequest): Promise<ConvertResultInfo>;
}

interface ConvertFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly driver?: ConvertDriver;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
}

function detectMediaCategory(ext: string): MediaCategory | undefined {
  const clean = ext.replace(/^\./, "").toLowerCase();
  if (IMAGE_EXTS.has(clean)) return "image";
  if (AUDIO_EXTS.has(clean)) return "audio";
  if (VIDEO_EXTS.has(clean)) return "video";
  return undefined;
}

function isConversionAllowed(source: MediaCategory, target: MediaCategory, targetExt: string): boolean {
  if (source === target) return true;
  if (source === "video" && (target === "audio" || (target === "image" && targetExt === "gif"))) return true;
  return false;
}

function buildFfmpegArgs(req: ConvertRequest): string[] {
  const args: string[] = ["-nostdin", "-hide_banner", "-loglevel", "error"];
  args.push(req.overwrite ? "-y" : "-n");
  args.push("-i", req.realSourcePath);

  if (req.sourceCategory === "video" && req.targetCategory === "audio") {
    args.push("-vn");
  }

  if (req.width !== undefined || req.height !== undefined) {
    const w = req.width ?? -2;
    const h = req.height ?? -2;
    args.push("-vf", `scale=${w}:${h}`);
  }

  if (req.quality !== undefined) {
    if (req.targetCategory === "image") {
      // Escala aproximada de calidad 1..100 para ffmpeg qscale/compression
      const q = Math.max(1, Math.min(31, Math.round(((100 - req.quality) / 100) * 30) + 1));
      args.push("-q:v", String(q));
    } else if (req.targetCategory === "audio" && (req.targetExt === "mp3" || req.targetExt === "ogg")) {
      const bitrateK = Math.max(64, Math.min(320, Math.round(64 + (req.quality / 100) * 256)));
      args.push("-b:a", `${bitrateK}k`);
    }
  }

  args.push(req.destinationPath);
  return args;
}

function runProcess(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Conversion cancelled"));
      return;
    }

    const child = spawn(command, [...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (onAbort !== undefined && signal !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
      child.stderr.destroy();
    };

    const failWith = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      failWith(new Error(`Conversion timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    const onAbort = signal
      ? () => {
          try {
            child.kill();
          } catch {
            // ignore
          }
          failWith(new Error("Conversion cancelled"));
        }
      : undefined;

    if (onAbort !== undefined && signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stderr.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      const slice = c.length + stderrBytes > MAX_STDERR_BYTES ? c.subarray(0, MAX_STDERR_BYTES - stderrBytes) : c;
      stderrChunks.push(slice);
      stderrBytes += slice.length;
    });
    child.on("error", (err) => failWith(err));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

const WINDOWS_IMAGE_FALLBACK_EXTS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "bmp", "gif", "tiff"]);

const PS_IMAGE_CONVERT = [
  "Add-Type -AssemblyName System.Drawing",
  "$src = [System.Drawing.Image]::FromFile($env:JARVIS_CONVERT_SRC)",
  "try {",
  "  $w = [int]$env:JARVIS_CONVERT_W; $h = [int]$env:JARVIS_CONVERT_H",
  "  if ($w -le 0 -and $h -le 0) { $w = $src.Width; $h = $src.Height }",
  "  elseif ($w -le 0) { $w = [Math]::Max(1, [int][Math]::Round($src.Width * ($h / [double]$src.Height))) }",
  "  elseif ($h -le 0) { $h = [Math]::Max(1, [int][Math]::Round($src.Height * ($w / [double]$src.Width))) }",
  "  $bmp = New-Object System.Drawing.Bitmap($w, $h)",
  "  $g = [System.Drawing.Graphics]::FromImage($bmp)",
  "  try { $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g.DrawImage($src, 0, 0, $w, $h) } finally { $g.Dispose() }",
  "  $fmt = switch ($env:JARVIS_CONVERT_EXT) {",
  "    'png' { [System.Drawing.Imaging.ImageFormat]::Png }",
  "    'bmp' { [System.Drawing.Imaging.ImageFormat]::Bmp }",
  "    'gif' { [System.Drawing.Imaging.ImageFormat]::Gif }",
  "    'tiff' { [System.Drawing.Imaging.ImageFormat]::Tiff }",
  "    default { [System.Drawing.Imaging.ImageFormat]::Jpeg }",
  "  }",
  "  $bmp.Save($env:JARVIS_CONVERT_DST, $fmt)",
  "  $bmp.Dispose()",
  "} finally { $src.Dispose() }",
].join("; ");

function createDefaultConvertDriver(platform: NodeJS.Platform = process.platform): ConvertDriver {
  return {
    async convert(req: ConvertRequest): Promise<ConvertResultInfo> {
      try {
        await runProcess("ffmpeg", buildFfmpegArgs(req), req.timeoutMs, req.signal);
        return { backend: "ffmpeg" };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;

        if (
          platform === "win32" &&
          req.sourceCategory === "image" &&
          req.targetCategory === "image" &&
          WINDOWS_IMAGE_FALLBACK_EXTS.has(req.sourceExt) &&
          WINDOWS_IMAGE_FALLBACK_EXTS.has(req.targetExt)
        ) {
          await execFileAsync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", PS_IMAGE_CONVERT],
            {
              timeout: req.timeoutMs,
              windowsHide: true,
              signal: req.signal,
              env: {
                ...process.env,
                JARVIS_CONVERT_SRC: req.realSourcePath,
                JARVIS_CONVERT_DST: req.destinationPath,
                JARVIS_CONVERT_EXT: req.targetExt,
                JARVIS_CONVERT_W: String(req.width ?? 0),
                JARVIS_CONVERT_H: String(req.height ?? 0),
              },
            },
          );
          return { backend: "windows_drawing" };
        }

        throw new Error(
          `Converter binary 'ffmpeg' is not installed or not in PATH (needed for .${req.sourceExt} -> .${req.targetExt}).`,
        );
      }
    },
  };
}

/** A dónde convertir: la ruta que dio el usuario (con su formato, si lo dio) o solo el formato (el archivo queda junto al origen, con otra extensión). */
type ConvertTarget =
  | { readonly kind: "destination"; readonly destination: string; readonly format: string | undefined }
  | { readonly kind: "format"; readonly format: string };

interface ConvertArgs {
  readonly source: string;
  readonly target: ConvertTarget;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly quality: number | undefined;
  readonly overwrite: boolean;
}

/** Entero opcional dentro de un rango: `undefined` si no vino, `null` si vino mal. */
function optionalInteger(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function parseConvertArgs(raw: Record<string, unknown>): { readonly ok: true; readonly args: ConvertArgs } | { readonly ok: false; readonly message: string } {
  const invalid = (message: string) => ({ ok: false as const, message });

  if (typeof raw.source !== "string" || raw.source.trim() === "") {
    return invalid("'source' is required: existing image, audio, or video file path.");
  }

  let destination: string | undefined;
  if (raw.destination !== undefined && raw.destination !== null) {
    if (typeof raw.destination !== "string" || raw.destination.trim() === "") return invalid("'destination' must be a non-empty file path.");
    destination = raw.destination.trim();
  }

  let format: string | undefined;
  if (raw.format !== undefined && raw.format !== null) {
    if (typeof raw.format !== "string" || raw.format.trim() === "") {
      return invalid("'format' must be a non-empty extension like 'png', 'mp3', or 'mp4'.");
    }
    format = raw.format.trim().replace(/^\./, "").toLowerCase();
  }

  const target: ConvertTarget | null = destination !== undefined ? { kind: "destination", destination, format } : format !== undefined ? { kind: "format", format } : null;
  if (target === null) return invalid("Provide 'destination' or target 'format' (e.g. 'webp', 'mp3', 'mp4').");

  const width = optionalInteger(raw.width, 1, MAX_DIMENSION);
  if (width === null) return invalid(`'width' must be an integer between 1 and ${MAX_DIMENSION}.`);
  const height = optionalInteger(raw.height, 1, MAX_DIMENSION);
  if (height === null) return invalid(`'height' must be an integer between 1 and ${MAX_DIMENSION}.`);
  const quality = optionalInteger(raw.quality, 1, 100);
  if (quality === null) return invalid("'quality' must be an integer between 1 and 100.");

  let overwrite = false;
  if (raw.overwrite !== undefined && raw.overwrite !== null) {
    if (typeof raw.overwrite !== "boolean") return invalid("'overwrite' must be true or false.");
    overwrite = raw.overwrite;
  }

  return { ok: true, args: { source: raw.source, target, width, height, quality, overwrite } };
}

/** Lo que ya se comprobó de una conversión: origen y destino resueltos, y los formatos y categorías de ambos. */
interface ConversionPlan {
  readonly srcResolved: Extract<ResolvedExistingTarget, { readonly ok: true }>;
  readonly dstResolved: Extract<ResolvedTarget, { readonly ok: true }>;
  readonly sourceExt: string;
  readonly targetExt: string;
  readonly sourceCategory: MediaCategory;
  readonly targetCategory: MediaCategory;
}

/**
 * Las comprobaciones previas, en orden: origen existente y de un tipo de medio conocido, formato de destino y que se pueda convertir de uno a otro, destino válido,
 * distinto del origen, con carpeta padre, y qué hay ya en él.
 */
async function planConversion(args: ConvertArgs, deps: ConvertFileDeps): Promise<{ readonly ok: true; readonly plan: ConversionPlan } | { readonly ok: false; readonly result: MCPCallResult }> {
  const refuse = (result: MCPCallResult) => ({ ok: false as const, result });
  const allowedDirs = deps.getAllowedDirectories();

  const srcResolved = await resolveExistingPath(args.source, deps.getEnvironment, allowedDirs, {
    expectedKind: "file",
    followSymlinkForAllowedCheck: true,
    paramName: "source",
  });
  if (!srcResolved.ok) return refuse(fail(srcResolved.message, pathFailureData(srcResolved)));

  const sourceExt = path.extname(srcResolved.realTarget).replace(/^\./, "").toLowerCase();
  const sourceCategory = detectMediaCategory(sourceExt);
  if (sourceCategory === undefined) {
    return refuse(fail(`Unsupported source media format '.${sourceExt || "none"}' for convert_file.`, { reason: "unsupported_format" }));
  }
  if ((args.width !== undefined || args.height !== undefined) && sourceCategory === "audio") {
    return refuse(fail("Cannot resize an audio file with 'width' or 'height'."));
  }

  let targetExt: string;
  let rawDestPath: string;
  if (args.target.kind === "destination") {
    const { destination, format } = args.target;
    const extFromDest = path.extname(destination).replace(/^\./, "").toLowerCase();
    targetExt = extFromDest || format || "";
    if (format !== undefined && extFromDest !== "" && format !== extFromDest) {
      return refuse(fail(`'format' ('${format}') does not match 'destination' extension ('.${extFromDest}').`));
    }
    rawDestPath = destination;
  } else {
    targetExt = args.target.format;
    const stem = path.basename(srcResolved.targetPath, path.extname(srcResolved.targetPath));
    rawDestPath = joinEntryPath(dirnameOf(srcResolved.targetPath), `${stem}.${targetExt}`);
  }

  const targetCategory = detectMediaCategory(targetExt);
  if (targetCategory === undefined) {
    return refuse(fail(`Unsupported target media format '.${targetExt || "none"}' for convert_file.`, { reason: "unsupported_format" }));
  }
  if (!isConversionAllowed(sourceCategory, targetCategory, targetExt)) {
    return refuse(fail(`Cannot convert ${sourceCategory} ('.${sourceExt}') to ${targetCategory} ('.${targetExt}').`, { reason: "incompatible_formats" }));
  }

  const dstResolved = await resolvePathTarget(rawDestPath, deps.getEnvironment, allowedDirs, {
    allowEmptyAsHome: false,
    paramName: "destination",
  });
  if (!dstResolved.ok) return refuse(fail(dstResolved.message, dstResolved.denied ? { reason: "denied" } : {}));
  if (dstResolved.targetPath === srcResolved.targetPath) {
    return refuse(fail("Source and destination refer to the same path; provide a distinct destination path or format.", { reason: "same_path" }));
  }

  const dstParent = dirnameOf(dstResolved.targetPath);
  try {
    const parentStat = await fs.promises.stat(dstParent);
    if (!parentStat.isDirectory()) return refuse(fail(`Destination parent '${dstParent}' is not a folder.`));
  } catch {
    return refuse(fail(`Destination parent folder does not exist: '${dstParent}'.`));
  }

  const dstInspection = await inspectDestinationTarget(dstResolved.targetPath, allowedDirs, dstResolved.env.home);
  if (dstInspection.status === "denied") return refuse(fail(dstInspection.message, { reason: "denied" }));
  if (dstInspection.status === "error") return refuse(fail(dstInspection.message));
  if (dstInspection.status === "exists") {
    if (dstInspection.isDirectory) return refuse(fail(`Destination '${dstResolved.targetPath}' is a folder, not a file.`));
    if (!args.overwrite) {
      return refuse(fail(`Destination already exists: '${dstResolved.targetPath}'. Pass overwrite: true to replace.`, { reason: "already_exists" }));
    }
  }

  return { ok: true, plan: { srcResolved, dstResolved, sourceExt, targetExt, sourceCategory, targetCategory } };
}

export async function runConvertFile(
  rawArgs: Record<string, unknown>,
  deps: ConvertFileDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  const parsed = parseConvertArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  const { width, height, quality, overwrite } = parsed.args;

  const planned = await planConversion(parsed.args, deps);
  if (!planned.ok) return planned.result;
  const { srcResolved, dstResolved, sourceExt, targetExt, sourceCategory, targetCategory } = planned.plan;

  if (options.signal?.aborted) return cancelledResult();

  const timeoutMs = effectiveTimeoutMs(deps.defaultTimeoutMs ?? DEFAULT_CONVERT_TIMEOUT_MS, options.timeoutMs);
  const driver = deps.driver ?? createDefaultConvertDriver(deps.platform ?? process.platform);

  try {
    const outcome = await driver.convert({
      sourcePath: srcResolved.targetPath,
      realSourcePath: srcResolved.realTarget,
      destinationPath: dstResolved.targetPath,
      sourceExt,
      targetExt,
      sourceCategory,
      targetCategory,
      width,
      height,
      quality,
      overwrite,
      timeoutMs,
      signal: options.signal,
    });
    if (options.signal?.aborted) return cancelledResult();

    let outBytes = 0;
    try {
      outBytes = (await fs.promises.stat(dstResolved.targetPath)).size;
    } catch {
      // Si el driver simulado en pruebas no escribió archivo físico, toleramos 0 B
    }

    const resizeLabel = width !== undefined || height !== undefined ? ` [${width ?? "auto"}x${height ?? "auto"}]` : "";
    const text = `status: ok · converted ${srcResolved.targetPath} -> ${dstResolved.targetPath}${resizeLabel} (${formatSize(outBytes)}, via ${outcome.backend})`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        source: srcResolved.targetPath,
        destination: dstResolved.targetPath,
        sourceFormat: sourceExt,
        targetFormat: targetExt,
        backend: outcome.backend,
        bytes: outBytes,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    const msg = errorMessage(error);
    return fail(`Conversion failed: ${msg}`, {
      ...(msg.includes("is not installed") ? { reason: "binary_missing" } : {}),
    });
  }
}
