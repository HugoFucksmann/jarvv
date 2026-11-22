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
 *   Las herramientas de otros servidores que una tool compuesta usa por dentro (`search`, `fetch` y `read_doc` de Free Search) figuran como `internal`: tienen política
 *   y Guard como las demás, pero no se ofrecen a Decision ni al planificador.
 * - Sin herramientas de interfaz gráfica (clic, teclado, portapapeles, capturas, esperas de UI) ni meta (feedback,
 *   prompts, estadísticas): decisión de diseño vigente.
 * - Las descripciones están en inglés: son la fuente única para Decision (criterios) y para el catálogo del
 *   planificador. Se compactan (MAX_TOOL_DESC_CHARS) y sustituyen a las del servidor, que a veces es el único lugar donde
 *   se explica el formato de un parámetro (el esquema solo dice `string`). Ese formato se conserva como nota
 *   (`notes`), que se inyecta en el esquema que ve el modelo que genera los argumentos.
 */

import type { Probe } from "./probes.ts";
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
  /** Excepciones al recorte por defecto de los strings de `args` al registrar la llamada (parámetro -> caracteres). */
  readonly argCaps?: Readonly<Record<string, number>>;
  /** Plazo de la herramienta en milisegundos (techo de cuánto espera una llamada de un proveedor nativo); sin él, el del transporte. */
  readonly timeoutMs?: number;
  /** Cuando la política de repetición depende de los argumentos de la llamada (`run_command`: esperar más salida de un `pid` repite los mismos argumentos). Gana a `policy.repeat`. */
  readonly repeatByArgs?: (args: Readonly<Record<string, unknown>>) => RepeatPolicy;
  /** Sondas de verificación de esta herramienta (`tools/probes.ts`): preguntas a Decisión que solo corren cuando la llamada es de esta herramienta. */
  readonly probes?: readonly Probe[];
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
  files_read: {
    server: "jarvis_files_read",
    description: "Find, list and read files and folders: look a file up by name, search text inside files, see what a folder contains, read a file.",
  },
  files_write: {
    server: "jarvis_files_write",
    description: "Create, write, edit, copy, move, rename, delete, compress or convert files and folders.",
  },
  terminal: {
    server: "jarvis_terminal",
    description:
      "Run a command or program (including launching apps), and read its output or send it input while it runs. Also for information about files that a plain listing does not give: sizes, dates, sorting, filtering or totals.",
  },
  system: {
    server: "jarvis_system",
    description: "Check the state of the PC (hardware, system, disks, services, network, processes, ports, date and time), stop processes, change PC settings, lock, sleep, restart or shut down, open an application, a URL or a folder on screen, and use the clipboard.",
  },
  multimedia: {
    server: "jarvis_multimedia",
    description: "Play music or video, and control the playback and the volume.",
  },
  web: {
    server: "jarvis_web",
    description: "Look up information online, read the content of web pages (including known URLs), and download a file from a URL.",
  },
};

