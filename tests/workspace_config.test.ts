/** `workspace` (carpeta base y carpetas permitidas) reemplazó a `desktopCommanderMcp`: un archivo de configuración anterior no pierde sus carpetas permitidas. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeConfig } from "../src/core/config.ts";

test("un jarvis-config.json anterior con desktopCommanderMcp conserva allowedDirectories y cwd en workspace", () => {
  const config = normalizeConfig({ desktopCommanderMcp: { command: "node", args: ["x.js"], cwd: "C:\Trabajo", allowedDirectories: ["C:\Users\Ana", "D:\Datos"] } });
  assert.deepEqual(config.workspace, { allowedDirectories: ["C:\Users\Ana", "D:\Datos"], cwd: "C:\Trabajo" });
  assert.equal("desktopCommanderMcp" in config, false);
});

test("workspace gana sobre la clave anterior, y sin ninguna de las dos no hay restricción", () => {
  assert.deepEqual(normalizeConfig({ workspace: { allowedDirectories: ["C:\A"] }, desktopCommanderMcp: { allowedDirectories: ["C:\B"] } }).workspace, { allowedDirectories: ["C:\A"] });
  assert.deepEqual(normalizeConfig({}).workspace, { allowedDirectories: [] });
});
