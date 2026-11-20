/**
 * Pruebas unitarias de `download_file` (`src/tools/web/downloadFile.ts`):
 * - Validación SSRF (`isPrivateOrReservedIp`, bloqueo de localhost/IPs privadas, DNS malicioso y redirecciones).
 * - Sanitización de nombres (`Content-Disposition` / URL), `allowedDirectories`, symlinks, `overwrite`.
 * - Streaming en `.part` con tope `maxBytes`, `timeoutMs` y `AbortSignal` verificando limpieza sin temporales huérfanos.
 * - Todas las peticiones usan `fetchFn` y `lookupHost` simulados (sin red externa).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { UserEnvironment } from "../src/core/environment.ts";
import { readToolResult } from "../src/core/tools/result.ts";
import { isPrivateOrReservedIp, runDownloadFile } from "../src/tools/web/downloadFile.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "jarvis-dl-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeEnv(home: string): UserEnvironment {
  return {
    platform: "linux",
    home,
    downloads: path.join(home, "Downloads"),
  };
}

function streamFromChunks(chunks: readonly (Uint8Array | Error)[], delayMs = 0): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const next = chunks[index++];
      if (next instanceof Error) {
        controller.error(next);
        return;
      }
      controller.enqueue(next);
    },
  });
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── SSRF / IPs privadas ─────────────────────────

test("isPrivateOrReservedIp: detecta loopback, RFC1918, CGNAT, link-local, metadatos cloud e IPv6 privado", () => {
  assert.equal(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("10.20.30.40"), true);
  assert.equal(isPrivateOrReservedIp("172.16.0.1"), true);
  assert.equal(isPrivateOrReservedIp("172.31.255.254"), true);
  assert.equal(isPrivateOrReservedIp("192.168.1.10"), true);
  assert.equal(isPrivateOrReservedIp("169.254.169.254"), true);
  assert.equal(isPrivateOrReservedIp("100.64.0.1"), true);
  assert.equal(isPrivateOrReservedIp("0.0.0.0"), true);
  assert.equal(isPrivateOrReservedIp("::1"), true);
  assert.equal(isPrivateOrReservedIp("fe80::1"), true);
  assert.equal(isPrivateOrReservedIp("fc00::1"), true);
  assert.equal(isPrivateOrReservedIp("::ffff:127.0.0.1"), true);

  // IPs públicas
  assert.equal(isPrivateOrReservedIp("93.184.216.34"), false);
  assert.equal(isPrivateOrReservedIp("1.1.1.1"), false);
  assert.equal(isPrivateOrReservedIp("172.32.0.1"), false);
  assert.equal(isPrivateOrReservedIp("2606:4700:4700::1111"), false);
});

test("download_file: bloquea esquemas no http(s), credenciales embebidas, IPs privadas, DNS interno y redirects SSRF", async () => {
  const root = makeTempDir();
  const env = makeEnv(root);
  fs.mkdirSync(env.downloads!, { recursive: true });

  const baseDeps = {
    getAllowedDirectories: () => [root],
    getEnvironment: async () => env,
    lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchFn: async () => {
      throw new Error("no debía invocar fetchFn");
    },
  };

  // file:// y javascript:
  const fileScheme = await runDownloadFile({ url: "file:///etc/passwd" }, baseDeps);
  assert.equal(fileScheme.isError, true);

  // Credenciales en URL
  const creds = await runDownloadFile({ url: "https://user:pass@example.com/a.zip" }, baseDeps);
  assert.equal(creds.isError, true);

  // localhost y IP de metadatos AWS/GCP
  const localUrl = await runDownloadFile({ url: "http://localhost:8080/secret" }, baseDeps);
  assert.equal(localUrl.isError, true);
  assert.equal(readToolResult(localUrl)?.data.reason, "denied");

  const metaUrl = await runDownloadFile({ url: "http://169.254.169.254/latest/meta-data/" }, baseDeps);
  assert.equal(metaUrl.isError, true);
  assert.equal(readToolResult(metaUrl)?.data.reason, "denied");

  // DNS que resuelve a red privada
  const dnsRebind = await runDownloadFile(
    { url: "https://rebind.example.com/payload.bin" },
    {
      ...baseDeps,
      lookupHost: async () => [{ address: "10.0.0.5", family: 4 }],
    },
  );
  assert.equal(dnsRebind.isError, true);
  assert.equal(readToolResult(dnsRebind)?.data.reason, "denied");

  // Redirect manual desde dominio público hacia loopback
  const ssrfRedirect = await runDownloadFile(
    { url: "https://public.example.com/start" },
    {
      ...baseDeps,
      fetchFn: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:9000/admin" },
        }),
    },
  );
  assert.equal(ssrfRedirect.isError, true);
  assert.equal(readToolResult(ssrfRedirect)?.data.reason, "denied");
});

// ───────────────────────── Descarga válida y sanitización ─────────────────────────

test("download_file: descarga por stream usando Content-Disposition sanitizado, sigue redirects públicos y respeta overwrite", async () => {
  const root = makeTempDir();
  const env = makeEnv(root);
  fs.mkdirSync(env.downloads!, { recursive: true });

  let calls = 0;
  const deps = {
    getAllowedDirectories: () => [root],
    getEnvironment: async () => env,
    lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchFn: async (input: string) => {
      calls++;
      if (input.endsWith("/redir")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/files/reporte" },
        });
      }
      return new Response(streamFromChunks([Buffer.from("hola "), Buffer.from("jarvis")]), {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": "attachment; filename*=UTF-8''..%2F..%2Freporte%20final.txt",
        },
      });
    },
  };

  // Descarga a carpeta por defecto (`downloads`) con redirect
  const ok = await runDownloadFile({ url: "https://public.example.com/redir" }, deps);
  const okRead = readToolResult(ok);
  assert.ok(okRead);
  assert.equal(ok.isError, false);
  assert.equal(calls, 2);
  assert.equal(okRead.data.state, "ok");
  assert.equal(okRead.data.bytes, 11);
  assert.equal(okRead.data.contentType, "text/plain");
  // Traversal `../../` eliminado en filename
  const expectedPath = path.join(env.downloads!, "reporte final.txt");
  assert.equal(okRead.data.path, expectedPath);
  assert.equal(fs.readFileSync(expectedPath, "utf8"), "hola jarvis");
  // No quedan archivos .part
  assert.equal(
    fs.readdirSync(env.downloads!).some((n) => n.endsWith(".part")),
    false,
  );

  // Sin overwrite rechaza si ya existe
  const noOver = await runDownloadFile({ url: "https://cdn.example.com/files/reporte" }, deps);
  assert.equal(noOver.isError, true);
  assert.equal(readToolResult(noOver)?.data.reason, "already_exists");

  // Con destination + overwrite: true sobrescribe
  const customDest = path.join(root, "manual.txt");
  fs.writeFileSync(customDest, "viejo");
  const over = await runDownloadFile(
    { url: "https://cdn.example.com/files/reporte", destination: customDest, overwrite: true },
    deps,
  );
  assert.equal(over.isError, false);
  assert.equal(fs.readFileSync(customDest, "utf8"), "hola jarvis");
});

// ───────────────────────── Límites, errores, timeout y AbortSignal ─────────────────────────

test("download_file: corta descargas demasiado grandes, maneja errores HTTP, timeout, AbortSignal y limpia .part", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-dl-out-");
  const env = makeEnv(root);
  fs.mkdirSync(env.downloads!, { recursive: true });

  const baseDeps = {
    getAllowedDirectories: () => [root],
    getEnvironment: async () => env,
    lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
  };

  // Rechaza por Content-Length declarado mayor a maxBytes
  const clTooBig = await runDownloadFile(
    { url: "https://public.example.com/big.bin", maxBytes: 100 },
    {
      ...baseDeps,
      fetchFn: async () =>
        new Response(streamFromChunks([Buffer.from("x")]), {
          status: 200,
          headers: { "content-length": "500" },
        }),
    },
  );
  assert.equal(clTooBig.isError, true);
  assert.equal(readToolResult(clTooBig)?.data.reason, "too_large");

  // Rechaza por bytes reales recibidos aunque no haya Content-Length, y elimina el .part
  const streamTooBig = await runDownloadFile(
    { url: "https://public.example.com/stream.bin", filename: "grande.bin", maxBytes: 10 },
    {
      ...baseDeps,
      fetchFn: async () =>
        new Response(streamFromChunks([Buffer.alloc(6, 65), Buffer.alloc(6, 66)]), { status: 200 }),
    },
  );
  assert.equal(streamTooBig.isError, true);
  assert.equal(fs.existsSync(path.join(env.downloads!, "grande.bin")), false);
  assert.equal(
    fs.readdirSync(env.downloads!).some((n) => n.endsWith(".part")),
    false,
    "archivo .part debe limpiarse al abortar por tamaño",
  );

  // HTTP 404
  const notFound = await runDownloadFile(
    { url: "https://public.example.com/missing.zip" },
    { ...baseDeps, fetchFn: async () => new Response("Not Found", { status: 404, statusText: "Not Found" }) },
  );
  assert.equal(notFound.isError, true);
  assert.equal(readToolResult(notFound)?.data.httpStatus, 404);

  // Timeout usando fetch que respeta AbortSignal
  const timedOut = await runDownloadFile(
    { url: "https://public.example.com/slow.bin", timeoutMs: 100 },
    {
      ...baseDeps,
      fetchFn: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    },
  );
  assert.equal(timedOut.isError, true);
  assert.equal(readToolResult(timedOut)?.data.reason, "timeout");

  // AbortSignal externo
  const ac = new AbortController();
  ac.abort();
  const cancelled = await runDownloadFile(
    { url: "https://public.example.com/ok.bin" },
    { ...baseDeps, fetchFn: async () => new Response("ok", { status: 200 }) },
    { signal: ac.signal },
  );
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");

  // Destino fuera de allowedDirectories o symlink saliente -> denied sin descargar
  const linkDest = path.join(root, "escape.bin");
  fs.symlinkSync(path.join(outside, "ext.bin"), linkDest);
  const deniedDest = await runDownloadFile(
    { url: "https://public.example.com/ok.bin", destination: path.join(outside, "f.bin") },
    { ...baseDeps, fetchFn: async () => new Response("ok", { status: 200 }) },
  );
  assert.equal(deniedDest.isError, true);
  assert.equal(readToolResult(deniedDest)?.data.reason, "denied");

  const deniedLink = await runDownloadFile(
    { url: "https://public.example.com/ok.bin", destination: linkDest, overwrite: true },
    { ...baseDeps, fetchFn: async () => new Response("ok", { status: 200 }) },
  );
  assert.equal(deniedLink.isError, true);
  assert.equal(readToolResult(deniedLink)?.data.reason, "denied");

  // Symlink colgante apuntando fuera -> denied sin descargar ni crear destino externo
  const danglingTarget = path.join(outside, "dangling_dl.bin");
  const danglingLink = path.join(root, "dangling.bin");
  fs.symlinkSync(danglingTarget, danglingLink);
  const deniedDangling = await runDownloadFile(
    { url: "https://public.example.com/ok.bin", destination: danglingLink, overwrite: true },
    { ...baseDeps, fetchFn: async () => new Response("ok", { status: 200 }) },
  );
  assert.equal(deniedDangling.isError, true);
  assert.equal(readToolResult(deniedDangling)?.data.reason, "denied");
  assert.equal(fs.existsSync(danglingTarget), false);

  // Stream colgado (pull nunca resuelve) debe respetar timeoutMs y limpiar el .part
  const stalledRes = await runDownloadFile(
    { url: "https://public.example.com/stalled.bin", filename: "stalled.bin", timeoutMs: 100 },
    {
      ...baseDeps,
      fetchFn: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              return new Promise(() => {});
            },
          }),
          { status: 200 },
        ),
    },
  );
  assert.equal(stalledRes.isError, true);
  assert.equal(readToolResult(stalledRes)?.data.reason, "timeout");
  assert.equal(fs.existsSync(path.join(env.downloads!, "stalled.bin")), false);
  assert.equal(
    fs.readdirSync(env.downloads!).some((n) => n.endsWith(".part")),
    false,
    "archivo .part debe eliminarse tras timeout de stream colgado",
  );

  // AbortSignal externo en stream colgado debe cancelar limpiamente y borrar el .part
  const midAc = new AbortController();
  setTimeout(() => midAc.abort(), 30);
  const abortedStalled = await runDownloadFile(
    { url: "https://public.example.com/stalled2.bin", filename: "stalled2.bin" },
    {
      ...baseDeps,
      fetchFn: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              return new Promise(() => {});
            },
          }),
          { status: 200 },
        ),
    },
    { signal: midAc.signal },
  );
  assert.equal(abortedStalled.isError, false);
  assert.equal(readToolResult(abortedStalled)?.data.state, "cancelled");
  assert.equal(
    fs.readdirSync(env.downloads!).some((n) => n.endsWith(".part")),
    false,
  );
});

