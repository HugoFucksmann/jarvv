import type { ExecutableRoute } from "../../src/core/types.ts";

/**
 * Obtiene la etiqueta amigable para la interfaz de usuario a partir del destino funcional.
 * Utiliza un switch exhaustivo sin cláusula default para garantizar validación en tiempo de compilación.
 */
export function getRouteLabel(route: ExecutableRoute): string {
  switch (route) {
    case "files":
      return "Archivos";
    case "locate":
      return "Búsqueda local";
    case "terminal":
      return "Terminal y procesos";
    case "web":
      return "Web";
  }
}
