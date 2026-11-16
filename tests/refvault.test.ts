/** Almacén de refs: guardado, lectura confinada al directorio y tope de tamaño por ref. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createRefVault, REF_MAX_CHARS, refTruncationMarker, RefVaultError } from "../src/core/refs/refVault.ts";

const withVault = async (fn: (vault: ReturnType<typeof createRefVault>, dir: string) => Promise<void>): Promise<void> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-vault-"));
  try {
    await fn(createRefVault({ dir }), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("put guarda el texto tal cual y readAll lo devuelve; el tamaño es el del texto", () =>
  withVault(async (vault) => {
    const stored = await vault.put("task_1", "hola ñandú\nsegunda línea");
    assert.equal(stored.size, "hola ñandú\nsegunda línea".length);
    assert.equal(await vault.readAll(stored.where), "hola ñandú\nsegunda línea");
  }));

test("put: un texto exactamente del tope se guarda entero", () =>
  withVault(async (vault) => {
    const text = "a".repeat(REF_MAX_CHARS);
    const stored = await vault.put("task_1", text);
    assert.equal(stored.size, REF_MAX_CHARS);
    assert.equal((await vault.readAll(stored.where)).length, REF_MAX_CHARS);
  }));

test("put: un texto mayor que el tope se corta y termina con la marca explícita; size es lo guardado", () =>
  withVault(async (vault) => {
    const text = "a".repeat(REF_MAX_CHARS) + "b".repeat(1234);
    const stored = await vault.put("task_1", text);
    const marker = refTruncationMarker(1234);
    assert.equal(stored.size, REF_MAX_CHARS + marker.length);
    const saved = await vault.readAll(stored.where);
    assert.equal(saved.length, stored.size);
    assert.ok(saved.endsWith(marker));
    assert.ok(!saved.includes("b"), "lo que pasa del tope no se guarda");
  }));

test("readAll solo lee dentro del directorio del almacén", () =>
  withVault(async (vault, dir) => {
    await assert.rejects(vault.readAll(path.join(dir, "..", "fuera.txt")), (e: unknown) => e instanceof RefVaultError && e.code === "outside_dir");
  }));
