/**
 * JARVIS Core — Tool Manifest: fuente única de herramientas, políticas y descripciones.
 *
 * Catálogo reducido a propósito: de cada servidor MCP solo figuran las herramientas listadas abajo, repartidas en 4
 * destinos (grupos funcionales que elige Decision #1). Para ofrecer otra herramienta se añade su línea con su destino;
 * solo si el formato de su resultado lo justifica se registra además su extractor en result/extractors/index.ts
 * (sin él, lo trata el extractor genérico). Los nombres de argumento salen de sus inputSchema.
 *
 * - Una sola tabla: (server, name) -> capability + política derivada. Es la ÚNICA fuente de políticas.
 * - Cada herramienta declara su destino (`route`) y su servidor se deriva de DESTINATIONS. Guard y las políticas son por
 *   (server, name), nunca por destino.
 * - Lookup insensible a mayúsculas, políticas inmutables, claves duplicadas = error al arrancar.
 * - Lista cerrada: lo que un servidor MCP exponga y no figure aquí NO se ofrece a Decision ni al planificador (ver
 *   `applyDestination`). `UNKNOWN_TOOL_POLICY` queda solo como defensa en profundidad en Guard.
 * - Los proveedores nativos (`jarvis_terminal`, `jarvis_web`) son módulos en proceso de `src/tools/`: una tool propia por ruta (`run_command`, `web_search`).
 *   Las herramientas de otros servidores que una tool compuesta usa por dentro (`research` y `fetch` de Free Search) figuran como `internal`: tienen política
 *   y Guard como las demás, pero no se ofrecen a Decision ni al planificador.
 * - Sin herramientas de interfaz gráfica (clic, teclado, portapapeles, capturas, esperas de UI) ni meta (feedback,
 *   prompts, estadísticas): decisión de diseño vigente.
 * - Las descripciones están en inglés: son la fuente única para Decision (criterios) y para el catálogo del
 *   planificador. Se compactan (MAX_TOOL_DESC_CHARS) y sustituyen a las del servidor, que a veces es el único lugar donde
 *   se explica el formato de un parámetro (el esquema solo dice `string`). Ese formato se conserva como nota
 *   (`notes`), que se inyecta en el esquema que ve el modelo que genera los argumentos.
 */

import {
  EXECUTABLE_ROUTES,
  MAX_PARAM_NOTE_CHARS,
  MAX_TOOL_DESC_CHARS,
  type Capability,
  type ExecutableRoute,
  type McpServerName,
  type MCPTool,
  type RepeatPolicy,
  type ToolPolicy,
} from "../types.ts";
import { isRerunnableCommand } from "../policy/rerun.ts";

export interface ToolDefinition {
  readonly name: string;
  readonly route: ExecutableRoute;
  readonly server: McpServerName;
  readonly description: string;
  /** Parámetros que se ofrecen al modelo; sin esta lista se ofrecen todos los del schema del servidor. */
  readonly params?: readonly string[];
  /** Formato de parámetros que el esquema del servidor no expresa (parámetro -> nota en inglés). */
  readonly notes?: Readonly<Record<string, string>>;
  readonly requires?: "search";
  /** Excepciones al recorte por defecto de los strings de `args` al registrar la llamada (parámetro -> caracteres). */
  readonly argCaps?: Readonly<Record<string, number>>;
  /** Plazo de la herramienta en milisegundos (techo de cuánto espera una llamada de un proveedor nativo); sin él, el del transporte. */
  readonly timeoutMs?: number;
  /** Cuando la política de repetición depende de los argumentos de la llamada (`run_command`: esperar más salida de un `pid` repite los mismos argumentos). Gana a `policy.repeat`. */
  readonly repeatByArgs?: (args: Readonly<Record<string, unknown>>) => RepeatPolicy;
  /** Solo la usa una tool compuesta por dentro: no entra en el catálogo de Decision ni del planificador. */
  readonly internal?: boolean;
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
    description: "Read, create, save or move files and folders, and list a folder (names only, without sizes or dates), when the path is already known.",
  },
  locate: {
    server: "desktop_commander",
    description: "Find files by name or by text inside files when the location is unknown.",
  },
  terminal: {
    server: "jarvis_terminal",
    description:
      "Run a command or program (including launching apps), and read its output or send it input while it runs. Also for information about files that a plain listing does not give: sizes, dates, sorting, filtering or totals.",
  },
  web: {
    server: "jarvis_web",
    description: "Look up information online and read the content of web pages, including known URLs.",
  },
};

