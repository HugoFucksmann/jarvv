/**
 * Foto del texto que ve cada modelo: vistas + renderizadores + adaptadores de Decisión, sobre contextos fijos.
 * Un cambio en cualquier prompt cambia esta foto; si es intencional, se regenera con `UPDATE_GOLDEN=1 npm test`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BUDGET } from "../src/core/budget.ts";
import type { TaskMode } from "../src/core/ctx/index.ts";
import {
  argsInput,
  askRenderOptions,
  finalRenderOptions,
  finalViewOptions,
  pendingInput,
  planInput,
  renderArgsView,
  reviewInput,
  reviewViewOptions,
  routeInput,
  routeViewOptions,
  toolInput,
  verifyInput,
  windowOptions,
} from "../src/core/engine/adapters.ts";
import { renderAsk, renderFallback, renderFinal, renderStatusNote } from "../src/core/render/index.ts";
import type { MCPTool } from "../src/core/types.ts";
import { buildContext } from "./fixtures.ts";

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "__golden__", "render.json");

const tool: MCPTool = {
  name: "write_file",
  description: "Write or append to a file.",
  inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, mode: { type: "string" } }, required: ["path", "content"] },
};

function capture(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const mode of ["reactive", "deliberative"] as TaskMode[]) {
    const ctx = buildContext(mode, "running");
    const k = (name: string): string => `${mode}/running/${name}`;
    out[k("args")] = renderArgsView(ctx, "write_file");
    out[k("argsLastError")] = renderArgsView(ctx, "start_process");
    out[k("argsInput")] = argsInput(tool, { platform: "windows", home: "C:\\Users\\Ana" }, renderArgsView(ctx, "write_file").text, 1);
    out[k("routeInput")] = routeInput(ctx.view.forRoute(routeViewOptions()), { routes: ["files", "terminal"] });
    out[k("toolInput")] = toolInput(ctx.view.forRoute(routeViewOptions("files")), "files", [tool]);
    out[k("reviewInput")] = reviewInput(ctx.view.forReview(reviewViewOptions()), "files", tool, { path: "C:\\x\\resumen.txt", content: "hola", mode: "rewrite" });
    const verifyId = ctx.find("calls", { tool: "list_directory" }).at(-1)!.id;
    out[k("verifyInput")] = verifyInput(ctx.view.forVerify(verifyId));
    out[k("ask")] = renderAsk(ctx.view.forAsk(), askRenderOptions());
    if (mode === "reactive") out[k("pending")] = pendingInput(ctx, ["Guardar el resumen en resumen.txt", "Abrir el archivo"]);

    if (mode === "deliberative") {
      out[`${mode}/step_failed/plan`] = planInput(buildContext(mode, "step_failed"), null);
      out[`${mode}/running/plan`] = planInput(ctx, "agregá un paso para verificar", "user_feedback");
    }

    const closed = buildContext(mode, "closed");
    out[`${mode}/closed/final`] = renderFinal(closed.view.forFinal(finalViewOptions()), finalRenderOptions());
    const fallback = closed.view.forFallback(windowOptions());
    out[`${mode}/closed/fallback`] = renderFallback(fallback);
    out[`${mode}/closed/statusNote`] = renderStatusNote(fallback, ["Guardar el resumen en resumen.txt"]);
  }
  out["caps"] = BUDGET.caps;
  return out;
}

test("el texto de los prompts no cambia (foto dorada)", () => {
  const actual = JSON.parse(JSON.stringify(capture())) as Record<string, unknown>;
  if (process.env.UPDATE_GOLDEN === "1" || !fs.existsSync(GOLDEN)) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + "\n", "utf-8");
    return;
  }
  const expected = JSON.parse(fs.readFileSync(GOLDEN, "utf-8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], `cambió: ${key}`);
});
