/**
 * `jarvis_files_write`: herramienta `write_file` (grupo de escritura).
 *
 * Separada estrictamente de `read_file` (`files_read`). Despacha internamente según el tipo/extensión
 * del archivo mediante un registro extensible de drivers (`WriteFileDriver`):
 * - Texto plano: soporta `rewrite`, `append` y `create_only` (creación atómica con bandera `wx`),
 *   validación de `allowedDirectories` y protección contra symlinks salientes.
 * - Formatos enriquecidos (`.pdf`, `.docx`, `.xlsx`, `.pptx`): requieren su driver registrado para no
 *   escribir texto crudo inválido bajo esas extensiones.
 */

import fs from "node:fs";
import path from "node:path";
import type { UserEnvironment } from "../../core/environment.ts";
import {
  dirnameOf,
  formatSize,
  inspectDestinationTarget,
  resolvePathTarget,
} from "../../core/tools/filePaths.ts";
import { cancelledResult, toolResult, toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

export type WriteMode = "rewrite" | "append" | "create_only";
const VALID_MODES = ["rewrite", "append", "create_only"] as const;
const VALID_ENCODINGS = ["utf8", "latin1"] as const;

const STRUCTURED_EXTS: ReadonlySet<string> = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "xlsm",
  "ppt",
  "pptx",
  "zip",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
]);

export interface WriteDriverContext {
  readonly targetPath: string;
  readonly extension: string;
  readonly content: string;
  readonly mode: WriteMode;
  readonly encoding: BufferEncoding;
  readonly existedBefore: boolean;
  readonly args: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface WriteFileDriver {
  readonly id: string;
  readonly extensions: readonly string[];
  write(ctx: WriteDriverContext): Promise<MCPCallResult>;
}

interface WriteFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly drivers?: readonly WriteFileDriver[];
}

interface ParsedWriteArgs {
  readonly path: string;
  readonly content: string;
  readonly mode: WriteMode;
  readonly createFolders: boolean;
  readonly encoding: "utf8" | "latin1";
}

function parseArgs(
  raw: Record<string, unknown>,
): { readonly ok: true; readonly args: ParsedWriteArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.path !== "string" || raw.path.trim() === "") {
    return { ok: false, message: "'path' is required: an absolute file path or ~ relative path." };
  }
  if (typeof raw.content !== "string") {
    return { ok: false, message: "'content' is required and must be a string." };
  }

  let mode: WriteMode = "rewrite";
  if (raw.mode !== undefined && raw.mode !== null) {
    if (typeof raw.mode !== "string" || !(VALID_MODES as readonly string[]).includes(raw.mode)) {
      return { ok: false, message: `'mode' must be one of: ${VALID_MODES.join(", ")}.` };
    }
    mode = raw.mode as WriteMode;
  }

  let createFolders = false;
  if (raw.createFolders !== undefined && raw.createFolders !== null) {
    if (typeof raw.createFolders !== "boolean") {
      return { ok: false, message: "'createFolders' must be true or false." };
    }
    createFolders = raw.createFolders;
  }

  let encoding: "utf8" | "latin1" = "utf8";
  if (raw.encoding !== undefined && raw.encoding !== null) {
    if (typeof raw.encoding !== "string" || !(VALID_ENCODINGS as readonly string[]).includes(raw.encoding)) {
      return { ok: false, message: `'encoding' must be one of: ${VALID_ENCODINGS.join(", ")}.` };
    }
    encoding = raw.encoding as "utf8" | "latin1";
  }

  return {
    ok: true,
    args: {
      path: raw.path.trim(),
      content: raw.content,
      mode,
      createFolders,
      encoding,
    },
  };
}

/** `true` si el contenido a agregar arranca igual que el archivo (primeros 80 caracteres no vacíos, mínimo 20). */
async function repeatsExistingStart(ctx: WriteDriverContext): Promise<boolean> {
  try {
    const existing = (await fs.promises.readFile(ctx.targetPath, { encoding: ctx.encoding })).trimStart();
    const added = ctx.content.trimStart();
    const n = Math.min(80, existing.length, added.length);
    return n >= 20 && existing.slice(0, n) === added.slice(0, n);
  } catch {
    return false;
  }
}

