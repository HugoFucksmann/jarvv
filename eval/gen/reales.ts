/**
 * eval/gen/reales.ts — Casos `args_review` reales: reconstruye cada revisión de D3 de `jarvis-traces.jsonl` como un escenario.
 *
 * Uso: npx tsx eval/gen/reales.ts [traza=jarvis-traces.jsonl] → escribe eval/datasets/reales_args_review.jsonl
 *
 * ⚠ NO EJECUTAR sobre el `jarvis-traces.jsonl` actual: ese archivo se sobrescribe con cada tarea (hoy trae una sola) y esto pisaría
 * `reales_args_review.jsonl` (hoy con los 36 casos, en forma de casos fijos) con muy pocos casos. Sirve solo como referencia de cómo se
 * etiquetaron; para regenerar hay que partir de una copia de las trazas originales.
 *
 * Cada revisión de la traza (una por llamada candidata revisada) se vuelve un caso: pedido, pasos hasta el actual, llamadas
 * anteriores con sus resultados y la candidata con su schema real. La etiqueta esperada la fijó una persona mirando cada
 * llamada (no D3, no el pre-chequeo): `args_invalid` si el comando o los valores eran inválidos, `approved` si eran correctos.
 * Un comando de PowerShell cuenta como inválido si el parser oficial lo rechaza (criterio objetivo).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { analyzePowerShell } from "../../src/core/engine/precheck.ts";

interface TraceCall {
  id: string;
  stepId: string;
  route: string;
  tool: string;
  kind: "read" | "write";
  args: Record<string, unknown> | null;
  status: string;
  verdict: string | null;
  reason: string | null;
  summary: string | null;
  ref: string | null;
}
interface TraceStep {
  id: string;
  instruction: string | null;
  state: string;
}
interface Trace {
  snapshot: { task: { request: string }; steps: TraceStep[]; calls: TraceCall[]; refs: { id: string; label: string; size: number; where: string }[] };
  models: Record<string, { stage: string; input: unknown }>;
}

const NOT_REVIEWED = new Set(["loop_blocked", "refs_unresolved", "denied"]);

/** URLs que sí salían de los resultados de la búsqueda; las demás de la traza eran inventadas. */
const GOOD_URLS = ["swen.ia.br/ranking/melhores-llms-2026", "openai.com/es-es/index/gpt-6-astra", "lisdatasolutions.com/es/blog/modelos-chatgpt-comparativa"];

async function judge(c: TraceCall): Promise<{ label: "approved" | "args_invalid"; tags: string[] }> {
  const args = c.args ?? {};
  if (c.tool === "start_process") {
    const cmd = String(args.command ?? "");
    if (/\bps aux\b|^\s*top\b|\bhead\b|\bfree\b|\bgrep\b/.test(cmd)) {
      // `head` y `grep` existen en una PC con Git para Windows en el PATH: ahí correrían. Se etiquetan igual (inválidos en un Windows común) y se marcan.
      return { label: "args_invalid", tags: ["linux_en_windows", ...(/\b(head|grep)\b/.test(cmd) ? ["depende_del_path"] : [])] };
    }
    if (/\/SO\b/.test(cmd)) return { label: "args_invalid", tags: ["opcion_invalida"] };
    const shell = typeof args.shell === "string" ? args.shell : "powershell";
    if (shell === "powershell" || shell === "pwsh") {
      const report = await analyzePowerShell(cmd);
      if (report !== null && report.syntaxErrors.length > 0) return { label: "args_invalid", tags: ["sintaxis_powershell"] };
    }
    return { label: "approved", tags: ["control", "comando_valido"] };
  }
  if (c.tool === "read_file") return { label: "args_invalid", tags: ["ruta_inventada"] };
  if (c.tool === "fetch" || c.tool === "fetch_batch") {
    const urls = (c.tool === "fetch" ? [args.url] : (args.urls as unknown[]) ?? []).map((u) => String(u).toLowerCase().replace(/^https?:\/\/(www\.)?/, ""));
    const bad = urls.some((u) => !GOOD_URLS.some((g) => u.startsWith(g)));
    return bad ? { label: "args_invalid", tags: ["url_inventada"] } : { label: "approved", tags: ["control", "url_de_resultados"] };
  }
  return { label: "approved", tags: ["control", c.tool] };
}

