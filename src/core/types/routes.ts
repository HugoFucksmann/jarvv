/**
 * Destinos que elige Decision #1 y que ejecutan herramientas MCP (grupos funcionales de herramientas).
 * El orden es fijo: es el orden de los criterios en el prompt de Decision #1. Todo lo demás (schemas JSON,
 * prompts, criterios de Decision, validación de planes) debe derivarse de esta constante. Cada destino lo
 * ejecuta un servidor MCP (ver DESTINATIONS en tools/manifest.ts).
 */
export const EXECUTABLE_ROUTES = ["files", "locate", "terminal", "web"] as const;
export type ExecutableRoute = (typeof EXECUTABLE_ROUTES)[number];

export const MCP_SERVERS = ["desktop_commander", "free_search"] as const;
export type McpServerName = (typeof MCP_SERVERS)[number];

/**
 * Opciones del modelo de decisión que no son rutas ni herramientas (5.2): identificadores estables, separados del texto
 * de los prompts. No crean llamadas. `FIN` y `ASK_USER` ya no son opciones de Decision: `src` no las usa y solo las importa
 * el eval (se borran al refactorizar el eval).
 */
export const FIN = "fin" as const;
export const ASK_USER = "ask_user" as const;

export function isExecutableRoute(route: unknown): route is ExecutableRoute {
  return typeof route === "string" && (EXECUTABLE_ROUTES as readonly string[]).includes(route);
}