interface ToolOptions {
  /** Una salida vacía es un error (lecturas y búsquedas). */
  emptyIsError?: boolean;
  /** Qué hacer con una llamada idéntica a una ya ejecutada (por defecto `strict`; `allow` para sondeos, `retry_failed` para la web). */
  repeat?: RepeatPolicy;
  params?: readonly string[];
  notes?: Readonly<Record<string, string>>;
  /** Excepciones al recorte por defecto de los strings de `args` (parámetro -> caracteres); ver `argCapsOf`. */
  argCaps?: Readonly<Record<string, number>>;
  /** Plazo de la herramienta en milisegundos (proveedores nativos). */
  timeoutMs?: number;
  repeatByArgs?: (args: Readonly<Record<string, unknown>>) => RepeatPolicy;
  probes?: readonly Probe[];
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
    argCaps: opts.argCaps ? Object.freeze({ ...opts.argCaps }) : undefined,
    timeoutMs: opts.timeoutMs,
    repeatByArgs: opts.repeatByArgs,
    probes: opts.probes ? Object.freeze([...opts.probes]) : undefined,
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
  // ── Grupo `files_read` (proveedor nativo `jarvis_files_read`): encontrar, listar y leer. Solo lectura, sin confirmación; los límites de cada tool están en su módulo. ──
  def("files_read", "find_files", "FILE_READ", "Find files or folders by name (wildcards like *.csv).", {
    repeat: "retry_failed",
    params: ["pattern", "path", "type", "maxResults"],
    notes: {
      pattern: "Name or text to match. Without * or ?, matches substring (case-insensitive). With * or ?, matches full name. Use | for alternatives (e.g. *.csv|*.json). Plain wildcards only, no regex.",
      path: "Folder to search in. Default: user home. Accepts aliases (home, desktop, documents, downloads) or an absolute path.",
      type: "Entry type to find: 'file', 'folder', or 'any' (default 'any').",
      maxResults: "Maximum results to return (default 50, max 200).",
    },
    timeoutMs: 15_000,
  }),
  def("files_read", "list_folder", "FILE_READ", "List a folder with type, size and date; can sort and filter by extension.", {
    repeat: "retry_failed",
    params: ["path", "sortBy", "order", "type", "extensions", "depth", "limit", "includeHidden"],
    notes: {
      path: "Folder to list. Accepts aliases (home, desktop, documents, downloads) or an absolute path.",
      sortBy: "Sort field: 'name' (default), 'size', or 'modified'.",
      order: "Sort order: 'asc' or 'desc'. Default is 'asc' for name, 'desc' for size and modified.",
      type: "Entry type filter: 'file', 'folder', or 'any' (default 'any').",
      extensions: 'Optional list of file extensions without dots, e.g. ["csv", "json"].',
      depth: "Subfolder depth to traverse (integer >= 1; default 1, max 3).",
      limit: "Maximum entries to show (default 100, max 500).",
      includeHidden: "Include hidden files and dotfiles (default false).",
    },
    timeoutMs: 10_000,
  }),
  def("files_read", "search_content", "FILE_READ", "Search for text inside files under a folder.", {
    repeat: "retry_failed",
    params: ["query", "path", "filePattern", "regex", "caseSensitive", "maxResults"],
    notes: {
      query: "Text to search for (a regular expression only if regex is true).",
      path: "Folder or file to search in. Default: user home. Accepts aliases (home, desktop, documents, downloads) or an absolute path.",
      filePattern: "Optional file name wildcard filter, e.g. '*.ts|*.json'.",
      regex: "Interpret query as a regular expression (default false).",
      caseSensitive: "Case-sensitive search (default false).",
      maxResults: "Maximum matches to return (default 50).",
    },
    timeoutMs: 15_000,
  }),
  def("files_read", "read_file", "FILE_READ", "Read the content of a local file (text lines; offset, limit).", {
    emptyIsError: true,
    params: ["path", "offset", "limit"],
    notes: {
      path: "Absolute file path or ~ relative path.",
      offset: "1-based first line to read (default 1).",
      limit: "Maximum lines to read (default 200, max 2000).",
    },
    timeoutMs: 15_000,
  }),

  // ── Grupo `files_write` (proveedor nativo `jarvis_files_write`): crear, modificar, mover, borrar y convertir. Toda escritura tiene su regla de nivel, su poscondición y su destino. ──
  def("files_write", "write_file", "FILE_WRITE", "Create or write a text file (rewrite, append or create_only).", {
    params: ["path", "content", "mode", "createFolders"],
    notes: {
      path: "Absolute file path or ~ relative path.",
      content: "Text to write into the file.",
      mode: "'rewrite' (default) replaces the file, 'append' adds at the end, 'create_only' fails if the file exists.",
      createFolders: "Create missing parent folders (default false).",
    },
    argCaps: { content: 4000 },
  }),
  def("files_write", "edit_file", "FILE_WRITE", "Replace exact text inside an existing text file.", {
    params: ["path", "oldText", "newText", "replaceAll", "expectedReplacements"],
    notes: {
      path: "Existing text file path.",
      oldText: "Exact text fragment to replace (non-empty).",
      newText: "Replacement text (may be empty to remove oldText).",
      replaceAll: "Replace every occurrence instead of requiring a unique match (default false).",
      expectedReplacements: "Optional expected number of replacements (>= 1).",
    },
    argCaps: { oldText: 2000, newText: 2000 },
  }),
  def("files_write", "convert_file", "FILE_WRITE", "Convert or resize an image, audio or video file.", {
    params: ["source", "destination", "format", "width", "height", "quality", "overwrite"],
    notes: {
      source: "Existing source media file path.",
      destination: "Optional output file path. Default: next to the source with the new extension.",
      format: "Target format extension, e.g. 'webp', 'png', 'mp3', 'mp4'.",
      width: "Optional target width in pixels (images and video).",
      height: "Optional target height in pixels (images and video).",
      quality: "Optional output quality 1..100.",
      overwrite: "Overwrite the destination if it exists (default false).",
    },
    timeoutMs: 65_000,
  }),
  def("files_write", "create_folder", "FILE_WRITE", "Create a folder, including missing parent folders."),
  def("files_write", "copy_file", "FILE_WRITE", "Copy a file or folder to a destination path.", {
    params: ["source", "destination", "overwrite", "recursive"],
    notes: {
      source: "Existing source file or folder path.",
      destination: "Target path of the copy (the full new path, not only the folder).",
      overwrite: "Overwrite the destination if it exists (default false).",
      recursive: "Copy folder contents recursively (default true).",
    },
    timeoutMs: 35_000,
  }),
  def("files_write", "move_file", "FILE_WRITE", "Move or rename files and folders, in batch.", {
    params: ["items", "overwrite"],
    notes: {
      items: "List of { source, destination } pairs. The destination is the full new path, not only the folder.",
      overwrite: "Overwrite existing destinations (default false).",
    },
    timeoutMs: 35_000,
  }),
  def("files_write", "delete_file", "FILE_WRITE", "Delete a file or folder (Recycle Bin unless permanent).", {
    params: ["path", "recursive", "permanent"],
    notes: {
      path: "Existing file or folder path to delete.",
      recursive: "Required true to delete a non-empty folder (default false).",
      permanent: "Delete permanently instead of sending to the Recycle Bin (default false).",
    },
    timeoutMs: 20_000,
  }),
  def("files_write", "archive_files", "FILE_WRITE", "Compress files into a .zip, or extract a .zip.", {
    params: ["action", "sources", "source", "destination", "overwrite", "includeHidden"],
    notes: {
      action: "'compress' or 'extract'.",
      sources: "Paths to compress (only with action 'compress').",
      source: ".zip archive to extract (only with action 'extract').",
      destination: "Output .zip file (compress) or target folder (extract).",
      overwrite: "Overwrite existing destination files (default false).",
      includeHidden: "Include dotfiles when compressing folders (default false).",
    },
    timeoutMs: 35_000,
  }),