interface ToolOptions {
  /** Una salida vacía es un error (lecturas y búsquedas). */
  emptyIsError?: boolean;
  /** Qué hacer con una llamada idéntica a una ya ejecutada (por defecto `strict`; `allow` para sondeos, `retry_failed` para la web). */
  repeat?: RepeatPolicy;
  params?: readonly string[];
  notes?: Readonly<Record<string, string>>;
  /** Estado que la tarea debe tener para ofrecer la herramienta: una búsqueda iniciada. */
  requires?: "search";
  /** Excepciones al recorte por defecto de los strings de `args` (parámetro -> caracteres); ver `argCapsOf`. */
  argCaps?: Readonly<Record<string, number>>;
  /** Plazo de la herramienta en milisegundos (proveedores nativos). */
  timeoutMs?: number;
  repeatByArgs?: (args: Readonly<Record<string, unknown>>) => RepeatPolicy;
}

function def(
  route: ExecutableRoute,
  name: string,
  capability: Capability,
  description: string,
  opts: ToolOptions = {},
  server: McpServerName = DESTINATIONS[route].server,
  internal = false,
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
  for (const [param, cap] of Object.entries(opts.argCaps ?? {})) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`[Manifest] argCaps de '${route}:${name}.${param}': debe ser un entero positivo.`);
    }
    if (opts.params && !opts.params.includes(param)) {
      throw new Error(`[Manifest] argCaps de '${route}:${name}.${param}': el parámetro no está en 'params'.`);
    }
  }
  const mutates = !NO_MUTATION.has(capability);
  return Object.freeze({
    name,
    route,
    server,
    description,
    params: opts.params,
    notes: opts.notes ? Object.freeze({ ...opts.notes }) : undefined,
    requires: opts.requires,
    argCaps: opts.argCaps ? Object.freeze({ ...opts.argCaps }) : undefined,
    timeoutMs: opts.timeoutMs,
    repeatByArgs: opts.repeatByArgs,
    internal: internal || undefined,
    policy: Object.freeze({
      capability,
      requiresApproval: NEEDS_APPROVAL.has(capability),
      mutates,
      emptyIsError: opts.emptyIsError ?? false,
      repeat: opts.repeat ?? "strict",
    }),
  });
}

/** Herramienta de otro servidor que una tool compuesta usa por dentro: política y Guard como las demás, fuera del catálogo de Decision. */
const internalDef = (server: McpServerName, route: ExecutableRoute, name: string, capability: Capability, description: string, opts: ToolOptions = {}): ToolDefinition =>
  def(route, name, capability, description, opts, server, true);

