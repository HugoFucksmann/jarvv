/**
 * Política de las tools nativas que escriben o modifican, de punta a punta: el motor real con proveedores reales sobre una carpeta temporal. Cubre la combinación de
 * modo automático (`autoMode`), aprobación por niveles (`approvalTiers`: verde, amarillo, rojo), la lista de reglas integradas (`policy/toolRules.ts`: blocked y
 * sensitive), Guard (DENY), Decisión 3 (revisión de argumentos; umbral estricto 0,65 en amarillo y sensitive) y la verificación del resultado (poscondición en el disco
 * por código, y Decisión 4 cuando no hay nada que mirar en el disco).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { IMCPServer } from "../src/core/mcp/types.ts";
import { FilesReadProvider } from "../src/tools/files_read/filesReadProvider.ts";
import { FilesWriteProvider } from "../src/tools/files_write/filesWriteProvider.ts";
import { SystemProvider, type ClipboardDriver } from "../src/tools/system/systemProvider.ts";
import { runNative } from "./helpers/native_flow.ts";

interface Rig {
  readonly root: string;
  readonly clipboard: string[];
}

/** Proveedores reales; `lieAbout` hace que esa tool de escritura diga «ok» sin escribir nada (para comprobar la poscondición en el disco). */
async function withRig(fn: (rig: Rig, providers: (lieAbout?: string) => Record<string, IMCPServer>) => Promise<void>): Promise<void> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-policy-")));
  const clipboard: string[] = [];
  const environment = async () => ({ platform: "windows" as const, home: root });
  const providers = (lieAbout?: string): Record<string, IMCPServer> => {
    const write = new FilesWriteProvider({ environment }) as unknown as IMCPServer;
    const clipboardDriver: ClipboardDriver = {
      async read() {
        return "";
      },
      async write(text) {
        clipboard.push(text);
      },
    };
    return {
      jarvis_files_read: new FilesReadProvider({ environment }) as unknown as IMCPServer,
      jarvis_files_write:
        lieAbout === undefined
          ? write
          : ({
              ...write,
              name: write.name,
              version: write.version,
              listTools: () => write.listTools(),
              isConnected: () => true,
              reconnect: async () => undefined,
              callTool: async (name, args, options) =>
                name === lieAbout ? { content: [{ type: "text", text: `status: ok · ${name} done` }] } : write.callTool(name, args, options),
            } as IMCPServer),
      jarvis_system: new SystemProvider({ environment, platform: "win32", clipboardDriver }) as unknown as IMCPServer,
    };
  };
  try {
    await fn({ root, clipboard }, providers);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const AUTO = { tiers: false, autoMode: true } as const;
const MANUAL = { tiers: false, autoMode: false } as const;
const TIERED = { tiers: true, autoMode: false } as const;
const TIERED_AUTO = { tiers: true, autoMode: true } as const;

// ───────────────────────── Verde, amarillo y rojo ─────────────────────────

test("verde: un archivo nuevo en las carpetas del usuario no pide confirmación, no pasa por Decisión 3 y se verifica por código sin consultar a Decisión 4", async () => {
  await withRig(async (rig, providers) => {
    for (const options of [TIERED, TIERED_AUTO]) {
      const file = path.join(rig.root, `verde-${options.autoMode}.txt`);
      const out = await runNative(providers(), rig.root, "files_write", "write_file", { path: file, content: "hola", mode: "create_only" }, options);
      assert.equal(out.state, "completed", JSON.stringify(out));
      assert.equal(out.approvals, 0);
      assert.equal(out.reviews, 0, "verde no pasa por Decisión 3");
      assert.equal(out.verifies, 0, "la poscondición en el disco decide sin Decisión 4");
      assert.equal(fs.readFileSync(file, "utf8"), "hola");
    }
  });
});

test("amarillo: agregar a un archivo pide al usuario sin modo automático; con modo automático lo revisa Decisión 3 con umbral estricto (0,70 pasa, 0,62 no)", async () => {
  await withRig(async (rig, providers) => {
    const file = path.join(rig.root, "nota.txt");
    fs.writeFileSync(file, "base");
    const args = { path: file, content: "+x", mode: "append" };
    const asked = await runNative(providers(), rig.root, "files_write", "write_file", args, { ...TIERED, approve: true });
    assert.equal(asked.approvals >= 1, true);
    assert.equal(asked.reviews, 0, "con la aprobación del usuario no se consulta a Decisión 3");
    assert.equal(fs.readFileSync(file, "utf8"), "base+x");

    const pass = await runNative(providers(), rig.root, "files_write", "write_file", args, { ...TIERED_AUTO, review: 0.7 });
    assert.equal(pass.approvals, 0);
    assert.equal(pass.reviews, 1);
    assert.equal(fs.readFileSync(file, "utf8"), "base+x+x");

    const fail = await runNative(providers(), rig.root, "files_write", "write_file", args, { ...TIERED_AUTO, review: 0.62 });
    assert.equal(fail.approvals, 0);
    assert.equal(fail.reviews >= 1, true);
    assert.equal(fail.dispatched.length, 0, "no alcanza el umbral estricto: no se despacha");
    assert.equal(fs.readFileSync(file, "utf8"), "base+x+x");
  });
});

test("rojo: sobrescribir un archivo que existe pide al usuario siempre, también con modo automático, y no pasa por Decisión 3", async () => {
  await withRig(async (rig, providers) => {
    const file = path.join(rig.root, "nota.txt");
    fs.writeFileSync(file, "original");
    for (const options of [TIERED, TIERED_AUTO]) {
      const refused = await runNative(providers(), rig.root, "files_write", "write_file", { path: file, content: "pisado", mode: "rewrite" }, { ...options, approve: false });
      assert.equal(refused.approvals >= 1, true);
      assert.equal(refused.reviews, 0);
      assert.equal(refused.dispatched.length, 0);
      assert.equal(fs.readFileSync(file, "utf8"), "original");
    }
    const accepted = await runNative(providers(), rig.root, "files_write", "write_file", { path: file, content: "pisado", mode: "rewrite" }, { ...TIERED_AUTO, approve: true });
    assert.equal(accepted.state, "completed", JSON.stringify(accepted));
    assert.equal(fs.readFileSync(file, "utf8"), "pisado");
  });
});

// ───────────────────────── Sin niveles ─────────────────────────

test("sin niveles: el modo manual pregunta al usuario; el modo automático lo revisa Decisión 3 con el umbral normal (0,6)", async () => {
  await withRig(async (rig, providers) => {
    const manual = await runNative(providers(), rig.root, "files_write", "write_file", { path: path.join(rig.root, "a.txt"), content: "a" }, { ...MANUAL, approve: true });
    assert.equal(manual.approvals >= 1, true);
    assert.equal(manual.reviews, 0);
    assert.equal(fs.existsSync(path.join(rig.root, "a.txt")), true);

    const pass = await runNative(providers(), rig.root, "files_write", "write_file", { path: path.join(rig.root, "b.txt"), content: "b" }, { ...AUTO, review: 0.62 });
    assert.equal(pass.approvals, 0);
    assert.equal(pass.reviews, 1);
    assert.equal(fs.existsSync(path.join(rig.root, "b.txt")), true, "0,62 supera el umbral normal");

    const fail = await runNative(providers(), rig.root, "files_write", "write_file", { path: path.join(rig.root, "c.txt"), content: "c" }, { ...AUTO, review: 0.4 });
    assert.equal(fail.dispatched.length, 0);
    assert.equal(fs.existsSync(path.join(rig.root, "c.txt")), false);
  });
});

// ───────────────────────── Reglas integradas y Guard ─────────────────────────

test("Guard: borrar la raíz de un disco o la carpeta de Windows se deniega siempre, con o sin aprobación del usuario", async () => {
  await withRig(async (rig, providers) => {
    for (const target of ["C:" + String.fromCharCode(92), ["C:", "Windows"].join(String.fromCharCode(92))]) {
      for (const options of [TIERED, MANUAL, AUTO]) {
        const out = await runNative(providers(), rig.root, "files_write", "delete_file", { path: target, recursive: true, permanent: true }, { ...options, approve: true });
        assert.equal(out.dispatched.length, 0, `${target}: no se despacha`);
        assert.equal(out.approvals, 0, `${target}: ni siquiera se le pregunta al usuario`);
        assert.equal(out.calls[0]?.status, "tool_rejected");
      }
    }
  });
});

test("blocked: borrar una carpeta personal entera se rechaza con niveles o modo automático, y sin ellos se le pregunta al usuario", async () => {
  await withRig(async (rig, providers) => {
    for (const options of [TIERED, TIERED_AUTO, AUTO]) {
      const out = await runNative(providers(), rig.root, "files_write", "delete_file", { path: "documents", recursive: true }, { ...options, approve: true });
      assert.equal(out.calls[0]?.status, "tool_rejected", JSON.stringify(options));
      assert.equal(out.approvals, 0);
      assert.equal(out.dispatched.length, 0);
    }
    const asked = await runNative(providers(), rig.root, "files_write", "delete_file", { path: "documents", recursive: true }, { ...MANUAL, approve: false });
    assert.equal(asked.approvals >= 1, true, "sin niveles ni modo automático, toda coincidencia se le pregunta al usuario");
    assert.equal(asked.dispatched.length, 0);
  });
});

test("borrar un archivo común es rojo: siempre confirma el usuario; aprobado, se borra", async () => {
  await withRig(async (rig, providers) => {
    const file = path.join(rig.root, "borrar.txt");
    fs.writeFileSync(file, "x");
    for (const options of [TIERED, TIERED_AUTO]) {
      const refused = await runNative(providers(), rig.root, "files_write", "delete_file", { path: file, permanent: true }, { ...options, approve: false });
      assert.equal(refused.approvals >= 1, true);
      assert.equal(fs.existsSync(file), true);
    }
    const ok = await runNative(providers(), rig.root, "files_write", "delete_file", { path: file, permanent: true }, { ...TIERED_AUTO, approve: true });
    assert.equal(ok.state, "completed", JSON.stringify(ok));
    assert.equal(fs.existsSync(file), false);
  });
});

test("sensitive: escribir un script o un ejecutable le pregunta al usuario con niveles, también en modo automático; sin niveles lo decide Decisión 3 estricta", async () => {
  await withRig(async (rig, providers) => {
    const script = path.join(rig.root, "tarea.ps1");
    for (const options of [TIERED, TIERED_AUTO]) {
      const refused = await runNative(providers(), rig.root, "files_write", "write_file", { path: script, content: "Get-Date" }, { ...options, approve: false });
      assert.equal(refused.approvals >= 1, true, JSON.stringify(options));
      assert.equal(fs.existsSync(script), false);
    }
    const strictFail = await runNative(providers(), rig.root, "files_write", "write_file", { path: script, content: "Get-Date" }, { ...AUTO, review: 0.62 });
    assert.equal(strictFail.dispatched.length, 0, "0,62 no alcanza el umbral estricto de lo sensitive");
    const strictPass = await runNative(providers(), rig.root, "files_write", "write_file", { path: script, content: "Get-Date" }, { ...AUTO, review: 0.7 });
    assert.equal(strictPass.approvals, 0);
    assert.equal(fs.existsSync(script), true);
    const other = path.join(rig.root, "nota.txt");
    const plain = await runNative(providers(), rig.root, "files_write", "write_file", { path: other, content: "x" }, { ...TIERED, approve: true });
    assert.equal(plain.approvals, 0, "un texto común sigue verde");
  });
});

test("sensitive: una descarga de un ejecutable le pregunta al usuario aun con modo automático (y un «no» no toca la red)", async () => {
  await withRig(async (rig, providers) => {
    const web = { jarvis_web: (await import("../src/tools/web/webSearchProvider.ts")).WebSearchProvider };
    const provider = new web.jarvis_web({ environment: async () => ({ platform: "windows", home: rig.root }) }) as unknown as IMCPServer;
    const out = await runNative({ ...providers(), jarvis_web: provider }, rig.root, "web", "download_file", { url: "https://example.invalid/setup.exe", folder: "downloads" }, { ...TIERED_AUTO, approve: false });
    assert.equal(out.approvals >= 1, true);
    assert.equal(out.dispatched.length, 0);
  });
});

// ───────────────────────── Verificación del resultado (Decisión 4) ─────────────────────────

test("verificación por código: una escritura que dice «ok» y no dejó nada en el disco se rechaza sin consultar a Decisión 4", async () => {
  await withRig(async (rig, providers) => {
    const file = path.join(rig.root, "fantasma.txt");
    const out = await runNative(providers("write_file"), rig.root, "files_write", "write_file", { path: file, content: "hola", mode: "create_only" }, { ...TIERED, verify: { ok: 0.99, cumple: 0.99 } });
    assert.equal(fs.existsSync(file), false);
    assert.equal(out.calls[0]?.verdict, "rejected");
    assert.equal(out.calls[0]?.reason, "not_accomplished");
    assert.equal(out.verifies, 0, "la poscondición decide por código");
  });
});

test("verificación por modelo: sin nada que mirar en el disco, Decisión 4 decide, también con modo automático y niveles", async () => {
  await withRig(async (rig, providers) => {
    const good = await runNative(providers(), rig.root, "system", "clipboard", { action: "write", text: "hola" }, { ...TIERED_AUTO, review: 0.9, verify: { ok: 0.95, cumple: 0.95 } });
    assert.equal(good.state, "completed", JSON.stringify(good));
    assert.equal(good.verifies >= 1, true, "Decisión 4 verifica lo que el código no puede comprobar");
    assert.equal(good.calls[0]?.verdict, "approved");

    const bad = await runNative(providers(), rig.root, "system", "clipboard", { action: "write", text: "hola" }, { ...TIERED_AUTO, review: 0.9, verify: { ok: 0.02, cumple: 0.02 } });
    assert.equal(bad.calls[0]?.verdict, "rejected", "Decisión 4 rechaza el resultado");
    assert.notEqual(bad.state, "completed");
  });
});

test("las lecturas no pasan por Decisión 3 ni piden confirmación, con cualquier combinación de modo automático y niveles", async () => {
  await withRig(async (rig, providers) => {
    fs.writeFileSync(path.join(rig.root, "nota.txt"), "hola");
    for (const options of [TIERED, TIERED_AUTO, MANUAL, AUTO]) {
      const out = await runNative(providers(), rig.root, "files_read", "read_file", { path: path.join(rig.root, "nota.txt") }, options);
      assert.equal(out.state, "completed", JSON.stringify([options, out]));
      assert.equal(out.approvals, 0);
      assert.equal(out.reviews, 0);
    }
  });
});
