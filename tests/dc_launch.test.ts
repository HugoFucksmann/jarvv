/** Desktop Commander se lanza con `node` directo: si falta el archivo (falta `npm install`), se avisa al arrancar y no recién en la primera tarea. */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { missingLaunchScript } from "../src/core/mcp/desktopCommanderMcp.ts";

const SCRIPT = "node_modules/@wonderwhy-er/desktop-commander/dist/index.js";

test("con node y el archivo presente no hay aviso; ausente, el aviso nombra la ruta completa y npm install", () => {
  assert.equal(missingLaunchScript({ command: "node", args: [SCRIPT] }, () => true), null);
  const message = missingLaunchScript({ command: "node", args: [SCRIPT] }, () => false);
  assert.ok(message?.includes(path.resolve(process.cwd(), SCRIPT)));
  assert.ok(message?.includes("npm install"));
});

test("la ruta es relativa al cwd configurado, y las opciones de node (`--flag`) no se toman por el archivo", () => {
  const seen: string[] = [];
  const cwd = path.resolve("carpeta-de-trabajo");
  missingLaunchScript({ command: "node", args: ["--no-warnings", SCRIPT], cwd }, (file) => (seen.push(file), true));
  assert.deepEqual(seen, [path.resolve(cwd, SCRIPT)]);
});

test("otros comandos (npx, uvx) no se comprueban; node con ruta completa y .exe sí", () => {
  assert.equal(missingLaunchScript({ command: "npx", args: ["-y", "paquete"] }, () => false), null);
  assert.equal(missingLaunchScript({ command: "uvx", args: ["--from", "x"] }, () => false), null);
  assert.ok(missingLaunchScript({ command: path.join("C:", "Program Files", "nodejs", "node.exe"), args: [SCRIPT] }, () => false) !== null);
  assert.equal(missingLaunchScript({ command: "node", args: [] }, () => false), null);
});
