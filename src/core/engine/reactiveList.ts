/**
 * JARVIS Core — Estado de la lista de pendientes del reactivo (transiciones puras, sin modelos ni contexto).
 *
 * La lista la mantiene el código (ver `pendingList.ts`): el modelo la genera al empezar, el paso que termina bien quita su ítem y solo se consulta de nuevo al modelo
 * tras un paso fallido (reescribir el ítem) o al vaciarse (confirmar que no falta nada). Un ítem nunca se abandona: si alcanza `maxItemFailures`, si `pending`
 * devuelve `done` o solo ítems ya cumplidos, o si repite exactamente el texto normalizado del ítem fallido, la lista señala cierre `no_alternatives`.
 */

import { itemFailuresReached } from "./limits.ts";
import { reconcileList, sameNormalizedText } from "./pendingList.ts";

/** Reaperturas de la lista por tarea cuando Decisión 5 dice con seguridad que falta algo. */
export const MAX_REOPENS = 2;

export type ModelListTransition = "accepted" | "identical_rewrite" | "no_replacement";

export class ReactiveList {
  /** Lo que falta; el primer ítem es la instrucción del paso. */
  private items: readonly string[] = [];
  /** ¿Toca consultar al modelo de pendientes antes del próximo paso? */
  private asking = true;
  /** Ítems ya cumplidos: el modelo no los vuelve a agregar. */
  private readonly done: string[] = [];
  /** Pasos fallidos seguidos sobre el ítem de adelante. */
  private headFailures = 0;
  /** Ítem de adelante que acaba de fallar y espera reescritura de `pending` (`null` en inicio o confirmación D5). */
  private failedHead: string | null = null;
  /** Veces que Decisión 5 reabrió la lista tras vaciarla `reconcileList`. */
  private reopens = 0;

  /** La lista actual (de solo lectura). */
  get pending(): readonly string[] {
    return this.items;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** El ítem de adelante: la instrucción del próximo paso. */
  get head(): string {
    return this.items[0];
  }

  /** ¿Hay que consultar al modelo antes del próximo paso? */
  get needsModel(): boolean {
    return this.asking;
  }

  /** Empieza con una lista que no necesita al modelo (una acción: la solicitud literal es el único ítem). */
  seed(items: readonly string[]): void {
    this.items = items;
    this.asking = false;
    this.failedHead = null;
  }

  /** El modelo ya contestó y el próximo paso puede ejecutarse. */
  modelAnswered(): void {
    this.asking = false;
  }

  /**
   * El modelo devolvió una lista no vacía.
   *
   * - Tras un fallo (`failedHead !== null`): corta con `"identical_rewrite"` si el ítem propuesto repite exactamente el texto normalizado del que falló, o con
   *   `"no_replacement"` si todo lo devuelto por el modelo ya figuraba en `done` (evita avanzar silenciosamente al siguiente ítem o vaciar la lista y cerrar
   *   `completed`). En ambos casos no muta `items` ni avanza la lista.
   * - En inicio o confirmación D5 (`failedHead === null`): aplica `reconcileList` y, si Decisión 5 dijo con seguridad que falta algo (`incompleteBefore`) y
   *   `reconcileList` la dejó vacía solo por parecerse a un ítem ya cumplido, reabre hasta `MAX_REOPENS` veces por tarea.
   */
  applyModelList(modelList: readonly string[], incompleteBefore: boolean): ModelListTransition {
    if (this.failedHead !== null) {
      if (modelList.length > 0 && sameNormalizedText(modelList[0], this.failedHead)) {
        return "identical_rewrite";
      }
      const freshFromModel = reconcileList(modelList, [], this.done);
      if (freshFromModel.length === 0) {
        return "no_replacement";
      }
      if (sameNormalizedText(freshFromModel[0], this.failedHead)) {
        return "identical_rewrite";
      }
      this.items = reconcileList(modelList, this.items, this.done);
      this.failedHead = null;
      return "accepted";
    }

    const previous = this.items;
    this.items = reconcileList(modelList, previous, this.done);
    if (this.items.length === 0 && modelList.length > 0 && this.reopens < MAX_REOPENS && incompleteBefore) {
      const fresh = modelList.filter((item) => !this.done.includes(item));
      if (fresh.length > 0) {
        this.items = fresh;
        this.reopens++;
      }
    }
    return "accepted";
  }

  /**
   * El modelo dice que no queda nada. Solo es válido con la lista ya vacía (inicio o confirmación tras completar todo); si quedaba algún ítem pendiente (p. ej.
   * tras un fallo), rechaza el cierre vacío para no abandonar ese ítem ni saltar a los posteriores.
   */
  applyModelDone(): "accepted" | "rejected" {
    if (this.items.length > 0) return "rejected";
    return "accepted";
  }

  /** El paso del ítem de adelante terminó bien: se quita de la lista. */
  completeHead(): void {
    this.done.push(this.head);
    this.items = this.items.slice(1);
    this.headFailures = 0;
    this.failedHead = null;
  }

  /**
   * El paso del ítem de adelante falló. Nunca abandona el ítem: al llegar a `maxItemFailures` fallos seguidos devuelve `"exhausted"` para cerrar la tarea
   * (`no_alternatives`), incluso con un solo ítem; si no, marca consulta al modelo para reescribirlo y devuelve `"rewrite"`.
   */
  failHead(): "exhausted" | "rewrite" {
    this.headFailures++;
    if (itemFailuresReached(this.headFailures)) {
      return "exhausted";
    }
    this.failedHead = this.head;
    this.asking = true;
    return "rewrite";
  }

  /** La lista se vació tras completar el último ítem: hay que consultar al modelo para confirmar que no falta nada. */
  askModelToConfirm(): void {
    this.asking = true;
  }
}
