/**
 * eval/core/offered.ts
 *
 * Las opciones de las decisiones D1 (`route`) y D2 (`tool_choice`) son las del backend y no las declara el caso:
 * D1 ofrece siempre todas las rutas ejecutables y D2, todas las herramientas visibles de la ruta elegida (un grupo por ruta).
 * Se leen del catálogo (`SYSTEM_TOOL_MANIFEST`), así que si `src` agrega o quita una, el eval la ve sin tocar casos ni variantes.
 *
 * Producción además descarta rutas y herramientas en tiempo de ejecución (`availableRoutes`, lista negra, ruta agotada por D4):
 * es un parche que se revisará aparte y el eval no lo reproduce.
 */

import { EXECUTABLE_ROUTES, SYSTEM_TOOL_MANIFEST } from "./contract.ts";
import type { ExecutableRoute } from "./contract.ts";

/** Rutas que ofrece D1, en el orden del catálogo. */
export function offeredRoutes(): ExecutableRoute[] {
  return [...EXECUTABLE_ROUTES];
}

/** Herramientas que ofrece D2 para `route`. Las internas (las que usa por dentro una herramienta compuesta) no se ofrecen. */
export function offeredTools(route: ExecutableRoute): string[] {
  return SYSTEM_TOOL_MANIFEST.filter((d) => d.route === route && d.internal !== true).map((d) => d.name);
}
