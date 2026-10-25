/**
 * JARVIS Core — Tool Manifest (fuente única de herramientas, políticas y descripciones)
 * Catálogo reducido por ahora: 11 herramientas de desktop_commander y 3 de free_search, repartidas en 4 destinos
 * (grupos funcionales que elige Decision #1); el resto de ambos servidores queda fuera (para ofrecer otra
 * herramienta se añade su línea con su destino y, si su resultado necesita un tratamiento propio, su rama en
 * ResultProcessor). Los nombres de argumento salen de sus inputSchema.
 *
 * - Una sola tabla: (server, name) -> capability + política derivada. Es la ÚNICA fuente de políticas
 *   (policyRegistry.ts fue eliminado).
 * - Cada herramienta declara su destino (`route`): pertenece a uno solo y su servidor se deriva de DESTINATIONS.
 *   Guard y las políticas siguen siendo por (server, name), nunca por destino.
 * - Lookup insensible a mayúsculas, políticas inmutables, claves duplicadas = error al arrancar.
 * - Lista cerrada: lo que un servidor MCP exponga y no figure aquí NO se ofrece a Decision ni al
 *   planificador (ver `applyDestination`). `UNKNOWN_TOOL_POLICY` queda solo como defensa en profundidad en Guard.
 * - No hay herramientas de interfaz gráfica (clic, teclado, portapapeles, capturas, esperas de UI…) ni
 *   herramientas meta (feedback, prompts, estadísticas): decisión de diseño vigente.
 * - Las descripciones están en inglés: son la fuente única para Decision (criterios) y para el catálogo del planificador.
 * - La descripción de una herramienta se compacta (≤80 caracteres) y sustituye a la del servidor, que a veces es el único
 *   lugar donde se explica el formato de un parámetro (el esquema solo dice `string`). Ese formato se conserva como
 *   nota del parámetro (`notes`): se inyecta en el esquema que ve el modelo que genera los argumentos.
 */

import {
  EXECUTABLE_ROUTES,
  MAX_PARAM_NOTE_CHARS,
  MAX_TOOL_DESC_CHARS,
  type Capability,
  type ExecutableRoute,
  type McpServerName,
  type MCPTool,
  type ToolPolicy,
} from "../types.ts";