async function writePlainText(ctx: WriteDriverContext): Promise<MCPCallResult> {
  if (ctx.signal?.aborted) return cancelledResult();

  const bytesWritten = Buffer.byteLength(ctx.content, ctx.encoding);
  if (ctx.mode === "create_only") {
    await fs.promises.writeFile(ctx.targetPath, ctx.content, { encoding: ctx.encoding, flag: "wx" });
  } else if (ctx.mode === "append") {
    // Un modelo chico suele reenviar el documento ENTERO con `append`: el archivo queda con el contenido repetido. Si lo que se agrega ya empieza como el archivo, se rechaza.
    if (ctx.existedBefore && (await repeatsExistingStart(ctx))) {
      return toolResult({
        text: `The content to append starts with the same text the file already has, so appending would duplicate it. Use mode 'rewrite' with the complete updated content, or append only the NEW lines.`,
        raw: "append would duplicate existing content",
        isError: true,
        data: { state: "error", reason: "append_duplicates", path: ctx.targetPath },
      });
    }
    await fs.promises.appendFile(ctx.targetPath, ctx.content, { encoding: ctx.encoding });
  } else {
    await fs.promises.writeFile(ctx.targetPath, ctx.content, { encoding: ctx.encoding });
  }

  const stat = await fs.promises.stat(ctx.targetPath);
  const verb = ctx.mode === "append" ? (ctx.existedBefore ? "appended to" : "created") : ctx.existedBefore ? "overwrote" : "created";
  const text = `status: ok · ${verb} ${ctx.targetPath} (${formatSize(bytesWritten)} written, total ${formatSize(stat.size)})`;

  return toolResult({
    text,
    raw: text,
    data: {
      state: "ok",
      format: "text",
      mode: ctx.mode,
      path: ctx.targetPath,
      bytesWritten,
      totalBytes: stat.size,
      created: !ctx.existedBefore,
      truncated: false,
    },
  });
}

export async function runWriteFile(
  rawArgs: Record<string, unknown>,
  deps: WriteFileDeps,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  const args = parsed.args;

  const allowedDirs = deps.getAllowedDirectories();
  const resolved = await resolvePathTarget(args.path, deps.getEnvironment, allowedDirs, {
    allowEmptyAsHome: false,
    paramName: "path",
  });
  if (!resolved.ok) {
    return fail(resolved.message, resolved.denied ? { reason: "denied" } : {});
  }
  if (options.signal?.aborted) return cancelledResult();

  const { targetPath, env } = resolved;
  const parentDir = dirnameOf(targetPath);

  // Qué driver escribe este formato se decide antes de tocar el disco: una llamada que va a fallar por el formato no deja carpetas creadas.
  const ext = path.extname(targetPath).replace(/^\./, "").toLowerCase();
  const customDriver = ext === "" ? undefined : deps.drivers?.find((d) => d.extensions.some((supported) => supported.replace(/^\./, "").toLowerCase() === ext));
  if (customDriver === undefined && STRUCTURED_EXTS.has(ext)) {
    return fail(
      `Writing '.${ext}' files requires a format driver that is not installed yet (file: '${targetPath}'). Nothing can be installed from here: tell the user, or write a '.csv' (opens in Excel) / '.txt' / '.md' instead.`,
      { reason: "unsupported_format", extension: ext },
    );
  }

  if (args.createFolders) {
    try {
      await fs.promises.mkdir(parentDir, { recursive: true });
    } catch (error) {
      return fail(`Cannot create parent folder '${parentDir}': ${errorMessage(error)}`);
    }
  } else {
    try {
      const parentStat = await fs.promises.stat(parentDir);
      if (!parentStat.isDirectory()) {
        return fail(`Parent path '${parentDir}' is not a folder.`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return fail(`Parent folder does not exist: '${parentDir}'. Create it with create_folder or pass createFolders: true.`);
      }
      return fail(`Cannot access parent folder '${parentDir}': ${errorMessage(error)}`);
    }
  }

  const dstInspection = await inspectDestinationTarget(targetPath, allowedDirs, env.home);
  if (dstInspection.status === "denied") {
    return fail(dstInspection.message, { reason: "denied" });
  }
  if (dstInspection.status === "error") {
    return fail(dstInspection.message);
  }
  if (dstInspection.status === "exists" && dstInspection.isDirectory) {
    return fail(`'${targetPath}' is a folder, not a file.`, { reason: "path_is_directory" });
  }
  const existedBefore = dstInspection.status === "exists";

  if (args.mode === "create_only" && existedBefore) {
    return fail(`File '${targetPath}' already exists and mode is 'create_only'.`, { reason: "already_exists" });
  }

  const driverCtx: WriteDriverContext = {
    targetPath,
    extension: ext,
    content: args.content,
    mode: args.mode,
    encoding: args.encoding,
    existedBefore,
    args: rawArgs,
    signal: options.signal,
  };

  if (customDriver !== undefined) {
    try {
      return await customDriver.write(driverCtx);
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return fail(`Driver '${customDriver.id}' failed writing '${targetPath}': ${errorMessage(error)}`);
    }
  }

  try {
    return await writePlainText(driverCtx);
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return fail(`File '${targetPath}' already exists and mode is 'create_only'.`, { reason: "already_exists" });
    }
    return fail(`Cannot write file '${targetPath}': ${errorMessage(error)}`);
  }
}
