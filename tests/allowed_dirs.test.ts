/**
 * Pruebas del flujo del paso 6c de `callRunner.ts` (`allowedDirectories`):
 * - rechazo inmediato (`tool_rejected`) ante rutas o `cwd` fuera de alcance;
 * - rutas no resolubles o comandos no analizables que exigen confirmación (`askUser`, `canRemember: false`) aun con `autoMode`;
 * - `run_command` con `cwd` explícito, `cwd` implícito (`environment.home`) y rutas del AST (`detectedPaths` / `unresolvablePaths`);
 * - enlaces simbólicos simulados que apuntan fuera de `allowedDirectories` (cuando la plataforma permite crearlos);
 * - lectura en vivo de `deps.allowedDirectories()`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { EngineDeps } from "../src/core/contracts.ts";
import { create } from "../src/core/ctx/index.ts";
import { runCall } from "../src/core/engine/callRunner.ts";
import { createEngineEnv } from "../src/core/engine/env.ts";
import type { CommandReport } from "../src/core/engine/precheck.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { clipWithin } from "../src/core/engine/args.ts";
import { createRefRedactor, REF_DISPLAY_CAP } from "../src/core/refs/redactRef.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import type { MCPCallResult, MCPTool } from "../src/core/types.ts";
import type { ExecutableRoute } from "../src/core/types/routes.ts";

const SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    url: { type: "string" },
    content: { type: "string" },
    mode: { type: "string" },
    command: { type: "string" },
    cwd: { type: "string" },
  },
};

const FILE_TOOLS: MCPTool[] = ["read_file", "write_file", "list_directory"].map((name) => ({
  name,
  description: name,
  inputSchema: SCHEMA,
}));

const TERMINAL_TOOLS: MCPTool[] = [{ name: "run_command", description: "run_command", inputSchema: SCHEMA }];

interface ApprovalSeen {
  readonly reason: string;
  readonly canRemember: boolean | undefined;
}

interface Step6cHarnessOptions {
  readonly request: string;
  readonly route: ExecutableRoute;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly allowedDirs: () => readonly string[];
  readonly home: string;
  readonly platform?: "windows" | "linux";
  readonly autoMode?: boolean;
  readonly approvalDecision?: "approve" | "reject";
  readonly analyzeCommand?: (command: string) => Promise<CommandReport | null>;
  readonly seedRefs?: readonly string[];
  readonly callTool?: (toolName: string, args: Record<string, unknown>) => Promise<MCPCallResult>;
}

async function runSingleCall(opts: Step6cHarnessOptions) {
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-vault-6c-"));
  const dispatched: Array<{ readonly tool: string; readonly args: Record<string, unknown> }> = [];
  const approvals: ApprovalSeen[] = [];
  let reviews = 0;

  const provider = (name: string, tools: MCPTool[]): IMCPServer => ({
    name,
    version: "test",
    listTools: async () => tools,
    callTool: async (toolName, args): Promise<MCPCallResult> => {
      dispatched.push({ tool: toolName, args });
      if (opts.callTool !== undefined) return opts.callTool(toolName, args);
      return { content: [{ type: "text", text: "contenido ok" }] };
    },
    isConnected: () => true,
    reconnect: async () => undefined,
  });

  const servers: Record<string, IMCPServer> = {
    desktop_commander: provider("desktop_commander", FILE_TOOLS),
    jarvis_terminal: provider("jarvis_terminal", TERMINAL_TOOLS),
  };

  const vault = createRefVault({ dir: vaultDir });
  const deps: EngineDeps = {
    discovery: {
      getServer: (name) => servers[name],
      getDiscoveredTools: async (name) => (name === "jarvis_terminal" ? TERMINAL_TOOLS : FILE_TOOLS),
      getUnavailableServers: () => ({}),
      validateToolExists: async () => true,
    },
    decision: {
      chooseRoute: async () => ({ action: "route", route: opts.route, probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      chooseTool: async (input) => ({
        action: "tool",
        tool: input.tools.find((t) => t.name === opts.tool) ?? input.tools[0],
        probabilities: {},
        rawInput: "",
        rawOutput: "",
        shortcut: true,
      }),
      reviewArgs: async () => {
        reviews++;
        return { review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" };
      },
      verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
      checkCompletion: async () => ({ requestComplete: 0.9, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generateArgumentsFromView: async () => ({ args: opts.args, rawInput: "", rawOutput: "", timing: { startedAt: 0, durationMs: 0 } }),
      generateQuestion: async () => ({ question: "¿cuál?", rawInput: "", rawOutput: "" }),
      generatePendingFromView: async () => ({ pending: [], rawInput: "", rawOutput: "" }),
      generatePlanFromView: async () => {
        throw new Error("no se usa");
      },
      generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
    },
    vault,
    guardScope: { protectedDirs: [path.join(vaultDir, "protegida")], relativeBases: [opts.home] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: opts.platform ?? "linux", home: opts.home }),
    autoMode: () => opts.autoMode ?? true,
    approvalTiers: () => true,
    allowedDirectories: opts.allowedDirs,
    ...(opts.analyzeCommand === undefined ? {} : { analyzeCommand: opts.analyzeCommand }),
  };

  let clock = 1_700_000_000_000;
  const ctx = create.context(
    { id: "task_6c", request: opts.request, mode: "reactive" },
    { now: () => (clock += 1000), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
  const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: opts.request, route: null, expected: null } }).ids[0];
  for (const [i, refText] of (opts.seedRefs ?? []).entries()) {
    const stored = await vault.put(ctx.task.id, refText);
    ctx.apply({ op: "add", target: "refs", value: { stepId, label: `seed_${i + 1}`, size: stored.size, where: stored.where } });
  }
  const runtime = new TaskRuntime({
    onChange: (waiting) => {
      if (waiting !== null && waiting.kind === "approval") {
        approvals.push({ reason: waiting.request.reason, canRemember: waiting.request.canRemember });
        queueMicrotask(() => {
          runtime.resolveApproval(waiting.request.id, (opts.approvalDecision ?? "reject") === "approve", "rechazado en prueba", true);
        });
      }
    },
  });

  try {
    const outcome = await runCall(createEngineEnv(ctx, runtime, deps), { stepId, route: opts.route });
    return { ctx, outcome, dispatched, approvals, reviews, calls: ctx.find("calls", {}) };
  } finally {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
}

function makeSandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-step6c-")));
  const allowedDir = path.join(root, "permitida");
  const outsideDir = path.join(root, "prohibida");
  fs.mkdirSync(path.join(allowedDir, "sub"), { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  const insideFile = path.join(allowedDir, "sub", "ok.txt");
  const outsideFile = path.join(outsideDir, "secreto.txt");
  fs.writeFileSync(insideFile, "dentro", "utf8");
  fs.writeFileSync(outsideFile, "fuera", "utf8");
  return {
    root,
    allowedDir,
    outsideDir,
    insideFile,
    outsideFile,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function trySymlink(target: string, linkPath: string, type: "file" | "dir"): boolean {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") return false;
    throw error;
  }
}

test("paso 6c: ruta de herramienta de archivos fuera de allowedDirectories se rechaza sin preguntar ni despachar", async () => {
  const sb = makeSandbox();
  try {
    const res = await runSingleCall({
      request: `Lee el archivo ${sb.outsideFile}`,
      route: "files",
      tool: "read_file",
      args: { path: sb.outsideFile },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
    });
    assert.equal(res.outcome.kind, "registered");
    assert.equal(res.calls[0].status, "tool_rejected");
    assert.match(res.calls[0].summary ?? "", /allowedDirectories/);
    assert.equal(res.approvals.length, 0);
    assert.equal(res.dispatched.length, 0);
    assert.equal(res.reviews, 0);
  } finally {
    sb.cleanup();
  }
});

test("paso 6c: ruta dentro de allowedDirectories pasa el filtro y se despacha", async () => {
  const sb = makeSandbox();
  try {
    const res = await runSingleCall({
      request: `Lee el archivo ${sb.insideFile}`,
      route: "files",
      tool: "read_file",
      args: { path: sb.insideFile },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
    });
    assert.equal(res.calls[0].status, "ok");
    assert.equal(res.approvals.length, 0);
    assert.equal(res.dispatched.length, 1);
  } finally {
    sb.cleanup();
  }
});

test("paso 6c: ruta no resoluble en herramienta de archivos exige confirmación aun en autoMode y sin 'siempre'", async () => {
  const sb = makeSandbox();
  try {
    const rejected = await runSingleCall({
      request: "Lee el archivo $env:TEMP\\notas.txt",
      route: "files",
      tool: "read_file",
      args: { path: "$env:TEMP\\notas.txt" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      autoMode: true,
      approvalDecision: "reject",
    });
    assert.equal(rejected.approvals.length, 1);
    assert.equal(rejected.approvals[0].canRemember, false);
    assert.match(rejected.approvals[0].reason, /allowedDirectories/);
    assert.equal(rejected.calls[0].status, "user_rejected");
    assert.equal(rejected.dispatched.length, 0);

    const approved = await runSingleCall({
      request: "Lee el archivo sub/ok.txt",
      route: "files",
      tool: "read_file",
      args: { path: "sub/ok.txt" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      autoMode: true,
      approvalDecision: "approve",
    });
    assert.equal(approved.approvals.length, 1);
    assert.equal(approved.approvals[0].canRemember, false);
    assert.equal(approved.calls[0].status, "ok");
    assert.equal(approved.dispatched.length, 1);
  } finally {
    sb.cleanup();
  }
});

test("paso 6c: run_command con cwd fuera de allowedDirectories (explícito o implícito vía home) se rechaza como tool_rejected", async () => {
  const sb = makeSandbox();
  try {
    const okAst = async (): Promise<CommandReport> => ({
      syntaxErrors: [],
      commands: [{ name: "Get-Date", kind: "Cmdlet", dashOptions: [] }],
      detectedPaths: [],
      unresolvablePaths: [],
    });

    const explicitCwd = await runSingleCall({
      request: `Ejecuta Get-Date en ${sb.outsideDir}`,
      route: "terminal",
      tool: "run_command",
      args: { command: "Get-Date", cwd: sb.outsideDir },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      analyzeCommand: okAst,
    });
    assert.equal(explicitCwd.calls[0].status, "tool_rejected");
    assert.match(explicitCwd.calls[0].summary ?? "", /está fuera de allowedDirectories/);
    assert.equal(explicitCwd.approvals.length, 0);
    assert.equal(explicitCwd.dispatched.length, 0);

    const implicitHomeCwd = await runSingleCall({
      request: "Ejecuta Get-Date",
      route: "terminal",
      tool: "run_command",
      args: { command: "Get-Date" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.outsideDir,
      analyzeCommand: okAst,
    });
    assert.equal(implicitHomeCwd.calls[0].status, "tool_rejected");
    assert.match(implicitHomeCwd.calls[0].summary ?? "", /carpeta de trabajo.*allowedDirectories/);
    assert.equal(implicitHomeCwd.approvals.length, 0);
    assert.equal(implicitHomeCwd.dispatched.length, 0);
  } finally {
    sb.cleanup();
  }
});

test("paso 6c: run_command con cwd permitido evalúa detectedPaths, unresolvablePaths y cmdReport null", async () => {
  const sb = makeSandbox();
  try {
    const outsideDetected = await runSingleCall({
      request: `Leer ${sb.outsideFile}`,
      route: "terminal",
      tool: "run_command",
      args: { command: `Get-Content ${sb.outsideFile}`, cwd: sb.allowedDir },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      analyzeCommand: async () => ({
        syntaxErrors: [],
        commands: [{ name: "Get-Content", kind: "Cmdlet", dashOptions: [] }],
        detectedPaths: [sb.outsideFile],
        unresolvablePaths: [],
      }),
    });
    assert.equal(outsideDetected.calls[0].status, "tool_rejected");
    assert.match(outsideDetected.calls[0].summary ?? "", /detectada en el comando.*allowedDirectories/);
    assert.equal(outsideDetected.approvals.length, 0);
    assert.equal(outsideDetected.dispatched.length, 0);

    const relativeInside = await runSingleCall({
      request: "Leer sub/ok.txt",
      route: "terminal",
      tool: "run_command",
      args: { command: "Get-Content sub/ok.txt", cwd: sb.allowedDir },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      analyzeCommand: async () => ({
        syntaxErrors: [],
        commands: [{ name: "Get-Content", kind: "Cmdlet", dashOptions: [] }],
        detectedPaths: ["sub/ok.txt"],
        unresolvablePaths: [],
      }),
    });
    assert.equal(relativeInside.calls[0].status, "ok");
    assert.equal(relativeInside.approvals.length, 0);
    assert.equal(relativeInside.dispatched.length, 1);

    const unresolvableAst = await runSingleCall({
      request: "Leer archivo con variable",
      route: "terminal",
      tool: "run_command",
      args: { command: "Get-Content $env:MY_FOLDER\\reporte.txt", cwd: sb.allowedDir },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      autoMode: true,
      approvalDecision: "reject",
      analyzeCommand: async () => ({
        syntaxErrors: [],
        commands: [{ name: "Get-Content", kind: "Cmdlet", dashOptions: [] }],
        detectedPaths: [],
        unresolvablePaths: ["$env:MY_FOLDER\\reporte.txt"],
      }),
    });
    assert.equal(unresolvableAst.approvals.length, 1);
    assert.equal(unresolvableAst.approvals[0].canRemember, false);
    assert.match(unresolvableAst.approvals[0].reason, /allowedDirectories/);
    assert.equal(unresolvableAst.calls[0].status, "user_rejected");
    assert.equal(unresolvableAst.dispatched.length, 0);

    const nullReport = await runSingleCall({
      request: "Ejecutar Get-Date sin analizador",
      route: "terminal",
      tool: "run_command",
      args: { command: "Get-Date", cwd: sb.allowedDir },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      platform: "linux",
      autoMode: true,
      approvalDecision: "reject",
    });
    assert.equal(nullReport.approvals.length, 1);
    assert.equal(nullReport.approvals[0].canRemember, false);
    assert.match(nullReport.approvals[0].reason, /No se pudieron analizar/);
    assert.equal(nullReport.calls[0].status, "user_rejected");
    assert.equal(nullReport.dispatched.length, 0);
  } finally {
    sb.cleanup();
  }
});

test("paso 6c: symlinks dentro de allowedDirectories que apuntan fuera se rechazan en archivos y en run_command", async (t) => {
  const sb = makeSandbox();
  try {
    const linkDir = path.join(sb.allowedDir, "escape-dir");
    const linkFile = path.join(sb.allowedDir, "escape-file.txt");
    if (!trySymlink(sb.outsideDir, linkDir, "dir") || !trySymlink(sb.outsideFile, linkFile, "file")) {
      t.skip("La plataforma o los permisos no permiten crear symlinks en este entorno");
      return;
    }

    const readLink = await runSingleCall({
      request: `Leer ${linkFile}`,
      route: "files",
      tool: "read_file",
      args: { path: linkFile },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
    });
    assert.equal(readLink.calls[0].status, "tool_rejected");
    assert.match(readLink.calls[0].summary ?? "", /allowedDirectories/);
    assert.equal(readLink.dispatched.length, 0);

    const newLeafInsideLinkDir = path.join(linkDir, "nuevo.txt");
    const writeThroughLink = await runSingleCall({
      request: `Escribir ${newLeafInsideLinkDir}`,
      route: "files",
      tool: "write_file",
      args: { path: newLeafInsideLinkDir, content: "hola", mode: "rewrite" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
    });
    assert.equal(writeThroughLink.calls[0].status, "tool_rejected");
    assert.match(writeThroughLink.calls[0].summary ?? "", /allowedDirectories/);
    assert.equal(writeThroughLink.dispatched.length, 0);

    const cmdCwdLink = await runSingleCall({
      request: `Ejecutar Get-Date en ${linkDir}`,
      route: "terminal",
      tool: "run_command",
      args: { command: "Get-Date", cwd: linkDir },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      analyzeCommand: async () => ({
        syntaxErrors: [],
        commands: [{ name: "Get-Date", kind: "Cmdlet", dashOptions: [] }],
        detectedPaths: [],
        unresolvablePaths: [],
      }),
    });
    assert.equal(cmdCwdLink.calls[0].status, "tool_rejected");
    assert.match(cmdCwdLink.calls[0].summary ?? "", /está fuera de allowedDirectories/);
    assert.equal(cmdCwdLink.dispatched.length, 0);

    const cmdDetectedLink = await runSingleCall({
      request: `Leer ${linkFile}`,
      route: "terminal",
      tool: "run_command",
      args: { command: `Get-Content ${linkFile}`, cwd: sb.allowedDir },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      analyzeCommand: async () => ({
        syntaxErrors: [],
        commands: [{ name: "Get-Content", kind: "Cmdlet", dashOptions: [] }],
        detectedPaths: [linkFile],
        unresolvablePaths: [],
      }),
    });
    assert.equal(cmdDetectedLink.calls[0].status, "tool_rejected");
    assert.match(cmdDetectedLink.calls[0].summary ?? "", /detectada en el comando.*allowedDirectories/);
    assert.equal(cmdDetectedLink.dispatched.length, 0);
  } finally {
    sb.cleanup();
  }
});

test("paso 6c: deps.allowedDirectories se lee en vivo entre llamadas y [] desactiva la restricción", async () => {
  const sb = makeSandbox();
  try {
    let currentDirs: string[] = [sb.allowedDir];

    const first = await runSingleCall({
      request: `Lee ${sb.outsideFile}`,
      route: "files",
      tool: "read_file",
      args: { path: sb.outsideFile },
      allowedDirs: () => currentDirs,
      home: sb.allowedDir,
    });
    assert.equal(first.calls[0].status, "tool_rejected");
    assert.equal(first.dispatched.length, 0);

    currentDirs = [sb.allowedDir, sb.outsideDir];
    const second = await runSingleCall({
      request: `Lee ${sb.outsideFile}`,
      route: "files",
      tool: "read_file",
      args: { path: sb.outsideFile },
      allowedDirs: () => currentDirs,
      home: sb.allowedDir,
    });
    assert.equal(second.calls[0].status, "ok");
    assert.equal(second.dispatched.length, 1);

    currentDirs = [];
    const unrestricted = await runSingleCall({
      request: `Lee ${sb.outsideFile}`,
      route: "files",
      tool: "read_file",
      args: { path: sb.outsideFile },
      allowedDirs: () => currentDirs,
      home: sb.allowedDir,
    });
    assert.equal(unrestricted.calls[0].status, "ok");
    assert.equal(unrestricted.dispatched.length, 1);
  } finally {
    sb.cleanup();
  }
});

test("refs en rechazos: la sustitución de {{ref:r1}} sigue llegando intacta a la herramienta", async () => {
  const sb = makeSandbox();
  try {
    const fullText = "contenido completo de la ref\nsegunda línea";
    const target = path.join(sb.allowedDir, "sub", "nuevo.txt");
    const res = await runSingleCall({
      request: `Escribir ${target}`,
      route: "files",
      tool: "write_file",
      args: { path: target, content: "{{ref:r1}}", mode: "rewrite" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      seedRefs: [fullText],
    });
    assert.equal(res.calls[0].status, "ok");
    assert.equal(res.dispatched.length, 1);
    assert.equal(res.dispatched[0].args.content, fullText);
    assert.equal((res.calls[0].args as { content?: string })?.content, "{{ref:r1}}");
  } finally {
    sb.cleanup();
  }
});

test("refs en rechazos (a): una ref con texto parecido a un mensaje legítimo solo se reemplaza si coincide entera y sin refs no recorta", async () => {
  const sb = makeSandbox();
  try {
    // 1) Ref con texto parecido (sin coincidencia completa del valor de >= 8 chars): no se sobrerredacta un mensaje corto.
    const redactor = createRefRedactor({ get: async (id) => (id === "r1" ? "allowedDirectories extra privado" : undefined) }, clipWithin);
    await redactor.lookup.get("r1");
    const shortMsg = "La ruta 'C:\\Users\\Ana\\doc.txt' está fuera de allowedDirectories.";
    assert.equal(redactor.redact(shortMsg), shortMsg);

    // 2) En mensajes > 120 chars con ref usada, el texto legítimo que pasa de 120 chars sí se recorta a <= 120.
    const withRef = await runSingleCall({
      request: `Escribir en ${sb.outsideFile}`,
      route: "files",
      tool: "write_file",
      args: { path: sb.outsideFile, content: "{{ref:r1}}", mode: "rewrite" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      seedRefs: ["allowedDirectories extra privado"],
    });
    assert.equal(withRef.calls[0].status, "tool_rejected");
    const summaryWithRef = withRef.calls[0].summary ?? "";
    assert.ok(summaryWithRef.length <= REF_DISPLAY_CAP);
    assert.match(summaryWithRef, /^Denied by the security policy; it was not performed\./);

    // 3) Si la llamada NO usó refs, el mismo mensaje largo queda intacto (> 120 chars).
    const withoutRef = await runSingleCall({
      request: `Escribir en ${sb.outsideFile}`,
      route: "files",
      tool: "write_file",
      args: { path: sb.outsideFile, content: "texto directo sin refs", mode: "rewrite" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
    });
    assert.equal(withoutRef.calls[0].status, "tool_rejected");
    assert.ok((withoutRef.calls[0].summary ?? "").length > REF_DISPLAY_CAP);
    assert.match(withoutRef.calls[0].summary ?? "", /Do not try this operation again/);
  } finally {
    sb.cleanup();
  }
});

test("refs en rechazos (b): normalización de barras y mayúsculas reemplaza por {{ref:r1}}; otro formato pasa al tope de 120", async () => {
  const sb = makeSandbox();
  try {
    const secretPath = "C:\\Users\\pedro_privado\\secreto/clave_larga.txt";
    const writeTarget = path.join(sb.allowedDir, "sub", "destino.txt");

    // 1) Diferencia de barras (/ vs \) y mayúsculas/minúsculas: se reemplaza por {{ref:r1}}.
    const redactor = createRefRedactor({ get: async (id) => (id === "r1" ? secretPath : undefined) }, clipWithin);
    await redactor.lookup.get("r1");
    assert.equal(
      redactor.redact(`La ruta '${secretPath.replace(/\\/g, "/").toUpperCase()}' falló.`),
      "La ruta '{{ref:r1}}' falló.",
    );

    // 2) Formato distinto (base64 en tool_error real): no coincide y queda truncado a <= 120 chars.
    const encodedErr = await runSingleCall({
      request: `Escribir en ${writeTarget}`,
      route: "files",
      tool: "write_file",
      args: { path: writeTarget, content: "{{ref:r1}}", mode: "rewrite" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      seedRefs: ["clave=secreta/ruta?token=" + "m".repeat(200)],
      callTool: async (_tool, args) => ({
        isError: true,
        content: [{ type: "text", text: `Error codificado: ${Buffer.from(String(args.content), "utf8").toString("base64")}` }],
      }),
    });
    assert.equal(encodedErr.calls[0].status, "tool_error");
    const errSummary = encodedErr.calls[0].summary ?? "";
    assert.ok(errSummary.length <= REF_DISPLAY_CAP);
    assert.match(errSummary, /…\(\+\d+\)$/);
  } finally {
    sb.cleanup();
  }
});

test("refs en rechazos (c): si tras reemplazar supera 120 caracteres o es formato no reconocido, ante la duda se trunca a <= 120", async () => {
  const sb = makeSandbox();
  try {
    const secret = "clave=secreta/ruta?token=" + "m".repeat(240);

    // 1) Excepción en callRunner con valor exacto: reemplaza por {{ref:r1}} y, si aún pasa de 120, corta a <= 120.
    const longPrefix = "Fallo al escribir en destino muy largo ".repeat(3);
    const thrown = await runSingleCall({
      request: `Escribir en ${path.join(sb.allowedDir, "sub", "destino.txt")}`,
      route: "files",
      tool: "write_file",
      args: { path: path.join(sb.allowedDir, "sub", "destino.txt"), content: "{{ref:r1}}", mode: "rewrite" },
      allowedDirs: () => [sb.allowedDir],
      home: sb.allowedDir,
      seedRefs: [secret],
      callTool: async (_tool, args) => {
        throw new Error(`${longPrefix}: ${String(args.content)}`);
      },
    });
    assert.equal(thrown.calls[0].status, "exception");
    assert.ok((thrown.calls[0].summary ?? "").length <= REF_DISPLAY_CAP);
    assert.doesNotMatch(thrown.calls[0].summary ?? "", /clave=secreta|mmmmmm/);

    // 2) Valor reformateado largo (URL-encoded) o prefijo parcial no reconocido: se recorta a <= 120 y descarta el resto.
    const redactor = createRefRedactor({ get: async (id) => (id === "r1" ? secret : undefined) }, clipWithin);
    await redactor.lookup.get("r1");

    const urlEncoded = `Regla custom rechazó URL-encoded: ${encodeURIComponent(secret)}`;
    const clippedUrl = redactor.redact(urlEncoded) ?? "";
    assert.ok(clippedUrl.length <= REF_DISPLAY_CAP);
    assert.match(clippedUrl, /…\(\+\d+\)$/);

    const partialLeak = `Prefijo parcial: ${secret.slice(0, 140)}`;
    const clippedPartial = redactor.redact(partialLeak) ?? "";
    assert.ok(clippedPartial.length <= REF_DISPLAY_CAP);
    assert.match(clippedPartial, /…\(\+\d+\)$/);
    assert.doesNotMatch(clippedPartial, /m{100}/);
  } finally {
    sb.cleanup();
  }
});


