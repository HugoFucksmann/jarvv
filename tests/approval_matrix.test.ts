/**
 * Matriz de caracterización de la autorización de una llamada (`runCall`, fases 6 a 8: Guard, lista negra, niveles, confirmación del usuario y revisión D3).
 *
 * Fija lo que el código HACE hoy, combinando las variables que deciden si una llamada pide confirmación al usuario, pasa por Decisión 3 o se rechaza:
 * `approvalTiers` × `autoMode` × nivel de la operación (verde, amarillo, rojo) × coincidencia con la lista negra (`blocked`/`sensitive`) × ruta sensible
 * obligatoria × umbral de D3 (normal o estricto) × `allowedDirectories` × rechazo del usuario.
 *
 * Es la red de seguridad del refactor de `runCall` (`docs/pendientes/REFACTOR_CORE.md`, punto 1): extraer `authorize` no debe cambiar ninguna fila. Si una fila
 * cambia a propósito, se cambia acá y se explica en el commit; si cambia sin querer, el refactor tiene un error.
 *
 * Se observa la PRIMERA llamada de cada escenario (después de un rechazo el motor reintenta y el ruido no interesa).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { EngineDeps } from "../src/core/contracts.ts";
import { create } from "../src/core/ctx/index.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { compileBlacklist } from "../src/core/policy/blacklist.ts";
import type { BlacklistEntry } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { toolResult } from "../src/core/tools/result.ts";
import type { MCPCallResult, MCPTool } from "../src/core/types.ts";
import { FAKE_DISK } from "./fixtures.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;
const SCHEMA = { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, mode: { type: "string" }, command: { type: "string" } } };
const tool = (name: string): MCPTool => ({ name, description: name, inputSchema: SCHEMA });
const FILE_TOOLS = ["list_directory", "write_file"].map(tool);
const TERMINAL_TOOLS = [tool("run_command")];
const FINISHED: MCPCallResult = toolResult({
  text: "status: finished · exit code: 0 · duration: 1.0s · pid: 4321\nlisto",
  raw: "listo",
  data: { state: "finished", pid: 4321, exitCode: 0, durationMs: 1000 },
});

// ───────────────────────── Operaciones ─────────────────────────

type OpName = "new_file" | "overwrite" | "append" | "read" | "sensitive_path" | "run_modify" | "run_readonly";

interface Op {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly request: string;
}

/** Arma la operación en `dir` (que es el «inicio» del entorno) y prepara el disco que necesita. */
function buildOp(name: OpName, dir: string): Op {
  const file = path.join(dir, name === "new_file" || name === "sensitive_path" ? "nueva.txt" : "existe.txt");
  switch (name) {
    case "new_file":
      return { tool: "write_file", args: { path: file, content: "hola" }, request: `Guardá hola en ${file}` };
    case "overwrite":
      fs.writeFileSync(file, "viejo");
      return { tool: "write_file", args: { path: file, content: "nuevo", mode: "rewrite" }, request: `Guardá nuevo en ${file}` };
    case "append":
      fs.writeFileSync(file, "viejo");
      return { tool: "write_file", args: { path: file, content: "más", mode: "append" }, request: `Agregá más a ${file}` };
    case "read":
      return { tool: "list_directory", args: { path: dir }, request: `Listá ${dir}` };
    case "sensitive_path": {
      const ssh = path.join(dir, ".ssh");
      fs.mkdirSync(ssh);
      const key = path.join(ssh, "id_rsa");
      return { tool: "write_file", args: { path: key, content: "x" }, request: `Guardá x en ${key}` };
    }
    case "run_modify": {
      const from = path.join(dir, "a.txt");
      const to = path.join(dir, "b.txt");
      fs.writeFileSync(from, "a");
      return { tool: "run_command", args: { command: `Copy-Item ${from} ${to}` }, request: `Copiá ${from} a ${to}` };
    }
    case "run_readonly":
      return { tool: "run_command", args: { command: "Get-Date" }, request: "Mostrar la fecha" };
  }
}

// ───────────────────────── Escenario ─────────────────────────

interface Scenario {
  readonly op: OpName;
  readonly tiers: boolean;
  readonly auto: boolean;
  /** Entrada de la lista negra que coincide con la operación (patrón sobre los argumentos). */
  readonly list?: "blocked" | "sensitive";
  /** Probabilidades que devuelve D3 (revisión de argumentos); por defecto aprueba con 1. */
  readonly review?: Record<string, number>;
  /** `allowedDirectories` que no incluye la carpeta de la operación. */
  readonly outside?: boolean;
  /** El usuario rechaza (con esta instrucción) en lugar de aprobar. */
  readonly deny?: string;
}

