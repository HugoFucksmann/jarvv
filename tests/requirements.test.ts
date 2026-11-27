/**
 * Libro de requisitos (`engine/requirements.ts`) y el formato `score` del modelo de decisión: las piezas puras, sin modelos.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { RequirementVerdict } from "../src/core/contracts.ts";
import { DELIVERED_MIN, deliverItem, GATHERED_MIN, gapsOf, INFO_MIN } from "../src/core/engine/requirements.ts";
import { DecisionValidationError } from "../src/core/models/transport.ts";
import { validateAnswer, parseResponse } from "../src/core/models/decision.ts";
import { DECISION_PROMPTS, DELIVERED_LEVELS } from "../src/core/models/prompts.ts";
import { upperLevelsMass } from "../src/core/types/decision.ts";

const REQ = ["hospedaje", "pasajes", "lugares", "crear el archivo"];
const v = (info: number, gathered: number, delivered: number | null): RequirementVerdict => ({ info, gathered, delivered });
const FILE = "C:\\Users\\Ana\\viaje.md";

test("huecos: sin datos se busca; con datos y sin volcar se entrega; con ambos o una acción no hay hueco", () => {
  const gaps = gapsOf(REQ, [v(0.9, 0.9, 0.9), v(0.9, 0.9, 0.1), v(0.9, 0.1, 0.1), v(0.1, 0.0, 0.0)], FILE);
  assert.deepEqual(gaps, [
    { kind: "gather", item: "lugares" },
    { kind: "deliver", item: deliverItem("pasajes", FILE) },
  ]);
  assert.match(gaps[1].item, /^Add to the file C:\\Users\\Ana\\viaje\.md the information found about: pasajes\./);
});

test("huecos: sin entregable solo cuenta lo que falta buscar; los umbrales son de «dudar es hueco»", () => {
  assert.deepEqual(gapsOf(REQ, [v(0.9, 0.9, null), v(0.9, 0.2, null)], null), [{ kind: "gather", item: "pasajes" }]);
  assert.deepEqual(gapsOf(["a"], [v(0.9, GATHERED_MIN, DELIVERED_MIN)], FILE), [], "justo en el umbral no es hueco");
  assert.deepEqual(gapsOf(["a"], [v(INFO_MIN - 0.01, 0, 0)], FILE), [], "una acción no se juzga");
  assert.deepEqual(gapsOf(["a", "b"], [v(0.9, 0.9, 0.9)], FILE), [], "sin veredicto de un requisito no hay hueco");
});

test("score: valida la respuesta (valor en [0, 1] y probabilidades por nivel) y rechaza lo mal formado", () => {
  const q = { type: "score", instructions: "x", criteria: ["a", "b", "c"] } as const;
  assert.deepEqual(validateAnswer("d", q, { score: 0.4, probabilities: { 0: 0.2, 1: 0.5, 2: 0.3, extra: "x" } }), { score: 0.4, probabilities: { "0": 0.2, "1": 0.5, "2": 0.3 } });
  assert.deepEqual(validateAnswer("d", q, { score: 1.4, probabilities: {} }), { score: 1.4, probabilities: {} }, "el score es el nivel esperado: con tres niveles llega hasta 2");
  assert.throws(() => validateAnswer("d", q, { score: 2.5, probabilities: {} }), DecisionValidationError);
  assert.throws(() => validateAnswer("d", q, { score: -0.1, probabilities: {} }), DecisionValidationError);
  assert.throws(() => validateAnswer("d", q, { noul: 0.4 }), DecisionValidationError);
  const raw = JSON.stringify({ answers: { d: { score: 0.1, probabilities: { 0: 1 } } } });
  assert.equal("score" in parseResponse(raw, { d: q }).d, true);
});

test("score: la masa de los niveles altos (desde la mitad de la escala)", () => {
  const answer = { score: 0.35, probabilities: { "0": 0.757, "1": 0.143, "2": 0.094, "3": 0.004, "4": 0.001 } };
  assert.equal(Math.round((upperLevelsMass(answer, 5) ?? 0) * 1000) / 1000, 0.099, "el ejemplo medido: casi todo en «no está»");
  assert.equal(upperLevelsMass({ score: 0.9, probabilities: { "2": 0.2, "3": 0.3, "4": 0.5 } }, 5), 1);
  assert.equal(upperLevelsMass({ score: 0.5, probabilities: {} }, 5), null, "sin probabilidades por nivel no hay masa");
});

test("preguntas: una consulta por tipo de evidencia, tres formatos, y sin entregable no hay `score`", () => {
  const withFile = DECISION_PROMPTS.buildRequirementsCheck({ requirements: ["a", "b"], request: "R", reads: "- web => x", deliverable: "C:\\f.md · 5 B" });
  assert.deepEqual(Object.keys(withFile.types.questions), ["t0", "t1"]);
  assert.deepEqual(Object.keys(withFile.reads.questions), ["g0", "g1"]);
  assert.deepEqual(Object.keys(withFile.deliverable?.questions ?? {}), ["d0", "d1"]);
  assert.equal(withFile.types.questions.t0.type, "choice");
  assert.equal(withFile.reads.questions.g0.type, "noul");
  assert.equal(withFile.deliverable?.questions.d0.type, "score");
  const d0 = withFile.deliverable?.questions.d0 as { criteria: readonly string[] } | undefined;
  assert.deepEqual(d0?.criteria, DELIVERED_LEVELS);
  assert.match(withFile.reads.questions.g1.instructions, /PART: "b"/);
  // Cada consulta lleva solo su evidencia (el servidor repite el estado por pregunta): ni las lecturas en la de tipos ni el entregable en la de lecturas.
  assert.equal(withFile.types.state, "REQUEST: R");
  assert.match(withFile.reads.state, /READS:\n- web => x$/);
  assert.equal(withFile.reads.state.includes("DELIVERABLE"), false);
  assert.match(withFile.deliverable?.state ?? "", /DELIVERABLE:\nC:\\f\.md · 5 B$/);
  assert.equal((withFile.deliverable?.state ?? "").includes("READS"), false);
  const without = DECISION_PROMPTS.buildRequirementsCheck({ requirements: ["a"], request: "R", reads: "(none)", deliverable: null });
  assert.equal(without.deliverable, null);
});

test("preguntas de dependencia y de elección de lecturas: una `noul` por ítem o por lectura, con el par o la lectura dentro de la pregunta", () => {
  const dep = DECISION_PROMPTS.buildDependencies({ request: "R", blocked: "Crear el archivo", items: ["Buscar vuelos", "Buscar hoteles"] });
  assert.equal(dep.state, "REQUEST: R");
  assert.deepEqual(Object.keys(dep.questions), ["b0", "b1"]);
  assert.equal(dep.questions.b1.type, "noul");
  assert.equal(dep.questions.b1.instructions, 'ITEM A: "Crear el archivo"\nITEM B: "Buscar hoteles"\nDoes ITEM B need the result of ITEM A?');

  const reads = DECISION_PROMPTS.buildReadSelection({ task: "Resumir vuelos", reads: [{ label: "web_search {}", text: "Vuelos baratos" }, { label: "list_folder {}", text: "[FILE] a.txt" }] });
  assert.equal(reads.state, "TASK: Resumir vuelos");
  assert.deepEqual(Object.keys(reads.questions), ["r0", "r1"]);
  assert.equal(reads.questions.r0.instructions, 'READ (web_search {}):\n"""\nVuelos baratos\n"""\nDoes this READ contain information that this TASK needs?');
});

test("pregunta de cobertura: una `noul` (`covers`) con la solicitud y la lista numerada como estado", () => {
  const c = DECISION_PROMPTS.buildCoverage({ request: "crea un md y recopila información", list: ["Crear el md", "Recopilar la información"] });
  assert.equal(c.state, "REQUEST: crea un md y recopila información\n\nTO-DO LIST:\n1. Crear el md\n2. Recopilar la información");
  assert.deepEqual(Object.keys(c.questions), ["covers"]);
  assert.equal(c.questions.covers.type, "noul");
});
