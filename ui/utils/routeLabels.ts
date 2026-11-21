/**
 * Obtiene la etiqueta amigable para la interfaz de usuario a partir del destino funcional.
 */
export function getRouteLabel(route?: string | null): string {
  switch (route) {
    case "files_read":
      return "Lectura de archivos";
    case "files_write":
      return "Escritura de archivos";
    case "system":
      return "Sistema";
    case "multimedia":
      return "Multimedia";
    case "terminal":
      return "Terminal";
    case "web":
      return "Web";
    default:
      return route || "General";
  }
}
