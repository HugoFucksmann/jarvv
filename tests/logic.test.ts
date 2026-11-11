/** Lógica pura del motor: la lista de pendientes, el contexto (`apply`, anti-bucle, cierre) y la protección de `/config`. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ContextError, canFinish, planClosure } from "../src/core/ctx/index.ts";
import { reconcileList, sameItem } from "../src/core/engine/pendingList.ts";
import { buildContext, newContext } from "./fixtures.ts";

test("pendientes: lo ya cumplido o abandonado no vuelve a la lista", () => {
  const next = reconcileList(["Guardar el resumen", "Abrir el archivo"], ["Leer el informe", "Guardar el resumen"], ["Abrir el archivo"]);
  assert.deepEqual(next, ["Guardar el resumen"]);
});

test("pendientes: los ítems que venían detrás se conservan si el modelo no los cubre", () => {
  const next = reconcileList(["Leer el informe de nuevo"], ["Leer el informe", "Guardar el resumen"], []);
  assert.ok(next.includes("Guardar el resumen"));
  assert.equal(next.filter((i) => sameItem(i, "Leer el informe")).length, 1);
});

test("RC-21: un ítem que vuelve después de otro distinto es un pedido (correr las pruebas, cambiar algo, correrlas otra vez); uno seguido es un duplicado", () => {
  const list = ["Ejecutar npm test en la carpeta", "Agregar la línea cambio a notas.txt", "Ejecutar npm test en la carpeta otra vez"];
  assert.deepEqual(reconcileList(list, [], []), list);
  assert.deepEqual(reconcileList(["Ejecutar npm test", "Ejecutar npm test de nuevo", "Agregar la línea"], [], []), ["Ejecutar npm test", "Agregar la línea"]);
});

test("RC-21: un pendiente que el código ya tenía no se pierde por parecerse a uno cumplido; lo que el modelo agrega de nuevo, sí", () => {
  const settled = ["Ejecutar npm test en la carpeta"];
  const previous = ["Agregar la línea cambio a notas.txt", "Ejecutar npm test en la carpeta otra vez"];
  // Falló el paso del medio: el modelo reescribe su ítem y repite el de las pruebas (que se parece al cumplido): queda el que tenía el código.
  const next = reconcileList(["Agregar la línea cambio al final de notas.txt", "Ejecutar npm test en la carpeta"], previous, settled);
  assert.deepEqual(next, ["Agregar la línea cambio al final de notas.txt", "Ejecutar npm test en la carpeta otra vez"]);
  // Al vaciarse la lista, el modelo no puede volver a meter lo ya hecho.
  assert.deepEqual(reconcileList(["Ejecutar npm test en la carpeta"], [], settled), []);
});

test("pendientes: cifras distintas no son el mismo ítem", () => {
  assert.equal(sameItem("Abrir 10 archivos grandes", "Abrir 20 archivos grandes"), false);
});

test("contexto: rechaza una operación inválida sin dejar rastro", () => {
  const ctx = newContext("reactive");
  assert.throws(() => ctx.apply({ op: "add", target: "calls", value: { stepId: "s99", route: "files", tool: "x", kind: "read", args: null, sig: null, status: "ok", summary: null, ref: null } }), ContextError);
  assert.equal(ctx.find("calls", {}).length, 0);
});

test("contexto: una llamada idéntica a una ya ejecutada es repetición, salvo que la herramienta esté exenta", () => {
  const ctx = newContext("reactive");
  const step = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "Listar", route: null, expected: null } }).ids[0];
  const read = { stepId: step, route: "files", tool: "list_directory", kind: "read" as const, args: { path: "C:\\x" }, sig: "huella", status: "ok" as const, summary: null, ref: null };
  ctx.apply({ op: "add", target: "calls", value: read });
  assert.equal(ctx.isRepeat("list_directory", "huella", { policy: "strict", stepId: step }), true);
  assert.equal(ctx.isRepeat("list_directory", "otra_huella", { policy: "strict", stepId: step }), false);
  assert.equal(ctx.isRepeat("list_directory", "huella", { policy: "allow", stepId: step }), false);
  // Una escritura exitosa intermedia habilita volver a leer lo mismo.
  ctx.apply({ op: "add", target: "calls", value: { ...read, tool: "write_file", kind: "write", sig: "otra" } });
  assert.equal(ctx.isRepeat("list_directory", "huella", { policy: "strict", stepId: step }), false);
});

test("contexto: un cierre parcial deja de ser 'running' y el plan sin pasos pendientes se cierra", () => {
  const ctx = buildContext("deliberative", "closed");
  assert.equal(ctx.isClosed(), true);
  assert.equal(ctx.task.state, "partial");
  assert.equal(planClosure(ctx.find("steps", {})) === "completed", false);
  assert.equal(typeof canFinish(ctx.find("calls", {})), "string");
});

test("contexto: el snapshot se reconstruye idéntico", async () => {
  const { create } = await import("../src/core/ctx/index.ts");
  const ctx = buildContext("deliberative", "step_failed");
  const snapshot = ctx.snapshot();
  const copy = create.fromSnapshot(JSON.parse(JSON.stringify(snapshot)), { now: () => 0, summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 });
  assert.deepEqual(copy.snapshot(), snapshot);
});

test("/config: el parche descarta command, args, env y cwd de los servidores MCP y conserva el resto", async () => {
  const { withoutLaunchFields } = await import("../src/server/jarvisRouter.ts");
  const patch = withoutLaunchFields({
    autoMode: true,
    desktopCommanderMcp: { command: "calc.exe", args: ["-x"], env: { A: "1" }, cwd: "C:\\", allowedDirectories: ["C:\\Users"] },
    freeSearchMcp: { command: "evil" },
  });
  assert.deepEqual(patch, { autoMode: true, desktopCommanderMcp: { allowedDirectories: ["C:\\Users"] }, freeSearchMcp: {} });
});
