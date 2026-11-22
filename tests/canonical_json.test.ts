/** `canonicalJson`: el mismo texto para valores iguales, sin importar el orden de las claves ni los `undefined` (huella de los argumentos y clave de aprobación). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalKey } from "../src/core/policy/approvalKey.ts";
import { computeSig } from "../src/core/engine/args.ts";
import { canonicalJson } from "../src/core/utils.ts";

test("canonicalJson ordena las claves en todos los niveles y omite las que valen undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } }), '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}');
  assert.equal(canonicalJson({ a: undefined }), "{}");
});

test("canonicalJson de lo que no es objeto: JSON normal; lo que JSON no puede escribir sale como null", () => {
  assert.equal(canonicalJson("x"), '"x"');
  assert.equal(canonicalJson(null), "null");
  assert.equal(canonicalJson(undefined), "null");
  assert.equal(canonicalJson([1, "a", null]), '[1,"a",null]');
});

test("la huella de los argumentos y la clave de aprobación no dependen del orden de las claves", () => {
  assert.equal(computeSig({ need: "x", freshness: "week" }), computeSig({ freshness: "week", need: "x" }));
  assert.notEqual(computeSig({ need: "x" }), computeSig({ need: "y" }));
  assert.equal(approvalKey("web_search", { need: "x", freshness: "week" }), approvalKey("web_search", { freshness: "week", need: "x" }));
});