export interface ToolDefinition {
  readonly name: string;
  readonly route: ExecutableRoute;
  readonly server: McpServerName;
  readonly description: string;
  /** Parámetros que se ofrecen al modelo; sin esta lista se ofrecen todos los del schema del servidor. */
  readonly params?: readonly string[];
  /** Formato de parámetros que el esquema del servidor no expresa (parámetro -> nota en inglés). */
  readonly notes?: Readonly<Record<string, string>>;
  readonly requires?: "process" | "search";
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

/**
 * Cada destino: servidor MCP que lo ejecuta y descripción (inglés). La descripción es el criterio de Decision #1
 * y el encabezado del catálogo del planificador.
 */
export const DESTINATIONS: Readonly<
  Record<ExecutableRoute, { readonly server: McpServerName; readonly description: string }>
> = {
  files: {
    server: "desktop_commander",
    description: "Read, create, save or move files and folders, and list a folder, when the path is already known.",
  },
  locate: {
    server: "desktop_commander",
    description: "Find files by name or by text inside files when the location is unknown.",
  },
  terminal: {
    server: "desktop_commander",
    description:
      "Run a command or program (including launching apps), and read its output or send it input while it runs. Not for reading or listing files.",
  },
  web: {
    server: "free_search",
    description: "Look up information online and read the content of web pages, including known URLs.",
  },
};

interface ToolOptions {
  /** Una salida vacía es un error (lecturas y búsquedas). */
  emptyIsError?: boolean;
  /** Exenta del anti-loop. */
  loopExempt?: boolean;
  /** Parámetros permitidos: el resto no se muestra ni se acepta (ver `applyDestination`). */
  params?: readonly string[];
  /** Formato de parámetros que el esquema del servidor no expresa (parámetro -> nota). Ver `applyDestination`. */
  notes?: Readonly<Record<string, string>>;
  /** Estado que la tarea debe tener para ofrecer la herramienta: un proceso en ejecución o una búsqueda iniciada. */
  requires?: "process" | "search";
}

function def(
  route: ExecutableRoute,
  name: string,
  capability: Capability,
  description: string,
  opts: ToolOptions = {}
): ToolDefinition {
  if (description.length > MAX_TOOL_DESC_CHARS) {
    throw new Error(`[Manifest] descripción de '${route}:${name}' excede ${MAX_TOOL_DESC_CHARS} caracteres.`);
  }
  for (const [param, note] of Object.entries(opts.notes ?? {})) {
    if (note.length > MAX_PARAM_NOTE_CHARS) {
      throw new Error(`[Manifest] nota de '${route}:${name}.${param}' excede ${MAX_PARAM_NOTE_CHARS} caracteres.`);
    }
    if (opts.params && !opts.params.includes(param)) {
      throw new Error(`[Manifest] nota de '${route}:${name}.${param}': el parámetro no está en 'params'.`);
    }
  }
  const mutates = !NO_MUTATION.has(capability);
  return Object.freeze({
    name,
    route,
    server: DESTINATIONS[route].server,
    description,
    params: opts.params,
    notes: opts.notes ? Object.freeze({ ...opts.notes }) : undefined,
    requires: opts.requires,
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

export const SYSTEM_TOOL_MANIFEST: readonly ToolDefinition[] = [
  // ---- files (desktop_commander, 6) ----
  def("files", "read_file", "FILE_READ", "Read a local or remote file (text, PDF, with offset).", { emptyIsError: true }),
  def("files", "read_multiple_files", "FILE_READ", "Read several files in parallel.", { emptyIsError: true }),
  def("files", "write_file", "FILE_WRITE", "Create or overwrite a file on disk.", {
    params: ["path", "content", "mode"],
    notes: {
      content:
        'Text of the file. For .xlsx/.xls/.xlsm: a JSON string of a 2D array of rows, e.g. [["Name","Age"],["Alice",30]], or of an object {"SheetName": [[...]]}.',
    },
  }),
  def("files", "create_directory", "FILE_WRITE", "Create a directory or ensure it exists."),
  def("files", "list_directory", "FILE_READ", "List files and subdirectories of a path.", { params: ["path", "depth"] }),
  def("files", "move_file", "FILE_WRITE", "Move or rename files or directories."),

  // ---- locate (desktop_commander, 2) ----
  def("locate", "start_search", "FILE_READ", "Start a streaming file search.", {
    params: ["path", "pattern", "searchType", "filePattern", "ignoreCase", "maxResults"],
  }),
  def("locate", "get_more_search_results", "FILE_READ", "Page through the results of an active file search.", { loopExempt: true, requires: "search" }),

  // ---- terminal (desktop_commander, 3) ----
  // Sin `verbose_timing`: con él la última línea de la salida pasa a ser un bloque de tiempos y el extractor pierde el fin del proceso y su exit code.
  def("terminal", "start_process", "PROCESS_CONTROL", "Start a terminal process or background command.", {
    params: ["command", "timeout_ms", "shell"],
  }),
  def("terminal", "read_process_output", "READ", "Read the accumulated output of a running process.", {
    loopExempt: true,
    requires: "process",
    params: ["pid", "timeout_ms", "offset", "length"],
  }),
  def("terminal", "interact_with_process", "PROCESS_CONTROL", "Send interactive stdin to a process or REPL.", {
    requires: "process",
    params: ["pid", "input", "timeout_ms", "wait_for_prompt"],
  }),

  // ---- web (free_search, 3) ----
  def("web", "search", "READ", "Deduplicated multi-engine web search with clean snippets.", {
    emptyIsError: true,
    params: ["query", "max_results"],
  }),
  // Sin `format` ni `inline`: el extractor asume Markdown (con JSON el resumen sería "{") y una imagen en línea no es texto.
  def("web", "fetch", "READ", "Download a web page and convert it to clean Markdown.", {
    params: ["url", "render", "force_refresh", "max_age_hours"],
  }),
  def("web", "fetch_batch", "READ", "Download several URLs in parallel.", {
    params: ["urls", "render"],
  }),
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

export function isKnownTool(server: string, tool: string): boolean {
  return INDEX.has(keyOf(server, tool));
}

export function getToolPolicy(server: string, tool: string): Readonly<ToolPolicy> {
  return INDEX.get(keyOf(server, tool))?.policy ?? UNKNOWN_TOOL_POLICY;
}

export function requirementOf(server: string, tool: string): "process" | "search" | undefined {
  return INDEX.get(keyOf(server, tool))?.requires;
}

/** Servidor MCP que ejecuta un destino. */
export function serverOf(route: ExecutableRoute): McpServerName {
  return DESTINATIONS[route].server;
}

/** Deja en el schema solo los parámetros permitidos; `validateArgs` rechaza cualquier otro (additionalProperties: false). */
function restrictParams(schema: MCPTool["inputSchema"], params: readonly string[]): MCPTool["inputSchema"] {
  const properties = Object.fromEntries(
    Object.entries(schema.properties ?? {}).filter(([name]) => params.includes(name))
  );
  return { ...schema, properties, additionalProperties: false };
}

const warnedNotes = new Set<string>();

/**
 * Añade al schema la nota de formato de cada parámetro (campo `description`, que el modelo ve en SCHEMA). La nota del
 * manifest prevalece sobre la descripción del servidor, igual que con la descripción de la herramienta. Una nota
 * para un parámetro que el servidor ya no expone indica una desviación del catálogo: se avisa una sola vez.
 */
function annotateParams(schema: MCPTool["inputSchema"], tool: string, notes: Readonly<Record<string, string>>): MCPTool["inputSchema"] {
  const properties: Record<string, unknown> = { ...(schema.properties ?? {}) };
  for (const [param, note] of Object.entries(notes)) {
    const prop = properties[param];
    if (prop === undefined || typeof prop !== "object" || prop === null) {
      if (!warnedNotes.has(`${tool}.${param}`)) {
        warnedNotes.add(`${tool}.${param}`);
        console.warn(`[Manifest] '${tool}': el servidor no expone el parámetro '${param}' al que el catálogo añade una nota.`);
      }
      continue;
    }
    properties[param] = { ...(prop as Record<string, unknown>), description: note };
  }
  return { ...schema, properties } as MCPTool["inputSchema"];
}

/**
 * Lista cerrada: de las herramientas que expone el servidor del destino, conserva solo las que el manifest
 * cataloga bajo ese destino, sustituye la descripción por la del manifest (inglés, ≤80 caracteres), añade las notas de
 * formato de sus parámetros y, si la herramienta declara `params`, restringe su schema a esos parámetros. Conserva el
 * `name` real del servidor.
 */
export function applyDestination(route: ExecutableRoute, tools: readonly MCPTool[]): MCPTool[] {
  const server = serverOf(route);
  const allowed: MCPTool[] = [];
  for (const t of tools) {
    const d = INDEX.get(keyOf(server, t.name));
    if (d?.route !== route) continue;
    let inputSchema = d.params ? restrictParams(t.inputSchema, d.params) : t.inputSchema;
    if (d.notes) inputSchema = annotateParams(inputSchema, t.name, d.notes);
    allowed.push({ ...t, description: d.description, inputSchema });
  }
  return allowed;
}

// ---------------------------------------------------------------
// Catálogo compacto para el planificador
// ---------------------------------------------------------------

/** Lista el manifest completo, un bloque por destino. */
export function buildCompactCatalog(): string {
  const sections: string[] = [];
  for (const route of EXECUTABLE_ROUTES) {
    const defs = SYSTEM_TOOL_MANIFEST.filter((d) => d.route === route);
    const lines = defs.map((d) => `• ${d.name} [${d.policy.capability}]: ${d.description}`);
    sections.push(`[SUBSYSTEM ${route} - ${DESTINATIONS[route].description}]:\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}