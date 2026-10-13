/**
 * JARVIS Core — Typed Tool Manifest & Catalog
 * Single Source of Truth for verified MCP and Local Tools.
 * References: docs/MCP_TOOLS_SNAPSHOT.md & PLAN_IMPLEMENTACION_MIGRACION_V1.3.md
 */

import { Capability, ToolPolicy, MCPTool } from "../types.ts";

export interface ToolDefinition {
  name: string;
  server: "windows" | "desktop_commander" | "free_search" | "local";
  capability: Capability;
  policy: ToolPolicy;
  description: string;
  isLocal?: boolean;
}

export const SYSTEM_TOOL_MANIFEST: readonly ToolDefinition[] = [
  // ============================================================
  // 1. Windows MCP (21 herramientas verificadas en runtime)
  // ============================================================
  {
    name: "ControlStatus",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Estado del dueño del control de escritorio e idle wait.",
  },
  {
    name: "App",
    server: "windows",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Abrir, iniciar, lanzar aplicaciones y gestionar ventanas.",
  },
  {
    name: "DisplayInventory",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Leer layout de pantallas activas y metadatos DPI.",
  },
  {
    name: "PowerShell",
    server: "windows",
    capability: "COMMAND_EXECUTION",
    policy: { capability: "COMMAND_EXECUTION", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Ejecución de scripts PowerShell y comandos terminal en Windows.",
  },
  {
    name: "FileSystem",
    server: "windows",
    capability: "FILE_WRITE",
    policy: { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Operaciones de sistema de archivos Windows (read/write/delete/copy/move/list).",
  },
  {
    name: "Snapshot",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Captura de pantalla e inspección visual de accesibilidad de la UI.",
  },
  {
    name: "Screenshot",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Snapshot rápido de escritorio o ventana activa.",
  },
  {
    name: "Click",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Clic de ratón en coordenadas específicas o elemento UI.",
  },
  {
    name: "Type",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Tipeo de texto en coordenadas o control con foco.",
  },
  {
    name: "Scroll",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Desplazamiento vertical u horizontal de rueda de ratón.",
  },
  {
    name: "Move",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Mover el cursor a una posición específica o drag-and-drop.",
  },
  {
    name: "Shortcut",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Ejecutar combinaciones de teclas (ej. ctrl+c, alt+tab).",
  },
  {
    name: "Wait",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", requiresApproval: false, kind: "READ", mutates: false, emptyIsError: false },
    description: "Pausa por duración específica de tiempo.",
  },
  {
    name: "WaitFor",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", requiresApproval: false, kind: "READ", mutates: false, emptyIsError: false },
    description: "Espera hasta que una condición específica de UI se cumpla.",
  },
  {
    name: "Scrape",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", requiresApproval: false, kind: "READ", mutates: false, emptyIsError: false },
    description: "Fetch y extracción de página web por URL.",
  },
  {
    name: "MultiSelect",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Selección múltiple de elementos o checkboxes.",
  },
  {
    name: "MultiEdit",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Entrada de texto simultánea en múltiples campos por coordenadas.",
  },
  {
    name: "Clipboard",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Operaciones de portapapeles de Windows (get/set/cut).",
  },
  {
    name: "Process",
    server: "windows",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Listar y terminar procesos del sistema.",
  },
  {
    name: "Notification",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Enviar notificación toast informativa en el escritorio.",
  },
  {
    name: "Registry",
    server: "windows",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Lectura y modificación del Registro de Windows (get/set/delete/list).",
  },

  // Herramientas heredadas / aliases de Windows MCP mapeadas para compatibilidad
  {
    name: "ui_get_window_tree",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Obtener árbol de accesibilidad de la ventana activa.",
  },
  {
    name: "ui_get_diff_tree",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Obtener cambios en el árbol de accesibilidad.",
  },
  {
    name: "ui_search_elements",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Buscar elementos en la interfaz gráfica.",
  },
  {
    name: "ui_inspect_element",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Inspeccionar atributos de un elemento de la interfaz.",
  },
  {
    name: "ui_read",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Leer texto de controles de UI.",
  },
  {
    name: "ui_wait",
    server: "windows",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Espera determinista en UI.",
  },
  {
    name: "ui_click",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Clic en elemento UI.",
  },
  {
    name: "ui_set_focus",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Establecer foco en un control.",
  },
  {
    name: "ui_type_text",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Tipear texto en control enfocado.",
  },
  {
    name: "set_volume",
    server: "windows",
    capability: "UI_ACTION",
    policy: { capability: "UI_ACTION", kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Ajustar volumen del sistema.",
  },
  {
    name: "launch_app",
    server: "windows",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Iniciar aplicación en Windows.",
  },
  {
    name: "close_window",
    server: "windows",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Cerrar ventana activa.",
  },

  // ============================================================
  // 2. Desktop Commander MCP (26 herramientas verificadas en runtime)
  // ============================================================
  {
    name: "get_config",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Obtener configuración completa del servidor Desktop Commander.",
  },
  {
    name: "set_config_value",
    server: "desktop_commander",
    capability: "CONFIGURATION",
    policy: { capability: "CONFIGURATION", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Modificar un valor específico de configuración.",
  },
  {
    name: "read_file",
    server: "desktop_commander",
    capability: "FILE_READ",
    policy: { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: true },
    description: "Leer contenido de archivo local o remoto (PDF, texto, offset).",
  },
  {
    name: "read_multiple_files",
    server: "desktop_commander",
    capability: "FILE_READ",
    policy: { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: true },
    description: "Leer múltiples archivos de forma paralela.",
  },
  {
    name: "write_file",
    server: "desktop_commander",
    capability: "FILE_WRITE",
    policy: { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Crear o sobrescribir archivo en disco.",
  },
  {
    name: "write_pdf",
    server: "desktop_commander",
    capability: "FILE_WRITE",
    policy: { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Crear o modificar un documento PDF.",
  },
  {
    name: "create_directory",
    server: "desktop_commander",
    capability: "FILE_WRITE",
    policy: { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Crear un nuevo directorio o asegurar su existencia.",
  },
  {
    name: "list_directory",
    server: "desktop_commander",
    capability: "FILE_READ",
    policy: { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Listar archivos y subdirectorios de una ruta.",
  },
  {
    name: "move_file",
    server: "desktop_commander",
    capability: "FILE_WRITE",
    policy: { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Mover o renombrar archivos o directorios.",
  },
  {
    name: "start_search",
    server: "desktop_commander",
    capability: "FILE_READ",
    policy: { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Iniciar búsqueda de archivos en streaming progresivo.",
  },
  {
    name: "get_more_search_results",
    server: "desktop_commander",
    capability: "FILE_READ",
    policy: { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Paginación de resultados de búsqueda activa de archivos.",
  },
  {
    name: "stop_search",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Detener una búsqueda de archivos en curso.",
  },
  {
    name: "list_searches",
    server: "desktop_commander",
    capability: "FILE_READ",
    policy: { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Listar búsquedas activas de archivos.",
  },
  {
    name: "get_file_info",
    server: "desktop_commander",
    capability: "FILE_READ",
    policy: { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Metadatos de archivo (tamaño, permisos, fechas).",
  },
  {
    name: "edit_block",
    server: "desktop_commander",
    capability: "FILE_WRITE",
    policy: { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Edición quirúrgica de bloques dentro de un archivo existente.",
  },
  {
    name: "start_process",
    server: "desktop_commander",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Iniciar proceso de terminal o comando en segundo plano.",
  },
  {
    name: "read_process_output",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Leer salida acumulada de un proceso en ejecución.",
  },
  {
    name: "interact_with_process",
    server: "desktop_commander",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Enviar stdin interactivo a un proceso o REPL.",
  },
  {
    name: "force_terminate",
    server: "desktop_commander",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Forzar terminación de sesión de terminal o proceso.",
  },
  {
    name: "list_sessions",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Listar sesiones de terminal activas.",
  },
  {
    name: "list_processes",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Listar procesos activos del sistema.",
  },
  {
    name: "kill_process",
    server: "desktop_commander",
    capability: "PROCESS_CONTROL",
    policy: { capability: "PROCESS_CONTROL", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Terminar un proceso por PID.",
  },
  {
    name: "get_usage_stats",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Estadísticas de uso para diagnóstico.",
  },
  {
    name: "get_recent_tool_calls",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Historial reciente de llamadas y argumentos.",
  },
  {
    name: "give_feedback_to_desktop_commander",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Abrir formulario de feedback.",
  },
  {
    name: "get_prompts",
    server: "desktop_commander",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Recuperar prompt de onboarding por ID.",
  },

  // Herramientas adicionales / heredadas de Desktop Commander
  {
    name: "run_command",
    server: "desktop_commander",
    capability: "COMMAND_EXECUTION",
    policy: { capability: "COMMAND_EXECUTION", requiresApproval: false, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Ejecución de comando en terminal (Guard valida dinámicamente mutaciones vs lecturas).",
  },
  {
    name: "search_files",
    server: "desktop_commander",
    capability: "FILE_READ",
    policy: { capability: "FILE_READ", kind: "READ", mutates: false, emptyIsError: true },
    description: "Buscar archivos por patrón de nombre.",
  },
  {
    name: "edit_file",
    server: "desktop_commander",
    capability: "FILE_WRITE",
    policy: { capability: "FILE_WRITE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Editar archivo local.",
  },
  {
    name: "delete_file",
    server: "desktop_commander",
    capability: "FILE_DELETE",
    policy: { capability: "FILE_DELETE", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Eliminar archivo del disco.",
  },
  {
    name: "set_config",
    server: "desktop_commander",
    capability: "CONFIGURATION",
    policy: { capability: "CONFIGURATION", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Actualizar configuración del servidor.",
  },

  // ============================================================
  // 3. Free Search MCP (11 herramientas verificadas en runtime v0.13.1)
  // ============================================================
  {
    name: "search",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: true },
    description: "Búsqueda web multi-motor deduplicada con snippets limpios.",
  },
  {
    name: "fetch",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Descargar y convertir página web a Markdown limpio.",
  },
  {
    name: "fetch_batch",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Descargar múltiples URLs web en paralelo.",
  },
  {
    name: "read_doc",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Leer documento remoto (PDF, DOCX) y parsear a Markdown.",
  },
  {
    name: "research",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Investigación web iterativa en profundidad.",
  },
  {
    name: "paper_graph",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Explorar citas y relaciones de papers académicos.",
  },
  {
    name: "cache_search",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Búsqueda full-text en caché local FTS5 SQLite.",
  },
  {
    name: "engines",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Listar motores de búsqueda disponibles y activos.",
  },
  {
    name: "compare",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Comparar contenido de 2 a 5 páginas web en paralelo.",
  },
  {
    name: "extract_structured",
    server: "free_search",
    capability: "READ",
    policy: { capability: "READ", kind: "READ", mutates: false, emptyIsError: false },
    description: "Extraer microdatos, OpenGraph y JSON-LD de una página web.",
  },
  {
    name: "download",
    server: "free_search",
    capability: "DOWNLOAD",
    policy: { capability: "DOWNLOAD", requiresApproval: true, kind: "no-READ", mutates: true, emptyIsError: false },
    description: "Descargar archivo o documento a un directorio local.",
  },

  // ============================================================
  // 4. Herramientas Locales Internas de JARVIS Core
  // ============================================================
  {
    name: "recall",
    server: "local",
    capability: "READ",
    policy: { capability: "READ", requiresApproval: false, kind: "READ", mutates: false, emptyIsError: false },
    description: "Recuperar hechos factuales, referencias previas o contexto relevante de memoria.",
    isLocal: true,
  },
  {
    name: "compose",
    server: "local",
    capability: "READ",
    policy: { capability: "READ", requiresApproval: false, kind: "READ", mutates: false, emptyIsError: false },
    description: "Redactar texto estructurado o respuesta en lenguaje natural asistido por Qwen.",
    isLocal: true,
  },
  {
    name: "ask_user",
    server: "local",
    capability: "READ",
    policy: { capability: "READ", requiresApproval: false, kind: "READ", mutates: false, emptyIsError: false },
    description: "Solicitar clarificación o parámetro indispensable directamente al usuario.",
    isLocal: true,
  },
];

/**
 * Consulta unívoca de definición en el manifiesto
 */
export function lookupToolManifest(server: string, tool: string): ToolDefinition | undefined {
  const normServer = server.toLowerCase();
  const normTool = tool.toLowerCase();
  return SYSTEM_TOOL_MANIFEST.find(
    (t) => t.server.toLowerCase() === normServer && t.name.toLowerCase() === normTool
  );
}

/**
 * Construye el catálogo compacto para el planificador Qwen (Sec. 3.2.3)
 * Proporciona nombres, servidores, capacidades y descripciones breves sin schemas pesados.
 */
export function buildCompactCatalog(discoveredTools?: Record<string, MCPTool[]>): string {
  const grouped: Record<string, string[]> = {
    windows: [],
    desktop_commander: [],
    free_search: [],
    local: [],
  };

  // Si se proveen herramientas descubiertas en runtime, priorizamos las activas
  if (discoveredTools && Object.keys(discoveredTools).length > 0) {
    for (const [server, tools] of Object.entries(discoveredTools)) {
      const serverKey = server in grouped ? server : "desktop_commander";
      for (const t of tools) {
        const manifestEntry = lookupToolManifest(server, t.name);
        const desc = manifestEntry?.description || t.description || "Herramienta disponible";
        grouped[serverKey].push(`• ${t.name}: ${desc.slice(0, 100)}`);
      }
    }
  } else {
    // Usamos el manifiesto base si no hay snapshot activo
    for (const item of SYSTEM_TOOL_MANIFEST) {
      grouped[item.server].push(`• ${item.name} [${item.capability}]: ${item.description.slice(0, 100)}`);
    }
  }

  const sections: string[] = [];
  if (grouped.windows.length > 0) {
    sections.push(`[SUBSISTEMA windows - GUI, ventanas y controles Windows]:\n${grouped.windows.slice(0, 15).join("\n")}`);
  }
  if (grouped.desktop_commander.length > 0) {
    sections.push(`[SUBSISTEMA desktop_commander - Archivos, procesos y terminal local]:\n${grouped.desktop_commander.slice(0, 18).join("\n")}`);
  }
  if (grouped.free_search.length > 0) {
    sections.push(`[SUBSISTEMA free_search - Navegación, búsqueda y documentación web]:\n${grouped.free_search.join("\n")}`);
  }
  if (grouped.local.length > 0) {
    sections.push(`[HERRAMIENTAS LOCALES]:\n${grouped.local.join("\n")}`);
  }

  return sections.join("\n\n");
}
