/**
 * `ctx.apply` (sección 6): única puerta de escritura.
 *
 * `prepareBatch` valida y arma el lote completo SIN tocar el contexto (se trabaja sobre un borrador: elementos nuevos
 * y copias al escribir de los modificados) y devuelve `commit()`. Si cualquier operación o comprobación final falla
 * lanza `ContextError`, el contexto queda intacto y no hay evento: atomicidad.
 *
 * Orden de las reglas por operación: 1 tarea abierta → 2 operación y destino → 3 valor → 4 mutabilidad →
 * 5 referencias → 7 topes. La regla 6 (transiciones e invariantes de 5.3) se comprueba una sola vez, al final del lote.
 * Las referencias se resuelven contra el contexto previo al lote: un lote no puede usar ids que él mismo crea.
 */

import { assertFinalState } from "./closure.ts";
import { ContextError, violation } from "./errors.ts";
import { existsIn, makeId, parseId } from "./ids.ts";
import { deepFreeze, isPlainObject } from "./json.ts";
import {
  assertVerifiable,
  checkCallInput,
  checkCallPatch,
  checkErrorInput,
  checkFactInput,
  checkFactKey,
  checkFinishValue,
  checkPlanInput,
  checkRefInput,
  checkResultInput,
  checkStepInput,
  checkStepPatch,
} from "./validate.ts";
import type { CheckEnv } from "./validate.ts";
import type {
  Call,
  ContextData,
  ContextLimits,
  ErrorEntry,
  Fact,
  FinishValue,
  NormalizedOp,
  Plan,
  Ref,
  ResultEntry,
  SectionName,
  Step,
  StepState,
} from "./types.ts";

/** Transiciones de `step.state` (5.3). `completed` y `failed` son finales. */
const ALLOWED_STEP_TRANSITIONS: { readonly [S in StepState]: readonly StepState[] } = {
  pending: ["running"],
  running: ["completed", "failed"],
  completed: [],
  failed: [],
};

const OP_KEYS = ["op", "target", "value"];

export interface PreparedBatch {
  /** Operaciones normalizadas (con `id` y `at` asignados), congeladas. */
  readonly ops: NormalizedOp[];
  /** Ids creados por el lote, en el orden de las operaciones `add`. */
  readonly ids: string[];
  /** Aplica el lote al contexto. No puede fallar: todo se validó antes. */
  commit(): void;
}

interface Added {
  plans: Plan[];
  steps: Step[];
  calls: Call[];
  errors: ErrorEntry[];
  refs: Ref[];
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

class Draft {
  private readonly data: ContextData;
  private readonly at: number;
  private readonly added: Added = { plans: [], steps: [], calls: [], errors: [], refs: [] };
  private readonly patchedSteps = new Map<number, Step>();
  private readonly patchedCalls = new Map<number, Call>();
  private readonly facts = new Map<string, Fact>();
  private result: ResultEntry | null | undefined = undefined;
  private finish: FinishValue | null = null;
  private touchedSteps = false;
  readonly ops: NormalizedOp[] = [];
  readonly ids: string[] = [];

  constructor(data: ContextData, at: number) {
    this.data = data;
    this.at = at;
  }

  // ─────────── Estado del borrador ───────────

  /** Regla 1: la tarea es terminal (ya antes del lote, o por un `finish` anterior dentro de él). */
  private isClosed(): boolean {
    return this.data.task.state !== "running" || this.finish !== null;
  }

  private currentResult(): ResultEntry | null {
    return this.result !== undefined ? this.result : this.data.result;
  }

  private stepAt(index: number): Step {
    return this.patchedSteps.get(index) ?? this.data.steps[index];
  }

  private callAt(index: number): Call {
    return this.patchedCalls.get(index) ?? this.data.calls[index];
  }

  private nextId(section: SectionName): string {
    const id = makeId(section, this.data[section].length + this.added[section].length);
    this.ids.push(id);
    return id;
  }

  private record(op: NormalizedOp): void {
    this.ops.push(Object.freeze(op));
  }

  /** Vista final de los pasos (contexto previo + modificaciones + nuevos) para las comprobaciones de fin de lote. */
  private finalSteps(): Step[] {
    return this.data.steps.map((s, i) => this.patchedSteps.get(i) ?? s).concat(this.added.steps);
  }

  private finalCalls(): Call[] {
    return this.data.calls.map((c, i) => this.patchedCalls.get(i) ?? c).concat(this.added.calls);
  }

  // ─────────── Procesamiento de una operación ───────────

