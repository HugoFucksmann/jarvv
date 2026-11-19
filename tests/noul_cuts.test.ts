/**
 * Cortes de las preguntas `noul` (una `noul` devuelve la probabilidad del «sí»: 0,5 es «no sé» y cuanto más lejos, más seguro).
 * Medidos con los datasets del eval (`docs/evaluacion`, `eval/GUIA_DECISION.md` §2.4): `ok` aprueba desde 0,3 y `cumple` desde 0,6; D0 `multi` lleva criterios true/false.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { NOUL_APPROVE, OK_APPROVE, VERIFY_APPROVE, verdictOf } from "../src/core/engine/verify.ts";
import { DECISION_PROMPTS } from "../src/core/models/prompts.ts";

test("verificación: `ok` aprueba desde 0,3 y `cumple` desde 0,6, cada una con su motivo de rechazo", () => {
  assert.equal(OK_APPROVE, 0.3);
  assert.equal(NOUL_APPROVE, 0.6);
  assert.deepEqual(VERIFY_APPROVE, { ok: 0.3, cumple: 0.6 });

  // `ok` en la zona que antes se rechazaba (0,3 a 0,6) ya no frena a un resultado que además cumple.
  assert.deepEqual(verdictOf({ ok: 0.35, cumple: 0.9 }), { verdict: "approved", reason: null });
  assert.deepEqual(verdictOf({ ok: 0.3, cumple: 0.6 }), { verdict: "approved", reason: null }, "el corte aprueba: es «desde»");
  // Por debajo del corte de cada una, rechaza con el motivo de esa pregunta.
  assert.deepEqual(verdictOf({ ok: 0.25, cumple: 0.9 }), { verdict: "rejected", reason: "no_usable_data" });
  assert.deepEqual(verdictOf({ ok: 0.9, cumple: 0.55 }), { verdict: "rejected", reason: "not_accomplished" });
  // Si fallan las dos, manda la primera de la tabla (`ok`).
  assert.deepEqual(verdictOf({ ok: 0.1, cumple: 0.1 }), { verdict: "rejected", reason: "no_usable_data" });
});

test("D0: la pregunta `multi` (noul) lleva criterios true y false; `kind` también", () => {
  const { questions } = DECISION_PROMPTS.buildFirstQuery({ request: "hola" });
  const multi = questions.multi;
  assert.equal(multi.type, "noul");
  if (multi.type !== "noul") return;
  assert.ok(multi.criteria !== undefined && multi.criteria.true.length > 0 && multi.criteria.false.length > 0, "criterios true y false");
  assert.match(multi.criteria?.true ?? "", /two or more/i);
  assert.match(multi.criteria?.false ?? "", /exactly one/i);
  assert.equal(questions.kind.type, "choice");
});

test("juez de fragmentos: cada pregunta noul lleva criterios true y false", () => {
  const { questions } = DECISION_PROMPTS.buildFragmentJudge({ need: "¿qué versión?", fragments: ["a", "b"] });
  assert.deepEqual(Object.keys(questions), ["f0", "f1"]);
  for (const q of Object.values(questions)) {
    assert.equal(q.type, "noul");
    if (q.type === "noul") assert.ok(q.criteria !== undefined && q.criteria.true.length > 0 && q.criteria.false.length > 0);
  }
});
