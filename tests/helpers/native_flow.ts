/**
 * Corre una tarea de un solo paso con el motor real (`runTask`) y proveedores nativos reales (con drivers falsos donde hace falta), sin modelos: los dobles de Decisión
 * y del LLM eligen la ruta y la herramienta y proponen los argumentos. Sirve a las pruebas de punta a punta de cada grupo nativo.
 */

import fs from "node:fs";
import path from "node:path";

import type { EngineDeps } from "../../src/core/contracts.ts";
import { create } from "../../src/core/ctx/index.ts";
import { runTask } from "../../src/core/engine/runTask.ts";
import { TaskRuntime } from "../../src/core/engine/runtime.ts";
import type { IMCPServer } from "../../src/core/mcp/types.ts";
import { EMPTY_BLACKLIST } from "../../src/core/policy/blacklist.ts";
import { createRefVault } from "../../src/core/refs/refVault.ts";
import type { ExecutableRoute } from "../../src/core/types.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;

export interface NativeOutcome {
  readonly state: string;
  readonly stopReason: string | null;
  readonly approvals: number;
  readonly dispatched: string[];
  readonly calls: { tool: string; status: string; verdict: string | null; reason: string | null }[];
  /** Consultas a Decisión 3 (revisión de argumentos) y a Decisión 4 (verificación del resultado). */
  readonly reviews: number;
  readonly verifies: number;
}

export interface NativeOptions {
  /** Responde a las confirmaciones del usuario (por defecto, aprueba). */
  readonly approve?: boolean;
  readonly autoMode?: boolean;
  /** Aprobación por niveles (por defecto, encendida). */
  /** Probabilidad de «aprobado» que da Decisión 3 (por defecto 1; el umbral estricto del nivel amarillo es 0,65 y el normal 0,6). */
  readonly review?: number;
  /** Respuestas de Decisión 4 (por defecto aprueba con 0,95). */
  readonly verify?: { readonly ok: number; readonly cumple: number };
}

/** Las rutas absolutas y las URL que menciona el pedido: el pre-chequeo rechaza una ruta de lectura que no sale del pedido ni de resultados anteriores. */
export function pathsOf(value: unknown): string[] {
  if (typeof value === "string") return path.isAbsolute(value) || /^https?:\/\//i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(pathsOf);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(pathsOf);
  return [];
}

export async function runNative(
  providers: Record<string, IMCPServer>,
  root: string,
  route: ExecutableRoute,
  tool: string,
  args: Record<string, unknown>,
  options: NativeOptions = {},
): Promise<NativeOutcome> {
  const dispatched: string[] = [];
  const servers: Record<string, IMCPServer> = {};
  for (const [name, provider] of Object.entries(providers)) {
    servers[name] = {
      name,
      version: "t",
      listTools: () => provider.listTools(),
      callTool: (t, a, o) => (dispatched.push(t), provider.callTool(t, a, o)),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
  }
  let t = 1_700_000_000_000;
  const mentioned = pathsOf(args);
  const ctx = create.context(
    { id: "task_native", request: `Hacer ${tool}${mentioned.length > 0 ? ` con ${mentioned.join(" y ")}` : ""}`, mode: "reactive" },
    { now: () => (t += 100), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
  let pendingN = 0;
  let approvals = 0;
  let reviews = 0;
  let verifies = 0;
  const rt: TaskRuntime = new TaskRuntime({
    onChange: (w) => {
      if (w?.kind === "approval") {
        approvals++;
        rt.resolveApproval(w.request.id, options.approve ?? true);
      }
    },
  });
  const refsDir = path.join(path.dirname(root), `refs-${path.basename(root)}`);
  const deps: EngineDeps = {
    discovery: {
      getServer: (n) => servers[n],
      getDiscoveredTools: async (n) => (n in servers ? servers[n].listTools() : []),
      getUnavailableServers: () => ({}),
      validateToolExists: async () => true,
      notifyTaskEnd: async () => undefined,
    },
    decision: {
      chooseRoute: async () => ({ action: "route", route, probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      chooseTool: async (inp) => ({ action: "tool", tool: inp.tools.find((x) => x.name === tool)!, probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async () => {
        reviews++;
        const p = options.review ?? 1;
        return { review: "approved", probabilities: { approved: p, args_invalid: 1 - p }, rawInput: "", rawOutput: "" };
      },
      verifyResult: async () => {
        verifies++;
        return { answers: options.verify ?? { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" };
      },
      checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generatePendingFromView: async () => ({ pending: pendingN++ === 0 ? [`Hacer ${tool}`] : [], rawInput: "", rawOutput: "" }),
      generateArgumentsFromView: async () => ({ args, rawInput: "", rawOutput: "", timing: TIMING }),
      generatePlanFromView: async () => {
        throw new Error("no se usa");
      },
      generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
      generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
    },
    vault: createRefVault({ dir: refsDir }),
    guardScope: { protectedDirs: [], relativeBases: [root] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: root }),
    autoMode: () => options.autoMode ?? false,
  };
  try {
    await runTask(ctx, rt, deps);
  } finally {
    fs.rmSync(refsDir, { recursive: true, force: true });
  }
  return {
    state: ctx.task.state,
    stopReason: ctx.task.stopReason ?? null,
    approvals,
    dispatched,
    calls: ctx.find("calls", {}).map((c) => ({ tool: c.tool, status: c.status, verdict: c.verdict ?? null, reason: c.reason ?? null })),
    reviews,
    verifies,
  };
}