  process(raw: unknown, env: CheckEnv): void {
    // Regla 2: operación bien formada.
    if (!isPlainObject(raw)) violation("malformed_op", 2, "la operación debe ser un objeto { op, target, value }");
    for (const key of Object.keys(raw)) {
      if (!OP_KEYS.includes(key)) violation("malformed_op", 2, `la operación tiene un campo desconocido "${key}"`);
    }
    const { op, target } = raw;
    if (op !== "add" && op !== "update" && op !== "set" && op !== "finish") {
      violation("malformed_op", 2, "`op` debe ser add, update, set o finish");
    }
    if (typeof target !== "string" || target.length === 0) violation("malformed_op", 2, "`target` debe ser un texto no vacío");
    if (!has(raw, "value")) violation("malformed_op", 2, "la operación no trae `value`");

    // Regla 1: tarea abierta; si es terminal, solo se admite escribir `result`.
    if (this.isClosed() && !(op === "set" && target === "result")) {
      violation("closed", 1, "la tarea está cerrada: solo se admite escribir `result` una vez");
    }

    switch (op) {
      case "add":
        this.add(target, raw.value, env);
        return;
      case "update":
        this.update(target, raw.value, env);
        return;
      case "set":
        this.set(target, raw.value, env);
        return;
      case "finish":
        this.finishTask(target, raw.value);
        return;
    }
  }

  private add(target: string, value: unknown, env: CheckEnv): void {
    switch (target) {
      case "plans": {
        const v = checkPlanInput(value, env);
        const element: Plan = deepFreeze({ id: this.nextId("plans"), at: this.at, trigger: v.trigger, feedback: v.feedback, stepId: v.stepId });
        this.added.plans.push(element);
        this.record({ op: "add", target: "plans", value: element });
        return;
      }
      case "steps": {
        const v = checkStepInput(value, env);
        const element: Step = deepFreeze({
          id: this.nextId("steps"),
          at: this.at,
          planId: v.planId,
          instruction: v.instruction,
          route: v.route,
          expected: v.expected,
          // 5.3: nace `pending` si trae `planId`; `running` si no (reactivo).
          state: v.planId !== null ? ("pending" as const) : ("running" as const),
          superseded: false,
        });
        this.added.steps.push(element);
        this.touchedSteps = true;
        this.record({ op: "add", target: "steps", value: element });
        return;
      }
      case "calls": {
        const v = checkCallInput(value, env);
        const element: Call = deepFreeze({
          id: this.nextId("calls"),
          stepId: v.stepId,
          at: this.at,
          route: v.route,
          tool: v.tool,
          kind: v.kind,
          args: v.args,
          sig: v.sig,
          status: v.status,
          verdict: null,
          reason: null,
          summary: v.summary,
          ref: v.ref,
        });
        this.added.calls.push(element);
        this.record({ op: "add", target: "calls", value: element });
        return;
      }
      case "errors": {
        const v = checkErrorInput(value, env);
        const element: ErrorEntry = deepFreeze({ id: this.nextId("errors"), stepId: v.stepId, at: this.at, kind: v.kind });
        this.added.errors.push(element);
        this.record({ op: "add", target: "errors", value: element });
        return;
      }
      case "refs": {
        const v = checkRefInput(value, env);
        const element: Ref = deepFreeze({
          id: this.nextId("refs"),
          stepId: v.stepId,
          at: this.at,
          label: v.label,
          size: v.size,
          where: v.where,
        });
        this.added.refs.push(element);
        this.record({ op: "add", target: "refs", value: element });
        return;
      }
      default:
        violation("unknown_target", 2, `\`add\` no aplica a "${target}" (solo plans, steps, calls, errors y refs)`);
    }
  }

  private update(target: string, value: unknown, env: CheckEnv): void {
    const parsed = parseId(target);
    if (parsed === null) violation("malformed_op", 2, `el destino de \`update\` es el id de un elemento (se recibió "${target}")`);
    if (!existsIn(this.data, parsed.section, target)) {
      violation("unknown_target", 2, `el elemento "${target}" no existe (un lote no puede actualizar lo que él mismo crea)`);
    }
    switch (parsed.section) {
      case "steps": {
        const patch = checkStepPatch(value, env);
        const next: Step = deepFreeze({ ...this.stepAt(parsed.index), ...patch });
        this.patchedSteps.set(parsed.index, next);
        this.touchedSteps = true;
        this.record({ op: "update", target, value: deepFreeze({ ...patch }) });
        return;
      }
      case "calls": {
        const patch = checkCallPatch(value);
        const current = this.callAt(parsed.index);
        assertVerifiable(current.id, current.status);
        // Regla 4 (tabla de campos mutables): `verdict` y `reason` se escriben una sola vez, mientras `verdict` sea null.
        if (current.verdict !== null) {
          violation("not_mutable", 4, `la llamada ${current.id} ya tiene veredicto: se escribe una sola vez (un reintento es una llamada nueva)`);
        }
        const next: Call = deepFreeze({ ...current, verdict: patch.verdict, reason: patch.reason });
        this.patchedCalls.set(parsed.index, next);
        this.record({ op: "update", target, value: deepFreeze({ ...patch }) });
        return;
      }
      default:
        // Regla 4: plans, errors y refs son inmutables.
        violation("not_mutable", 4, `los elementos de \`${parsed.section}\` son inmutables: "${target}" no se puede actualizar`);
    }
  }

