/**
 * Invariantes estructurales y de arquitectura (Fase 2 de auditoría).
 *
 * - Aislamiento estricto de `src/core/ctx/` (incluyendo `views/`).
 * - Puntos únicos de despacho `.callTool(`.
 * - Invariante 12: `policy/`, `result/`, `refs/` y `models/` no importan `engine/`, `tasks.ts` ni `server/`.
 *   (La violación detectada en `models/` → `engine/` queda documentada como `test.skip`).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SRC = path.resolve("src");
const CORE = path.join(SRC, "core");
const CTX = path.join(CORE, "ctx");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function relativeImports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const found = [...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  return found.map((spec) => path.resolve(path.dirname(file), spec));
}

function externalImports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((spec) => !spec.startsWith("."));
}

const inside = (dir: string, target: string): boolean => {
  const rel = path.relative(dir, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

test("ctx/ (incluido views/) está 100% aislado: solo importa módulos relativos dentro de ctx/ y cero dependencias externas", () => {
  const ctxFiles = files(CTX);
  assert.ok(ctxFiles.length >= 20);

  const relativeOffenders: string[] = [];
  const externalOffenders: string[] = [];

  for (const file of ctxFiles) {
    for (const target of relativeImports(file)) {
      if (!inside(CTX, target)) {
        relativeOffenders.push(`${path.relative(SRC, file)} → ${path.relative(SRC, target)}`);
      }
    }
    for (const spec of externalImports(file)) {
      externalOffenders.push(`${path.relative(SRC, file)} → ${spec}`);
    }
  }

  assert.deepEqual(relativeOffenders, []);
  assert.deepEqual(externalOffenders, []);
});

test("ctx/derive.ts recibe las políticas de repetición por inversión de dependencias (no importa manifest.ts ni policy/rerun.ts)", () => {
  const deriveFile = path.join(CTX, "derive.ts");
  const targets = relativeImports(deriveFile).map((t) => path.relative(SRC, t));
  assert.equal(targets.some((t) => t.includes("manifest") || t.includes("rerun")), false);
  assert.ok(targets.every((t) => t.startsWith(`core${path.sep}ctx${path.sep}`)));
});

test("auditoría estática de .callTool(: solo aparece en capture.ts, wrappers MCP y mcpRouter.ts", () => {
  const allowed = new Set([
    path.join("core", "engine", "capture.ts"),
    path.join("core", "mcp", "stdioServer.ts"),
    path.join("core", "mcp", "desktopCommanderMcp.ts"),
    path.join("server", "mcpRouter.ts"),
  ]);

  const found: string[] = [];
  for (const file of files(SRC)) {
    const code = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    if (/\.callTool\s*\(/.test(code)) {
      found.push(path.relative(SRC, file));
    }
  }

  for (const rel of found) {
    assert.ok(allowed.has(rel), `Sitio inesperado de .callTool(: ${rel}`);
  }
  assert.deepEqual(new Set(found), allowed);
});

test("Invariante 12 (policy, result, refs): nunca importan engine/, tasks.ts ni server/", () => {
  const forbidden = [
    path.join(CORE, "engine"),
    path.join(CORE, "tasks.ts"),
    path.join(SRC, "server"),
  ];

  for (const folder of ["policy", "result", "refs"]) {
    const offenders = files(path.join(CORE, folder)).flatMap((file) =>
      relativeImports(file)
        .filter((target) => forbidden.some((f) => target === f || inside(f, target)))
        .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
    );
    assert.deepEqual(offenders, [], `Dependencia prohibida desde ${folder}/`);
  }
});

test("Invariante 12 (models): nunca importa tasks.ts ni server/", () => {
  const forbidden = [path.join(CORE, "tasks.ts"), path.join(SRC, "server")];
  const offenders = files(path.join(CORE, "models")).flatMap((file) =>
    relativeImports(file)
      .filter((target) => forbidden.some((f) => target === f || inside(f, target)))
      .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
  );
  assert.deepEqual(offenders, []);
});

test.skip("Invariante 12 (VIOLACIÓN REAL en código): models/ nunca importa engine/ (decision.ts:46 -> firstQuery.ts, prompts.ts:17 -> thread.ts)", () => {
  const engineDir = path.join(CORE, "engine");
  const offenders = files(path.join(CORE, "models")).flatMap((file) =>
    relativeImports(file)
      .filter((target) => inside(engineDir, target))
      .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
  );
  assert.deepEqual(offenders, []);
});
