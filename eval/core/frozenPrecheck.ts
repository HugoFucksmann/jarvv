/**
 * eval/core/frozenPrecheck.ts
 *
 * Pre-chequeo (`src/core/engine/precheck.ts`) sobre un caso `args_review` **fijo**: el request ya armado, sin contexto. Se
 * reconstruye lo que el pre-chequeo necesita desde el texto del `state` que ve D3 (herramienta, argumentos y fuentes). Es una
 * aproximación del camino de producción (que usa el contexto completo): las fuentes son el texto que D3 ve, sin los intentos
 * fallidos de ese paso (un intento rechazado era una suposición y no da origen).
 */

import { precheckCall } from "../../src/core/engine/precheck.ts";
import type { CommandAnalyzer, PrecheckFinding } from "../../src/core/engine/precheck.ts";
import { getToolPolicy, serverOf } from "../../src/core/tools/manifest.ts";
import type { ExecutableRoute } from "../../src/core/types/routes.ts";

const ENVIRONMENT = {
  platform: "windows" as const,
  home: "C:/Users/hugof",
  desktop: "C:/Users/hugof/Desktop",
  documents: "C:/Users/hugof/Documents",
  downloads: "C:/Users/hugof/Downloads",
};

const norm = (s: string): string => s.split("\\").join("/").toLowerCase();

/** Texto del `state` antes de la llamada candidata, sin el bloque "Failed attempts of this step". */
export function collectFrozenSources(state: string): string {
  const head = state.slice(0, state.indexOf("Candidate call:") >= 0 ? state.indexOf("Candidate call:") : state.length);
  const out: string[] = [];
  let inFailed = false;
  for (const line of head.split("\n")) {
    if (line.startsWith("Failed attempts of this step")) {
      inFailed = true;
      continue;
    }
    if (inFailed && line.startsWith("- ")) continue;
    inFailed = false;
    out.push(line);
  }
  return norm(out.join("\n"));
}

export async function frozenPrecheck(
  state: string,
  analyze?: CommandAnalyzer,
): Promise<{ route?: ExecutableRoute; tool: string; finding: PrecheckFinding | null }> {
  const toolLine = /Tool: (\w+)\/(\w+)/.exec(state);
  const argsLine = /Arguments: (.*)$/m.exec(state);
  if (toolLine === null || argsLine === null) return { tool: "", finding: null };
  const route = toolLine[1] as ExecutableRoute;
  const tool = toolLine[2];
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsLine[1]) as Record<string, unknown>;
  } catch {
    return { route, tool, finding: null };
  }
  const kind = getToolPolicy(serverOf(route), tool).mutates ? "write" : "read";
  const finding = await precheckCall({ tool, kind, args, sources: { text: collectFrozenSources(state), complete: true }, environment: ENVIRONMENT }, analyze);
  return { route, tool, finding };
}
