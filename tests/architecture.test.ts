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
