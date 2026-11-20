/**
 * eval/core/stages/shared.ts
 *
 * Helpers mínimos compartidos por los módulos de etapa.
 */

import { EXECUTABLE_ROUTES, isExecutableRoute } from "../contract.ts";
import type { LabelInfo } from "./types.ts";

export const YES = "yes";
export const NO = "no";

export function noLabel(): LabelInfo {
  return { predicted: null, expected: null, rawScore: null, probabilities: null };
}

export function checkRoute(key: string, v: unknown, errs: string[]): void {
  if (typeof v === "string" && !isExecutableRoute(v)) {
    errs.push(`expect.${key} '${v}' no es una ruta ejecutable (válidas: ${EXECUTABLE_ROUTES.join(", ")}).`);
  }
}

export function checkRouteList(key: string, v: unknown, errs: string[]): void {
  if (Array.isArray(v)) v.forEach((r) => checkRoute(`${key}[]`, r, errs));
}

export function checkRange01(expectObj: Record<string, unknown>, keys: readonly string[], errs: string[]): void {
  for (const key of keys) {
    const v = expectObj[key];
    if (typeof v === "number" && Number.isFinite(v) && (v < 0 || v > 1)) {
      errs.push(`expect.${key} debe estar entre 0 y 1 (recibido: ${v}).`);
    }
  }
}

export function checkIntMin1(expectObj: Record<string, unknown>, keys: readonly string[], errs: string[]): void {
  for (const key of keys) {
    const v = expectObj[key];
    if (typeof v === "number" && Number.isFinite(v) && (!Number.isInteger(v) || v < 1)) {
      errs.push(`expect.${key} debe ser un entero >= 1 (recibido: ${v}).`);
    }
  }
}