  // ── Grupo `system` (proveedor nativo `jarvis_system`): estado de la PC, procesos, ajustes, energía, abrir en pantalla y portapapeles. `list_processes` pasó a ser la sección `processes` de `system_info`. ──
  def("system", "system_info", "READ", "Inspect hardware, OS, disks, network, processes, ports, date and time.", {
    repeat: "retry_failed",
    params: ["section", "status", "sortBy", "protocol", "nameFilter", "limit"],
    notes: {
      section: "Section to inspect: overview, hardware, os, disks, services, dev_tools, network, processes, ports or datetime.",
      status: "Only for 'services': 'running' (default), 'stopped' or 'all'.",
      sortBy: "Only for 'processes': 'memory' (default), 'cpu' or 'name'.",
      protocol: "Only for 'ports': 'all' (default), 'tcp' or 'udp'.",
      nameFilter: "Optional case-insensitive substring filter for services, processes or ports.",
      limit: "Maximum items for list sections.",
    },
    timeoutMs: 15_000,
  }),
  def("system", "stop_process", "PROCESS_CONTROL", "Stop a running process by its pid or name.", {
    params: ["pid", "name", "force"],
    notes: {
      pid: "Process id to stop (give pid or name).",
      name: "Process name to stop, e.g. 'notepad' (give pid or name). Stops every process with that name.",
      force: "Force termination (default false).",
    },
    timeoutMs: 12_000,
  }),
  def("system", "pc_settings", "CONFIGURATION", "Get or set brightness, wifi, bluetooth, dark mode or do not disturb.", {
    params: ["setting", "action", "value"],
    notes: {
      setting: "Setting to read or change: brightness, wifi, bluetooth, dark_mode or do_not_disturb.",
      action: "'get' to read it or 'set' to change it.",
      value: "Only for 'set': 0..100 for brightness, 'on' or 'off' for the others.",
    },
    timeoutMs: 12_000,
  }),
  def("system", "power", "PROCESS_CONTROL", "Lock, sleep, restart or shut down the PC.", {
    params: ["action", "delaySec", "force"],
    notes: {
      action: "'lock', 'sleep', 'restart' or 'shutdown'.",
      delaySec: "Optional delay in seconds for restart or shutdown.",
      force: "Force close open apps on restart or shutdown (default false).",
    },
    timeoutMs: 12_000,
  }),
  def("system", "open_on_screen", "PROCESS_CONTROL", "Open an app, a URL or a path on the user's screen.", {
    params: ["target", "type"],
    notes: {
      target: "Application name (e.g. 'notepad'), http(s) URL, or local path or alias (home, desktop, documents, downloads). It does not return the content: use read_file to read a file.",
      type: "Optional hint: 'auto' (default), 'app', 'url' or 'path'.",
    },
    timeoutMs: 12_000,
  }),
  def("system", "clipboard", "CONFIGURATION", "Read or write text in the system clipboard.", {
    params: ["action", "text"],
    notes: {
      action: "'read' or 'write'.",
      text: "Text to put in the clipboard (only with action 'write').",
    },
    argCaps: { text: 2000 },
    timeoutMs: 10_000,
  }),

