/**
 * Coherencia de las tablas por herramienta con el catálogo (`tools/manifest.ts`).
 *
 * El catálogo dice qué herramientas existen; las reglas de nivel (`policy/tiers.ts`), las poscondiciones de disco (`engine/postcondition.ts`) y los destinos de
 * escritura (`tools/toolTargets.ts`) viven junto al código que las usa y se indexan por nombre. Si se agrega una herramienta que modifica el sistema y falta su fila en
 * alguna tabla, el motor no falla: cae en un valor por omisión (amarillo, «lo decide el modelo»). Estas pruebas hacen que falle acá, diciendo qué falta.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { hasPostcondition, NO_DISK_POSTCONDITION } from "../src/core/engine/postcondition.ts";
import { hasTierRule } from "../src/core/policy/tiers.ts";
import { SYSTEM_TOOL_MANIFEST } from "../src/core/tools/manifest.ts";
import { isPathWriteTool } from "../src/core/tools/toolTargets.ts";

/** Herramientas que ofrece el motor y modifican el sistema (no las internas de una tool compuesta). */
const mutating = SYSTEM_TOOL_MANIFEST.filter((d) => d.policy.mutates && d.internal !== true);

test("el catálogo no repite nombres entre servidores (las tablas por herramienta se indexan por nombre)", () => {
  const names = SYSTEM_TOOL_MANIFEST.map((d) => d.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test("toda herramienta que modifica el sistema tiene su regla de nivel en policy/tiers.ts", () => {
  const missing = mutating.filter((d) => !hasTierRule(d.name)).map((d) => d.name);
  assert.deepEqual(missing, [], "agregar su fila a TIER_RULES (sin ella rige el amarillo por omisión)");
});

test("toda herramienta que modifica el sistema tiene poscondición de disco o está declarada sin ella", () => {
  const missing = mutating.filter((d) => !hasPostcondition(d.name) && !NO_DISK_POSTCONDITION.has(d.name)).map((d) => d.name);
  assert.deepEqual(missing, [], "agregar su fila a POSTCONDITIONS, o a NO_DISK_POSTCONDITION si no deja nada que mirar en el disco");
});

test("las tablas no listan herramientas que el catálogo no tiene", () => {
  const cataloged = new Set(SYSTEM_TOOL_MANIFEST.map((d) => d.name));
  for (const name of new Set([...mutating.map((d) => d.name), "write_file", "move_file", "run_command", "stop_process"])) {
    if (hasTierRule(name)) assert.ok(cataloged.has(name), `TIER_RULES tiene '${name}', que no está en el catálogo`);
    if (isPathWriteTool(name)) assert.ok(cataloged.has(name), `toolTargets tiene '${name}', que no está en el catálogo`);
    if (NO_DISK_POSTCONDITION.has(name)) assert.ok(cataloged.has(name), `NO_DISK_POSTCONDITION tiene '${name}', que no está en el catálogo`);
  }
});

test("toda herramienta que escribe en una ruta (toolTargets) modifica el sistema según el catálogo y tiene poscondición", () => {
  for (const d of SYSTEM_TOOL_MANIFEST) {
    if (!isPathWriteTool(d.name)) continue;
    assert.equal(d.policy.mutates, true, `${d.name}: figura como escritura de ruta pero el catálogo no la marca como modificadora`);
    assert.equal(hasPostcondition(d.name), true, `${d.name}: escribe en una ruta y no tiene poscondición de disco`);
  }
});
