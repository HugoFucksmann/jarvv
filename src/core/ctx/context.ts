/**
 * `TaskContext`: el contexto de una tarea. Fachada fina sobre los módulos del paquete:
 * escritura (`apply`), lectura (`get`, `find`, `current`), eventos (`on`) y persistencia (`snapshot`).
 *
 * Un solo escritor por tarea y todo síncrono: no hace falta control de concurrencia (sección 4).
 * No conoce herramientas, modelos ni traza (principio 5): quien lo usa le pasa los datos ya resueltos.
 */

import { prepareBatch } from "./apply.ts";
import { ContextError } from "./errors.ts";
import { currentOf, findElements, getElement } from "./query.ts";
import { cloneData } from "./snapshot.ts";
import { checkMeta } from "./validate.ts";
import type {
  ApplyResult,
  ChangeEvent,
  ChangeMeta,
  ContextData,
  ContextElement,
  ContextLimits,
  ContextOptions,
  CurrentView,
  ElementOf,
  Op,
  ResultEntry,
  SectionName,
  TaskInfo,
} from "./types.ts";

export type ChangeListener = (event: ChangeEvent) => void;

export class TaskContext {
  private data: ContextData;
  private counter = 0;
  private emitting = false;
  private readonly listeners = new Set<ChangeListener>();
  private readonly now: () => number;
  private readonly limits: ContextLimits;
  private readonly onListenerError: ((error: unknown) => void) | undefined;

  constructor(data: ContextData, options: ContextOptions) {
    this.data = data;
    this.now = options.now;
    this.limits = {
      summaryMax: options.summaryMax,
      argsStringMax: options.argsStringMax,
      factValueMax: options.factValueMax,
      jsonMaxDepth: options.jsonMaxDepth,
    };
    this.onListenerError = options.onListenerError;
  }

  // ─────────── Versión y estado ───────────

  /** Versión actual: contador interno de `apply`. Fuera del JSON y no se persiste. */
  get n(): number {
    return this.counter;
  }

  /** Identidad y estado de la tarea (solo lectura). */
  get task(): Readonly<TaskInfo> {
    return this.data.task;
  }

  /** Respuesta final; `null` hasta que exista (solo lectura). */
  get result(): Readonly<ResultEntry> | null {
    return this.data.result;
  }

  /** ¿La tarea llegó a un estado terminal? Quien ejecuta lo consulta para descartar eventos tardíos (5.3). */
  isClosed(): boolean {
    return this.data.task.state !== "running";
  }

  // ─────────── Escritura ───────────

  /**
   * Única puerta de escritura. Una operación o un arreglo; el arreglo se aplica completo o no se aplica:
   * ante cualquier error lanza `ContextError`, no cambia nada y no emite evento.
   */
  apply(ops: Op | readonly Op[], meta?: ChangeMeta): ApplyResult {
    if (this.emitting) {
      throw new ContextError("reentrant", null, "`apply` no se puede llamar dentro de un suscriptor de `change`");
    }
    const changeMeta = checkMeta(meta);
    const at = this.now();
    const batch = prepareBatch(this.data, ops, at, this.limits);
    batch.commit();
    this.counter += 1;
    const event: ChangeEvent = Object.freeze({
      n: this.counter,
      at,
      ops: Object.freeze(batch.ops),
      meta: changeMeta === null ? null : Object.freeze(changeMeta),
    });
    this.emit(event);
    return { n: this.counter, ids: batch.ids };
  }

  // ─────────── Eventos ───────────

  /**
   * Suscripción a `change`. Los suscriptores son de solo lectura: no pueden llamar a `apply` y, si fallan, el
   * cambio no se revierte (el error va a `onListenerError`). Devuelve la función que cancela la suscripción.
   */
  on(event: "change", listener: ChangeListener): () => void {
    if (event !== "change") throw new ContextError("malformed_op", null, `evento desconocido "${String(event)}"`);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: ChangeEvent): void {
    this.emitting = true;
    try {
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch (error) {
          this.onListenerError?.(error);
        }
      }
    } finally {
      this.emitting = false;
    }
  }

  // ─────────── Lectura ───────────

  /** Un elemento por `id` (`facts.<clave>` para un hecho); `undefined` si no existe. */
  get(id: string): Readonly<ContextElement> | undefined {
    return getElement(this.data, id);
  }

  /** Elementos de una sección que cumplen la igualdad de campos de `where`, incluidos los reemplazados por un replan. */
  find<S extends SectionName>(section: S, where: Partial<ElementOf<S>>): readonly ElementOf<S>[] {
    return findElements(this.data, section, where);
  }

  /** `{ step, lastCall }`: el paso vigente `running` (o el primer vigente `pending`) y la última llamada. */
  current(): CurrentView {
    return currentOf(this.data);
  }

  // ─────────── Persistencia ───────────

  /** Copia profunda en JSON plano; no comparte nada con el contexto vivo. */
  snapshot(): ContextData {
    return cloneData(this.data);
  }
}