export const SYSTEM_TOOL_MANIFEST: readonly ToolDefinition[] = [
  // Sin `isUrl`: las URL las cubre `fetch`. `offset` y `length` cuentan líneas en archivos de texto (observado); en PDF o Excel no se verificó.
  def("files", "read_file", "FILE_READ", "Read a local text/PDF/Excel file (offset, sheet, range).", {
    emptyIsError: true,
    params: ["path", "offset", "length", "sheet", "range"],
  }),
  def("files", "read_multiple_files", "FILE_READ", "Read several files in parallel.", { emptyIsError: true }),
  def("files", "write_file", "FILE_WRITE", "Create or overwrite a file on disk.", {
    params: ["path", "content", "mode"],
    notes: {
      content:
        'Text of the file. For .xlsx/.xls/.xlsm: a JSON string of a 2D array of rows, e.g. [["Name","Age"],["Alice",30]], or of an object {"SheetName": [[...]]}.',
    },
  }),
  def("files", "create_directory", "FILE_WRITE", "Create a directory or ensure it exists."),
  def("files", "list_directory", "FILE_READ", "List files and subdirectories of a path (names only: no sizes or dates).", { params: ["path", "depth"] }),
  def("files", "move_file", "FILE_WRITE", "Move or rename files or directories."),

  def("locate", "start_search", "FILE_READ", "Start a streaming file search.", {
    params: ["path", "pattern", "searchType", "filePattern", "ignoreCase", "maxResults"],
  }),
  def("locate", "get_more_search_results", "FILE_READ", "Page through the results of an active file search.", { repeat: "allow", requires: "search" }),

  // `run_command` (proveedor nativo `jarvis_terminal`): lanza un comando de PowerShell, o continúa uno que sigue vivo (`pid`, con `input` si esperaba entrada).
  // Escritura por catálogo; un comando que `policy/readOnly.ts` demuestra de solo lectura, y una continuación sin `input`, se tratan como lectura llamada por llamada.
  // Repetición: un comando nuevo es `strict` (repetir una escritura idéntica pudo duplicar sus efectos), salvo uno de comprobación o compilación que
  // `policy/rerun.ts` reconoce (`npm test`, `dotnet build`…): `rerun`, que se puede repetir tras un cambio intermedio (RC-21). Una continuación por `pid` es
  // `allow`, porque esperar más salida repite los mismos argumentos (los topes del paso, `maxCallsPerStep`, acotan las vueltas).
  def("terminal", "run_command", "PROCESS_CONTROL", "Run a PowerShell command, or continue a running one by its pid.", {
    repeatByArgs: (args) => (typeof args.pid === "number" ? "allow" : typeof args.command === "string" && isRerunnableCommand(args.command) ? "rerun" : "strict"),
    params: ["command", "pid", "input", "timeoutSec", "cwd"],
    notes: {
      command: "PowerShell command to run. Omit it when continuing a process (use pid).",
      pid: "Process id from an earlier run_command that is still running or waiting for input.",
      input: "Answer for a process that was waiting for input; only with pid.",
      timeoutSec: "Seconds to wait for the result (default 30, max 300). The process is not killed when it expires.",
      cwd: "Absolute working directory for a new command. Default: the user's home folder.",
    },
    argCaps: { command: 1000 },
    timeoutMs: 315_000,
  }),
  // `list_processes` y `stop_process` (mismo proveedor; RC-25): lo que Desktop Commander hacía con `list_sessions`, `list_processes`, `force_terminate` y
  // `kill_process`. Listar es una lectura. Cortar es control de procesos (confirmación): uno de `run_command` con todo su árbol; otro proceso de la PC, solo
  // ese, nunca los críticos de Windows, Jarvis y lo suyo, ni lo de otra tarea en curso (lo decide el proveedor).
  def("terminal", "list_processes", "READ", "List the processes started with run_command, or every process on the computer.", {
    params: ["all"],
    notes: { all: "true to list every process on the computer (pid, name, memory); omit it for the processes started with run_command." },
  }),
  def("terminal", "stop_process", "PROCESS_CONTROL", "Stop a running process by its pid.", {
    params: ["pid"],
    notes: { pid: "Process id to stop: one started with run_command (it stops everything that command started) or any other process." },
  }),

  // `web_search` (proveedor nativo `jarvis_web`): busca o lee las URLs dadas y devuelve fragmentos literales con su fuente y un estado. Por dentro usa `research` y
  // `fetch` de Free Search (internas). `no_data` (sin resultados o sin fragmentos relevantes) permite un reintento con otros argumentos (`retry_failed`).
  def("web", "web_search", "READ", "Search the web, or read given URLs, and return the relevant passages.", {
    repeat: "retry_failed",
    params: ["need", "terms", "urls", "freshness", "domains"],
    notes: {
      need: "A direct question, e.g. 'When was Node.js 22 released?' (not an instruction like 'find…'; never a URL). Max 300 characters.",
      terms: "Optional keywords in the language the sources are likely written in; helps when the question is in another language.",
      urls: "Optional pages to read directly instead of searching (max 5, http or https).",
      freshness: "Only for time-sensitive needs: day, week, month or year.",
      domains: "Only if the user named a site: domains to restrict the search to.",
    },
    timeoutMs: 150_000,
  }),
  // Internas de `web_search` (Free Search). `research` busca y lee en una sola llamada; `fetch` descarga UNA URL como Markdown.
  internalDef("free_search", "web", "research", "READ", "Search the web and read the top pages in one call.", { emptyIsError: true, repeat: "retry_failed" }),
  internalDef("free_search", "web", "fetch", "READ", "Download ONE known URL as Markdown.", { repeat: "retry_failed" }),
];

/** Clave canónica de una herramienta (servidor + nombre, sin distinguir mayúsculas); la usan el catálogo y el registro de extractores. */
export const toolKey = (server: string, tool: string) => `${server}:${tool}`.toLowerCase();

const INDEX = new Map<string, ToolDefinition>();
for (const t of SYSTEM_TOOL_MANIFEST) {
  const k = toolKey(t.server, t.name);
  if (INDEX.has(k)) throw new Error(`[Manifest] herramienta duplicada: ${k}`);
  INDEX.set(k, t);
}