  private set(target: string, value: unknown, env: CheckEnv): void {
    if (target === "result") {
      // Regla 1: `result` solo se escribe con la tarea ya en estado terminal, en un `apply` posterior al `finish`.
      if (this.data.task.state === "running") {
        violation("not_mutable", 1, "`result` solo se escribe con la tarea en estado terminal, en un `apply` posterior al `finish`");
      }
      const v = checkResultInput(value);
      // Regla 4: `result` se escribe una sola vez (mientras sea null).
      if (this.currentResult() !== null) violation("not_mutable", 4, "`result` ya tiene valor: se escribe una sola vez");
      const entry: ResultEntry = deepFreeze({ text: v.text, origin: v.origin });
      this.result = entry;
      this.record({ op: "set", target: "result", value: entry });
      return;
    }
    if (target.startsWith("facts.")) {
      const key = checkFactKey(target.slice("facts.".length));
      const v = checkFactInput(value, env);
      // `stepId` y `at` se actualizan en cada `set` (regla 4, tabla de campos mutables).
      const fact: Fact = deepFreeze({ value: v.value, stepId: v.stepId, at: this.at });
      this.facts.set(key, fact);
      this.record({ op: "set", target: `facts.${key}`, value: fact });
      return;
    }
    violation("unknown_target", 2, `\`set\` no aplica a "${target}" (solo \`facts.<clave>\` y \`result\`)`);
  }

  private finishTask(target: string, value: unknown): void {
    if (target !== "task") violation("unknown_target", 2, `\`finish\` aplica a "task", no a "${target}"`);
    const v = checkFinishValue(value);
    // El estado y el motivo se validan contra la tabla de 5.3 al final del lote, con la vista final de calls y steps.
    this.finish = deepFreeze({ state: v.state, stopReason: v.stopReason });
    this.record({ op: "finish", target: "task", value: this.finish });
  }

  // ─────────── Regla 6: comprobaciones al final del lote ───────────

  checkEnd(): void {
    if (this.touchedSteps) {
      for (const [index, next] of this.patchedSteps) {
        const prev = this.data.steps[index];
        // Transiciones de `step.state` (5.3).
        if (next.state !== prev.state && !ALLOWED_STEP_TRANSITIONS[prev.state].includes(next.state)) {
          violation("transition", 6, `paso ${prev.id}: la transición ${prev.state} → ${next.state} no está permitida`);
        }
        // Invariante 1: `superseded` solo pasa de false a true, y nunca en un paso `completed`.
        if (prev.superseded && !next.superseded) {
          violation("invariant", 6, `invariante 1: el paso ${prev.id} ya estaba \`superseded\` y no puede volver a false`);
        }
        if (next.superseded && next.state === "completed") {
          violation("invariant", 6, `invariante 1: el paso ${prev.id} está \`completed\` y no puede quedar \`superseded\``);
        }
      }
      // Invariante 2: como máximo un paso vigente `running`.
      let running = 0;
      for (const step of this.finalSteps()) {
        if (!step.superseded && step.state === "running") running++;
      }
      if (running > 1) violation("invariant", 6, `invariante 2: hay ${running} pasos vigentes \`running\` (máximo uno)`);
    }
    // Invariante 3 y tabla de estado terminal por motivo de detención.
    if (this.finish !== null) {
      assertFinalState(this.data.task.mode, this.finish.state, this.finish.stopReason, this.finalSteps(), this.finalCalls());
    }
  }

  // ─────────── Confirmación ───────────

  commit(): void {
    const data = this.data;
    for (const [index, step] of this.patchedSteps) data.steps[index] = step;
    for (const [index, call] of this.patchedCalls) data.calls[index] = call;
    for (const element of this.added.plans) data.plans.push(element);
    for (const element of this.added.steps) data.steps.push(element);
    for (const element of this.added.calls) data.calls.push(element);
    for (const element of this.added.errors) data.errors.push(element);
    for (const element of this.added.refs) data.refs.push(element);
    for (const [key, fact] of this.facts) data.facts[key] = fact;
    if (this.result !== undefined) data.result = this.result;
    if (this.finish !== null) {
      data.task = deepFreeze({ ...data.task, state: this.finish.state, stopReason: this.finish.stopReason });
    }
  }
}

/**
 * Valida y arma un lote sin modificar `data`. `raw` es una operación o un arreglo de operaciones; `at` es la marca
 * de tiempo única del lote; `limits` son los topes que pasó quien creó el contexto.
 */
export function prepareBatch(data: ContextData, raw: unknown, at: number, limits: ContextLimits): PreparedBatch {
  const rawOps: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
  if (rawOps.length === 0) violation("malformed_op", 2, "el lote no tiene operaciones");

  const env: CheckEnv = {
    mode: data.task.mode,
    limits,
    hasPlan: (id) => existsIn(data, "plans", id),
    hasStep: (id) => existsIn(data, "steps", id),
    hasRef: (id) => existsIn(data, "refs", id),
  };

  const draft = new Draft(data, at);
  rawOps.forEach((rawOp, index) => {
    try {
      draft.process(rawOp, env);
    } catch (error) {
      throw error instanceof ContextError && error.opIndex === null ? error.withOp(index) : error;
    }
  });
  draft.checkEnd();

  return { ops: draft.ops, ids: draft.ids, commit: () => draft.commit() };
}
