/**
 * Almacén de refs en disco (PLAN_CONTEXT v0.29, 5.2 "refs" y sección 4 "retención").
 *
 * Guarda el texto crudo fuera del contexto y devuelve cómo recuperarlo (`where`, `size`). No conoce el contexto, las
 * herramientas ni el `id` de la ref: quien llama guarda primero aquí, después hace `apply add ref` con `where` y
 * `size`, y por último `apply add call` con `ref` (dos `apply`, sección 6).
 *
 * - El directorio llega por parámetro (quien compone el sistema lo lee de `refsDir`); este módulo no importa configuración.
 * - Archivo: `<dir>/<taskId saneado>/<uuid>.txt`. El nombre no depende del `id` de la ref.
 * - UTF-8, carpeta creada de forma recursiva y bandera `wx`: nunca sobrescribe.
 * - Nada se borra (sin barrido ni retención): las refs viven mientras viva el disco.
 * - No lee por trozos: eso lo hace el modelo con la herramienta de archivos sobre `where`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type RefVaultErrorCode = "invalid_input" | "write_failed" | "read_failed" | "outside_dir";

/** Error único del almacén. Qué hace el ejecutor con él se decide en la Fase 5. */
export class RefVaultError extends Error {
  readonly code: RefVaultErrorCode;
  /** Ruta implicada, si la hay. */
  readonly where: string | null;

  constructor(code: RefVaultErrorCode, message: string, where: string | null = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RefVaultError";
    this.code = code;
    this.where = where;
  }
}

export interface RefVaultOptions {
  /** Directorio raíz de las refs (`refsDir`). */
  dir: string;
}

export interface StoredRef {
  /** Ruta absoluta del archivo con el texto crudo. */
  where: string;
  /** Tamaño en caracteres de lo guardado (el texto, o el texto cortado más la marca si superó `REF_MAX_CHARS`). */
  size: number;
}

export interface RefVault {
  /** Guarda `text` en un archivo nuevo de la carpeta de la tarea; si supera `REF_MAX_CHARS`, lo corta y lo marca. */
  put(taskId: string, text: string): Promise<StoredRef>;
  /** Texto completo del archivo `where`; solo rutas dentro del directorio del almacén. */
  readAll(where: string): Promise<string>;
}

/** Tope de caracteres que `put` guarda por ref: lo que lo supera se corta y el archivo termina con una marca explícita (acota disco, memoria y el endpoint de depuración). */
export const REF_MAX_CHARS = 5_000_000;

/** Marca que `put` agrega al final de un texto cortado por `REF_MAX_CHARS`. */
export const refTruncationMarker = (omitted: number): string => `
[… ref truncated: ${omitted} characters omitted …]`;

const UNSAFE_CHARS = /[^A-Za-z0-9._-]/g;

/** Nombre de carpeta seguro para un id de tarea: lo que no es letra, dígito, `.`, `_` o `-` pasa a `_`; nunca solo puntos. */
export function taskFolderName(taskId: string): string {
  const name = taskId.replace(UNSAFE_CHARS, "_");
  return /^\.+$/.test(name) ? name.replace(/\./g, "_") : name;
}

function errnoCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRefVault(options: RefVaultOptions): RefVault {
  if (typeof options?.dir !== "string" || options.dir.length === 0) {
    throw new RefVaultError("invalid_input", "createRefVault: `dir` debe ser un texto no vacío");
  }
  const root = path.resolve(options.dir);

  async function put(taskId: string, text: string): Promise<StoredRef> {
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new RefVaultError("invalid_input", "put: `taskId` debe ser un texto no vacío");
    }
    if (typeof text !== "string") {
      throw new RefVaultError("invalid_input", "put: `text` debe ser un texto");
    }
    const stored = text.length > REF_MAX_CHARS ? `${text.slice(0, REF_MAX_CHARS)}${refTruncationMarker(text.length - REF_MAX_CHARS)}` : text;
    const folder = path.join(root, taskFolderName(taskId));
    const where = path.join(folder, `${randomUUID()}.txt`);

    try {
      await mkdir(folder, { recursive: true });
    } catch (error) {
      throw new RefVaultError("write_failed", `no se pudo crear la carpeta ${folder}: ${reason(error)}`, folder, error);
    }
    try {
      await writeFile(where, stored, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      // Con EEXIST el archivo no es nuestro (no se toca); con cualquier otro fallo puede quedar uno a medias.
      if (errnoCode(error) !== "EEXIST") await rm(where, { force: true }).catch(() => undefined);
      throw new RefVaultError("write_failed", `no se pudo escribir ${where}: ${reason(error)}`, where, error);
    }
    return { where, size: stored.length };
  }

  async function readAll(where: string): Promise<string> {
    if (typeof where !== "string" || where.length === 0) {
      throw new RefVaultError("invalid_input", "readAll: `where` debe ser un texto no vacío");
    }
    const resolved = path.resolve(where);
    const relative = path.relative(root, resolved);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new RefVaultError("outside_dir", `la ruta ${where} está fuera del directorio de refs`, where);
    }
    try {
      return await readFile(resolved, "utf8");
    } catch (error) {
      throw new RefVaultError("read_failed", `no se pudo leer ${resolved}: ${reason(error)}`, resolved, error);
    }
  }

  return { put, readAll };
}