async function main(): Promise<void> {
  const file = process.argv[2] ?? "jarvis-traces.jsonl";
  const traces = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Trace);
  const out: string[] = [
    "# Casos reales de args_review reconstruidos de jarvis-traces.jsonl (generado por eval/gen/reales.ts; no editar a mano).",
    "# La etiqueta la fijó una persona mirando cada llamada candidata; el pedido, los pasos y las llamadas previas son los reales.",
  ];
  const seen = new Set<string>();
  let skipped = 0;

  for (let ti = 0; ti < traces.length; ti++) {
    const t = traces[ti];
    const reviews = Object.values(t.models).filter((m) => m.stage === "review");
    const calls = t.snapshot.calls;
    const reviewed = calls.filter((c) => !NOT_REVIEWED.has(c.status) && !(c.status === "args_invalid" && c.args === null));
    if (reviews.length !== reviewed.length) {
      skipped++;
      console.warn(`⚠ traza ${ti}: ${reviews.length} revisiones y ${reviewed.length} llamadas revisadas; se omite.`);
      continue;
    }
    for (let k = 0; k < reviewed.length; k++) {
      const cand = reviewed[k];
      if (cand.args === null) continue;
      const key = `${ti}|${cand.stepId}|${cand.tool}|${JSON.stringify(cand.args)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const stepIds = t.snapshot.steps.map((s) => s.id);
      const upTo = stepIds.indexOf(cand.stepId);
      const steps = t.snapshot.steps.slice(0, upTo + 1).map((s, i) => ({
        state: i === upTo ? "running" : s.state === "failed" ? "failed" : "completed",
        ...(s.instruction ? { instruction: s.instruction } : {}),
      }));
      const before = calls.slice(0, calls.indexOf(cand));
      const scCalls = before.map((c) => {
        const ref = c.ref === null ? undefined : t.snapshot.refs.find((r) => r.id === c.ref);
        return {
          route: c.route,
          tool: c.tool,
          kind: c.kind,
          status: c.status,
          step: stepIds.indexOf(c.stepId),
          args: c.args,
          ...(c.summary !== null ? { summary: c.summary } : {}),
          ...(c.verdict !== null ? { verdict: c.verdict } : {}),
          ...(c.reason !== null ? { reason: c.reason } : {}),
          ...(ref !== undefined ? { ref: { label: ref.label, size: ref.size, where: ref.where } } : {}),
        };
      });
      const reviewInput = reviews[k].input as { state?: string } | string | null;
      const state = typeof reviewInput === "string" ? (JSON.parse(reviewInput) as { state: string }).state : reviewInput?.state ?? "";
      const schemaText = /Tool schema: (.*)/.exec(state)?.[1];
      let inputSchema: unknown;
      try {
        inputSchema = schemaText ? JSON.parse(schemaText) : undefined;
      } catch {
        inputSchema = undefined;
      }

      const { label, tags } = await judge(cand);
      const id = `real-t${ti}-c${k}-${cand.tool}`;
      out.push(
        JSON.stringify({
          id,
          stage: "args_review",
          tags: ["escenario", "args_review", "traza", ...tags],
          description: `Traza real ${ti}, llamada ${k + 1}: ${cand.tool} ${JSON.stringify(cand.args).slice(0, 90)}`,
          scenario: {
            mode: "reactive",
            request: t.snapshot.task.request,
            steps,
            ...(scCalls.length > 0 ? { calls: scCalls } : {}),
            at: { route: cand.route, tool: cand.tool, ...(inputSchema ? { inputSchema } : {}), args: cand.args },
          },
          expect: { expectedReview: label },
        }),
      );
    }
  }
  writeFileSync("eval/datasets/reales_args_review.jsonl", `${out.join("\n")}\n`);
  console.log(`${out.length - 2} casos escritos (${skipped} trazas omitidas) → eval/datasets/reales_args_review.jsonl`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
