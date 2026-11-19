/** Cómo mira el disco el motor (poscondiciones): inyectable para las pruebas. Vive en `types/` porque `contracts.ts` lo nombra; `engine/postcondition.ts` lo reexporta. */
export interface DiskView {
  exists(p: string): boolean;
  isDirectory(p: string): boolean;
  size(p: string): number;
}
