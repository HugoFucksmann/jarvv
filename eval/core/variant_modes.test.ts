/**
 * eval/core/variant_modes.test.ts
 *
 * Opciones del backend y modos de variante: D1 y D2 ofrecen siempre las opciones del catálogo (no las declara el caso), una variante
 * `prompt` no puede cambiar preguntas ni opciones, y una `structure` no es comparable contra la baseline.
 * Ejecución: `npx tsx --test eval/core/variant_modes.test.ts`
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createEvalClients, executeComparisonBatch } from "./batch.ts";
import { parseConfig } from "./config.ts";
import { EXECUTABLE_ROUTES, SYSTEM_TOOL_MANIFEST } from "./contract.ts";
import type { ExecutableRoute } from "./contract.ts";
import type { DecisionInput } from "../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../src/core/models/prompts.ts";
import { loadDatasets } from "./datasets.ts";
import { offeredRoutes, offeredTools } from "./offered.ts";
import { materializeScenario } from "./scenario.ts";
import type { Scenario } from "./stages/types.ts";
import type { ChoiceQ, DecisionRequest, Variant } from "./types.ts";
import { loadVariantSpec, parseVariantExport } from "./variants/load.ts";

const tmp: string[] = [];
after(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

const routeScenario: Scenario = { mode: "reactive", request: "Fijate qué versión tiene package.json", steps: [{ state: "running" }] };
const toolScenario = (route: ExecutableRoute): Scenario => ({ ...routeScenario, at: { route } });

const choiceOf = (req: DecisionRequest, key: string): ChoiceQ => {
  const q = req.questions[key];
  assert.equal(q.type, "choice");
  return q as ChoiceQ;
};

/** Variante `prompt` o `structure` que envuelve D1 y modifica el `criteria` con `edit`. */
function routeVariant(mode: Variant["mode"], edit: (criteria: Record<string, string>) => Record<string, string>): Variant {
  const buildRouteChoice = (data: Parameters<typeof DECISION_PROMPTS.buildRouteChoice>[0]): DecisionInput => {
    const base = DECISION_PROMPTS.buildRouteChoice(data);
    const q = base.questions.route;
    if (q.type !== "choice") throw new Error("route debe ser choice");
    return { ...base, questions: { route: { ...q, criteria: edit(q.criteria) } } };
  };
  return { name: `route_${mode}_test`, mode, prompts: { DECISION_PROMPTS: { buildRouteChoice } } };
}

describe("opciones del backend (D1 y D2)", () => {
  it("D1 ofrece siempre todas las rutas ejecutables, en el orden del catálogo", () => {
    assert.deepEqual(offeredRoutes(), [...EXECUTABLE_ROUTES]);
    const req = materializeScenario("route", routeScenario).request as DecisionRequest;
    assert.deepEqual(Object.keys(choiceOf(req, "route").criteria), [...EXECUTABLE_ROUTES]);
  });

  it("D2 ofrece, por cada ruta, todas las herramientas visibles de su grupo y ninguna interna", () => {
    for (const route of EXECUTABLE_ROUTES) {
      const expected = SYSTEM_TOOL_MANIFEST.filter((d) => d.route === route && d.internal !== true).map((d) => d.name);
      assert.deepEqual(offeredTools(route), expected);
      const req = materializeScenario("tool_choice", toolScenario(route)).request as DecisionRequest;
      assert.deepEqual(Object.keys(choiceOf(req, "selected_tool").criteria), expected, `ruta ${route}`);
    }
    const internals = SYSTEM_TOOL_MANIFEST.filter((d) => d.internal === true).map((d) => d.name);
    assert.ok(internals.length > 0);
    const web = materializeScenario("tool_choice", toolScenario("web")).request as DecisionRequest;
    for (const name of internals) assert.equal(name in choiceOf(web, "selected_tool").criteria, false);
  });

  it("el caso no declara las opciones: at.routes, at.tools y claves desconocidas de at son error de carga", () => {
    assert.throws(() => materializeScenario("route", { ...routeScenario, at: { routes: ["web"] } as never }), /at\.routes ya no existe/);
    assert.throws(() => materializeScenario("tool_choice", { ...routeScenario, at: { route: "files_read", tools: ["read_file"] } as never }), /at\.tools ya no existe/);
    assert.throws(() => materializeScenario("route", { ...routeScenario, at: { rotue: "web" } as never }), /clave desconocida 'at\.rotue'/);
  });
});

