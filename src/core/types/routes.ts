/**
 * Destinos que elige Decision #1 y que ejecutan herramientas MCP (grupos funcionales de herramientas).
 * El orden es fijo: es el orden de los criterios en el prompt de Decision #1. Todo lo demás (schemas JSON,
 * prompts, criterios de Decision, validación de planes) debe derivarse de esta constante. Cada destino lo
 * ejecuta un servidor MCP (ver DESTINATIONS en tools/manifest.ts).
 */
export const EXECUTABLE_ROUTES = ["files", "locate", "terminal", "web"] as const;
export type ExecutableRoute = (typeof EXECUTABLE_ROUTES)[number];

/** Proveedores de herramientas: los dos servidores MCP de terceros y los nativos (`jarvis_*`, en `src/tools/`). */
export const MCP_SERVERS = ["desktop_commander", "free_search", "jarvis_terminal", "jarvis_web"] as const;
export type McpServerName = (typeof MCP_SERVERS)[number];

export function isExecutableRoute(route: unknown): route is ExecutableRoute {
  return typeof route === "string" && (EXECUTABLE_ROUTES as readonly string[]).includes(route);
}