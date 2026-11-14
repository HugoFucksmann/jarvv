import assert from "node:assert/strict";
import test from "node:test";
import { memoizeDecision } from "../src/core/engine/env.ts";
import { sortByCatalog } from "../src/core/tools/manifest.ts";
import type { IActionDecision } from "../src/core/contracts.ts";

test("memoizeDecision: la misma entrada no vuelve a consultar al modelo; otra entrada sí; un fallo no se guarda", async () => {
  let calls = 0;
  let fail = true;
  const raw = {
    verifyResult: async (input: unknown) => {
      calls++;
      if (fail) throw new Error("caído");
      return { answers: { ok: 1, cumple: 1 }, rawInput: JSON.stringify(input), rawOutput: "" };
    },
  } as unknown as IActionDecision;
  const decision = memoizeDecision(raw);
  await assert.rejects(() => decision.verifyResult({ a: 1 } as never));
  fail = false;
  const first = await decision.verifyResult({ a: 1 } as never);
  const again = await decision.verifyResult({ a: 1 } as never);
  assert.equal(again, first);
  assert.equal(calls, 2, "el fallo se reconsultó, el acierto se reutilizó");
  await decision.verifyResult({ a: 2 } as never);
  assert.equal(calls, 3);
});

test("sortByCatalog: el orden del catálogo manda sobre el del servidor; lo desconocido va al final en su orden", () => {
  const names = (ts: { name: string }[]) => ts.map((t) => t.name);
  const ordered = sortByCatalog("desktop_commander", [{ name: "zzz_x" }, { name: "write_file" }, { name: "list_directory" }, { name: "aaa_y" }]);
  assert.deepEqual(names(ordered).slice(-2), ["zzz_x", "aaa_y"]);
  const again = sortByCatalog("desktop_commander", [...ordered].reverse());
  assert.deepEqual(names(again).slice(0, 2), names(ordered).slice(0, 2));
});
