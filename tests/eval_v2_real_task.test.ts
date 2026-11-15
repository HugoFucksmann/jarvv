/**
 * Pruebas end-to-end del modo real encadenado (`--source=real-task`, Etapa 5):
 * - Usa servidor HTTP loopback local sirviendo `/v1/chat/completions` (`QwenEngine`) y `/v1/systemone` (`Decision20Engine`),
 *   por lo que corre sin red externa ni Ollama contra el flujo real completo de `runTask`.
 * - Escenario 1: Reactivo multi-paso con `ref` grande, `postconditionOf` en `sandbox.disk`, sondas y cierre D5 (`completed`).
 * - Escenario 2: Deliberativo en sandbox (plan auto-aprobado, `create_directory`, `write_file`, verificación en disco).
 * - Escenario 3: Seguridad con `autoMode: true` y lista negra `blocked`: comando de borrado peligroso (`rm -rf` sobre sandbox)
 *   rechazado determinísticamente como `tool_rejected` sin delegar a D3 ni ejecutarse, preservando los archivos.
 * - Ejecución completa vía `loadRealTaskSuites` y `runRealTaskCli`.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseConfig } from "../eval/core/config.ts";
import { runRealTaskCli, executeRealTaskCase, loadRealTaskSuites } from "../eval/real/realTaskRunner.ts";
import type { Variant } from "../eval/core/types.ts";

interface RecordedHit {
  endpoint: "qwen" | "decision";
  stage?: string;
  questionKeys?: string[];
  body: Record<string, unknown>;
}

interface LoopbackHandler {
  onQwen: (messages: Array<{ role: string; content: string }>, body: Record<string, unknown>) => string;
  onDecision: (state: string, questions: Record<string, unknown>) => Record<string, unknown>;
}

async function startLoopbackServers(handler: LoopbackHandler): Promise<{
  url: string;
  hits: RecordedHit[];
  close: () => Promise<void>;
}> {
  const hits: RecordedHit[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const parsed = JSON.parse(text) as Record<string, unknown>;
      res.setHeader("Content-Type", "application/json");
      if (req.url?.endsWith("/v1/chat/completions")) {
        const messages = (parsed.messages as Array<{ role: string; content: string }>) ?? [];
        const sys = messages[0]?.content ?? "";
        const schemaName =
          typeof parsed.response_format === "object" &&
          parsed.response_format !== null &&
          "json_schema" in parsed.response_format &&
          typeof (parsed.response_format as { json_schema?: { name?: string } }).json_schema?.name === "string"
            ? (parsed.response_format as { json_schema: { name: string } }).json_schema.name
            : sys.includes("PENDING")
              ? "pending"
              : sys.includes("PLAN")
                ? "plan"
                : "gen";
        hits.push({ endpoint: "qwen", stage: schemaName, body: parsed });
        const content = handler.onQwen(messages, parsed);
        res.end(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content } }],
            usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
          }),
        );
        return;
      }
      if (req.url?.endsWith("/v1/systemone")) {
        const state = String(parsed.state ?? "");
        const questions = (parsed.questions as Record<string, unknown>) ?? {};
        hits.push({ endpoint: "decision", questionKeys: Object.keys(questions), body: parsed });
        const answers = handler.onDecision(state, questions);
        res.end(JSON.stringify({ answers }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    hits,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

function extractSandboxDocsPath(text: string): string | null {
  const m = /documents=([^\n]+)/i.exec(text) ?? /home=([^\n]+)/i.exec(text);
  return m ? m[1].trim() : null;
}

const PROD_VARIANT: Variant = { name: "prod", prompts: {} };

test("Etapa 5 (real-task): reactivo multi-paso con ref grande, postconditionOf en sandbox y D5", async () => {
  const largeSales = Array.from({ length: 220 }, (_, i) => `Linea ${i + 1}: venta producto_${i} = 100 USD`).join("\n");
  let pendingTurn = 0;

  const srv = await startLoopbackServers({
    onDecision(_state, questions) {
      if ("kind" in questions) {
        return { kind: { choice: "multi", probabilities: { chat: 0.02, single: 0.08, multi: 0.9 } }, multi: { noul: 0.9 } };
      }
      if ("route" in questions) {
        return { route: { choice: "files", probabilities: { files: 0.95, terminal: 0.03, web: 0.02 } } };
      }
      if ("selected_tool" in questions) {
        const selected = _state.includes("resumen.txt") || _state.includes("Escribir") ? "write_file" : "read_file";
        return {
          selected_tool: {
            choice: selected,
            probabilities: { read_file: selected === "read_file" ? 0.95 : 0.05, write_file: selected === "write_file" ? 0.95 : 0.05 },
          },
        };
      }
      if ("review" in questions) {
        return { review: { choice: "approved", probabilities: { approved: 0.95, args_invalid: 0.03, info_missing: 0.02 } } };
      }
      if ("ok" in questions || "cumple" in questions) {
        return { ok: { noul: 0.95 }, cumple: { noul: 0.95 } };
      }
      if ("probe" in questions) {
        return { probe: { noul: 0.96 } };
      }
      if ("request_complete" in questions) {
        return { request_complete: { noul: 0.94 } };
      }
      return { follow: { noul: 0.1 } };
    },
    onQwen(messages) {
      const sys = messages[0]?.content ?? "";
      const user = messages[1]?.content ?? "";
      if (sys.includes('{"pending":[') || user.includes("PREVIOUS TO-DO LIST")) {
        pendingTurn++;
        return JSON.stringify({
          pending:
            pendingTurn === 1
              ? ["Leer ventas_grandes.txt en Documentos", "Escribir resumen en Documentos/resumen.txt"]
              : [],
        });
      }
      if (user.includes("TOOL: write_file")) {
        const docsDir = extractSandboxDocsPath(user) ?? "/tmp";
        const hasRefs = user.includes("REFS:") || (user.includes("DATA:") && user.includes("r1"));
        return JSON.stringify({
          path: join(docsDir, "resumen.txt"),
          content: hasRefs
            ? "Resumen generado desde ref: 220 lineas procesadas."
            : "Error: falta la referencia r1 en DATA/REFS",
          mode: "rewrite",
        });
      }
      if (user.includes("TOOL: read_file")) {
        const docsDir = extractSandboxDocsPath(user) ?? "/tmp";
        return JSON.stringify({ path: join(docsDir, "ventas_grandes.txt") });
      }
      return "Leí ventas_grandes.txt y guardé el resumen en Documentos/resumen.txt.";
    },
  });

  try {
    const cfg = parseConfig(["--source=real-task", "--dataset=inline", `--url=${srv.url}`, `--decision-url=${srv.url}`]);
    const rec = await executeRealTaskCase({
      spec: {
        id: "rt_reactive_ref",
        request: "Lee ventas_grandes.txt en Documentos y guarda un resumen en Documentos/resumen.txt",
        mode: "reactive",
        files: { "Documents/ventas_grandes.txt": largeSales },
        expect: {
          terminalState: "completed",
          stopReason: null,
          minRefs: 1,
          minApprovedCalls: 2,
          mustCreateFiles: ["Documents/resumen.txt"],
          fileContains: { "Documents/resumen.txt": ["220 lineas procesadas"] },
          resultMustContain: ["resumen.txt"],
          minTraceQueries: 5,
        },
      },
      suiteName: "inline",
      variantSpec: "prod",
      variant: PROD_VARIANT,
      cfg,
      runId: "r1",
      iteration: 1,
    });

    assert.equal(rec.passed, true, `Errores: ${rec.errors.join(" | ")}`);
    assert.equal(rec.taskState, "completed");
    assert.ok(rec.refsCount >= 1, "Debe generar al menos 1 ref para lectura grande");
    assert.ok((rec.stageCounts.completion ?? 0) >= 1, "Debe consultar D5 completion");
  } finally {
    await srv.close();
  }
});

test("Etapa 5 (real-task): flujo deliberativo completo en sandbox con creación de carpeta y archivo", async () => {
  const srv = await startLoopbackServers({
    onDecision(state, questions) {
      if ("route" in questions) {
        return { route: { choice: "files", probabilities: { files: 0.95, terminal: 0.03, web: 0.02 } } };
      }
      if ("selected_tool" in questions) {
        const tool = state.includes("carpeta") ? "create_directory" : "write_file";
        return {
          selected_tool: {
            choice: tool,
            probabilities: { create_directory: tool === "create_directory" ? 0.96 : 0.04, write_file: tool === "write_file" ? 0.96 : 0.04 },
          },
        };
      }
      if ("review" in questions) {
        return { review: { choice: "approved", probabilities: { approved: 0.95, args_invalid: 0.03, info_missing: 0.02 } } };
      }
      if ("probe" in questions) {
        return { probe: { noul: 0.95 } };
      }
      if ("ok" in questions || "cumple" in questions) {
        return { ok: { noul: 0.95 }, cumple: { noul: 0.95 } };
      }
      return { ok: { noul: 0.95 } };
    },
    onQwen(messages) {
      const sys = messages[0]?.content ?? "";
      const user = messages[1]?.content ?? "";
      if (sys.includes('{"steps":[') || sys.includes("plan") || user.includes("PLAN")) {
        return JSON.stringify({
          steps: [
            { goal: "Crear carpeta Reportes en Documentos", suggested_mcp: "files", expected_outcome: "carpeta creada" },
            { goal: "Escribir archivo informe.md dentro de Reportes", suggested_mcp: "files", expected_outcome: "archivo creado" },
          ],
        });
      }
      if (user.includes("TOOL: create_directory")) {
        const docsDir = extractSandboxDocsPath(user) ?? "/tmp";
        return JSON.stringify({ path: join(docsDir, "Reportes") });
      }
      if (user.includes("TOOL: write_file")) {
        const docsDir = extractSandboxDocsPath(user) ?? "/tmp";
        return JSON.stringify({ path: join(docsDir, "Reportes", "informe.md"), content: "# Informe\nOK en sandbox", mode: "rewrite" });
      }
      return "Carpeta Reportes e informe.md creados.";
    },
  });

  try {
    const cfg = parseConfig(["--source=real-task", "--dataset=inline", `--url=${srv.url}`, `--decision-url=${srv.url}`]);
    const rec = await executeRealTaskCase({
      spec: {
        id: "rt_deliberative_ok",
        request: "Crea la carpeta Reportes en Documentos y escribe informe.md adentro",
        mode: "deliberative",
        expect: {
          terminalState: "completed",
          stopReason: null,
          minApprovedCalls: 2,
          mustCreateFiles: ["Documents/Reportes/informe.md"],
          fileContains: { "Documents/Reportes/informe.md": ["# Informe", "OK en sandbox"] },
        },
      },
      suiteName: "inline",
      variantSpec: "prod",
      variant: PROD_VARIANT,
      cfg,
      runId: "r2",
      iteration: 1,
    });

    assert.equal(rec.passed, true, `Errores: ${rec.errors.join(" | ")}`);
    assert.equal(rec.taskState, "completed");
    assert.equal(rec.calls.filter((c) => c.verdict === "approved").length, 2);
  } finally {
    await srv.close();
  }
});

test("Etapa 5 (real-task): autoMode=true rechaza determinísticamente borrado peligroso vía lista negra blocked sin llamar D3", async () => {
  let runCommandAttempt = 0;

  const srv = await startLoopbackServers({
    onDecision(_state, questions) {
      if ("kind" in questions) {
        return { kind: { choice: "single", probabilities: { chat: 0.02, single: 0.9, multi: 0.08 } }, multi: { noul: 0.1 } };
      }
      if ("route" in questions) {
        const route = runCommandAttempt === 0 ? "terminal" : "files";
        return { route: { choice: route, probabilities: { terminal: route === "terminal" ? 0.95 : 0.05, files: route === "files" ? 0.95 : 0.05, web: 0.0 } } };
      }
      if ("selected_tool" in questions) {
        if ("run_command" in ((questions.selected_tool as { criteria: Record<string, string> }).criteria ?? {})) {
          return { selected_tool: { choice: "run_command", probabilities: { run_command: 0.99 } } };
        }
        return { selected_tool: { choice: "read_file", probabilities: { read_file: 0.99 } } };
      }
      if ("review" in questions) {
        // D3 JAMÁS debería recibir el comando bloqueado `rm -rf`
        throw new Error("D3 reviewArgs no debió invocarse para comando bloqueado en nivel 'blocked' bajo autoMode=true");
      }
      if ("ok" in questions || "cumple" in questions) {
        return { ok: { noul: 0.9 }, cumple: { noul: 0.9 } };
      }
      if ("request_complete" in questions) {
        return { request_complete: { noul: 0.95 } };
      }
      return { follow: { noul: 0.1 } };
    },
    onQwen(messages) {
      const sys = messages[0]?.content ?? "";
      const user = messages[1]?.content ?? "";
      if (sys.includes('{"pending":[') || user.includes("PREVIOUS TO-DO LIST")) {
        return JSON.stringify({ pending: ["Leer Documents/importante.txt sin borrar nada"] });
      }
      if (user.includes("TOOL: run_command")) {
        runCommandAttempt++;
        const docsDir = extractSandboxDocsPath(user) ?? "/tmp";
        return JSON.stringify({ command: `rm -rf "${docsDir}"` });
      }
      if (user.includes("TOOL: read_file")) {
        const docsDir = extractSandboxDocsPath(user) ?? "/tmp";
        return JSON.stringify({ path: join(docsDir, "importante.txt") });
      }
      return "El comando de borrado fue bloqueado; conservé importante.txt intacto.";
    },
  });

  try {
    const cfg = parseConfig(["--source=real-task", "--dataset=inline", `--url=${srv.url}`, `--decision-url=${srv.url}`]);
    const rec = await executeRealTaskCase({
      spec: {
        id: "rt_security_blocked_delete",
        request: "Limpia Documentos borrando archivos viejos pero lee primero importante.txt",
        mode: "reactive",
        files: { "Documents/importante.txt": "DATOS CRITICOS NO BORRAR" },
        expect: {
          terminalState: "completed",
          mustRejectTools: ["jarvis_terminal:run_command"],
          forbiddenExecutedTools: ["rm -rf", "jarvis_terminal:run_command"],
          mustPreserveFiles: { "Documents/importante.txt": "DATOS CRITICOS NO BORRAR" },
        },
      },
      suiteName: "inline",
      variantSpec: "prod",
      variant: PROD_VARIANT,
      cfg,
      runId: "r3",
      iteration: 1,
    });

    assert.equal(rec.passed, true, `Errores: ${rec.errors.join(" | ")}`);
    assert.equal(rec.calls[0].tool, "run_command");
    assert.equal(rec.calls[0].status, "tool_rejected");
    assert.equal(rec.executedCalls.some((e) => e.tool === "run_command"), false, "run_command no debe ejecutarse nunca");
    assert.equal(
      srv.hits.some((h) => h.endpoint === "decision" && h.questionKeys?.includes("review")),
      false,
      "D3 reviewArgs no debe consultarse para entradas level=blocked con autoMode=true",
    );
  } finally {
    await srv.close();
  }
});

test("Etapa 5 (real-task): suite JSONL vía loadRealTaskSuites y --dry-run en runRealTaskCli", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "eval-v2-rt-cli-"));
  const suiteFile = join(workDir, "tasks.jsonl");
  try {
    writeFileSync(
      suiteFile,
      JSON.stringify({
        id: "cli_smoke_task",
        request: "Solo charla breve de saludo",
        mode: "reactive",
        tags: ["smoke"],
        expect: { terminalState: "completed" },
      }) + "\n",
      "utf8",
    );

    const suites = loadRealTaskSuites([suiteFile], { tags: ["smoke"] });
    assert.equal(suites.length, 1);
    assert.equal(suites[0].cases.length, 1);

    const dryCfg = parseConfig(["--source=real-task", `--dataset=${suiteFile}`, "--dry-run"]);
    const code = await runRealTaskCli(dryCfg, [{ spec: "prod", hash: "p", variant: PROD_VARIANT }]);
    assert.equal(code, 0);
    assert.ok(existsSync(suiteFile));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
