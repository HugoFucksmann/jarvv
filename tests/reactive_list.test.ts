/**
 * `ReactiveList`: las transiciones de la lista de pendientes del reactivo, sin modelos ni contexto.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { MAX_REOPENS, ReactiveList } from "../src/core/engine/reactiveList.ts";

test("empieza vacía y pidiendo al modelo; `seed` la llena sin consultarlo", () => {
  const list = new ReactiveList();
  assert.equal(list.isEmpty, true);
  assert.equal(list.needsModel, true);
  list.seed(["Listar la carpeta"]);
  assert.deepEqual(list.pending, ["Listar la carpeta"]);
  assert.equal(list.head, "Listar la carpeta");
  assert.equal(list.needsModel, false);
});

test("un paso que termina bien quita su ítem; al vaciarse hay que confirmar con el modelo", () => {
  const list = new ReactiveList();
  list.applyModelList(["Crear la carpeta docs", "Guardar el archivo notas.md"], false);
  list.modelAnswered();
  assert.equal(list.head, "Crear la carpeta docs");
  list.completeHead();
  assert.deepEqual(list.pending, ["Guardar el archivo notas.md"]);
  list.completeHead();
  assert.equal(list.isEmpty, true);
  assert.equal(list.hasAbandoned, false);
  list.askModelToConfirm();
  assert.equal(list.needsModel, true);
});

test("un fallo con otros ítems detrás: el primero reescribe; al `maxItemFailures`-ésimo seguido se abandona y se sigue con el resto", () => {
  const list = new ReactiveList();
  list.applyModelList(["Leer un archivo imposible", "Guardar lo obtenido"], false);
  list.modelAnswered();
  for (let i = 1; i < BUDGET.maxItemFailures; i++) {
    assert.equal(list.failHead(), "rewrite");
    assert.equal(list.needsModel, true, "tras un fallo se consulta al modelo para reescribir el ítem");
    list.modelAnswered();
  }
  assert.equal(list.failHead(), "abandoned");
  assert.deepEqual(list.pending, ["Guardar lo obtenido"]);
  assert.equal(list.hasAbandoned, true);
  assert.equal(list.needsModel, false, "abandonar no consulta al modelo: el resto de la lista ya está");
});

test("un ítem sin nadie detrás no se abandona por fallos: sigue pidiendo reescritura", () => {
  const list = new ReactiveList();
  list.seed(["Único ítem"]);
  for (let i = 0; i < BUDGET.maxItemFailures + 2; i++) assert.equal(list.failHead(), "rewrite");
  assert.deepEqual(list.pending, ["Único ítem"]);
  assert.equal(list.hasAbandoned, false);
});

test("completar un ítem reinicia la cuenta de fallos seguidos", () => {
  const list = new ReactiveList();
  list.applyModelList(["Primero", "Segundo", "Tercero"], false);
  if (BUDGET.maxItemFailures > 1) list.failHead(); // un fallo sobre «Primero»
  list.completeHead(); // «Primero» termina bien
  for (let i = 1; i < BUDGET.maxItemFailures; i++) assert.equal(list.failHead(), "rewrite", "la cuenta de «Segundo» arranca de cero");
});

test("el modelo no vuelve a agregar un ítem ya cumplido", () => {
  const list = new ReactiveList();
  list.applyModelList(["Crear la carpeta docs", "Guardar el archivo notas.md"], false);
  list.completeHead();
  list.completeHead();
  list.applyModelList(["Crear la carpeta docs"], false);
  assert.equal(list.isEmpty, true);
});

test("`applyModelDone` con ítems detrás: siguen, y el de adelante queda abandonado", () => {
  const list = new ReactiveList();
  list.applyModelList(["Primero", "Segundo distinto"], false);
  list.applyModelDone();
  assert.deepEqual(list.pending, ["Segundo distinto"]);
  assert.equal(list.hasAbandoned, true);
});

test("`applyModelDone` con la lista ya vacía no abandona nada", () => {
  const list = new ReactiveList();
  list.applyModelDone();
  assert.equal(list.isEmpty, true);
  assert.equal(list.hasAbandoned, false);
});

test("reapertura: si D5 dice con seguridad que falta algo y la lista queda vacía solo por parecerse a lo cumplido, se ejecuta lo propuesto, hasta MAX_REOPENS veces", () => {
  const list = new ReactiveList();
  list.applyModelList(["Crear la carpeta jarvis"], false);
  list.completeHead();
  // El modelo propone un ítem compuesto que `reconcileList` descarta por parecerse al ya cumplido.
  const compound = "Crear la carpeta jarvis y luego crear el archivo info.md";
  list.applyModelList([compound], false);
  assert.equal(list.isEmpty, true, "sin la señal de D5 se descarta");
  // Cada reapertura exige un texto que no repita exactamente uno ya cumplido: el modelo propone una variante cada vez.
  const variant = (i: number): string => `${compound} (versión ${i})`;
  for (let i = 0; i < MAX_REOPENS; i++) {
    list.applyModelList([variant(i)], true);
    assert.deepEqual(list.pending, [variant(i)], `reapertura ${i + 1}`);
    list.completeHead();
  }
  list.applyModelList([variant(MAX_REOPENS)], true);
  assert.equal(list.isEmpty, true, "agotadas las reaperturas, no se reabre más");
  list.applyModelList([variant(0)], true);
  assert.equal(list.isEmpty, true, "el mismo texto exacto de un ítem ya cumplido nunca se reabre");
});
