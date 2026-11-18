/**
 * Piezas puras de `callAuthorize.ts`: se prueban sin modelos, sin servidores ni disco.
 *
 * `needsConfirmation` se compara contra la fórmula original de `runCall` (antes de extraerla) en TODAS las combinaciones de sus entradas: el refactor no cambió la regla.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { needsConfirmation, policyDenialNote } from "../src/core/engine/callAuthorize.ts";
import type { PolicyFacts } from "../src/core/engine/callAuthorize.ts";

type Tier = "green" | "yellow" | "red" | null;

/** La fórmula tal como estaba en `runCall` antes de extraerla. */
function original(i: { tiered: boolean; auto: boolean; tier: Tier; mandatory: boolean; decision: "ALLOW" | "APPROVAL"; listed: boolean; unresolvable: boolean; userAuthored: boolean; known: boolean }): boolean {
  return (
    i.unresolvable ||
    (i.tiered
      ? !i.userAuthored && (i.mandatory || i.tier === "red" || (i.tier === "yellow" && !i.auto) || i.listed)
      : !i.userAuthored && ((i.decision === "APPROVAL" && (i.mandatory || !(i.auto && i.known))) || (i.listed && !i.auto)))
  );
}

test("needsConfirmation: coincide con la fórmula original en las 2.304 combinaciones de sus entradas", () => {
  const bools = [false, true];
  const tiers: Tier[] = [null, "green", "yellow", "red"];
  const decisions = ["ALLOW", "APPROVAL"] as const;
  let n = 0;
  for (const tiered of bools)
    for (const auto of bools)
      for (const tier of tiers)
        for (const mandatory of bools)
          for (const decision of decisions)
            for (const listed of bools)
              for (const unresolvable of bools)
                for (const userAuthored of bools)
                  for (const known of bools) {
                    const verdict = {
                      guard: { decision, mandatory: mandatory ? true : undefined },
                      auto,
                      tiered,
                      tier,
                      listed: listed ? { level: "sensitive", reason: "r", id: "x" } : null,
                    } as unknown as PolicyFacts;
                    const actual = needsConfirmation({ verdict, known, allowedUnresolvableReason: unresolvable ? "no se pudo resolver" : null, userAuthored });
                    const expected = original({ tiered, auto, tier, mandatory, decision, listed, unresolvable, userAuthored, known });
                    assert.equal(actual, expected, JSON.stringify({ tiered, auto, tier, mandatory, decision, listed, unresolvable, userAuthored, known }));
                    n++;
                  }
  assert.equal(n, 2 * 2 * 4 * 2 * 2 * 2 * 2 * 2 * 2);
});

test("needsConfirmation: una ruta no resoluble pide confirmación aunque la respuesta sea del usuario; lo verde no pide", () => {
  const base = { guard: { decision: "APPROVAL" }, auto: true, tiered: true, tier: "green", listed: null } as unknown as PolicyFacts;
  assert.equal(needsConfirmation({ verdict: base, known: true, allowedUnresolvableReason: null, userAuthored: false }), false, "verde con autoMode");
  assert.equal(needsConfirmation({ verdict: base, known: true, allowedUnresolvableReason: "x", userAuthored: true }), true, "no resoluble gana sobre userAuthored");
});

test("policyDenialNote: dice que no se ejecutó, el motivo y que siga por otro camino", () => {
  const note = policyDenialNote("Disco protegido.");
  assert.match(note, /^Denied by the security policy; it was not performed\. Disco protegido\./);
  assert.match(note, /take a different approach/);
  assert.equal(policyDenialNote(undefined).includes("undefined"), false);
});
