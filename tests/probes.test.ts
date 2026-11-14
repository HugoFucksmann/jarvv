import assert from "node:assert/strict";
import { test } from "node:test";

import { ATTRIBUTE_PROBE, GATE_MIN, ITEM_PROBE, PLACE_PROBE, POSITION_PROBE, SCOPE_PROBE, type ProbeCall } from "../src/core/tools/probes.ts";
import { probesOf } from "../src/core/tools/manifest.ts";

const call = (over: Partial<ProbeCall>): ProbeCall => ({ tool: "write_file", args: null, summary: null, request: "pedido", step: "pedido", ...over });
const BS = String.fromCharCode(92);
const U = ["C:", "Users", "Hugo F"].join(BS);

test("catálogo: cada herramienta declara sus sondas", () => {
  const ids = (server: string, tool: string): string[] => probesOf(server, tool).map((p) => p.id);
  assert.deepEqual(ids("desktop_commander", "write_file"), ["place", "position"]);
  assert.deepEqual(ids("desktop_commander", "create_directory"), ["place"]);
  assert.deepEqual(ids("desktop_commander", "move_file"), ["place"]);
  assert.deepEqual(ids("desktop_commander", "read_file"), ["item"]);
  assert.deepEqual(ids("desktop_commander", "list_directory"), ["attribute"]);
  assert.deepEqual(ids("desktop_commander", "start_search"), ["scope"]);
  assert.deepEqual(ids("desktop_commander", "no_existe"), []);
});

test("ubicación: dos etapas; carpeta nueva se lista completa; el movimiento usa el destino", () => {
  const w = call({ args: { path: `${U}${BS}Desktop${BS}jarvis${BS}gpt.md` }, request: "Crea un md dentro de la carpeta jarvis", summary: "Successfully wrote to X" });
  const st = PLACE_PROBE.stages(w);
  assert.equal(st.length, 2);
  assert.ok(st[0].state.startsWith("Step: Crea un md") && st[0].state.includes("Successfully wrote to X"));
  assert.ok(st[1].state.includes("Folders of the saved file: C: > Users > Hugo F > Desktop > jarvis") && st[1].state.includes("File name: gpt.md"));
  const d = PLACE_PROBE.stages(call({ tool: "create_directory", args: { path: `${U}${BS}Documents${BS}Proyectos` } }));
  assert.ok(d[1].state.includes("Folders in the path of the new folder: C: > Users > Hugo F > Documents > Proyectos") && !d[1].state.includes("File name"));
  const m = call({ tool: "move_file", args: { source: "a", destination: `${U}${BS}Desktop${BS}a.pdf` } });
  assert.ok(PLACE_PROBE.stages(m)[0].state.includes(`Successfully moved to ${U}${BS}Desktop${BS}a.pdf`));
  assert.equal(PLACE_PROBE.applies(call({ args: {} })), false);
});

test("posición: append dice «al FINAL»; rewrite muestra la primera línea; sin content no aplica", () => {
  assert.ok(POSITION_PROBE.stages(call({ args: { content: "x", mode: "append" } }))[0].state.includes("Text added at the END"));
  assert.ok(POSITION_PROBE.stages(call({ args: { content: "primera\nsegunda" } }))[0].state.includes('"primera"'));
  assert.equal(POSITION_PROBE.applies(call({ args: { path: "p" } })), false);
});

test("alcance: solo búsquedas de archivos por nombre", () => {
  assert.equal(SCOPE_PROBE.applies(call({ tool: "start_search", args: { pattern: "app*.log" } })), true);
  assert.equal(SCOPE_PROBE.applies(call({ tool: "start_search", args: { pattern: "x", searchType: "content" } })), false);
  assert.ok(SCOPE_PROBE.stages(call({ tool: "start_search", step: "todos los .log", args: { pattern: "app*.log" } }))[0].state.includes("app*.log"));
});

test("ítem: solo hojas de cálculo, y la afirmativa es lo malo", () => {
  assert.equal(ITEM_PROBE.applies(call({ tool: "read_file", args: { path: "a.xlsx" } })), true);
  assert.equal(ITEM_PROBE.applies(call({ tool: "read_file", args: { path: "a.txt" } })), false);
  assert.equal(ITEM_PROBE.stages(call({ tool: "read_file", args: { path: "a.xlsx" } }))[0].badWhenTrue, true);
});

test("atributo: la primera etapa es compuerta", () => {
  const st = ATTRIBUTE_PROBE.stages(call({ tool: "list_directory", step: "los más recientes", summary: "a\nb" }));
  assert.equal(st.length, 2);
  assert.equal(st[0].gate, true);
  assert.equal(st[1].gate, undefined);
  assert.ok(GATE_MIN > 0 && GATE_MIN <= 1);
});

test("ubicación: renombrar en la misma carpeta no aplica; mover a otra carpeta sí", () => {
  const rename = call({ tool: "move_file", args: { source: ["", "home", "user", "foto.jpg"].join("/"), destination: ["", "home", "user", "vacaciones.jpg"].join("/") } });
  assert.equal(PLACE_PROBE.applies(rename), false);
  const move = call({ tool: "move_file", args: { source: ["", "home", "user", "foto.jpg"].join("/"), destination: ["", "home", "otra", "foto.jpg"].join("/") } });
  assert.equal(PLACE_PROBE.applies(move), true);
});
