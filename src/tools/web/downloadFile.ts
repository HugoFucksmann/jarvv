/**
 * `jarvis_web`: herramienta `download_file`.
 *
 * Descarga un archivo desde una URL `http(s)` hacia el disco por stream (sin acumular el cuerpo entero en RAM):
 * - Protección SSRF: valida esquema `http`/`https`, rechaza credenciales en la URL, valida DNS e IPs privadas,
 *   loopback, link-local y metadatos cloud (incluidos redireccionamientos manuales hasta un tope de saltos).
 * - Valida `allowedDirectories` en el destino y limpia archivos `.part` incompletos ante fallo, exceso o cancelación.
 * - Limpia siempre timers y listeners de `AbortSignal` en `finally`.
 */

import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { UserEnvironment } from "../../core/environment.ts";
import {
  dirnameOf,
  effectiveTimeoutMs as computeEffectiveTimeoutMs,
  formatSize,
  inspectDestinationTarget,
  joinEntryPath,
  raceAbort,
  resolveFolderPath,
  resolvePathTarget,
} from "../../core/tools/filePaths.ts";
import { cancelledResult, toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
export const DEFAULT_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

export interface LookupAddress {
  readonly address: string;
  readonly family: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type LookupLike = (hostname: string) => Promise<readonly LookupAddress[]>;

export interface DownloadFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly fetchFn?: FetchLike;
  readonly lookupHost?: LookupLike;
  readonly defaultTimeoutMs?: number;
  readonly maxBytes?: number;
  readonly allowPrivateNetwork?: boolean;
}

interface ParsedDownloadArgs {
  readonly url: string;
  readonly destination?: string;
  readonly folder?: string;
  readonly filename?: string;
  readonly overwrite: boolean;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

function parseArgs(
  raw: Record<string, unknown>,
  defaultMaxBytes: number,
  defaultTimeoutMs: number,
): { readonly ok: true; readonly args: ParsedDownloadArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.url !== "string" || raw.url.trim() === "") {
    return { ok: false, message: "'url' is required (http or https URL)." };
  }

  let destination: string | undefined;
  if (raw.destination !== undefined && raw.destination !== null) {
    if (typeof raw.destination !== "string" || raw.destination.trim() === "") {
      return { ok: false, message: "'destination' must be a non-empty file path." };
    }
    destination = raw.destination.trim();
  }

  let folder: string | undefined;
  if (raw.folder !== undefined && raw.folder !== null) {
    if (typeof raw.folder !== "string" || raw.folder.trim() === "") {
      return { ok: false, message: "'folder' must be a non-empty folder path or alias." };
    }
    folder = raw.folder.trim();
  }

  if (destination !== undefined && folder !== undefined) {
    return { ok: false, message: "Provide either 'destination' or 'folder', not both." };
  }

  let filename: string | undefined;
  if (raw.filename !== undefined && raw.filename !== null) {
    if (typeof raw.filename !== "string" || raw.filename.trim() === "") {
      return { ok: false, message: "'filename' must be a non-empty file name." };
    }
    filename = raw.filename.trim();
  }

  let overwrite = false;
  if (raw.overwrite !== undefined && raw.overwrite !== null) {
    if (typeof raw.overwrite !== "boolean") return { ok: false, message: "'overwrite' must be true or false." };
    overwrite = raw.overwrite;
  }

  let maxBytes = defaultMaxBytes;
  if (raw.maxBytes !== undefined && raw.maxBytes !== null) {
    if (typeof raw.maxBytes !== "number" || !Number.isInteger(raw.maxBytes) || raw.maxBytes < 1) {
      return { ok: false, message: "'maxBytes' must be a positive integer." };
    }
    maxBytes = Math.min(raw.maxBytes, defaultMaxBytes);
  }

  let timeoutMs = defaultTimeoutMs;
  if (raw.timeoutMs !== undefined && raw.timeoutMs !== null) {
    if (typeof raw.timeoutMs !== "number" || !Number.isInteger(raw.timeoutMs) || raw.timeoutMs < 100) {
      return { ok: false, message: "'timeoutMs' must be an integer >= 100." };
    }
    timeoutMs = Math.min(raw.timeoutMs, 300_000);
  }

  return {
    ok: true,
    args: { url: raw.url.trim(), destination, folder, filename, overwrite, maxBytes, timeoutMs },
  };
}

/** Comprueba si una IP literal pertenece a rangos privados, loopback, link-local o no enrutables. */
export function isPrivateOrReservedIp(ipRaw: string): boolean {
  const ip = ipRaw.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const ver = net.isIP(ip);
  if (ver === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18.0.0/15
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (ver === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateOrReservedIp(mapped[1]);
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(ip)) return true; // link-local fe80::/10
    if (ip.startsWith("ff")) return true; // multicast
    return false;
  }
  return true;
}

const defaultLookupHost: LookupLike = async (hostname) => {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
};

async function validateRemoteUrl(
  rawUrl: string,
  lookupHost: LookupLike,
  allowPrivateNetwork: boolean,
): Promise<{ readonly ok: true; readonly url: URL } | { readonly ok: false; readonly message: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, message: `Invalid URL: '${rawUrl}'.` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: `Only http and https URLs are supported (got '${parsed.protocol}').` };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, message: "URLs containing embedded credentials are not allowed." };
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) {
    return { ok: false, message: "URL is missing a hostname." };
  }

  if (!allowPrivateNetwork) {
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      return { ok: false, message: `[DENIED] Refusing download from local/private host '${hostname}'.` };
    }
    if (net.isIP(hostname) !== 0) {
      if (isPrivateOrReservedIp(hostname)) {
        return { ok: false, message: `[DENIED] Refusing download from private or loopback IP '${hostname}'.` };
      }
    } else {
      let resolved: readonly LookupAddress[];
      try {
        resolved = await lookupHost(hostname);
      } catch (error) {
        return { ok: false, message: `Could not resolve hostname '${hostname}': ${errorMessage(error)}` };
      }
      if (resolved.length === 0) {
        return { ok: false, message: `Hostname '${hostname}' resolved to no addresses.` };
      }
      for (const addr of resolved) {
        if (isPrivateOrReservedIp(addr.address)) {
          return {
            ok: false,
            message: `[DENIED] Hostname '${hostname}' resolved to private/reserved address '${addr.address}'.`,
          };
        }
      }
    }
  }

  return { ok: true, url: parsed };
}

