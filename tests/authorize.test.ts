/**
 * Piezas puras de `callAuthorize.ts`: se prueban sin modelos, sin servidores ni disco.
 *
 * `needsConfirmation` se compara contra la regla escrita a mano en TODAS las combinaciones de sus entradas: la regla de niveles es la única.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { needsConfirmation, policyDenialNote } from "../src/core/engine/callAuthorize.ts";
import type { PolicyFacts } from "../src/core/engine/callAuthorize.ts";

type Tier = "green" | "yellow" | "red" | null;

/** La regla escrita a mano: lo obligatorio de Guard, lo rojo, el amarillo sin modo automático y la lista negra piden; lo verde no. */
function expectedAsk(i: { auto: boolean; tier: Tier; mandatory: boolean; listed: boolean; unresolvable: boolean; userAuthored: boolean }): boolean {
  return i.unresolvable || (!i.userAuthored && (i.mandatory || i.tier === "red" || (i.tier === "yellow" && !i.auto) || i.listed));
}

test("needsConfirmation: coincide con la regla de niveles en todas las combinaciones de sus entradas", () => {
  const bools = [false, true];
  const tiers: Tier[] = [null, "green", "yellow", "red"];
  const decisions = ["ALLOW", "APPROVAL"] as const;
  let n = 0;
  for (const auto of bools)
    for (const tier of tiers)
      for (const mandatory of bools)
        for (const decision of decisions)
          for (const listed of bools)
            for (const unresolvable of bools)
              for (const userAuthored of bools) {
                const verdict = {
                  guard: { decision, mandatory: mandatory ? true : undefined },
                  auto,
                  tier,
                  listed: listed ? { level: "sensitive", reason: "r", id: "x" } : null,
                } as unknown as PolicyFacts;
                const actual = needsConfirmation({ verdict, allowedUnresolvableReason: unresolvable ? "no se pudo resolver" : null, userAuthored });
                const expected = expectedAsk({ auto, tier, mandatory, listed, unresolvable, userAuthored });
                assert.equal(actual, expected, JSON.stringify({ auto, tier, mandatory, decision, listed, unresolvable, userAuthored }));
                n++;
              }
  assert.equal(n, 2 * 4 * 2 * 2 * 2 * 2 * 2);
});

test("needsConfirmation: una ruta no resoluble pide confirmación aunque la respuesta sea del usuario; lo verde no pide", () => {
  const base = { guard: { decision: "APPROVAL" }, auto: true, tier: "green", listed: null } as unknown as PolicyFacts;
  assert.equal(needsConfirmation({ verdict: base, allowedUnresolvableReason: null, userAuthored: false }), false, "verde con autoMode");
  assert.equal(needsConfirmation({ verdict: base, allowedUnresolvableReason: "x", userAuthored: true }), true, "no resoluble gana sobre userAuthored");
});

test("policyDenialNote: dice que no se ejecutó, el motivo y que siga por otro camino", () => {
  const note = policyDenialNote("Disco protegido.");
  assert.match(note, /^Denied by the security policy; it was not performed\. Disco protegido\./);
  assert.match(note, /take a different approach/);
  assert.equal(policyDenialNote(undefined).includes("undefined"), false);
});
