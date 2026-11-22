/** Dependencias en un solo sentido: el núcleo (`src/core/`) no importa los proveedores nativos (`src/tools/`); estos solo conocen los tipos del núcleo. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SRC = path.resolve("src");
const CORE = path.join(SRC, "core");
const TOOLS = path.join(SRC, "tools");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : full.endsWith(".ts") ? [full] : [];
  });
}

/** Rutas absolutas de lo que importa un archivo con un especificador relativo (`import`, `export … from` e `import()`). */
function relativeImports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const found = [...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  return found.map((spec) => path.resolve(path.dirname(file), spec));
}

const inside = (dir: string, target: string): boolean => {
  const relative = path.relative(dir, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

test("el núcleo no importa ningún proveedor nativo de src/tools/", () => {
  const offenders = files(CORE).flatMap((file) => relativeImports(file).filter((target) => inside(TOOLS, target)).map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`));
  assert.deepEqual(offenders, []);
});

test("los proveedores nativos solo importan del núcleo tipos, utilidades y contratos: nunca el motor ni los modelos", () => {
  const forbidden = ["engine", "models", "ctx", "trace", "reasoner"].map((name) => path.join(CORE, name));
  const offenders = files(TOOLS).flatMap((file) =>
    relativeImports(file)
      .filter((target) => forbidden.some((dir) => inside(dir, target)))
      .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
  );
  assert.deepEqual(offenders, []);
});

test("cada proveedor nativo vive en su carpeta y las demás no lo importan entre sí", () => {
  const folders = fs.readdirSync(TOOLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(TOOLS, e.name));
  assert.ok(folders.length >= 2);
  for (const folder of folders) {
    const others = folders.filter((f) => f !== folder);
    const offenders = files(folder).flatMap((file) => relativeImports(file).filter((target) => others.some((o) => inside(o, target))).map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`));
    assert.deepEqual(offenders, []);
  }
});

test("el núcleo no conoce las vías de entrada y salida (Telegram, voz, servidor), y estas no dependen del servidor", () => {
  const dir = (name: string) => path.join(SRC, name);
  const offenders = (from: string, forbidden: string[]) =>
    files(dir(from)).flatMap((file) =>
      relativeImports(file)
        .filter((target) => forbidden.some((name) => inside(dir(name), target)))
        .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
    );
  assert.deepEqual(offenders("core", ["telegram", "voice", "server"]), []);
  assert.deepEqual(offenders("tools", ["telegram", "voice", "server"]), []);
  assert.deepEqual(offenders("telegram", ["server"]), []);
  assert.deepEqual(offenders("voice", ["server", "telegram"]), []);
});

test("el catálogo y las políticas del núcleo (`core/tools`, `core/policy`) no importan el motor ni los modelos: la dependencia va del motor hacia ellos", () => {
  const forbidden = ["engine", "models"].map((name) => path.join(CORE, name));
  const offenders = [path.join(CORE, "tools"), path.join(CORE, "policy")].flatMap((dir) =>
    files(dir).flatMap((file) =>
      relativeImports(file)
        .filter((target) => forbidden.some((forbiddenDir) => inside(forbiddenDir, target)))
        .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
    ),
  );
  assert.deepEqual(offenders, []);
});

test("el motor no elige la implementación de la memoria: solo importa su puerto (tipos); el proveedor lo elige la raíz de composición", () => {
  const offenders = files(path.join(CORE, "engine")).filter((file) => /^import\s+(?!type\b)[^;]*memory\/index/m.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(SRC, file));
  assert.deepEqual(offenders, []);
});

test("`core/policy` solo consulta el sistema para el inicio del usuario en un lugar (`homeDirs.ts`)", () => {
  const offenders = files(path.join(CORE, "policy"))
    .filter((file) => path.basename(file) !== "homeDirs.ts")
    .filter((file) => /\bos\.homedir\s*\(/.test(fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(offenders, []);
});

test("los modelos y los contratos no importan el motor (`engine/`): la dependencia va del motor hacia ellos", () => {
  const engine = path.join(CORE, "engine");
  const files_ = [...files(path.join(CORE, "models")), path.join(CORE, "contracts.ts")];
  const offenders = files_.flatMap((file) =>
    relativeImports(file)
      .filter((target) => inside(engine, target))
      .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
  );
  assert.deepEqual(offenders, []);
});

test("los renderizadores (`render/`) no importan el motor ni los modelos", () => {
  const forbidden = ["engine", "models"].map((name) => path.join(CORE, name));
  const offenders = files(path.join(CORE, "render")).flatMap((file) =>
    relativeImports(file)
      .filter((target) => forbidden.some((dir) => inside(dir, target)))
      .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
  );
  assert.deepEqual(offenders, []);
});

test("el contexto (`ctx/`) no importa nada fuera de `ctx/`: ni el núcleo, ni paquetes externos (solo `node:`)", () => {
  const ctxDir = path.join(CORE, "ctx");
  const offenders = files(ctxDir).flatMap((file) => {
    const text = fs.readFileSync(file, "utf8");
    const specifiers = [...text.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm)].map((m) => m[1] ?? m[2]);
    return specifiers
      .filter((spec) => (spec.startsWith(".") ? !inside(ctxDir, path.resolve(path.dirname(file), spec)) : !spec.startsWith("node:")))
      .map((spec) => `${path.relative(SRC, file)} → ${spec}`);
  });
  assert.deepEqual(offenders, []);
});

// ───────────────────────── Aislamiento del contexto y del flujo ─────────────────────────

/** `origen → destino` de cada import de `fromDirs` (carpetas de `src/`) que cae dentro de alguna de `forbiddenDirs`. */
function violations(fromDirs: string[], forbiddenDirs: string[]): string[] {
  const abs = (name: string) => path.join(SRC, name);
  return fromDirs.flatMap((from) =>
    files(abs(from)).flatMap((file) =>
      relativeImports(file)
        .filter((target) => forbiddenDirs.some((name) => inside(abs(name), target)))
        .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
    ),
  );
}

test("el contexto (`core/ctx`) no depende de nada fuera de sí: es el estado de la tarea y no conoce motor, modelos, herramientas ni políticas", () => {
  const ctx = path.join(CORE, "ctx");
  const offenders = files(ctx).flatMap((file) =>
    relativeImports(file)
      .filter((target) => !inside(ctx, target) && path.dirname(target) !== ctx && target !== ctx)
      .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`),
  );
  assert.deepEqual(offenders, []);
});

test("el motor no importa los modelos: recibe sus decisiones y su generación por los contratos (`contracts.ts`), así se prueba con falsos", () => {
  assert.deepEqual(violations(["core/engine"], ["core/models", "tools", "server", "telegram", "voice"]), []);
});

test("la traza y el cliente MCP no dependen del motor ni de los modelos: leen datos (`core/types`) y errores comunes (`core/utils`)", () => {
  assert.deepEqual(violations(["core/trace", "core/mcp"], ["core/engine", "core/models"]), []);
});

test("las vías externas (Telegram, voz) no importan el motor ni los modelos: el núcleo les llega por la API HTTP y por tipos (los eventos de `core/ctx`, los de `core/types`)", () => {
  assert.deepEqual(violations(["telegram", "voice"], ["core/engine", "core/models"]), []);
});
