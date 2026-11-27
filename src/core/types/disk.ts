/** Cómo mira el disco el motor (poscondiciones): inyectable para las pruebas. Vive en `types/` porque `contracts.ts` lo nombra; `engine/postcondition.ts` lo reexporta. */
export interface DiskView {
  exists(p: string): boolean;
  isDirectory(p: string): boolean;
  size(p: string): number;
  /** Texto de un archivo (hasta `maxBytes`), o `null` si no es texto o no se puede leer. Opcional: sin él no se observa el contenido de los archivos. */
  readText?(p: string, maxBytes: number): string | null;
  /** Nombres de las entradas de una carpeta (hasta `max`), o `null` si no se puede leer. Opcional. */
  list?(p: string, max: number): string[] | null;
}
