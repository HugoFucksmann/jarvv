/**
 * Alias de carpetas del usuario con subruta (`desktop\Archivos\Docs`): una sola resolución (`filePaths.ts`) para las herramientas y para `prepareArgs`,
 * que expande los argumentos antes de que los vean el Guard, el pre-chequeo y `allowedDirectories`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { UserEnvironment } from "../src/core/environment.ts";
import { Guard } from "../src/core/policy/guard.ts";
import { expandAliasPath, expandPathAliases, resolveAlias } from "../src/core/tools/filePaths.ts";
import { FilesWriteProvider } from "../src/tools/files_write/filesWriteProvider.ts";

// El escritorio está redirigido (OneDrive): no es `home\Desktop`.
const win: UserEnvironment = {
  platform: "windows",
  home: "C:\\Users\\Ana",
  desktop: "D:\\OneDrive\\Escritorio",
  documents: "C:\\Users\\Ana\\Documents",
};

test("resolveAlias: el alias solo o con subruta (\\ o /) se une a la carpeta real; sin alias o sin esa carpeta, no", () => {
  assert.deepEqual(resolveAlias("desktop", win), { found: true, path: "D:\\OneDrive\\Escritorio" });
  assert.deepEqual(resolveAlias("Desktop\\Archivos\\Docs", win), { found: true, path: "D:\\OneDrive\\Escritorio\\Archivos\\Docs" });
  assert.deepEqual(resolveAlias("documents/a/b.txt", win), { found: true, path: "C:\\Users\\Ana\\Documents\\a\\b.txt" });
  assert.deepEqual(resolveAlias("downloads\\x", win), { found: false, missingAlias: "downloads" }, "esa carpeta no existe en este entorno");
  for (const raw of ["desktopfoo", "desktop.txt", "C:\\desktop\\x", "mi\\desktop", "~\\Desktop", ""]) {
    assert.deepEqual(resolveAlias(raw, win), { found: false }, raw);
  }
  assert.deepEqual(resolveAlias("desktop/a", { platform: "linux", home: "/home/ana", desktop: "/home/ana/Desktop" }), { found: true, path: "/home/ana/Desktop/a" });
});

test("resolveAlias: un `..` se normaliza al unir (los controles de ruta se aplican después, sobre la ruta resuelta)", () => {
  assert.deepEqual(resolveAlias("desktop\\..\\..\\Windows", win), { found: true, path: "D:\\Windows" });
});

test("expandAliasPath: el mismo texto si no es un alias o la carpeta no existe", () => {
  assert.equal(expandAliasPath("desktop\\a", win), "D:\\OneDrive\\Escritorio\\a");
  assert.equal(expandAliasPath("C:\\x\\y", win), "C:\\x\\y");
  assert.equal(expandAliasPath("downloads\\x", win), "downloads\\x");
});

test("expandPathAliases: rutas simples, listas y lotes; lo que no es una ruta no se toca", () => {
  const out = expandPathAliases(
    {
      path: "desktop\\Archivos",
      cwd: "home",
      paths: ["documents\\a", "C:\\ya\\absoluta"],
      sources: ["desktop\\s1"],
      items: [{ source: "desktop\\o", destination: "documents\\d", overwrite: false }, "raro"],
      content: "desktop\\esto es texto, no una ruta",
      command: "dir desktop\\x",
    },
    win,
  );
  assert.deepEqual(out, {
    path: "D:\\OneDrive\\Escritorio\\Archivos",
    cwd: "C:\\Users\\Ana",
    paths: ["C:\\Users\\Ana\\Documents\\a", "C:\\ya\\absoluta"],
    sources: ["D:\\OneDrive\\Escritorio\\s1"],
    items: [{ source: "D:\\OneDrive\\Escritorio\\o", destination: "C:\\Users\\Ana\\Documents\\d", overwrite: false }, "raro"],
    content: "desktop\\esto es texto, no una ruta",
    command: "dir desktop\\x",
  });
});

test("el Guard deniega `desktop\\x` en crudo (se resolvía contra el proyecto protegido) y deja pasar la ruta ya expandida", () => {
  const scope = { protectedDirs: [process.cwd()], relativeBases: [process.cwd()], homeDirs: ["C:\\Users\\Ana"] };
  const raw = { path: "desktop\\Archivos\\Documentos" };
  assert.equal(Guard.evaluate("jarvis_files_write", "create_folder", raw, scope).decision, "DENY");
  const expanded = expandPathAliases(raw, win);
  assert.notEqual(Guard.evaluate("jarvis_files_write", "create_folder", expanded, scope).decision, "DENY");
});

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("la herramienta acepta `alias/subruta`: create_folder crea bajo la carpeta real del alias", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-alias-"));
  tempDirs.push(root);
  const env: UserEnvironment = { platform: "linux", home: root, desktop: path.join(root, "EscritorioReal") };
  fs.mkdirSync(env.desktop as string);
  const provider = new FilesWriteProvider({ allowedDirectories: () => [root], environment: async () => env });
  const res = await provider.callTool("create_folder", { path: "desktop/Archivos/Documentos", recursive: true });
  assert.equal(res.isError, false, JSON.stringify(res.content));
  assert.ok(fs.statSync(path.join(root, "EscritorioReal", "Archivos", "Documentos")).isDirectory());
});
