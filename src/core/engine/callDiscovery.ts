/**
 * JARVIS Core — Descubrimiento de herramientas para una llamada (`runCall`, fase 1) y rutas que se ofrecen a Decisión 1.
 *
 * Qué herramientas del catálogo se pueden usar ahora: las que no exigen un proceso o una búsqueda activos, o cuyo requisito se cumple, menos las vetadas enteras por
 * la lista negra. De ahí salen las rutas que ve Decisión 1 (`availableRoutes`) y las herramientas que ve Decisión 2 (`discoverTools`).
 */

import type { IMCPServer } from "../mcp/types.ts";
import { isBlacklistedTool } from "../policy/blacklist.ts";
import type { Blacklist } from "../policy/blacklist.ts";
import { applyDestination, getToolPolicy, serverOf } from "../tools/manifest.ts";
import type { MCPTool } from "../types.ts";
import type { ExecutableRoute } from "../types/routes.ts";
import { currentBlacklist } from "./callAuthorize.ts";
import { fromFailure } from "./callRecord.ts";
import type { EngineEnv } from "./env.ts";
import { routeExhausted } from "./limits.ts";
import type { CallOutcome } from "./outcomes.ts";

export type Discovery =
  | { readonly kind: "ok"; readonly server: IMCPServer; readonly tools: MCPTool[] }
  | { readonly kind: "outcome"; readonly outcome: CallOutcome };

/**
 * Herramientas del catálogo que se pueden usar ahora: todas menos las vetadas enteras por la lista negra (FLUJO 2, opciones disponibles). Una herramienta cuya llamada se
 * bloqueó por repetición sigue disponible: el anti-bucle solo bloquea la llamada idéntica, y con otros argumentos pasa.
 */
function usableTools(mcp: string, cataloged: readonly MCPTool[], blacklist: Blacklist): MCPTool[] {
  return cataloged.filter((t) => !isBlacklistedTool(blacklist, mcp, t.name, getToolPolicy(mcp, t.name).mutates));
}

/**
 * Rutas que se ofrecen a Decisión 1: las que tienen al menos una herramienta usable. Una ruta cuyo servidor o catálogo no
 * se puede consultar NO se descarta: el fallo aparece al ejecutar y cierra la tarea como infraestructura caída. Una cuyo servidor respondió
 * sin herramientas (una herramienta que no existe en esta plataforma) sí se descarta.
 */
export async function availableRoutes(env: EngineEnv, stepId: string, routes: readonly ExecutableRoute[]): Promise<ExecutableRoute[]> {
  const out = await routesWithTools(env, routes);
  // Una ruta cuyo resultado Decisión 4 rechazó `maxNotAccomplishedPerRoute` veces como "no cumple lo pedido" en este paso se deja de ofrecer: cambiar los
  // argumentos de la misma herramienta no resuelve lo que esa ruta no puede dar (p. ej. un listado sin tamaños no los trae). Si no quedara ninguna ruta, se ofrecen todas.
  const remaining = out.filter((route) => !routeExhausted(env.ctx, stepId, route));
  return remaining.length > 0 ? remaining : out;
}

async function routesWithTools(env: EngineEnv, routes: readonly ExecutableRoute[]): Promise<ExecutableRoute[]> {
  const { deps } = env;
  // En paralelo: si el servidor todavía está arrancando (lo normal en la primera tarea tras encender Jarvis), esperar a cada ruta una tras otra
  // sumaría los arranques de los dos servidores en vez de esperar al más lento. El orden de las rutas se conserva.
  const checked = await Promise.all(
    routes.map(async (route): Promise<ExecutableRoute | null> => {
      const mcp = serverOf(route);
      let cataloged: MCPTool[] = [];
      try {
        cataloged = deps.discovery.getServer(mcp) ? applyDestination(route, await deps.discovery.getDiscoveredTools(mcp)) : [];
      } catch {
        cataloged = [];
      }
      if (cataloged.length > 0) return usableTools(mcp, cataloged, currentBlacklist(deps)).length > 0 ? route : null;
      // Sin catálogo: si el servidor existe, respondió y no lo marcaron caído, no tiene herramientas para este destino (`jarvis_terminal` fuera de
      // Windows): no se ofrece. Si falló o no está, se ofrece igual y el fallo cierra la tarea como infraestructura caída al ejecutar.
      const answeredEmpty = deps.discovery.getServer(mcp) !== undefined && deps.discovery.getUnavailableServers()[mcp] === undefined;
      return answeredEmpty ? null : route;
    }),
  );
  return checked.filter((route): route is ExecutableRoute => route !== null);
}

/**
 * Herramientas utilizables del destino. Servidor ausente, sin catálogo disponible o descubrimiento que falla =
 * infraestructura (`service_unavailable`, D4). Que tras filtrar las que exigen un proceso o una búsqueda activos no
 * quede ninguna NO es infraestructura: `no_tools` (D32).
 */
export async function discoverTools(env: EngineEnv, stepId: string, route: ExecutableRoute, mcp: string): Promise<Discovery> {
  const { deps } = env;
  const unavailable = (detail: unknown): Discovery => ({ kind: "outcome", outcome: fromFailure(env, stepId, "unavailable", detail) });

  const server = deps.discovery.getServer(mcp);
  if (!server) return unavailable(`Servidor MCP '${mcp}' no disponible.`);

  let cataloged: MCPTool[];
  try {
    cataloged = applyDestination(route, await deps.discovery.getDiscoveredTools(mcp));
  } catch (error) {
    return unavailable(error);
  }
  if (cataloged.length === 0) {
    const down = deps.discovery.getUnavailableServers()[mcp];
    return unavailable(
      `Discovery: no hay herramientas catalogadas disponibles para el destino '${route}' en '${mcp}'` + (down ? `: servidor no disponible (${down.reason}).` : "."),
    );
  }

  const usable = usableTools(mcp, cataloged, currentBlacklist(deps));
  if (usable.length === 0) {
    console.warn(`[Engine] no hay herramientas utilizables en el destino '${route}'.`);
    return { kind: "outcome", outcome: { kind: "no_tools" } };
  }
  return { kind: "ok", server, tools: usable };
}
