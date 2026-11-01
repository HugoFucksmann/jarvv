/**
 * Error único del contexto. Toda violación de una regla de validación lanza `ContextError`:
 * nada cambia y no se emite evento (atomicidad, sección 6).
 */

export type ContextErrorCode =
  | "closed" // regla 1: la tarea ya es terminal
  | "malformed_op" // regla 2: operación mal formada
  | "unknown_target" // regla 2: el destino no existe
  | "invalid_value" // regla 3: JSON plano, campos, tipos, vocabularios
  | "not_mutable" // regla 4: el campo o el destino no es mutable
  | "dangling_ref" // regla 5: una referencia no existe
  | "transition" // regla 6: transición de estado no permitida
  | "invariant" // regla 6: invariante de 5.3
  | "finish_table" // regla 6: estado terminal no corresponde al motivo de detención
  | "limit" // regla 7: tope de largo o formato de clave
  | "reentrant" // apply dentro de un suscriptor
  | "snapshot_version" // load: `v` distinto
  | "snapshot_invalid"; // load: snapshot mal formado o inconsistente

/** Número de la regla de validación de la sección 6 que se violó; null si no corresponde a una de las 7. */
export type ValidationRule = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export class ContextError extends Error {
  readonly code: ContextErrorCode;
  readonly rule: ValidationRule | null;
  /** Posición de la operación dentro del lote; null si el error no es de una operación concreta. */
  readonly opIndex: number | null;
  /** Mensaje sin el prefijo de la operación. */
  readonly detail: string;

  constructor(code: ContextErrorCode, rule: ValidationRule | null, detail: string, opIndex: number | null = null) {
    super(opIndex === null ? detail : `[op ${opIndex}] ${detail}`);
    this.name = "ContextError";
    this.code = code;
    this.rule = rule;
    this.opIndex = opIndex;
    this.detail = detail;
  }

  /** Copia del error indicando en qué operación del lote ocurrió. */
  withOp(opIndex: number): ContextError {
    return new ContextError(this.code, this.rule, this.detail, opIndex);
  }
}

/** Atajo para lanzar un error de regla. */
export function violation(code: ContextErrorCode, rule: ValidationRule | null, message: string): never {
  throw new ContextError(code, rule, message);
}
