/**
 * El grupo `system` y `download_file` (grupo `web`) en el catálogo: rutas y servidores, reglas de nivel, poscondiciones, datos sensibles hacia internet y el destino de
 * una descarga. Los esquemas de los proveedores contra el manifest están en `native_files_catalog.test.ts`.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { postconditionOf, NO_DISK_POSTCONDITION } from "../src/core/engine/postcondition.ts";
import { Guard } from "../src/core/policy/guard.ts";
import { approvalTierOf } from "../src/core/policy/tiers.ts";
import { DESTINATIONS, SYSTEM_TOOL_MANIFEST, serverOf } from "../src/core/tools/manifest.ts";
import { isPathWriteTool } from "../src/core/tools/toolTargets.ts";
import { EXECUTABLE_ROUTES, MCP_SERVERS } from "../src/core/types/routes.ts";
import { WebSearchProvider } from "../src/tools/web/webSearchProvider.ts";

test("rutas: el orden de los grupos sigue al doc, cada una tiene su servidor nativo y todo servidor del catálogo existe", () => {
  assert.deepEqual([...EXECUTABLE_ROUTES], ["terminal", "files_read", "files_write", "system", "multimedia", "web"]);
  assert.deepEqual(
    EXECUTABLE_ROUTES.map((route) => serverOf(route)),
    ["jarvis_terminal", "jarvis_files_read", "jarvis_files_write", "jarvis_system", "jarvis_multimedia", "jarvis_web"],
  );
  for (const route of EXECUTABLE_ROUTES) assert.ok(DESTINATIONS[route].description.length > 20, `${route} necesita criterio para D1`);
  for (const d of SYSTEM_TOOL_MANIFEST) assert.ok((MCP_SERVERS as readonly string[]).includes(d.server), `${d.name}: el servidor '${d.server}' no está en MCP_SERVERS`);
  assert.equal((MCP_SERVERS as readonly string[]).includes("jarvis_files"), false, "el proveedor viejo jarvis_files ya no existe");
});

test("catálogo: list_processes y la antigua stop_process del terminal no existen; stop_process es de system y system_info absorbe los procesos", () => {
  const names = SYSTEM_TOOL_MANIFEST.map((d) => d.name);
  assert.equal(names.includes("list_processes"), false);
  assert.equal(names.filter((n) => n === "stop_process").length, 1);
  assert.equal(SYSTEM_TOOL_MANIFEST.find((d) => d.name === "stop_process")?.server, "jarvis_system");
  assert.equal(SYSTEM_TOOL_MANIFEST.find((d) => d.name === "run_command")?.server, "jarvis_terminal");
  for (const d of SYSTEM_TOOL_MANIFEST.filter((x) => x.route === "terminal")) assert.equal(d.name, "run_command", "el grupo terminal es solo run_command");
});

test("catálogo: system_info no pide aprobación; las demás tools de system la piden", () => {
  const byName = (name: string) => SYSTEM_TOOL_MANIFEST.find((d) => d.name === name)!;
  assert.equal(byName("system_info").policy.mutates, false);
  assert.equal(byName("system_info").policy.requiresApproval, false);
  for (const name of ["stop_process", "pc_settings", "power", "open_on_screen", "clipboard"]) {
    assert.equal(byName(name).policy.requiresApproval, true, name);
    assert.ok(NO_DISK_POSTCONDITION.has(name), `${name} no deja nada en el disco`);
  }
  assert.equal(byName("download_file").policy.capability, "DOWNLOAD");
  assert.equal(byName("download_file").policy.requiresApproval, true);
});

// ───────────────────────── Niveles ─────────────────────────

const ENV = { platform: "windows" as const, home: "C:\\Users\\Ana", desktop: "C:\\Users\\Ana\\Desktop", documents: "C:\\Users\\Ana\\Documents", downloads: "C:\\Users\\Ana\\Downloads" };
const FOLDERS = [ENV.home, ENV.desktop, ENV.documents, ENV.downloads];
const tier = (tool: string, args: Record<string, unknown>, existing: string[] = []) =>
  approvalTierOf(tool, args, ENV, { exists: (p: string) => existing.includes(p) || FOLDERS.includes(p) });

test("niveles de system: leer es verde, cambiar es amarillo, reiniciar, apagar y cortar procesos son rojos", () => {
  assert.equal(tier("pc_settings", { setting: "brightness", action: "get" }), "green");
  assert.equal(tier("pc_settings", { setting: "brightness", action: "set", value: 40 }), "yellow");
  assert.equal(tier("power", { action: "lock" }), "yellow");
  assert.equal(tier("power", { action: "sleep" }), "yellow");
  assert.equal(tier("power", { action: "restart" }), "red");
  assert.equal(tier("power", { action: "shutdown", delaySec: 60 }), "red");
  assert.equal(tier("stop_process", { name: "notepad" }), "red");
  assert.equal(tier("clipboard", { action: "read" }), "green");
  assert.equal(tier("clipboard", { action: "write", text: "hola" }), "yellow");
});

test("niveles de open_on_screen: una URL o una carpeta del usuario es verde; una app o una ruta ajena, amarillo", () => {
  assert.equal(tier("open_on_screen", { target: "https://example.com/a" }), "green");
  assert.equal(tier("open_on_screen", { target: "notepad" }), "yellow");
  assert.equal(tier("open_on_screen", { target: "calc", type: "auto" }), "yellow");
  assert.equal(tier("open_on_screen", { target: "desktop" }), "green", "alias de carpeta del usuario");
  assert.equal(tier("open_on_screen", { target: "downloads\\informe.pdf" }), "green");
  assert.equal(tier("open_on_screen", { target: "C:\\Users\\Ana\\Documents\\manual.pdf" }), "green");
  assert.equal(tier("open_on_screen", { target: "D:\\datos\\x.pdf" }), "yellow", "fuera de las carpetas del usuario");
  assert.equal(tier("open_on_screen", { target: "Calculadora", type: "app" }), "yellow");
  assert.equal(tier("open_on_screen", { target: "downloads\\..\\..\\Windows\\x.exe" }), "yellow", "alias con ..");
  assert.equal(tier("open_on_screen", { target: "{{ruta}}\\x.pdf", type: "path" }), "yellow", "marcador sin resolver");
  assert.equal(tier("open_on_screen", { target: "https://example.com", type: "url" }), "green");
});

test("niveles de download_file: nunca verde; un destino que ya existe es rojo", () => {
  const dest = "C:\\Users\\Ana\\Downloads\\a.zip";
  assert.equal(tier("download_file", { url: "https://example.com/a.zip" }), "yellow");
  assert.equal(tier("download_file", { url: "https://example.com/a.zip", folder: "downloads" }), "yellow");
  assert.equal(tier("download_file", { url: "https://example.com/a.zip", destination: dest }), "yellow");
  assert.equal(tier("download_file", { url: "https://example.com/a.zip", destination: dest }, [dest]), "red");
});

// ───────────────────────── Poscondición y destino ─────────────────────────

const view = (files: Record<string, number>, dirs: string[] = []) => ({
  exists: (p: string) => p in files || dirs.includes(p),
  isDirectory: (p: string) => dirs.includes(p),
  size: (p: string) => files[p] ?? 0,
});

test("poscondición de download_file: con destino se comprueba el archivo; con carpeta y nombre deducido no se decide", () => {
  const dest = path.resolve(path.sep, "datos", "a.zip");
  assert.equal(postconditionOf("download_file", { url: "https://x.test/a.zip", destination: dest }, view({ [dest]: 100 })), "met");
  assert.equal(postconditionOf("download_file", { url: "https://x.test/a.zip", destination: dest }, view({ [dest]: 0 })), "unmet", "una descarga vacía no es lo pedido");
  assert.equal(postconditionOf("download_file", { url: "https://x.test/a.zip", destination: dest }, view({})), "unmet");
  assert.equal(postconditionOf("download_file", { url: "https://x.test/a.zip", destination: dest }, view({}, [dest])), "unmet", "una carpeta no es el archivo");
  assert.equal(postconditionOf("download_file", { url: "https://x.test/a.zip", folder: "downloads" }, view({})), null);
  for (const tool of ["pc_settings", "power", "open_on_screen", "clipboard", "stop_process"]) assert.equal(postconditionOf(tool, { action: "x" }, view({})), null, `${tool}: no hay nada que mirar en el disco`);
  assert.equal(isPathWriteTool("download_file"), true);
});

// ───────────────────────── Guard y datos sensibles ─────────────────────────

test("Guard: descargar o cambiar el sistema pide aprobación; un secreto en la URL de una descarga la hace obligatoria", () => {
  assert.equal(Guard.evaluate("jarvis_system", "system_info", { section: "processes" }).decision, "ALLOW");
  for (const [tool, args] of [
    ["stop_process", { pid: 4 }],
    ["pc_settings", { setting: "wifi", action: "set", value: "off" }],
    ["power", { action: "shutdown" }],
    ["open_on_screen", { target: "notepad" }],
    ["clipboard", { action: "write", text: "x" }],
  ] as const) {
    assert.equal(Guard.evaluate("jarvis_system", tool, args).decision, "APPROVAL", tool);
  }
  const plain = Guard.evaluate("jarvis_web", "download_file", { url: "https://example.com/a.zip", folder: "downloads" });
  assert.equal(plain.decision, "APPROVAL");
  assert.equal(plain.mandatory, undefined);
  const leaky = Guard.evaluate("jarvis_web", "download_file", { url: "https://example.com/a.zip?key=sk-abcdefghijklmnopqrstuvwxyz123456" });
  assert.equal(leaky.decision, "APPROVAL");
  assert.equal(leaky.mandatory, true, "una clave en lo que sale a internet exige confirmación aunque haya modo automático");
  assert.equal(Guard.evaluate("jarvis_web", "download_file", { url: "https://example.com/a.zip", destination: "C:\\Windows\\System32\\x.dll" }).mandatory, true, "ruta del sistema");
});

test("download_file: un destino fuera de allowedDirectories se rechaza antes de tocar la red", async () => {
  const allowed = path.resolve(path.sep, "permitido");
  const provider = new WebSearchProvider({ allowedDirectories: () => [allowed], environment: async () => ({ platform: "linux", home: allowed }) });
  const outside = path.resolve(path.sep, "otra", "a.zip");
  const result = await provider.callTool("download_file", { url: "https://example.com/a.zip", destination: outside });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /allowed|permitid|denied|DENIED|outside/i);
  const badUrl = await provider.callTool("download_file", { url: "file:///etc/passwd", destination: path.join(allowed, "a") });
  assert.equal(badUrl.isError, true);
  const noUrl = await provider.callTool("download_file", {});
  assert.equal(noUrl.isError, true);
});

test("web: el proveedor responde con error a una herramienta desconocida y web_search sigue pidiendo el anfitrión", async () => {
  const provider = new WebSearchProvider();
  assert.equal((await provider.callTool("inventada", {})).isError, true);
  assert.equal((await provider.callTool("web_search", { need: "hola" })).isError, true);
});