function sanitizeFileName(rawName: string): string {
  const base = path.win32.basename(path.posix.basename(rawName.trim()));
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === ".." || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) {
    return "download.bin";
  }
  return cleaned;
}

function filenameFromHeadersOrUrl(headers: Headers, finalUrl: URL): string {
  const cd = headers.get("content-disposition");
  if (cd) {
    const utf8Match = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\r\n]+)/i.exec(cd);
    if (utf8Match?.[1]) {
      try {
        return sanitizeFileName(decodeURIComponent(utf8Match[1].replace(/^"|"$/g, "")));
      } catch {
        return sanitizeFileName(utf8Match[1]);
      }
    }
    const plainMatch = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\r\n]+)/i.exec(cd);
    const candidate = plainMatch?.[1] ?? plainMatch?.[2];
    if (candidate) return sanitizeFileName(candidate);
  }

  const segment = finalUrl.pathname.split("/").filter(Boolean).pop();
  if (segment) {
    try {
      return sanitizeFileName(decodeURIComponent(segment));
    } catch {
      return sanitizeFileName(segment);
    }
  }
  return "download.bin";
}

function createLinkedController(timeoutMs: number, externalSignal?: AbortSignal): {
  readonly controller: AbortController;
  readonly didTimeout: () => boolean;
  readonly cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Download timed out"));
  }, timeoutMs);

  let onExternalAbort: (() => void) | undefined;
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      onExternalAbort = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  return {
    controller,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      if (onExternalAbort !== undefined && externalSignal !== undefined) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    },
  };
}

