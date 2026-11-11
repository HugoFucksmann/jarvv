/**
 * Anti-bucle (`isRepeat`): qué llamada idéntica se bloquea según lo que pasó con la anterior y en qué paso.
 *
 * Regla en una frase: una LECTURA idéntica se bloquea mientras nada haya cambiado, salvo que el resultado anterior no sirviera y el juicio sea de otro
 * paso (o sea un fallo pasajero que merece un reintento). Una escritura idéntica no se reintenta a ciegas.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isRepeat } from "../src/core/ctx/index.ts";
import type { CallStatus, RepeatPolicy, TaskContext } from "../src/core/ctx/index.ts";
import { newContext } from "./fixtures.ts";

type Kind = "read" | "write";
type Verdict = "approved" | "rejected";

/** Un contexto reactivo al que se le agregan pasos y llamadas ejecutadas; el último paso agregado es el vigente. */
class Scene {
  readonly ctx: TaskContext = newContext("reactive");
  private current: string | null = null;

  /** Cierra el paso vigente como fallido y abre otro. Mismo `instruction` = mismo criterio (el reactivo reintenta un ítem con un paso nuevo). */
  step(instruction = "paso"): string {
    if (this.current !== null) this.ctx.apply({ op: "update", target: this.current, value: { state: "failed" } });
    this.current = this.ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction, route: null, expected: null } }).ids[0];
    return this.current;
  }

  call(tool: string, sig: string, status: CallStatus, options: { kind?: Kind; verdict?: Verdict } = {}): this {
    const stepId = this.current ?? this.step();
    const id = this.ctx.apply({ op: "add", target: "calls", value: { stepId, route: "web", tool, kind: options.kind ?? "read", args: {}, sig, status, summary: null, ref: null } }).ids[0];
    if (options.verdict !== undefined) this.ctx.apply({ op: "update", target: id, value: { verdict: options.verdict, reason: options.verdict === "rejected" ? "no_usable_data" : null } });
    return this;
  }

  /** ¿Se bloquearía pedir `tool`/`sig` desde el paso vigente? */
  blocks(tool: string, sig: string, policy: RepeatPolicy = "strict"): boolean {
    return this.ctx.isRepeat(tool, sig, { policy, stepId: this.current ?? this.step() });
  }
}

// ───────────────────────── Lo que no cambió ─────────────────────────

test("dentro del paso: una lectura aprobada o rechazada por la verificación no se repite igual", () => {
  const approved = new Scene().call("research", "Q1", "ok", { verdict: "approved" });
  assert.equal(approved.blocks("research", "Q1"), true);
  const rejected = new Scene().call("research", "Q1", "ok", { verdict: "rejected" });
  assert.equal(rejected.blocks("research", "Q1"), true, "mismo paso, mismo criterio, mismo veredicto");
});

test("otros argumentos o otra herramienta no se bloquean", () => {
  const scene = new Scene().call("research", "Q1", "ok", { verdict: "rejected" });
  assert.equal(scene.blocks("research", "Q2"), false);
  assert.equal(scene.blocks("fetch", "Q1"), false);
});

test("una escritura exitosa en el medio habilita volver a leer lo mismo, aunque el resultado esté aprobado", () => {
  const scene = new Scene().call("research", "Q1", "ok", { verdict: "approved" }).call("write_file", "W1", "ok", { kind: "write", verdict: "approved" });
  scene.step();
  assert.equal(scene.blocks("research", "Q1"), false);
});

test("una respuesta del usuario en el medio también habilita repetir", () => {
  const scene = new Scene().call("research", "Q1", "ok", { verdict: "approved" });
  scene.ctx.apply({ op: "set", target: "facts.answer_1", value: { value: "sí", stepId: scene.step() } });
  assert.equal(scene.blocks("research", "Q1"), false);
});

test("política allow: nunca se bloquea", () => {
  const scene = new Scene().call("read_process_output", "P1", "ok", { verdict: "approved" });
  assert.equal(scene.blocks("read_process_output", "P1", "allow"), false);
});

test("una llamada bloqueada no deja rastro: solo las ejecutadas cuentan", () => {
  const scene = new Scene().call("research", "Q1", "loop_blocked");
  scene.step();
  assert.equal(scene.blocks("research", "Q1"), false);
});

test("lo aprobado se bloquea en toda la tarea, también desde otro paso (el dato ya está a la vista)", () => {
  const scene = new Scene().call("research", "Q1", "ok", { verdict: "approved" });
  scene.step();
  assert.equal(scene.blocks("research", "Q1"), true);
  assert.equal(scene.blocks("research", "Q1", "retry_failed"), true);
});

test("denied del servidor: se bloquea siempre, también desde otro paso y con retry_failed", () => {
  const scene = new Scene().call("research", "Q1", "denied");
  assert.equal(scene.blocks("research", "Q1", "retry_failed"), true);
  scene.step();
  assert.equal(scene.blocks("research", "Q1", "retry_failed"), true);
});

// ───────────────────────── Lo que cambia ─────────────────────────

test("un rechazo de la verificación vale solo para su criterio: un paso con otro criterio puede repetir la lectura", () => {
  const scene = new Scene().call("research", "Q1", "ok", { verdict: "rejected" });
  assert.equal(scene.blocks("research", "Q1"), true);
  scene.step("Buscar la fecha de lanzamiento");
  assert.equal(scene.blocks("research", "Q1"), false);
});