  // ── Grupo `multimedia` (proveedor nativo `jarvis_multimedia`): reproducir y controlar la reproducción. No dejan nada en el disco. ──
  def("multimedia", "play_media", "PROCESS_CONTROL", "Search and play music or video on YouTube or Spotify.", {
    params: ["query", "platform", "mediaType"],
    notes: {
      query: "Song or video search text, a YouTube or Spotify URL, or a Spotify URI.",
      platform: "'auto' (default), 'youtube' or 'spotify'.",
      mediaType: "'auto' (default), 'music' or 'video'.",
    },
    timeoutMs: 10_000,
  }),
  def("multimedia", "media_control", "PROCESS_CONTROL", "Control the current playback: pause, skip, seek, volume, now playing.", {
    repeat: "allow",
    params: ["action", "seconds", "level"],
    notes: {
      action: "Action to perform, e.g. play, pause, next, previous, seek_forward, seek_backward, set_volume, mute, now_playing.",
      seconds: "Only for seek_forward and seek_backward: seconds to jump.",
      level: "Only for set_volume: volume level 0..100.",
    },
    timeoutMs: 10_000,
  }),

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
  // `web_search` (proveedor nativo `jarvis_web`): busca o lee las URLs dadas y devuelve fragmentos literales con su fuente y un estado. Por dentro usa `search` y
  // `fetch` de Free Search (internas). `no_data` (sin resultados o sin fragmentos relevantes) permite un reintento con otros argumentos (`retry_failed`).
  def("web", "web_search", "READ", "Search the web, or read given URLs, and return the relevant passages.", {
    repeat: "retry_failed",
    params: ["need", "urls", "freshness", "domains"],
    notes: {
      need: "A direct question, e.g. 'When was Node.js 22 released?' (not an instruction like 'find…'; never a URL). Max 300 characters.",
      urls: "Optional pages to read directly instead of searching (max 5, http or https).",
      freshness: "Only for time-sensitive needs: day, week, month or year.",
      domains: "Only if the user named a site: domains to restrict the search to (max 5).",
    },
    timeoutMs: 150_000,
  }),
  def("web", "download_file", "DOWNLOAD", "Download a file from an http(s) URL to disk.", {
    params: ["url", "destination", "folder", "filename", "overwrite"],
    notes: {
      url: "http or https URL of the file.",
      destination: "Full path of the file to create (give destination or folder, not both).",
      folder: "Folder or alias (home, desktop, documents, downloads) to save into. Default: downloads.",
      filename: "File name to use with folder. Default: taken from the URL or the response.",
      overwrite: "Overwrite the file if it exists (default false).",
    },
    timeoutMs: 65_000,
  }),
  // Internas de `web_search` (Free Search). `search` devuelve enlaces con extractos (es lo que usa `web_search`); `read_doc` lee un documento por ventanas; `fetch` descarga UNA URL como Markdown.
  internalDef("free_search", "web", "search", "READ", "Search the web and return a list of links with snippets.", { emptyIsError: true, repeat: "retry_failed" }),
  internalDef("free_search", "web", "read_doc", "READ", "Read a long page or document in windows (start, length).", { repeat: "retry_failed" }),
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

/** Posición de cada herramienta en el catálogo (`SYSTEM_TOOL_MANIFEST`), por clave. */
const CATALOG_RANK: ReadonlyMap<string, number> = new Map(SYSTEM_TOOL_MANIFEST.map((t, i) => [toolKey(t.server, t.name), i]));

/**
 * Ordena las herramientas como el catálogo (`SYSTEM_TOOL_MANIFEST`); las que no están en él van al final, en su orden. Frente 3, DN-3.7: el orden en que
 * un servidor MCP las descubre cambia entre arranques y movía 2 de 82 elecciones de Decisión 2.
 */
export function sortByCatalog<T extends { readonly name: string }>(server: string, tools: readonly T[]): T[] {
  const rank = (t: T): number => CATALOG_RANK.get(toolKey(server, t.name)) ?? Number.MAX_SAFE_INTEGER;
  return tools.map((t, i) => ({ t, i, r: rank(t) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.t);
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

/** Las sondas de verificación declaradas para la herramienta (ninguna si no tiene o no está catalogada). */
export function probesOf(server: string, tool: string): readonly Probe[] {
  return lookup(server, tool)?.probes ?? [];
}

export function isKnownTool(server: string, tool: string): boolean {
  return lookup(server, tool) !== undefined;
}

export function getToolPolicy(server: string, tool: string): Readonly<ToolPolicy> {
  return lookup(server, tool)?.policy ?? UNKNOWN_TOOL_POLICY;
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
    if (d?.route !== route || d.internal === true) continue;
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