async function writeBodyStreamToFile(
  body: ReadableStream<Uint8Array>,
  partPath: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<number> {
  const reader = body.getReader();
  const ws = fs.createWriteStream(partPath, { flags: "wx" });
  let totalBytes = 0;
  let wsError: Error | undefined;

  ws.on("error", (err) => {
    wsError = err;
  });

  const writeChunk = (chunk: Uint8Array): Promise<void> =>
    new Promise((resolve, reject) => {
      if (wsError !== undefined) {
        reject(wsError);
        return;
      }
      const onError = (err: Error) => {
        ws.removeListener("drain", onDrain);
        reject(err);
      };
      const onDrain = () => {
        ws.removeListener("error", onError);
        resolve();
      };
      ws.once("error", onError);
      if (ws.write(chunk)) {
        ws.removeListener("error", onError);
        ws.removeListener("drain", onDrain);
        resolve();
      } else {
        ws.once("drain", onDrain);
      }
    });

  const closeStream = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (wsError !== undefined) {
        reject(wsError);
        return;
      }
      const onError = (err: Error) => {
        ws.removeListener("close", onClose);
        reject(err);
      };
      const onClose = () => {
        ws.removeListener("error", onError);
        resolve();
      };
      ws.once("error", onError);
      ws.once("close", onClose);
      ws.end();
    });

  const destroyAndWaitClose = async (): Promise<void> => {
    if (ws.closed) return;
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.destroy();
    });
  };

  try {
    while (true) {
      if (signal.aborted) throw new Error("Download aborted");
      const readRes = await raceAbort(reader.read(), signal);
      if (readRes.aborted) throw new Error("Download aborted");
      const { done, value } = readRes.value;
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`Download exceeded maxBytes limit (${formatSize(maxBytes)}).`);
      }
      await writeChunk(value);
    }
    await closeStream();
    return totalBytes;
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors during cleanup
    }
    await destroyAndWaitClose();
    throw err;
  } finally {
    reader.releaseLock();
  }
}

