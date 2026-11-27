/**
 * JARVIS Core — Estado de la lista de pendientes del reactivo (transiciones puras, sin modelos ni contexto).
 *
 * La lista la mantiene el código (ver `pendingList.ts`): el modelo la genera al empezar, el paso que termina bien quita su ítem y solo se consulta de nuevo al modelo
 * tras un paso fallido (reescribir el ítem) o al vaciarse (confirmar que no falta nada). Un ítem nunca se abandona: si `pending` repite exactamente el texto
 * normalizado del ítem fallido, devuelve `done` o solo ítems ya cumplidos, u omite el ítem fallido y sigue con uno de los de atrás, la lista señala cierre `no_alternatives`.
 * Excepción: tras `tool_failed` o `review_rejected` (`canRetryIdentical`) se acepta un reintento idéntico por ítem. Una reescritura distinta es un intento nuevo y no hay un tope por ítem: la racha la acota el tope de pasos fallidos seguidos (`escalationsExceeded`).
 */

import type { StepFailureCause } from "./outcomes.ts";
import { exactlyDistinct, itemKey, reconcileList, sameItem, sameNormalizedText } from "./pendingList.ts";

/** Reaperturas de la lista por tarea cuando Decisión 5 dice con seguridad que falta algo. */
export const MAX_REOPENS = 2;

/** `identical_retry`: el modelo repitió el ítem fallido y se acepta UN reintento idéntico porque la falla fue informativa para el generador de argumentos (`canRetryIdentical`; el resto cierra la tarea). */
type ModelListTransition = "accepted" | "identical_retry" | "identical_rewrite" | "no_replacement" | "skips_failed_item";

export class ReactiveList {
  /** Lo que falta; el primer ítem es la instrucción del paso. */
  private items: readonly string[] = [];
  /** ¿Toca consultar al modelo de pendientes antes del próximo paso? */
  private asking = true;
  /** Ítems ya cumplidos: el modelo no los vuelve a agregar. */
  private readonly done: string[] = [];
  /** Ítem de adelante que acaba de fallar y espera reescritura de `pending` (`null` en inicio o confirmación D5). */
  private failedHead: string | null = null;
  /** Por qué falló el paso del ítem de adelante (`null` en inicio o confirmación D5). */
  private failedCause: StepFailureCause | null = null;
  /** Ítems (por texto normalizado) que ya usaron su único reintento idéntico tras un error de la herramienta. */
  private readonly identicalRetried = new Set<string>();
  /** Pasos fallidos seguidos del ítem de adelante (se reinicia al completarlo): un ítem reescrito que vuelve a fallar ya no es su primer fallo. */
  private failStreak = 0;
  /** Veces que Decisión 5 reabrió la lista tras vaciarla `reconcileList`. */
  private reopens = 0;
  /** Ítems fallidos (por texto normalizado) que ya se difirieron una vez: un segundo fallo cierra. */
  private readonly deferred = new Set<string>();