describe("modos de variante", () => {
  it("el export de una variante exige `name` y un `mode` válido", () => {
    assert.throws(() => parseVariantExport("x", { name: "x" }), /falta `mode`/);
    assert.throws(() => parseVariantExport("x", { name: "x", mode: "otro" }), /falta `mode`/);
    assert.throws(() => parseVariantExport("x", { name: "y", mode: "prompt" }), /name="x"/);
    assert.equal(parseVariantExport("x", { name: "x", mode: "structure" }).mode, "structure");
  });

  it("prod es mode prompt", async () => {
    assert.equal((await loadVariantSpec("prod")).variant.mode, "prompt");
  });

  it("una variante prompt que solo cambia textos pasa y se ve en el request", () => {
    const v = routeVariant("prompt", (c) => Object.fromEntries(Object.entries(c).map(([k, t]) => [k, `${t} (nuevo texto)`])));
    const req = materializeScenario("route", routeScenario, v).request as DecisionRequest;
    const criteria = choiceOf(req, "route").criteria;
    assert.deepEqual(Object.keys(criteria), [...EXECUTABLE_ROUTES]);
    assert.ok(Object.values(criteria).every((t) => t.includes("(nuevo texto)")));
  });

  it("una variante prompt que quita, agrega o reordena opciones falla con el motivo", () => {
    const quita = routeVariant("prompt", ({ web: _web, ...rest }) => rest);
    assert.throws(() => materializeScenario("route", routeScenario, quita), /mode "prompt".*opciones de 'route'/);
    const agrega = routeVariant("prompt", (c) => ({ ...c, inventada: "otra" }));
    assert.throws(() => materializeScenario("route", routeScenario, agrega), /inventada/);
    const reordena = routeVariant("prompt", (c) => Object.fromEntries(Object.entries(c).reverse()));
    assert.throws(() => materializeScenario("route", routeScenario, reordena), /mode "prompt"/);
  });

  it("una variante structure puede cambiar las opciones", () => {
    const v = routeVariant("structure", ({ web: _web, ...rest }) => rest);
    const req = materializeScenario("route", routeScenario, v).request as DecisionRequest;
    assert.equal("web" in choiceOf(req, "route").criteria, false);
  });

  it("el reporte no compara una variante structure contra la baseline y la marca no comparable", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-modes-"));
    tmp.push(root);
    const cfg = parseConfig(["--client=oracle", "--dataset=smoke", "--stages=route", "--label=modes_test"]);
    const prod = await loadVariantSpec("prod");
    const structure = routeVariant("structure", (c) => c);
    const datasets = {
      prod: loadDatasets(cfg.datasetSpecs, { stages: ["route"] }),
      [structure.name]: loadDatasets(cfg.datasetSpecs, { stages: ["route"] }, structure),
    };
    const res = await executeComparisonBatch({
      cfg,
      variants: [
        { spec: "prod", hash: prod.hash, variant: prod.variant },
        { spec: structure.name, hash: "h", variant: structure },
      ],
      datasetsByVariant: new Map(Object.entries(datasets)),
      stageFilter: ["route"],
      clients: createEvalClients(cfg),
      resultsRoot: root,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const row = res.report.variants.find((v) => v.variant === structure.name);
    assert.equal(row?.comparable, false);
    assert.equal(row?.deltaPassRate, undefined);
    assert.equal(row?.signTestP, undefined);
    assert.equal(res.report.deltas.some((d) => d.variant === structure.name), false);
    assert.ok(res.report.warnings.some((w) => w.includes('mode "structure"')));
    assert.equal(res.report.variants.find((v) => v.variant === "prod")?.comparable, undefined);
  });
});