export async function runDownloadFile(
  rawArgs: Record<string, unknown>,
  deps: DownloadFileDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  const defaultMaxBytes = deps.maxBytes ?? DEFAULT_DOWNLOAD_MAX_BYTES;
  const defaultTimeout = deps.defaultTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const parsed = parseArgs(rawArgs, defaultMaxBytes, defaultTimeout);
  if (!parsed.ok) return fail(parsed.message);
  const args = parsed.args;

  const effectiveTimeoutMs = computeEffectiveTimeoutMs(args.timeoutMs, options.timeoutMs, 1_000);
  const fetchFn: FetchLike = deps.fetchFn ?? fetch;
  const lookupHost: LookupLike = deps.lookupHost ?? defaultLookupHost;
  const allowPrivate = deps.allowPrivateNetwork === true;
  const allowedDirs = deps.getAllowedDirectories();

  // Validar carpeta/destino antes de iniciar tráfico de red.
  let targetFolder: string | undefined;
  let explicitTargetPath: string | undefined;
  let userHome = "";

  if (args.destination !== undefined) {
    const res = await resolvePathTarget(args.destination, deps.getEnvironment, allowedDirs, {
      allowEmptyAsHome: false,
      paramName: "destination",
    });
    if (!res.ok) return fail(res.message, res.denied ? { reason: "denied" } : {});
    explicitTargetPath = res.targetPath;
    userHome = res.env.home;

    const parent = dirnameOf(explicitTargetPath);
    try {
      const parentStat = await fs.promises.stat(parent);
      if (!parentStat.isDirectory()) return fail(`Destination parent '${parent}' is not a folder.`);
    } catch {
      return fail(`Destination parent folder does not exist: '${parent}'.`);
    }
  } else {
    const folderRes = await resolveFolderPath(args.folder ?? "downloads", deps.getEnvironment, allowedDirs);
    if (!folderRes.ok) return fail(folderRes.message, folderRes.denied ? { reason: "denied" } : {});
    targetFolder = folderRes.targetPath;
    const env = await deps.getEnvironment();
    userHome = env.home;
  }

  const linked = createLinkedController(effectiveTimeoutMs, options.signal);
  let partPath: string | undefined;

  try {
    let currentUrl = args.url;
    let response: Response | undefined;
    let finalUrl: URL | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const urlCheck = await validateRemoteUrl(currentUrl, lookupHost, allowPrivate);
      if (!urlCheck.ok) {
        return fail(urlCheck.message, urlCheck.message.startsWith("[DENIED]") ? { reason: "denied" } : {});
      }
      finalUrl = urlCheck.url;

      const res = await fetchFn(finalUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: linked.controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) return fail(`Redirect (${res.status}) missing Location header.`);
        if (hop === MAX_REDIRECTS) return fail(`Too many redirects (max ${MAX_REDIRECTS}).`);
        currentUrl = new URL(loc, finalUrl).toString();
        continue;
      }

      response = res;
      break;
    }

    if (!response || !finalUrl) {
      return fail("Download did not produce an HTTP response.");
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return fail(`Download failed with HTTP ${response.status} ${response.statusText || ""}`.trim(), {
        httpStatus: response.status,
      });
    }

    const clHeader = response.headers.get("content-length");
    if (clHeader !== null) {
      const declared = Number(clHeader);
      if (Number.isFinite(declared) && declared > args.maxBytes) {
        await response.body?.cancel().catch(() => {});
        return fail(
          `File size (${formatSize(declared)}) exceeds maxBytes limit (${formatSize(args.maxBytes)}).`,
          { reason: "too_large", contentLength: declared },
        );
      }
    }

    const finalPath =
      explicitTargetPath ??
      joinEntryPath(
        targetFolder!,
        args.filename !== undefined ? sanitizeFileName(args.filename) : filenameFromHeadersOrUrl(response.headers, finalUrl),
      );

    // Verificar allowedDirectories + symlinks sobre la ruta final resuelta.
    const dstInspection = await inspectDestinationTarget(finalPath, allowedDirs, userHome);
    if (dstInspection.status === "denied") {
      await response.body?.cancel().catch(() => {});
      return fail(dstInspection.message, { reason: "denied" });
    }
    if (dstInspection.status === "error") {
      await response.body?.cancel().catch(() => {});
      return fail(dstInspection.message);
    }
    if (dstInspection.status === "exists") {
      if (dstInspection.isDirectory) {
        await response.body?.cancel().catch(() => {});
        return fail(`Destination '${finalPath}' is a folder, not a file.`);
      }
      if (!args.overwrite) {
        await response.body?.cancel().catch(() => {});
        return fail(`Destination already exists: '${finalPath}'. Pass overwrite: true to replace.`, {
          reason: "already_exists",
        });
      }
    }

    partPath = `${finalPath}.jarvis-dl-${process.pid}-${Date.now()}.part`;
    let bytesDownloaded = 0;

    if (response.body === null) {
      await fs.promises.writeFile(partPath, Buffer.alloc(0), { flag: "wx" });
    } else {
      bytesDownloaded = await writeBodyStreamToFile(response.body, partPath, args.maxBytes, linked.controller.signal);
    }

    await fs.promises.rename(partPath, finalPath);
    partPath = undefined;

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const text = `status: ok · downloaded ${finalUrl.toString()} -> ${finalPath} (${formatSize(bytesDownloaded)}, ${contentType})`;

    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        url: finalUrl.toString(),
        path: finalPath,
        bytes: bytesDownloaded,
        contentType,
        httpStatus: response.status,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    if (linked.didTimeout()) {
      return fail(`Download timed out after ${effectiveTimeoutMs} ms.`, { reason: "timeout" });
    }
    return fail(`Download failed: ${errorMessage(error)}`);
  } finally {
    linked.cleanup();
    if (partPath !== undefined) {
      await fs.promises.rm(partPath, { force: true }).catch(() => {});
    }
  }
}
