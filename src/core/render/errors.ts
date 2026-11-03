/**
 * `ContextOverflowError`: lo que no puede recortarse (efectos y posibles efectos, que comparten una reserva) no entra. Falla
 * en voz alta, no recorta en silencio (sección 9). La detecta el renderizador porque el tamaño en caracteres solo se conoce
 * al renderizar. Solo las vistas que muestran efectos pueden desbordar:
 *
 * - `forPlan` y `forArgs`: la tarea cierra con `unrecoverable`, sin `error` (FLUJO 9).
 * - `forFinal`: el cierre cae a `forFallback`, que nunca falla.
 */

export type OverflowingView = "forPlan" | "forFinal" | "forArgs";

export class ContextOverflowError extends Error {
  readonly view: OverflowingView;
  /** Reserva de efectos que se excedió. */
  readonly maxChars: number;
  /** Tamaño de lo que no se pudo recortar. */
  readonly chars: number;

  constructor(view: OverflowingView, maxChars: number, chars: number) {
    super(`${view}: lo que no se puede recortar (${chars} caracteres) excede la reserva de ${maxChars}`);
    this.name = "ContextOverflowError";
    this.view = view;
    this.maxChars = maxChars;
    this.chars = chars;
  }
}