/** Política para herramientas no catalogadas: tratadas como acción sensible. */
export const UNKNOWN_TOOL_POLICY: Readonly<ToolPolicy> = Object.freeze({
  capability: "COMMAND_EXECUTION",
  requiresApproval: true,
  mutates: true,
  emptyIsError: false,
  repeat: "strict",
});

const lookup = (server: string, tool: string): ToolDefinition | undefined => INDEX.get(toolKey(server, tool));

export function isKnownTool(server: string, tool: string): boolean {
  return lookup(server, tool) !== undefined;
}

export function getToolPolicy(server: string, tool: string): Readonly<ToolPolicy> {
  return lookup(server, tool)?.policy ?? UNKNOWN_TOOL_POLICY;
}

export function requirementOf(server: string, tool: string): "search" | undefined {
  return lookup(server, tool)?.requires;
}

/** Política de repetición de una llamada: la de sus argumentos si la herramienta la declara así (`repeatByArgs`); si no, la de su política. */
export function repeatPolicyOf(server: string, tool: string, args: Readonly<Record<string, unknown>>): RepeatPolicy {
  const def = lookup(server, tool);
  return def?.repeatByArgs?.(args) ?? getToolPolicy(server, tool).repeat;
}

/** Plazo declarado de la herramienta en milisegundos, o `undefined` si no tiene (rige el del transporte). */
export function timeoutOf(server: string, tool: string): number | undefined {
  return lookup(server, tool)?.timeoutMs;
}

const NO_ARG_CAPS: Readonly<Record<string, number>> = Object.freeze({});

/** Excepciones al recorte por defecto de los strings de `args` de una herramienta (vacío si no tiene o no está catalogada). */
export function argCapsOf(server: string, tool: string): Readonly<Record<string, number>> {
  return lookup(server, tool)?.argCaps ?? NO_ARG_CAPS;
}

/**
 * `ARGS_MAX`: el mayor de `defaultCap` (`BUDGET.argsStringDefault`) y de todas las excepciones `argCaps` del catálogo.
 * Es el valor que se pasa a `create.context` (`argsStringMax`); `clipWithin` garantiza que ningún string recortado lo supere.
 */
export function argsMax(defaultCap: number): number {
  let max = defaultCap;
  for (const t of SYSTEM_TOOL_MANIFEST) {
    for (const cap of Object.values(t.argCaps ?? {})) max = Math.max(max, cap);
  }
  return max;
}

/**
 * Nombres de los parámetros de `read_file` con los que `ctx.view.forArgs` deriva qué parte de una ref ya se mostró
 * (`ArgsViewOptions.readArgKeys`). Único lugar donde se declaran: el contexto no conoce herramientas (principio 5).
 */
export const READ_ARG_KEYS = Object.freeze({ path: "path", offset: "offset", length: "length" });

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
    properties[param] = { ...prop, description: note };
  }
  return { ...schema, properties };
}

/**
 * Lista cerrada: de las herramientas que expone el servidor del destino, conserva solo las que el manifest
 * cataloga bajo ese destino, sustituye la descripción por la del manifest (inglés, MAX_TOOL_DESC_CHARS), añade las
 * notas de formato de sus parámetros y, si la herramienta declara `params`, restringe su schema a esos parámetros.
 * Conserva el `name` real del servidor.
 */
export function applyDestination(route: ExecutableRoute, tools: readonly MCPTool[]): MCPTool[] {
  const server = serverOf(route);
  const allowed: MCPTool[] = [];
  for (const t of tools) {
    const d = lookup(server, t.name);
    if (d?.route !== route) continue;
    let inputSchema = d.params ? restrictParams(t.inputSchema, d.params) : t.inputSchema;
    if (d.notes) inputSchema = annotateParams(inputSchema, t.name, d.notes);
    allowed.push({ ...t, description: d.description, inputSchema });
  }
  return allowed;
}

export function buildCompactCatalog(): string {
  const sections: string[] = [];
  for (const route of EXECUTABLE_ROUTES) {
    const defs = SYSTEM_TOOL_MANIFEST.filter((d) => d.route === route && d.internal !== true);
    const lines = defs.map((d) => `• ${d.name} [${d.policy.capability}]: ${d.description}`);
    sections.push(`[SUBSYSTEM ${route} - ${DESTINATIONS[route].description}]:\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}