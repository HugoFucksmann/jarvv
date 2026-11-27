/**
 * Observación de artefactos (`engine/artifacts.ts`): el esbozo de un archivo, la huella de su ruta y la lectura del disco, sin modelos.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ARTIFACT_KEY_PREFIX, artifactKey, artifactPathOf, observePath, outlineOf } from "../src/core/engine/artifacts.ts";
import type { DiskView } from "../src/core/types/disk.ts";

test("esbozo: cada encabezado con su primera línea, y un encabezado repetido se cuenta (×N)", () => {
  const text = "# Viaje\n\n## Hospedaje\n- Hotel A\n- Hotel B\n\n## Pasajes\n- Se están buscando opciones\n\n## Hospedaje\n- Hotel A\n\n## Hospedaje\n- Hotel A\n";
  const outline = outlineOf(text, text.length);
  assert.match(outline, /Outline: # Viaje \| ## Hospedaje ×3: Hotel A \| ## Pasajes: Se están buscando opciones/);
  assert.match(outline, /^\d+ B, \d+ lines\./);
});

test("esbozo: un relleno se ve (la primera línea de la sección es lo que se muestra)", () => {
  assert.match(outlineOf("## Pasajes\n- Se están buscando opciones de transporte\n", 60), /## Pasajes: Se están buscando opciones de transporte/);
});

test("esbozo: sin encabezados muestra el comienzo y el final; vacío se dice vacío; muchos encabezados se recortan", () => {
  assert.match(outlineOf("primera línea\nsegunda\n\núltima línea\n", 40), /Starts: "primera línea"; ends: "última línea"/);
  assert.match(outlineOf("  \n\n", 3), /empty$/);
  const many = Array.from({ length: 14 }, (_, i) => `## S${i}\ntexto ${i}`).join("\n");
  const outline = outlineOf(many, many.length);
  assert.match(outline, /\| \+4 more$/);
  assert.equal(outline.includes("## S11"), false);
});

test("huella: estable, sin distinguir mayúsculas ni el tipo de separador, y distinta entre rutas", () => {
  assert.equal(artifactKey("C:\\Users\\Ana\\Viaje.md"), artifactKey("c:/users/ana/viaje.md"));
  assert.notEqual(artifactKey("C:\\Users\\Ana\\a.md"), artifactKey("C:\\Users\\Ana\\b.md"));
  assert.match(artifactKey("C:\\x.md"), new RegExp(`^${ARTIFACT_KEY_PREFIX}[0-9a-f]{8}$`));
  assert.equal(artifactPathOf("C:\\Users\\Ana\\a.md · 3 B, 1 lines"), "C:\\Users\\Ana\\a.md");
});

const disk = (files: Record<string, string>, folders: Record<string, string[]> = {}): DiskView => ({
  exists: (p) => p in files || p in folders,
  isDirectory: (p) => p in folders,
  size: (p) => files[p]?.length ?? 0,
  readText: (p) => files[p] ?? null,
  list: (p) => folders[p] ?? null,
});

test("observación: archivo de texto, carpeta, binario y ruta que no se puede mirar", () => {
  const d = disk({ "C:\\a.md": "## Uno\nhola\n", "C:\\x.bin": "" }, { "C:\\carpeta": ["a.txt", "b.txt"] });
  assert.match(observePath("C:\\a.md", d) ?? "", /^C:\\a\.md · .*Outline: ## Uno: hola/);
  assert.match(observePath("C:\\carpeta", d) ?? "", /folder, 2 entries: a\.txt, b\.txt/);
  assert.equal(observePath("C:\\no_existe.md", d), null);
  assert.equal(observePath("relativa\\a.md", d), null, "una ruta relativa no se mira");
  assert.equal(observePath("C:\\{{ref}}\\a.md", d), null, "un marcador sin resolver tampoco");
  const noRead: DiskView = { exists: () => true, isDirectory: () => false, size: () => 2048 };
  assert.match(observePath("C:\\b.pdf", noRead) ?? "", /2\.0 KB, not text or not readable/);
});

test("observación: el valor del hecho cabe en el tope de los hechos (500)", () => {
  const long = Array.from({ length: 40 }, (_, i) => `## Sección número ${i} con un título bastante largo para llenar\ncontenido de la sección ${i} que también es largo`).join("\n");
  const value = observePath("C:\\grande.md", disk({ "C:\\grande.md": long })) ?? "";
  assert.equal(value.length <= 480, true, String(value.length));
});
