/**
 * JARVIS Core — Tool Manifest (fuente única de herramientas, políticas y descripciones)
 * Catálogo reducido por ahora: 11 herramientas de desktop_commander y 3 de free_search; el resto de ambos
 * servidores queda fuera (se reactiva añadiendo su línea). Los nombres de argumento salen de sus inputSchema.
 *
 * - Una sola tabla: (server, name) -> capability + política derivada. Es la ÚNICA fuente de políticas
 *   (policyRegistry.ts fue eliminado).
 * - Lookup insensible a mayúsculas, políticas inmutables, claves duplicadas = error al arrancar.
 * - Lista cerrada: lo que un servidor MCP exponga y no figure aquí NO se ofrece a Decision ni al
 *   planificador (ver `applyManifest`). `UNKNOWN_TOOL_POLICY` queda solo como defensa en profundidad en Guard.
 * - No hay herramientas de interfaz gráfica (clic, teclado, portapapeles, capturas, esperas de UI…) ni
 *   herramientas meta (feedback, prompts, estadísticas): decisión de diseño vigente.
 * - Las descripciones están en inglés: son la fuente única para Decision (criterios) y para el catálogo del planificador.
 */

import {
  EXECUTABLE_ROUTES,
  type Capability,
  type ExecutableRoute,
  type MCPTool,
  type ToolPolicy,
} from "../types.ts";

export interface ToolDefinition {
  readonly name: string;
  readonly server: ExecutableRoute;
  readonly description: string;
  readonly policy: Readonly<ToolPolicy>;
}

/** Decision recorta a 80 caracteres; una descripción más larga se rechaza al arrancar. */
const MAX_DESCRIPTION_CHARS = 80;

const NO_MUTATION = new Set<Capability>(["READ", "FILE_READ"]);
const NEEDS_APPROVAL = new Set<Capability>([
  "FILE_WRITE",
  "PROCESS_CONTROL",
  "COMMAND_EXECUTION",
  "DOWNLOAD",
  "CONFIGURATION",
]);

/** Descripción de cada ruta: criterios de Decision #1 y encabezados del catálogo del planificador. */
export const ROUTE_DESCRIPTIONS: Readonly<Record<ExecutableRoute, string>> = {
  windows: "Windows OS control: launch apps, run PowerShell, manage processes, registry and files.",
  desktop_commander: "Local files, directories, processes and terminal commands.",
  free_search: "Search the web and fetch the content of web pages.",
};

interface ToolOptions {
  /** Una salida vacía es un error (lecturas y búsquedas). */
  emptyIsError?: boolean;
  /** Exenta del anti-loop. */
  loopExempt?: boolean;
}

function def(
  server: ExecutableRoute,
  name: string,
  capability: Capability,
  description: string,
  opts: ToolOptions = {}
): ToolDefinition {
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new Error(`[Manifest] descripción de '${server}:${name}' excede ${MAX_DESCRIPTION_CHARS} caracteres.`);
  }
  const mutates = !NO_MUTATION.has(capability);
  return Object.freeze({
    name,
    server,
    description,
    policy: Object.freeze({
      capability,
      requiresApproval: NEEDS_APPROVAL.has(capability),
      mutates,
      kind: mutates ? ("no-READ" as const) : ("READ" as const),
      emptyIsError: opts.emptyIsError ?? false,
      loopExempt: opts.loopExempt ?? false,
    }),
  });
}

const winTool = (name: string, cap: Capability, desc: string, opts?: ToolOptions) =>
  def("windows", name, cap, desc, opts);
const dcTool = (name: string, cap: Capability, desc: string, opts?: ToolOptions) =>
  def("desktop_commander", name, cap, desc, opts);
const searchTool = (name: string, cap: Capability, desc: string, opts?: ToolOptions) =>
  def("free_search", name, cap, desc, opts);

