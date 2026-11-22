/**
 * `ReactiveList`: las transiciones de la lista de pendientes del reactivo, sin modelos ni contexto.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

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

test("tras un fallo se consulta al modelo; una reescritura DISTINTA es un intento nuevo y no hereda ningún conteo: el ítem puede fallar y reescribirse varias veces", () => {
  const list = new ReactiveList();
  list.applyModelList(["Buscar el precio del producto X en la web", "Guardar el resultado"], false);
  list.modelAnswered();
  for (let i = 0; i < 5; i++) {
    list.failHead();
    assert.equal(list.needsModel, true, "tras un fallo se consulta al modelo para reescribir el ítem");
    assert.equal(list.applyModelList([`Consultar el catálogo número ${i} para el producto X`, "Guardar el resultado"], false), "accepted", `reescritura ${i + 1}`);
    list.modelAnswered();
  }
  assert.equal(list.head, "Consultar el catálogo número 4 para el producto X");
  assert.deepEqual(list.pending, ["Consultar el catálogo número 4 para el producto X", "Guardar el resultado"], "el ítem de atrás se conserva en su lugar");
});

test("tras un fallo, si el modelo omite el ítem fallido y sigue con uno de los que venían detrás, corta (`skips_failed_item`) sin mutar la lista", () => {
  const list = new ReactiveList();
  list.applyModelList(["Leer el archivo informe.txt", "Resumir el contenido del informe", "Guardar el resumen en resumen.md"], false);
  list.modelAnswered();
  list.completeHead(); // «Leer…» ok
  list.failHead(); // «Resumir…» falla
  assert.equal(list.applyModelList(["Guardar el resumen en resumen.md"], false), "skips_failed_item");
  assert.deepEqual(list.pending, ["Resumir el contenido del informe", "Guardar el resumen en resumen.md"], "el ítem fallido sigue de primero");
});

test("tras un fallo, un ítem reformulado que sigue pareciéndose al fallido no es una omisión: se acepta", () => {
  const list = new ReactiveList();
  list.applyModelList(["Resumir el contenido del informe", "Guardar el resumen en resumen.md"], false);
  list.modelAnswered();
  list.failHead();
  assert.equal(list.applyModelList(["Resumir el informe en tres líneas", "Guardar el resumen en resumen.md"], false), "accepted");
  assert.equal(list.head, "Resumir el informe en tres líneas");
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
  list.failHead();
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
  list.failHead();
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
  single.failHead();
  assert.equal(single.applyModelList(["Crear A"], false), "no_replacement");
  assert.deepEqual(single.pending, ["Leer B"]);

  const multi = new ReactiveList();
  multi.applyModelList(["Crear A", "Leer B", "Escribir C"], false);
  multi.completeHead();
  multi.failHead();
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

test("tras un fallo, si el modelo vuelve a listar un ítem ya cumplido y luego el mismo ítem fallido, también corta (`identical_rewrite`)", () => {
  const list = new ReactiveList();
  list.applyModelList(["Crear la carpeta docs", "Escribir el archivo notas.md"], false);
  list.modelAnswered();
  list.completeHead(); // «Crear…» ok
  list.failHead(); // «Escribir…» falla
  assert.equal(list.applyModelList(["Crear la carpeta docs", "Escribir el archivo notas.md"], false), "identical_rewrite");
  assert.deepEqual(list.pending, ["Escribir el archivo notas.md"]);
});

// ───────────────────────── Un reintento idéntico del ítem cuando la falla fue un error de la herramienta ─────────────────────────

test("tras `tool_failed`, repetir el ítem se acepta UNA vez (`identical_retry`) con la lista intacta; la segunda vez cierra", () => {
  const list = new ReactiveList();
  list.applyModelList(["Escribir el informe en informe.md", "Enviar el informe"], false);
  list.modelAnswered();
  list.failHead("tool_failed");
  assert.equal(list.applyModelList(["Escribir el informe en informe.md", "Enviar el informe"], false), "identical_retry");
  assert.deepEqual(list.pending, ["Escribir el informe en informe.md", "Enviar el informe"], "la lista no cambia: el mismo ítem se vuelve a intentar con un paso nuevo");

  list.modelAnswered();
  list.failHead("tool_failed"); // el reintento también falló
  assert.equal(list.applyModelList(["Escribir el informe en informe.md", "Enviar el informe"], false), "identical_rewrite", "el reintento idéntico es uno por ítem");
});

test("el reintento idéntico es solo para fallos que el generador de argumentos puede corregir: con otra causa, o sin causa, repetir el ítem cierra", () => {
  for (const cause of ["verify_rejected", "call_cap", "repeat_blocked", "denied", "user_rejected", null] as const) {
    const list = new ReactiveList();
    list.applyModelList(["Leer el archivo datos.json"], false);
    list.modelAnswered();
    list.failHead(cause);
    assert.equal(list.applyModelList(["Leer el archivo datos.json"], false), "identical_rewrite", String(cause));
  }
});

test("tras `review_rejected` en el PRIMER fallo del ítem se acepta UN reintento idéntico (el generador ve el motivo); si una reescritura ya falló, cierra", () => {
  const list = new ReactiveList();
  list.applyModelList(["Buscar hospedaje en Mendoza"], false);
  list.modelAnswered();
  list.failHead("review_rejected");
  assert.equal(list.applyModelList(["Buscar hospedaje en Mendoza"], false), "identical_retry");
  list.modelAnswered();
  list.failHead("review_rejected");
  assert.equal(list.applyModelList(["Buscar hospedaje en Mendoza"], false), "identical_rewrite", "uno por ítem");

  const rewritten = new ReactiveList();
  rewritten.applyModelList(["Buscar hospedaje en Mendoza"], false);
  rewritten.modelAnswered();
  rewritten.failHead("review_rejected");
  assert.equal(rewritten.applyModelList(["Buscar hospedaje con precios en Mendoza"], false), "accepted", "una reescritura distinta siempre es un intento nuevo");
  rewritten.modelAnswered();
  rewritten.failHead("review_rejected"); // la reescritura también falló la revisión
  assert.equal(rewritten.applyModelList(["Buscar hospedaje con precios en Mendoza"], false), "identical_rewrite", "ya no es el primer fallo: no converge, cierra");
});

test("cada ítem tiene su propio reintento idéntico", () => {
  const list = new ReactiveList();
  list.applyModelList(["Crear la carpeta docs", "Escribir el archivo notas.md"], false);
  list.modelAnswered();
  list.failHead("tool_failed");
  assert.equal(list.applyModelList(["Crear la carpeta docs", "Escribir el archivo notas.md"], false), "identical_retry");
  list.completeHead(); // el reintento salió bien
  list.failHead("tool_failed"); // ahora falla «Escribir…»
  assert.equal(list.applyModelList(["Escribir el archivo notas.md"], false), "identical_retry", "otro ítem: su propio reintento");
});

test("el reintento idéntico también vale cuando el modelo vuelve a listar un ítem ya cumplido antes del fallido", () => {
  const list = new ReactiveList();
  list.applyModelList(["Crear la carpeta docs", "Escribir el archivo notas.md"], false);
  list.modelAnswered();
  list.completeHead();
  list.failHead("tool_failed");
  assert.equal(list.applyModelList(["Crear la carpeta docs", "Escribir el archivo notas.md"], false), "identical_retry");
  assert.deepEqual(list.pending, ["Escribir el archivo notas.md"]);
});
