/**
 * Identificadores (5.1): prefijo de sección + número creciente (`p1`, `s1`, `c4`, `e1`, `r3`).
 * Único en todo el contexto, nunca se reutiliza ni se renumera; como nada se borra, el índice de un elemento en
 * su arreglo es siempre `número - 1` y la búsqueda por id es O(1).
 */

import type { ContextData, SectionName } from "./types.ts";

export const ID_PREFIX: { readonly [S in SectionName]: string } = {
  plans: "p",
  steps: "s",
  calls: "c",
  errors: "e",
  refs: "r",
};

const SECTION_BY_PREFIX: { readonly [prefix: string]: SectionName | undefined } = {
  p: "plans",
  s: "steps",
  c: "calls",
  e: "errors",
  r: "refs",
};

const ID_PATTERN = /^([a-z])([1-9][0-9]*)$/;

export interface ParsedId {
  section: SectionName;
  /** Posición del elemento en el arreglo de su sección. */
  index: number;
}

/** Interpreta un id; null si no tiene la forma `<prefijo><número>` de una sección con id. */
export function parseId(id: unknown): ParsedId | null {
  if (typeof id !== "string") return null;
  const match = ID_PATTERN.exec(id);
  if (!match) return null;
  const section = SECTION_BY_PREFIX[match[1]];
  if (section === undefined) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number)) return null;
  return { section, index: number - 1 };
}

/** Id del elemento que ocupa la posición `count` (los `count` anteriores ya existen). */
export function makeId(section: SectionName, count: number): string {
  return `${ID_PREFIX[section]}${count + 1}`;
}

/** ¿Existe en `data` un elemento de esa sección con ese id? */
export function existsIn(data: Pick<ContextData, SectionName>, section: SectionName, id: unknown): boolean {
  const parsed = parseId(id);
  if (parsed === null || parsed.section !== section) return false;
  const element = data[section][parsed.index];
  return element !== undefined && element.id === id;
}