  /** La lista actual (de solo lectura). */
  get pending(): readonly string[] {
    return this.items;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** El ítem que acaba de fallar y espera reescritura (`null` en inicio o confirmación D5). */
  get failedItem(): string | null {
    return this.failedHead;
  }

  /** Los ítems que vienen detrás del de adelante. */
  get laterItems(): readonly string[] {
    return this.items.slice(1);
  }

  /** ¿El ítem fallido todavía puede diferirse? Una sola vez por ítem. */
  get canDefer(): boolean {
    return this.failedHead !== null && !this.deferred.has(itemKey(this.failedHead));
  }

  /**
   * El ítem fallido no se abandona ni cierra la tarea: se difiere detrás de los ítems que no lo necesitan (`dependent[i]`: el `i`-ésimo de `laterItems` necesita su
   * resultado), y los que sí lo necesitan quedan detrás de él. El código conserva el orden de los demás ítems; no usa la lista del modelo, que omitió el fallido. `false`,
   * sin cambios, si ya se difirió una vez, si el veredicto no corresponde a los ítems o si todos dependen de él (no hay con qué seguir).
   */
  deferFailed(dependent: readonly boolean[]): boolean {
    const failed = this.failedHead;
    const later = this.items.slice(1);
    if (failed === null || !this.canDefer || dependent.length !== later.length) return false;
    const independent = later.filter((_, i) => !dependent[i]);
    if (independent.length === 0) return false;
    this.items = [...independent, failed, ...later.filter((_, i) => dependent[i])];
    this.deferred.add(itemKey(failed));
    this.failedHead = null;
    this.failedCause = null;
    this.failStreak = 0;
    return true;
  }

  /** ¿Quedan reaperturas de la lista por tarea? (Decisión 5 y el libro de requisitos comparten el tope.) */
  get canReopen(): boolean {
    return this.reopens < MAX_REOPENS;
  }

  /**
   * Reabre la lista con pasos que dio el código (los huecos del libro de requisitos), sin consultar al modelo de pendientes. `false` si no hay pasos o ya no quedan
   * reaperturas: la lista no cambia.
   */
  reopenWith(items: readonly string[]): boolean {
    if (items.length === 0 || this.reopens >= MAX_REOPENS) return false;
    this.items = [...items];
    this.reopens++;
    this.asking = false;
    this.failedHead = null;
    this.failedCause = null;
    return true;
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
    this.failedCause = null;
  }

  /** El modelo ya contestó y el próximo paso puede ejecutarse. */
  modelAnswered(): void {
    this.asking = false;
  }

  /**
   * El modelo devolvió una lista no vacía.
   *
   * - Tras un fallo (`failedHead !== null`): corta con `"identical_rewrite"` si el ítem propuesto repite exactamente el texto normalizado del que falló (Decisión
   *   trabaja con temperatura 0: el mismo texto da la misma respuesta, así que ya se sabe que fallará), con `"no_replacement"` si todo lo devuelto por el modelo ya
   *   figuraba en `done` (evita vaciar la lista y cerrar `completed`), o con `"skips_failed_item"` si el modelo omitió el ítem fallido y empieza por uno de los que
   *   venían detrás (los ítems pueden depender del que falló: seguir sería ejecutarlos sin lo que necesitan). En los tres casos no muta `items` ni avanza la lista.
   *   Una reescritura DISTINTA se acepta y es un intento nuevo: no hereda ningún conteo.
   *   El caso `"skips_failed_item"` es una red de seguridad que decide por parecido de palabras (`sameItem`): ante la duda cierra, que es el lado seguro. La solución de fondo
   *   (que el modelo solo reescriba el ítem y el código conserve el orden del resto) queda pendiente.
   * - En inicio o confirmación D5 (`failedHead === null`): aplica `reconcileList` y, si Decisión 5 dijo con seguridad que falta algo (`incompleteBefore`) y
   *   `reconcileList` la dejó vacía solo por parecerse a un ítem ya cumplido, reabre hasta `MAX_REOPENS` veces por tarea.
   */
  applyModelList(modelList: readonly string[], incompleteBefore: boolean): ModelListTransition {
    if (this.failedHead !== null) {
      if (modelList.length > 0 && sameNormalizedText(modelList[0], this.failedHead)) {
        return this.identical();
      }
      const freshFromModel = reconcileList(modelList, [], this.done);
      if (freshFromModel.length === 0) {
        return "no_replacement";
      }
      if (sameNormalizedText(freshFromModel[0], this.failedHead)) {
        return this.identical();
      }
      // Omitió el ítem fallido y sigue con uno de los que venían detrás: parecido al de atrás y no al fallido.
      if (!sameItem(freshFromModel[0], this.failedHead) && this.items.slice(1).some((later) => sameItem(freshFromModel[0], later))) {
        return "skips_failed_item";
      }
      this.items = reconcileList(modelList, this.items, this.done);
      this.failedHead = null;
      this.failedCause = null;
      return "accepted";
    }

    const previous = this.items;
    // La primera lista del modelo es el pedido descompuesto: no hay nada cumplido ni previo con qué compararla, así que solo se quita lo literalmente repetido. Con `sameItem`,
    // «hospedaje en Buenos Aires» y «pasajes hacia Buenos Aires» pasaban por duplicados (comparten el lugar y el ítem corto queda «cubierto»), y la tarea perdía partes del pedido.
    this.items = previous.length === 0 && this.done.length === 0 ? exactlyDistinct(modelList) : reconcileList(modelList, previous, this.done);
    if (this.items.length === 0 && modelList.length > 0 && this.reopens < MAX_REOPENS && incompleteBefore) {
      const fresh = modelList.filter((item) => !this.done.some((d) => sameNormalizedText(d, item)));
      if (fresh.length > 0) {
        this.items = fresh;
        this.reopens++;
      }
    }
    return "accepted";
  }

  /**
   * ¿El fallo da pie a repetir el ítem tal cual? Solo cuando el generador de argumentos ve por qué falló el intento anterior (`LAST ERROR`, `attemptText`) y puede corregirlo:
   * - `tool_failed`: el error de la herramienta es información nueva en cada intento.
   * - `review_rejected` (`args_invalid`: p. ej. una URL inventada, con las conocidas en el mensaje): igual, pero solo en el PRIMER fallo del ítem; si una reescritura ya falló la revisión, el generador no
   *   está convergiendo y repetir solo gasta intentos.
   * Las demás causas (`verify_rejected`: mismos argumentos, mismo resultado; `call_cap`, `repeat_blocked`, `denied`, `user_rejected`) no cambian nada con otro intento y cierran.
   */
  private canRetryIdentical(): boolean {
    return this.failedCause === "tool_failed" || (this.failedCause === "review_rejected" && this.failStreak === 1);
  }

  /**
   * El modelo repitió el ítem que falló. Lo normal es cerrar (`identical_rewrite`): el mismo texto da la misma respuesta de Decisión y ya se sabe que fallará. Una
   * excepción: si el paso falló por errores de la herramienta (`tool_failed`) o por argumentos rechazados (`review_rejected`), un paso nuevo con el mismo ítem NO es igual al anterior, porque el generador de
   * argumentos ve el error anterior (`LAST ERROR`) y puede corregirlos. Se permite UN reintento idéntico por ítem; el segundo cierra. La lista no cambia.
   */
  private identical(): ModelListTransition {
    const key = itemKey(this.failedHead ?? "");
    if (this.canRetryIdentical() && key !== "" && !this.identicalRetried.has(key)) {
      this.identicalRetried.add(key);
      this.failedHead = null;
      this.failedCause = null;
      return "identical_retry";
    }
    return "identical_rewrite";
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
    this.failStreak = 0;
    this.done.push(this.head);
    this.items = this.items.slice(1);
    this.failedHead = null;
    this.failedCause = null;
  }

  /**
   * El paso del ítem de adelante falló (`cause`: por qué): se recuerda cuál fue y se consulta al modelo para reescribirlo. No hay un tope de fallos por ítem: una reescritura DISTINTA es un
   * intento nuevo (Decisión trabaja con temperatura 0: el mismo texto da siempre la misma respuesta, otro texto puede dar otra), y una IDÉNTICA ya se sabe que fallará
   * (`applyModelList` la corta). Lo que acota la racha es el tope de pasos fallidos seguidos (`escalationsExceeded`).
   */
  failHead(cause: StepFailureCause | null = null): void {
    this.failStreak++;
    this.failedHead = this.head;
    this.failedCause = cause;
    this.asking = true;
  }

  /** La lista se vació tras completar el último ítem: hay que consultar al modelo para confirmar que no falta nada. */
  askModelToConfirm(): void {
    this.asking = true;
  }
}
