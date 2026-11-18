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
  list.askModelToConfirm();
  assert.equal(list.needsModel, true);
});

test("un fallo con otros ítems detrás: el primero reescribe; al `maxItemFailures`-ésimo seguido cierra (`exhausted`) y nunca abandona al resto", () => {
  const list = new ReactiveList();
  list.applyModelList(["Leer un archivo imposible", "Guardar lo obtenido"], false);
  list.modelAnswered();
  for (let i = 1; i < BUDGET.maxItemFailures; i++) {
    assert.equal(list.failHead(), "rewrite");
    assert.equal(list.needsModel, true, "tras un fallo se consulta al modelo para reescribir el ítem");
    list.modelAnswered();
  }
  assert.equal(list.failHead(), "exhausted");
  assert.deepEqual(list.pending, ["Leer un archivo imposible", "Guardar lo obtenido"], "no avanza al segundo ítem ni lo abandona");
});

test("un ítem sin nadie detrás también corta al `maxItemFailures`-ésimo fallo (`exhausted`: 2 intentos, no 3)", () => {
  const list = new ReactiveList();
  list.seed(["Único ítem"]);
  for (let i = 1; i < BUDGET.maxItemFailures; i++) {
    assert.equal(list.failHead(), "rewrite");
  }
  assert.equal(list.failHead(), "exhausted");
  assert.deepEqual(list.pending, ["Único ítem"]);
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
  assert.equal(list.applyModelList(["Crear la carpeta docs"], false), "accepted");
  assert.equal(list.isEmpty, true);
});

test("`applyModelDone` con ítems pendientes tras fallo se rechaza sin abandonar ni avanzar al segundo ítem", () => {
  const list = new ReactiveList();
  list.applyModelList(["Primero", "Segundo distinto"], false);
  assert.equal(list.failHead(), "rewrite");
  assert.equal(list.applyModelDone(), "rejected");
  assert.deepEqual(list.pending, ["Primero", "Segundo distinto"]);
});

test("`applyModelDone` con la lista ya vacía (inicio o confirmación D5) se acepta sin error", () => {
  const list = new ReactiveList();
  assert.equal(list.applyModelDone(), "accepted");
  assert.equal(list.isEmpty, true);

  list.applyModelList(["Paso único"], false);
  list.completeHead();
  list.askModelToConfirm();
  assert.equal(list.applyModelDone(), "accepted");
  assert.equal(list.isEmpty, true);
});

test("tras un fallo, `applyModelList` corta con `identical_rewrite` solo ante igualdad estricta normalizada, no por `sameItem`", () => {
  const list = new ReactiveList();
  list.applyModelList(["Leer archivo datos.json", "Guardar resumen"], false);
  assert.equal(list.failHead(), "rewrite");
  // Igualdad estricta normalizada (cambia mayúsculas, tildes y puntuación) -> corta.
  assert.equal(list.applyModelList(["leer archivo datos json!", "Guardar resumen"], false), "identical_rewrite");
  assert.deepEqual(list.pending, ["Leer archivo datos.json", "Guardar resumen"]);

  // Texto con diferencia real aunque `sameItem` los considere similares -> se acepta y conserva el posterior.
  assert.equal(list.applyModelList(["Leer archivo datos.json en Documentos"], false), "accepted");
  assert.deepEqual(list.pending, ["Leer archivo datos.json en Documentos", "Guardar resumen"]);
});

test("tras un fallo, `applyModelList` con solo ítems ya cumplidos devuelve `no_replacement` y no vacía ni salta ítems", () => {
  const single = new ReactiveList();
  single.applyModelList(["Crear A", "Leer B"], false);
  single.completeHead();
  assert.equal(single.failHead(), "rewrite");
  assert.equal(single.applyModelList(["Crear A"], false), "no_replacement");
  assert.deepEqual(single.pending, ["Leer B"]);

  const multi = new ReactiveList();
  multi.applyModelList(["Crear A", "Leer B", "Escribir C"], false);
  multi.completeHead();
  assert.equal(multi.failHead(), "rewrite");
  assert.equal(multi.applyModelList(["Crear A"], false), "no_replacement");
  assert.deepEqual(multi.pending, ["Leer B", "Escribir C"]);
});

test("guarda de texto vacío: ítems sin caracteres alfanuméricos ASCII no colisionan como reescritura idéntica", async () => {
  const { sameNormalizedText } = await import("../src/core/engine/pendingList.ts");
  assert.equal(sameNormalizedText("", ""), false);
  assert.equal(sameNormalizedText("!!!", "???"), false);
  assert.equal(sameNormalizedText("你好", "世界"), false);
  assert.equal(sameNormalizedText("Leer A.txt", "leer a txt"), true);
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
