/**
 * JARVIS Core — Tool Manifest (fuente única de herramientas y políticas)
 * Reemplaza a policyRegistry.ts. Referencia: docs/MCP_TOOLS_SNAPSHOT.md
 *
 * - Una sola tabla: (server, name) -> capability + política derivada.
 * - Lookup insensible a mayúsculas, políticas inmutables, claves duplicadas = error al arrancar.
 * - Herramienta no catalogada => UNKNOWN_TOOL_POLICY (Guard exige aprobación).
 * - Las UI tools (UI_ACTION) no pasan por aprobación: decisión de diseño vigente.
 */

import type { Capability, MCPTool, ToolPolicy } from "../types.ts";

export type ToolServer = "windows" | "desktop_commander" | "free_search" | "local";

export interface ToolDefinition {
  readonly name: string;
  readonly server: ToolServer;
  readonly description: string;
  readonly policy: Readonly<ToolPolicy>;
}

const NO_MUTATION = new Set<Capability>(["READ", "FILE_READ"]);
const NEEDS_APPROVAL = new Set<Capability>([
  "FILE_WRITE",
  "PROCESS_CONTROL",
  "COMMAND_EXECUTION",
  "DOWNLOAD",
  "CONFIGURATION",
]);

function def(
  server: ToolServer,
  name: string,
  capability: Capability,
  description: string,
  emptyIsError = false
): ToolDefinition {
  return Object.freeze({
    name,
    server,
    description,
    policy: Object.freeze({
      capability,
      requiresApproval: NEEDS_APPROVAL.has(capability),
      mutates: !NO_MUTATION.has(capability),
      emptyIsError,
    }),
  });
}

/** Herramientas locales: definición única (runStep y el catálogo leen de aquí). */
export const LOCAL_TOOLS: readonly MCPTool[] = [
  {
    name: "recall",
    description: "Recuperar hechos factuales, referencias previas o contexto relevante de memoria.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "compose",
    description: "Redactar texto estructurado o respuesta en lenguaje natural asistido por Qwen.",
    inputSchema: { type: "object", properties: { prompt: { type: "string" } } },
  },
  {
    name: "ask_user",
    description: "Solicitar clarificación o parámetro indispensable directamente al usuario.",
    inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
  },
];

const win = (name: string, cap: Capability, desc: string) => def("windows", name, cap, desc);
const dc = (name: string, cap: Capability, desc: string, emptyIsError = false) =>
  def("desktop_commander", name, cap, desc, emptyIsError);
const fs = (name: string, cap: Capability, desc: string, emptyIsError = false) =>
  def("free_search", name, cap, desc, emptyIsError);

