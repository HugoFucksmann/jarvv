/**
 * JARVIS Core — Estado de la lista de pendientes del reactivo (transiciones puras, sin modelos ni contexto).
 *
 * La lista la mantiene el código (ver `pendingList.ts`): el modelo la genera al empezar, el paso que termina bien quita su ítem y solo se consulta de nuevo al modelo
 * tras un paso fallido (reescribir el ítem) o al vaciarse (confirmar que no falta nada). Este objeto es todo lo que `runReactive` recordaba en variables sueltas: la
 * lista, qué ítems ya se cumplieron o abandonaron, cuántos pasos fallaron seguidos sobre el ítem de adelante y cuántas veces Decisión 5 reabrió la lista. Cada
 * método es una transición con nombre; `runReactive` decide cuándo ocurre cada una y se queda solo con el flujo (qué consultar, cuándo cerrar).
 */

import { itemFailuresReached } from "./limits.ts";
import { reconcileList } from "./pendingList.ts";

/** Reaperturas de la lista por tarea cuando Decisión 5 dice con seguridad que falta algo. */
export const MAX_REOPENS = 2;

export class ReactiveList {
  /** Lo que falta; el primer ítem es la instrucción del paso. */
  private items: readonly string[] = [];
  /** ¿Toca consultar al modelo de pendientes antes del próximo paso? */
  private asking = true;
  /** Ítems cumplidos o abandonados: el modelo no los vuelve a agregar. */
  private readonly done: string[] = [];
  private dropped = 0;
  /** Pasos fallidos seguidos sobre el ítem de adelante. */
  private headFailures = 0;
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

  /** ¿Se abandonó algún ítem? Entonces la tarea no puede cerrar `completed`. */
  get hasAbandoned(): boolean {
    return this.dropped > 0;
  }

  /** Empieza con una lista que no necesita al modelo (una acción: la solicitud literal es el único ítem). */
  seed(items: readonly string[]): void {
    this.items = items;
    this.asking = false;
  }

  /** El modelo ya contestó y el próximo paso puede ejecutarse. */
  modelAnswered(): void {
    this.asking = false;
  }

  /**
   * El modelo devolvió una lista no vacía. Se ajusta con lo ya cumplido y con los ítems que venían detrás del reescrito. Si Decisión 5 dijo con seguridad que falta
   * algo (`incompleteBefore`: su última probabilidad estaba por debajo del umbral) y `reconcileList` la dejó vacía solo por parecerse a un ítem ya cumplido (p. ej. un
   * ítem compuesto «crear la carpeta y luego el archivo» del que solo se hizo la primera parte), cerrar sería dar por hecho lo que no se hizo: se ejecutan los ítems
   * propuestos que no repiten el texto exacto de uno ya cumplido, como máximo `MAX_REOPENS` veces por tarea.
   */
  applyModelList(modelList: readonly string[], incompleteBefore: boolean): void {
    const previous = this.items;
    this.items = reconcileList(modelList, previous, this.done);
    if (this.items.length === 0 && modelList.length > 0 && this.reopens < MAX_REOPENS && incompleteBefore) {
      const fresh = modelList.filter((item) => !this.done.includes(item));
      if (fresh.length > 0) {
        this.items = fresh;
        this.reopens++;
      }
    }
  }

  /**
   * El modelo dice que no queda nada. Si el código tiene ítems detrás del que falló, siguen; y si con eso la lista quedó más corta, el ítem de adelante se dio por
   * abandonado.
   */
  applyModelDone(): void {
    const previous = this.items;
    this.items = reconcileList([], previous, this.done);
    if (previous.length > 0 && this.items.length < previous.length) {
      this.done.push(previous[0]);
      this.dropped++;
    }
  }

  /** El paso del ítem de adelante terminó bien: se quita de la lista. */
  completeHead(): void {
    this.done.push(this.head);
    this.items = this.items.slice(1);
    this.headFailures = 0;
  }

  /**
   * El paso del ítem de adelante falló. Si ya falló `maxItemFailures` veces seguidas y quedan otros ítems, se abandona (salida parcial: se sigue con el resto, p. ej.
   * guardar lo obtenido) y devuelve `"abandoned"`; si no, hay que consultar al modelo para reescribirlo y devuelve `"rewrite"`.
   */
  failHead(): "abandoned" | "rewrite" {
    this.headFailures++;
    if (itemFailuresReached(this.headFailures) && this.items.length > 1) {
      this.done.push(this.head);
      this.dropped++;
      this.items = this.items.slice(1);
      this.headFailures = 0;
      return "abandoned";
    }
    this.asking = true;
    return "rewrite";
  }

  /** La lista se vació tras completar el último ítem: hay que consultar al modelo para confirmar que no falta nada. */
  askModelToConfirm(): void {
    this.asking = true;
  }
}