export const SYSTEM_TOOL_MANIFEST: readonly ToolDefinition[] = [
  // ---- windows (6) ----
  winTool("App", "PROCESS_CONTROL", "Launch applications and manage their windows."),
  winTool("PowerShell", "COMMAND_EXECUTION", "Run PowerShell scripts and terminal commands on Windows."),
  winTool("FileSystem", "FILE_WRITE", "Windows file operations: read, write, delete, copy, move and list."),
  winTool("Scrape", "READ", "Fetch a web page by URL and extract its content."),
  winTool("Process", "PROCESS_CONTROL", "List and terminate system processes."),
  winTool("Registry", "PROCESS_CONTROL", "Read and modify the Windows Registry: get, set, delete and list."),

  // ---- desktop_commander (11) ----
  dcTool("read_file", "FILE_READ", "Read a local or remote file (text, PDF, with offset).", { emptyIsError: true }),
  dcTool("read_multiple_files", "FILE_READ", "Read several files in parallel.", { emptyIsError: true }),
  dcTool("write_file", "FILE_WRITE", "Create or overwrite a file on disk."),
  dcTool("create_directory", "FILE_WRITE", "Create a directory or ensure it exists."),
  dcTool("list_directory", "FILE_READ", "List files and subdirectories of a path."),
  dcTool("move_file", "FILE_WRITE", "Move or rename files or directories."),
  dcTool("start_search", "FILE_READ", "Start a streaming file search."),
  dcTool("get_more_search_results", "FILE_READ", "Page through the results of an active file search.", { loopExempt: true }),
  dcTool("start_process", "PROCESS_CONTROL", "Start a terminal process or background command."),
  dcTool("read_process_output", "READ", "Read the accumulated output of a running process.", { loopExempt: true }),
  dcTool("interact_with_process", "PROCESS_CONTROL", "Send interactive stdin to a process or REPL."),

  // ---- free_search (3) ----
  searchTool("search", "READ", "Deduplicated multi-engine web search with clean snippets.", { emptyIsError: true }),
  searchTool("fetch", "READ", "Download a web page and convert it to clean Markdown."),
  searchTool("fetch_batch", "READ", "Download several URLs in parallel."),
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
  kind: "no-READ" as const,
  emptyIsError: false,
  loopExempt: false,
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

/**
 * Lista cerrada: descarta las herramientas que el servidor expone y el manifest no cataloga,
 * y sustituye la descripción por la del manifest (inglés, ≤80 caracteres).
 * Conserva el `name` y el `inputSchema` reales del servidor.
 */
export function applyManifest(server: ExecutableRoute, tools: readonly MCPTool[]): MCPTool[] {
  const allowed: MCPTool[] = [];
  for (const t of tools) {
    const d = INDEX.get(keyOf(server, t.name));
    if (d) allowed.push({ ...t, description: d.description });
  }
  return allowed;
}

// ---------------------------------------------------------------
// Catálogo compacto para el planificador
// ---------------------------------------------------------------

/**
 * @param discoveredTools Herramientas realmente descubiertas por ruta. Si se omite o está vacío,
 *   se lista el manifest completo.
 */
export function buildCompactCatalog(
  discoveredTools?: Partial<Record<ExecutableRoute, readonly MCPTool[]>>
): string {
  const useDiscovery = discoveredTools !== undefined && Object.keys(discoveredTools).length > 0;

  const sections: string[] = [];
  for (const route of EXECUTABLE_ROUTES) {
    let defs: ToolDefinition[];
    if (useDiscovery) {
      defs = (discoveredTools[route] ?? [])
        .map((t) => lookupToolManifest(route, t.name))
        .filter((d): d is ToolDefinition => d !== undefined);
    } else {
      defs = SYSTEM_TOOL_MANIFEST.filter((d) => d.server === route);
    }
    if (defs.length === 0) continue;

    const lines = defs.map((d) => `• ${d.name} [${d.policy.capability}]: ${d.description}`);
    sections.push(`[SUBSYSTEM ${route} - ${ROUTE_DESCRIPTIONS[route]}]:\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}