export const SYSTEM_TOOL_MANIFEST: readonly ToolDefinition[] = [
  // ---- windows (21) ----
  win("ControlStatus", "READ", "Estado del dueño del control de escritorio e idle wait."),
  win("App", "PROCESS_CONTROL", "Abrir, iniciar, lanzar aplicaciones y gestionar ventanas."),
  win("DisplayInventory", "READ", "Leer layout de pantallas activas y metadatos DPI."),
  win("PowerShell", "COMMAND_EXECUTION", "Ejecución de scripts PowerShell y comandos terminal en Windows."),
  win("FileSystem", "FILE_WRITE", "Operaciones de sistema de archivos Windows (read/write/delete/copy/move/list)."),
  win("Snapshot", "READ", "Captura de pantalla e inspección visual de accesibilidad de la UI."),
  win("Screenshot", "READ", "Snapshot rápido de escritorio o ventana activa."),
  win("Click", "UI_ACTION", "Clic de ratón en coordenadas específicas o elemento UI."),
  win("Type", "UI_ACTION", "Tipeo de texto en coordenadas o control con foco."),
  win("Scroll", "UI_ACTION", "Desplazamiento vertical u horizontal de rueda de ratón."),
  win("Move", "UI_ACTION", "Mover el cursor a una posición específica o drag-and-drop."),
  win("Shortcut", "UI_ACTION", "Ejecutar combinaciones de teclas (ej. ctrl+c, alt+tab)."),
  win("Wait", "READ", "Pausa por duración específica de tiempo."),
  win("WaitFor", "READ", "Espera hasta que una condición específica de UI se cumpla."),
  win("Scrape", "READ", "Fetch y extracción de página web por URL."),
  win("MultiSelect", "UI_ACTION", "Selección múltiple de elementos o checkboxes."),
  win("MultiEdit", "UI_ACTION", "Entrada de texto simultánea en múltiples campos por coordenadas."),
  win("Clipboard", "UI_ACTION", "Operaciones de portapapeles de Windows (get/set/cut)."),
  win("Process", "PROCESS_CONTROL", "Listar y terminar procesos del sistema."),
  win("Notification", "UI_ACTION", "Enviar notificación toast informativa en el escritorio."),
  win("Registry", "PROCESS_CONTROL", "Lectura y modificación del Registro de Windows (get/set/delete/list)."),

  // ---- desktop_commander (26) ----
  dc("get_config", "READ", "Obtener configuración completa del servidor Desktop Commander."),
  dc("set_config_value", "CONFIGURATION", "Modificar un valor específico de configuración."),
  dc("read_file", "FILE_READ", "Leer contenido de archivo local o remoto (PDF, texto, offset).", true),
  dc("read_multiple_files", "FILE_READ", "Leer múltiples archivos de forma paralela.", true),
  dc("write_file", "FILE_WRITE", "Crear o sobrescribir archivo en disco."),
  dc("write_pdf", "FILE_WRITE", "Crear o modificar un documento PDF."),
  dc("create_directory", "FILE_WRITE", "Crear un nuevo directorio o asegurar su existencia."),
  dc("list_directory", "FILE_READ", "Listar archivos y subdirectorios de una ruta."),
  dc("move_file", "FILE_WRITE", "Mover o renombrar archivos o directorios."),
  dc("start_search", "FILE_READ", "Iniciar búsqueda de archivos en streaming progresivo."),
  dc("get_more_search_results", "FILE_READ", "Paginación de resultados de búsqueda activa de archivos."),
  dc("stop_search", "READ", "Detener una búsqueda de archivos en curso."),
  dc("list_searches", "FILE_READ", "Listar búsquedas activas de archivos."),
  dc("get_file_info", "FILE_READ", "Metadatos de archivo (tamaño, permisos, fechas)."),
  dc("edit_block", "FILE_WRITE", "Edición quirúrgica de bloques dentro de un archivo existente."),
  dc("start_process", "PROCESS_CONTROL", "Iniciar proceso de terminal o comando en segundo plano."),
  dc("read_process_output", "READ", "Leer salida acumulada de un proceso en ejecución."),
  dc("interact_with_process", "PROCESS_CONTROL", "Enviar stdin interactivo a un proceso o REPL."),
  dc("force_terminate", "PROCESS_CONTROL", "Forzar terminación de sesión de terminal o proceso."),
  dc("list_sessions", "READ", "Listar sesiones de terminal activas."),
  dc("list_processes", "READ", "Listar procesos activos del sistema."),
  dc("kill_process", "PROCESS_CONTROL", "Terminar un proceso por PID."),
  dc("get_usage_stats", "READ", "Estadísticas de uso para diagnóstico."),
  dc("get_recent_tool_calls", "READ", "Historial reciente de llamadas y argumentos."),
  dc("give_feedback_to_desktop_commander", "READ", "Abrir formulario de feedback."),
  dc("get_prompts", "READ", "Recuperar prompt de onboarding por ID."),

  // ---- free_search (11) ----
  fs("search", "READ", "Búsqueda web multi-motor deduplicada con snippets limpios.", true),
  fs("fetch", "READ", "Descargar y convertir página web a Markdown limpio."),
  fs("fetch_batch", "READ", "Descargar múltiples URLs web en paralelo."),
  fs("read_doc", "READ", "Leer documento remoto (PDF, DOCX) y parsear a Markdown."),
  fs("research", "READ", "Investigación web iterativa en profundidad."),
  fs("paper_graph", "READ", "Explorar citas y relaciones de papers académicos."),
  fs("cache_search", "READ", "Búsqueda full-text en caché local FTS5 SQLite."),
  fs("engines", "READ", "Listar motores de búsqueda disponibles y activos."),
  fs("compare", "READ", "Comparar contenido de 2 a 5 páginas web en paralelo."),
  fs("extract_structured", "READ", "Extraer microdatos, OpenGraph y JSON-LD de una página web."),
  fs("download", "DOWNLOAD", "Descargar archivo o documento a un directorio local."),

  // ---- locales (3) ----
  ...LOCAL_TOOLS.map((t) => def("local", t.name, "READ", t.description)),
];