test("un paso nuevo que pide lo mismo (mismo criterio) hereda el rechazo: repetir daría el mismo veredicto", () => {
  const scene = new Scene().call("research", "Q1", "ok", { verdict: "rejected" });
  scene.step("paso");
  assert.equal(scene.blocks("research", "Q1"), true, "reintento del mismo ítem con un paso nuevo");
});

test("el criterio incluye lo esperado: misma instrucción pero otro resultado esperado es otro criterio", () => {
  // Datos armados a mano: un contexto deliberativo real exige planes y estados que aquí no importan.
  const step = (id: string, expected: string) => ({ id, instruction: "Buscar", route: "web", expected, planId: "p1", state: "failed", superseded: false });
  const call = { id: "c1", stepId: "s1", route: "web", tool: "research", kind: "read", args: {}, sig: "Q1", status: "ok", verdict: "rejected", reason: "not_accomplished", at: 1, summary: null, ref: null };
  const data = { calls: [call], facts: {}, steps: [step("s1", "una lista"), step("s2", "una tabla con fechas"), step("s3", "una lista")] } as never;
  assert.equal(isRepeat(data, "research", "Q1", { policy: "strict", stepId: "s2" }), false, "otro esperado: otro criterio");
  assert.equal(isRepeat(data, "research", "Q1", { policy: "strict", stepId: "s3" }), true, "misma instrucción y mismo esperado: mismo criterio");
});

test("una vez repetida en otro paso, si ese paso la vuelve a rechazar, dentro de él ya no se repite", () => {
  const scene = new Scene().call("research", "Q1", "ok", { verdict: "rejected" });
  scene.step("otro criterio");
  scene.call("research", "Q1", "ok", { verdict: "rejected" });
  assert.equal(scene.blocks("research", "Q1"), true);
});

test("fallo pasajero (tool_error, exception, interrupted) en una lectura: un reintento idéntico por paso", () => {
  for (const status of ["tool_error", "exception", "interrupted"] as const) {
    // `interrupted` no se verifica (su veredicto queda null); los otros sí.
    const verdict = status === "interrupted" ? {} : { verdict: "rejected" as const };
    const scene = new Scene().call("research", "Q1", status, verdict);
    assert.equal(scene.blocks("research", "Q1"), false, `${status}: primer reintento`);
    scene.call("research", "Q1", status, verdict);
    assert.equal(scene.blocks("research", "Q1"), true, `${status}: el reintento del paso ya se usó`);
    scene.step();
    assert.equal(scene.blocks("research", "Q1"), false, `${status}: en otro paso se permite de nuevo`);
  }
});

test("no_data y not_found: con strict se bloquean en el mismo paso y en otros (no cambiarán solos); con retry_failed, un reintento por paso", () => {
  for (const status of ["no_data", "not_found"] as const) {
    const scene = new Scene().call("fetch", "U1", status, { verdict: "rejected" });
    assert.equal(scene.blocks("fetch", "U1", "strict"), true, `${status} strict, mismo paso`);
    assert.equal(scene.blocks("fetch", "U1", "retry_failed"), false, `${status} retry_failed, primer reintento`);
    scene.call("fetch", "U1", status, { verdict: "rejected" });
    assert.equal(scene.blocks("fetch", "U1", "retry_failed"), true, `${status} retry_failed, ya reintentado`);
    scene.step();
    assert.equal(scene.blocks("fetch", "U1", "strict"), true, `${status} strict, otro paso: un resultado deterministico no cambia`);
    assert.equal(scene.blocks("fetch", "U1", "retry_failed"), false, `${status} retry_failed, otro paso`);
  }
});

// ───────────────────────── Escrituras: sin relajar ─────────────────────────

test("una escritura idéntica no se reintenta a ciegas: ni tras un fallo ni en otro paso", () => {
  const failed = new Scene().call("write_file", "W1", "exception", { kind: "write" });
  assert.equal(failed.blocks("write_file", "W1"), true, "pudo dejar cambios parciales");
  assert.equal(failed.blocks("write_file", "W1", "retry_failed"), true);
  failed.step();
  assert.equal(failed.blocks("write_file", "W1"), true, "tampoco desde otro paso");

  const rejected = new Scene().call("write_file", "W1", "ok", { kind: "write", verdict: "rejected" });
  rejected.step();
  assert.equal(rejected.blocks("write_file", "W1"), true);
});

test("una lectura ejecutada en el medio habilita repetir la escritura", () => {
  const scene = new Scene().call("write_file", "W1", "exception", { kind: "write" }).call("read_file", "R1", "ok", { verdict: "approved" });
  assert.equal(scene.blocks("write_file", "W1"), false);
});

// ───────────────────────── Catálogo ─────────────────────────

test("el catálogo asigna la política: sondeos allow, web retry_failed, el resto strict", async () => {
  const { getToolPolicy } = await import("../src/core/tools/manifest.ts");
  assert.equal(getToolPolicy("desktop_commander", "get_more_search_results").repeat, "allow");
  assert.equal(getToolPolicy("jarvis_terminal", "run_command").repeat, "strict", "un comando idéntico pudo duplicar sus efectos");
  assert.equal(getToolPolicy("desktop_commander", "read_file").repeat, "strict");
  assert.equal(getToolPolicy("jarvis_web", "web_search").repeat, "retry_failed");
  assert.equal(getToolPolicy("free_search", "research").repeat, "retry_failed");
  assert.equal(getToolPolicy("free_search", "fetch").repeat, "retry_failed");
  assert.equal(getToolPolicy("desktop_commander", "herramienta_inventada").repeat, "strict");
});