interface Observed {
  /** Confirmaciones pedidas al usuario hasta que se registró la primera llamada. */
  readonly asked: number;
  /** Consultas a D3 hasta que se registró la primera llamada. */
  readonly reviews: number;
  readonly status: string;
  readonly summary: string | null;
  /** La primera confirmación pedida, si hubo. */
  readonly approval: { readonly tier?: string; readonly canRemember: boolean; readonly blacklist?: { readonly level: string }; readonly reason: string } | null;
  readonly dispatched: number;
}

async function observe(s: Scenario): Promise<Observed> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-matrix-"));
  try {
    const op = buildOp(s.op, dir);
    let asked = 0;
    let reviews = 0;
    let dispatched = 0;
    let first: { asked: number; reviews: number } | null = null;
    let approval: Observed["approval"] = null;

    const provider = (name: string, tools: MCPTool[]): IMCPServer => ({
      name,
      version: "test",
      listTools: async () => tools,
      callTool: async (toolName): Promise<MCPCallResult> => {
        dispatched++;
        if (toolName === "run_command") return FINISHED;
        return { content: [{ type: "text", text: toolName === "write_file" ? "ok" : "[FILE] a.txt\n[FILE] b.txt" }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    });
    const servers: Record<string, IMCPServer> = { desktop_commander: provider("desktop_commander", FILE_TOOLS), jarvis_terminal: provider("jarvis_terminal", TERMINAL_TOOLS) };
    const catalog = (name: string): MCPTool[] => (name === "jarvis_terminal" ? TERMINAL_TOOLS : name === "desktop_commander" ? FILE_TOOLS : []);

    const entries: BlacklistEntry[] =
      s.list === undefined ? [] : [{ tool: op.tool, pattern: "nueva|existe|a\\.txt", reason: "Regla de prueba.", level: s.list }];
    let pendingCalls = 0;
    let runtime!: TaskRuntime;

    const deps: EngineDeps = {
      discovery: {
        getServer: (name) => servers[name],
        getDiscoveredTools: async (name) => catalog(name),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: op.tool === "run_command" ? "terminal" : "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === op.tool) ?? input.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => {
          reviews++;
          return { review: "approved", probabilities: s.review ?? { approved: 1 }, rawInput: "", rawOutput: "" };
        },
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        firstQuery: async () => ({ kind: "single", probabilities: {}, multi: 0, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 1, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generateArgumentsFromView: async () => ({ args: op.args, rawInput: "", rawOutput: "", timing: TIMING }),
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generatePendingFromView: async () => ({ pending: pendingCalls++ === 0 ? [op.request] : [], rawInput: "", rawOutput: "" }),
        generatePlanFromView: async () => {
          throw new Error("no se usa en reactivo");
        },
        generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, ".refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: compileBlacklist(entries),
      environment: async () => ({ platform: "windows", home: dir }),
      autoMode: () => s.auto,
      approvalTiers: () => s.tiers,
      disk: FAKE_DISK,
      ...(s.outside === true ? { allowedDirectories: () => [path.join(dir, "otra-carpeta")] } : {}),
    };

    let clock = 1_700_000_000_000;
    const ctx = create.context(
      { id: "task_matrix", request: op.request, mode: "reactive" },
      { now: () => (clock += 1000), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
    );
    ctx.on("change", (event) => {
      if (first === null && event.ops.some((o) => o.op === "add" && o.target === "calls")) first = { asked, reviews };
    });
    runtime = new TaskRuntime({
      onChange: (waiting) => {
        // `info_missing` hace una pregunta al usuario: se responde para que la tarea siga.
        if (waiting !== null && waiting.kind === "question") {
          const questionId = waiting.question.id;
          queueMicrotask(() => runtime.answer("la que sea", questionId));
          return;
        }
        if (waiting === null || waiting.kind !== "approval") return;
        asked++;
        const r = waiting.request;
        approval ??= { ...(r.tier === undefined ? {} : { tier: r.tier }), canRemember: r.canRemember === true, ...(r.blacklist === undefined ? {} : { blacklist: { level: r.blacklist.level } }), reason: r.reason };
        queueMicrotask(() => (s.deny === undefined ? runtime.resolveApproval(r.id, true) : runtime.resolveApproval(r.id, false, s.deny)));
      },
    });
    await runTask(ctx, runtime, deps);

    const call = ctx.find("calls", {})[0];
    assert.ok(call !== undefined, "la tarea debió registrar al menos una llamada");
    const snapshot = first ?? { asked, reviews };
    return { asked: snapshot.asked, reviews: snapshot.reviews, status: call.status, summary: call.summary, approval, dispatched };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const label = (s: Scenario): string =>
  [s.op, `tiers=${s.tiers ? "on" : "off"}`, `auto=${s.auto ? "on" : "off"}`, s.list ? `lista=${s.list}` : null, s.outside ? "fuera de allowedDirectories" : null, s.deny !== undefined ? "usuario rechaza" : null, s.review ? `D3=${JSON.stringify(s.review)}` : null]
    .filter(Boolean)
    .join(" · ");

interface Expect {
  readonly asked: number;
  readonly reviews: number;
  readonly status: string;
  readonly canRemember?: boolean;
  readonly tier?: string;
  readonly listLevel?: string;
  readonly summary?: RegExp;
}

function check(name: string, s: Scenario, e: Expect): void {
  test(`matriz: ${name}`, async () => {
    const o = await observe(s);
    assert.equal(o.asked, e.asked, `confirmaciones pedidas (${label(s)})`);
    assert.equal(o.reviews, e.reviews, `consultas a D3 (${label(s)})`);
    assert.equal(o.status, e.status, `estado de la primera llamada (${label(s)})`);
    if (e.canRemember !== undefined) assert.equal(o.approval?.canRemember, e.canRemember, "«aprobar siempre» ofrecido");
    if (e.tier !== undefined) assert.equal(o.approval?.tier, e.tier, "nivel mostrado en la confirmación");
    if (e.listLevel !== undefined) assert.equal(o.approval?.blacklist?.level, e.listLevel, "nivel de la lista negra mostrado");
    if (e.summary !== undefined) assert.match(o.summary ?? "", e.summary);
  });
}

const MODES = [
  { tiers: true, auto: false },
  { tiers: true, auto: true },
  { tiers: false, auto: false },
  { tiers: false, auto: true },
] as const;

// ───────────────────────── 1. Escrituras del catálogo, sin lista ni ruta sensible ─────────────────────────

/** Con niveles: verde no pide ni revisa; rojo siempre pide; amarillo pide sin `autoMode` y con él pasa por D3. Sin niveles: sin `autoMode` pide, con él pasa por D3. */
function baseline(op: "new_file" | "overwrite" | "append", tiers: boolean, auto: boolean): Pick<Expect, "asked" | "reviews"> {
  if (tiers) {
    if (op === "new_file") return { asked: 0, reviews: 0 };
    if (op === "overwrite") return { asked: 1, reviews: 0 };
    return auto ? { asked: 0, reviews: 1 } : { asked: 1, reviews: 0 };
  }
  return auto ? { asked: 0, reviews: 1 } : { asked: 1, reviews: 0 };
}

for (const op of ["new_file", "overwrite", "append"] as const) {
  for (const { tiers, auto } of MODES) {
    const s: Scenario = { op, tiers, auto };
    check(label(s), s, { ...baseline(op, tiers, auto), status: "ok", ...(tiers && op === "overwrite" ? { tier: "red", canRemember: true } : {}) });
  }
}

// ───────────────────────── 2. Las lecturas nunca piden confirmación ni pasan por D3 ─────────────────────────

for (const { tiers, auto } of MODES) {
  const s: Scenario = { op: "read", tiers, auto };
  check(label(s), s, { asked: 0, reviews: 0, status: "ok" });
}

// ───────────────────────── 3. Lista negra ─────────────────────────

// `sensitive`: con niveles siempre pregunta; sin niveles pregunta solo sin `autoMode` y con él pasa por D3 (umbral estricto).
for (const { tiers, auto } of MODES) {
  const s: Scenario = { op: "new_file", tiers, auto, list: "sensitive" };
  const asks = tiers || !auto;
  check(label(s), s, { asked: asks ? 1 : 0, reviews: asks ? 0 : 1, status: "ok", ...(asks ? { canRemember: false, listLevel: "sensitive" } : {}) });
}

// `blocked`: con niveles o con `autoMode` se rechaza sin preguntar; solo sin niveles y sin `autoMode` se le pregunta al usuario.
for (const { tiers, auto } of MODES) {
  const s: Scenario = { op: "new_file", tiers, auto, list: "blocked" };
  if (tiers || auto) check(label(s), s, { asked: 0, reviews: 0, status: "tool_rejected", summary: /Regla de prueba\./ });
  else check(label(s), s, { asked: 1, reviews: 0, status: "ok", canRemember: false, listLevel: "blocked" });
}

// ───────────────────────── 4. Ruta sensible: confirmación obligatoria en todos los modos ─────────────────────────

for (const { tiers, auto } of MODES) {
  const s: Scenario = { op: "sensitive_path", tiers, auto };
  check(label(s), s, { asked: 1, reviews: 0, status: "ok", canRemember: false });
}

// ───────────────────────── 5. Umbral de D3: normal (0,6) y estricto (0,65) ─────────────────────────

const APPROVED_062 = { approved: 0.62, args_invalid: 0.3, info_missing: 0.08 };
const APPROVED_070 = { approved: 0.7, args_invalid: 0.2, info_missing: 0.1 };
const REJECT_ARGS = { approved: 0.3, args_invalid: 0.6, info_missing: 0.1 };
const REJECT_INFO = { approved: 0.3, args_invalid: 0.2, info_missing: 0.5 };

// Amarillo con `autoMode` (umbral estricto): 0,62 pasa el normal pero no el estricto → `tool_rejected`, no `args_invalid`.
check("amarillo + auto: D3 con 0,62 no alcanza el umbral estricto → tool_rejected", { op: "append", tiers: true, auto: true, review: APPROVED_062 }, { asked: 0, reviews: 1, status: "tool_rejected", summary: /safety review was not confident/ });
check("amarillo + auto: D3 con 0,70 supera el umbral estricto → se ejecuta", { op: "append", tiers: true, auto: true, review: APPROVED_070 }, { asked: 0, reviews: 1, status: "ok" });
check("amarillo + auto: D3 rechaza con args_invalid → args_invalid", { op: "append", tiers: true, auto: true, review: REJECT_ARGS }, { asked: 0, reviews: 1, status: "args_invalid" });
check("amarillo + auto: D3 rechaza con info_missing → info_missing", { op: "append", tiers: true, auto: true, review: REJECT_INFO }, { asked: 0, reviews: 1, status: "info_missing" });

// Sin niveles y con `autoMode` (umbral normal): 0,62 aprueba; un rechazo claro es `args_invalid`.
check("sin niveles + auto: D3 con 0,62 supera el umbral normal → se ejecuta", { op: "new_file", tiers: false, auto: true, review: APPROVED_062 }, { asked: 0, reviews: 1, status: "ok" });
check("sin niveles + auto: D3 rechaza con args_invalid → args_invalid", { op: "new_file", tiers: false, auto: true, review: REJECT_ARGS }, { asked: 0, reviews: 1, status: "args_invalid" });

// Lista negra `sensitive` con `autoMode` y sin niveles: umbral estricto.
check("lista sensitive + auto sin niveles: D3 con 0,62 → tool_rejected", { op: "new_file", tiers: false, auto: true, list: "sensitive", review: APPROVED_062 }, { asked: 0, reviews: 1, status: "tool_rejected", summary: /Regla de prueba\./ });
check("lista sensitive + auto sin niveles: D3 con 0,70 → se ejecuta", { op: "new_file", tiers: false, auto: true, list: "sensitive", review: APPROVED_070 }, { asked: 0, reviews: 1, status: "ok" });

// Verde y confirmación del usuario sustituyen a D3: aunque D3 rechazara, no se consulta.
check("verde: D3 no se consulta aunque rechazaría", { op: "new_file", tiers: true, auto: true, review: REJECT_ARGS }, { asked: 0, reviews: 0, status: "ok" });
check("rojo: la aprobación del usuario sustituye a D3 aunque rechazaría", { op: "overwrite", tiers: true, auto: true, review: REJECT_ARGS }, { asked: 1, reviews: 0, status: "ok" });

// ───────────────────────── 6. Rechazo del usuario ─────────────────────────

check("rojo: el usuario rechaza → user_rejected con su instrucción; no se despacha", { op: "overwrite", tiers: true, auto: false, deny: "no lo sobrescribas" }, { asked: 1, reviews: 0, status: "user_rejected", summary: /no lo sobrescribas/ });

// ───────────────────────── 7. allowedDirectories ─────────────────────────

for (const tiers of [true, false]) {
  const s: Scenario = { op: "new_file", tiers, auto: true, outside: true };
  check(label(s), s, { asked: 0, reviews: 0, status: "tool_rejected", summary: /allowedDirectories/ });
}

// ───────────────────────── 8. run_command ─────────────────────────

// Un comando de solo lectura es una lectura: ni confirmación ni D3.
for (const { tiers, auto } of MODES) {
  const s: Scenario = { op: "run_readonly", tiers, auto };
  check(label(s), s, { asked: 0, reviews: 0, status: "ok" });
}

// Un comando que modifica es rojo con niveles (siempre pide); sin niveles sigue la regla general del catálogo.
for (const { tiers, auto } of MODES) {
  const s: Scenario = { op: "run_modify", tiers, auto };
  const asks = tiers || !auto;
  check(label(s), s, { asked: asks ? 1 : 0, reviews: asks ? 0 : 1, status: "ok" });
}
