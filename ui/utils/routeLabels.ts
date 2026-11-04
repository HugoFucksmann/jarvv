/**
 * Obtiene la etiqueta amigable para la interfaz de usuario a partir del destino funcional.
 */
export function getRouteLabel(route?: string | null): string {
  switch (route) {
    case "files":
      return "Archivos";
    case "locate":
      return "Búsqueda local";
    case "terminal":
      return "Terminal y procesos";
    case "web":
      return "Web";
    default:
      return route || "General";
  }
}
