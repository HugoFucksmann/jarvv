/**
 * `ContextOverflowError`: una vista que no puede recortarse no entra en el límite. Falla en voz alta, no recorta en
 * silencio (sección 9). La detecta el renderizador porque el tamaño en caracteres solo se conoce al renderizar.
 *
 * - `forPlan`: la tarea cierra con `unrecoverable` (5.3).
 * - `forFinal`: los efectos solos exceden el límite; el cierre cae a `forFallback`, que nunca falla.
 */

export type OverflowingView = "forPlan" | "forFinal";

export class ContextOverflowError extends Error {
  readonly view: OverflowingView;
  readonly maxChars: number;
  /** Tamaño de lo que no se pudo recortar más. */
  readonly chars: number;

  constructor(view: OverflowingView, maxChars: number, chars: number) {
    super(`${view}: lo que no se puede recortar (${chars} caracteres) excede el límite de ${maxChars}`);
    this.name = "ContextOverflowError";
    this.view = view;
    this.maxChars = maxChars;
    this.chars = chars;
  }
}
