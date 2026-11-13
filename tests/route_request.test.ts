/**
 * Decisión 1 ve la solicitud del usuario (reactivo): el paso (primer pendiente) puede haber perdido lo que el usuario dijo sobre dónde o cómo hacerlo.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { routeInput, routeViewOptions } from "../src/core/engine/adapters.ts";
import { DECISION_PROMPTS, ROUTE_QUESTION } from "../src/core/models/prompts.ts";
import { newContext } from "./fixtures.ts";

const ROUTES = ["files", "terminal"] as const;

test("la vista forRoute lleva la solicitud en reactivo y no en deliberativo", () => {
  const reactive = newContext("reactive");
  assert.equal(reactive.view.forRoute(routeViewOptions()).request, "Busca los informes de ventas y guarda un resumen en resumen.txt");
  assert.equal(newContext("deliberative").view.forRoute(routeViewOptions()).request, null);
});

test("Decisión 1: el estado empieza con la línea Request, y la pregunta es la de dónde correr", () => {
  const ctx = newContext("reactive");
  ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "Crear el directorio C:\\Temp\\rc_a", route: null, expected: null } });
  const input = routeInput(ctx.view.forRoute(routeViewOptions()), { routes: ROUTES });
  const { state, questions } = DECISION_PROMPTS.buildRouteChoice(input);

  const lines = state.split("\n");
  assert.equal(lines[0], "Request: Busca los informes de ventas y guarda un resumen en resumen.txt");
  assert.equal(lines[1], "Step: Crear el directorio C:\\Temp\\rc_a");
  assert.equal(questions.route.instructions, ROUTE_QUESTION);
  assert.match(ROUTE_QUESTION, /^Where should this step run\?/);
  assert.deepEqual(Object.keys((questions.route as { criteria: Record<string, string> }).criteria), [...ROUTES]);
});

test("Decisión 1: sin solicitud (deliberativo) el estado no trae la línea Request", () => {
  const ctx = newContext("deliberative");
  const input = routeInput(ctx.view.forRoute(routeViewOptions()), { routes: ROUTES });
  assert.equal(input.request, null);
  assert.ok(!DECISION_PROMPTS.buildRouteChoice(input).state.includes("Request:"));
});

test("Decisión 1: la solicitud larga se recorta al tope de Decisión 1 y se pone en una línea", () => {
  const ctx = newContext("reactive");
  const long = ctx.task.request.repeat(100);
  const input = routeInput({ ...ctx.view.forRoute(routeViewOptions()), request: `${long}\nsegunda línea` }, { routes: ROUTES });
  assert.ok(input.request !== null && input.request !== undefined);
  assert.ok(input.request.length <= BUDGET.caps.routeRequest + 20, `longitud ${input.request.length}`);
  assert.ok(!input.request.includes("\n"));
});