// ---------------------------------------------------------------
// Índice y API de consulta
// ---------------------------------------------------------------
const keyOf = (server: string, tool: string) => `${server}:${tool}`.toLowerCase();

const INDEX = new Map<string, ToolDefinition>();
for (const t of SYSTEM_TOOL_MANIFEST) {
  const k = keyOf(t.server, t.name);
  if (INDEX.has(k)) throw new Error(`[Manifest] herramienta duplicada: ${k}`);
  INDEX.set(k, t);
}

/** Política para herramientas no catalogadas: tratadas como acción sensible. */
export const UNKNOWN_TOOL_POLICY: Readonly<ToolPolicy> = Object.freeze({
  capability: "COMMAND_EXECUTION",
  requiresApproval: true,
  mutates: true,
  emptyIsError: false,
});

export function lookupToolManifest(server: string, tool: string): ToolDefinition | undefined {
  return INDEX.get(keyOf(server, tool));
}

export function isKnownTool(server: string, tool: string): boolean {
  return INDEX.has(keyOf(server, tool));
}

export function getToolPolicy(server: string, tool: string): Readonly<ToolPolicy> {
  return INDEX.get(keyOf(server, tool))?.policy ?? UNKNOWN_TOOL_POLICY;
}

// ---------------------------------------------------------------
// Catálogo compacto para el planificador Qwen (Sec. 3.2.3)
// ---------------------------------------------------------------
const SECTION_TITLES: Record<ToolServer, string> = {
  windows: "SUBSISTEMA windows - GUI, ventanas y controles Windows",
  desktop_commander: "SUBSISTEMA desktop_commander - Archivos, procesos y terminal local",
  free_search: "SUBSISTEMA free_search - Navegación, búsqueda y documentación web",
  local: "HERRAMIENTAS LOCALES",
};

export function buildCompactCatalog(discoveredTools?: Record<string, MCPTool[]>): string {
  const grouped: Record<ToolServer, string[]> = { windows: [], desktop_commander: [], free_search: [], local: [] };
  const line = (name: string, cap: Capability, desc: string) => `• ${name} [${cap}]: ${desc.slice(0, 100)}`;

  if (discoveredTools && Object.keys(discoveredTools).length > 0) {
    for (const [server, tools] of Object.entries(discoveredTools)) {
      if (!Object.hasOwn(grouped, server)) continue; // servidor no reconocido: se ignora
      for (const t of tools) {
        const d = lookupToolManifest(server, t.name);
        const cap = (d?.policy ?? UNKNOWN_TOOL_POLICY).capability;
        grouped[server as ToolServer].push(line(t.name, cap, d?.description || t.description || "Herramienta disponible"));
      }
    }
  } else {
    for (const d of SYSTEM_TOOL_MANIFEST) grouped[d.server].push(line(d.name, d.policy.capability, d.description));
  }

  return (Object.keys(SECTION_TITLES) as ToolServer[])
    .filter((s) => grouped[s].length > 0)
    .map((s) => `[${SECTION_TITLES[s]}]:\n${grouped[s].join("\n")}`)
    .join("\n\n");
}