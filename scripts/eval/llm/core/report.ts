import type {
    LlmEvalStage,
    LlmRunRecord,
    LlmScoresSummary,
    LlmStageSummary,
    LlmThinkingSummary,
    LlmRunSettings,
} from "./types.ts";

export const STAGES: LlmEvalStage[] = ["plan", "replan", "arguments", "final_response"];

/** Datos de la corrida que no viven en `settings` pero se muestran en el resumen. */
export interface ReportMeta {
    datasetFile: string;
    promptsLabel: string;
    stageFilter: string;
}

const SOFT_SUFFIX = " (soft)";
const MAX_ERROR_CHARS = 200;

// ------------------------------------------------------------
// Agregación (todo se deriva de los registros: scores.json y summary.md no pueden divergir de runs.jsonl)
// ------------------------------------------------------------

const executedOf = (recs: LlmRunRecord[]): LlmRunRecord[] => recs.filter((r) => r.status !== "error");

const mean = (values: number[]): number =>
    values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

function summarizeStage(recs: LlmRunRecord[]): LlmStageSummary {
    const executed = executedOf(recs);
    const passed = recs.filter((r) => r.status === "pass").length;

    const metrics: Record<string, { pass: number; total: number }> = {};
    for (const r of executed) {
        const soft = new Set(r.soft_metrics ?? []);
        for (const [name, ok] of Object.entries(r.metrics)) {
            const m = (metrics[soft.has(name) ? `${name}${SOFT_SUFFIX}` : name] ??= { pass: 0, total: 0 });
            m.total++;
            if (ok) m.pass++;
        }
    }

    return {
        total: recs.length,
        passed,
        pass_rate: recs.length > 0 ? Number((passed / recs.length).toFixed(3)) : 0,
        errors: recs.length - executed.length,
        truncated: executed.filter((r) => r.finish_reason === "length").length,
        avg_latency_ms: mean(executed.map((r) => r.latency_ms)),
        metrics_breakdown: metrics,
    };
}

function summarizeThinking(recs: LlmRunRecord[]): LlmThinkingSummary {
    return {
        ...summarizeStage(recs),
        avg_completion_tokens: mean(executedOf(recs).map((r) => r.completion_tokens ?? 0)),
    };
}

export function summarizeRuns(records: LlmRunRecord[], settings: LlmRunSettings): LlmScoresSummary {
    const executed = executedOf(records);
    const passed = records.filter((r) => r.status === "pass").length;

    const finishReasons: Record<string, number> = {};
    for (const r of executed) {
        if (r.finish_reason) finishReasons[r.finish_reason] = (finishReasons[r.finish_reason] ?? 0) + 1;
    }

    const byStage: LlmScoresSummary["by_stage"] = {};
    const thinkingComparison: LlmScoresSummary["thinking_comparison"] = {};
    for (const stage of STAGES) {
        const recs = records.filter((r) => r.stage === stage);
        if (recs.length === 0) continue;
        byStage[stage] = summarizeStage(recs);

        const off = recs.filter((r) => !r.thinking);
        const on = recs.filter((r) => r.thinking);
        if (off.length > 0 && on.length > 0) {
            thinkingComparison[stage] = { off: summarizeThinking(off), on: summarizeThinking(on) };
        }
    }

    return {
        total: records.length,
        passed,
        failed: records.filter((r) => r.status === "fail").length,
        errors: records.length - executed.length,
        pass_rate: records.length > 0 ? Number((passed / records.length).toFixed(3)) : 0,
        avg_latency_ms: mean(executed.map((r) => r.latency_ms)),
        finish_reasons: finishReasons,
        settings,
        by_stage: byStage,
        thinking_comparison: thinkingComparison,
    };
}

// ------------------------------------------------------------
// Utilidades de formato
// ------------------------------------------------------------

const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;
const ratio = (passed: number, total: number): string => `${passed}/${total} (${total > 0 ? pct(passed / total) : "n/d"})`;
const thinkingLabel = (thinking: boolean): string => (thinking ? "on" : "off");
const mdCell = (v: unknown): string => String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function mdTable(headers: string[], rows: unknown[][]): string[] {
    return [
        `| ${headers.map(mdCell).join(" | ")} |`,
        `|${headers.map(() => "---").join("|")}|`,
        ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`),
    ];
}

function clip(text: string, max: number): string {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const maxTokensLabel = (s: LlmRunSettings): string =>
    STAGES.map((st) => `${st}=${s.max_tokens[st]}`).join(", ");

/** Pares off/on de una etapa, por caso (solo casos que corrieron en ambos modos). */
function thinkingPairs(records: LlmRunRecord[], stage: LlmEvalStage) {
    const byCase = new Map<string, { off?: LlmRunRecord; on?: LlmRunRecord }>();
    for (const r of records) {
        if (r.stage !== stage) continue;
        const pair = byCase.get(r.case_id) ?? {};
        pair[r.thinking ? "on" : "off"] = r;
        byCase.set(r.case_id, pair);
    }
    return [...byCase]
        .filter((entry): entry is [string, { off: LlmRunRecord; on: LlmRunRecord }] => !!entry[1].off && !!entry[1].on)
        .map(([caseId, pair]) => ({ caseId, ...pair }));
}

const outcomeLabel = (r: LlmRunRecord): string => `${r.status.toUpperCase()} (${r.latency_ms}ms)`;

/** Checks ordenados: primero los que hacen fallar, luego los soft. */
function sortedChecks(breakdown: LlmStageSummary["metrics_breakdown"]): [string, { pass: number; total: number }][] {
    const isSoft = (name: string) => name.endsWith(SOFT_SUFFIX);
    return Object.entries(breakdown).sort(([a], [b]) => Number(isSoft(a)) - Number(isSoft(b)) || a.localeCompare(b));
}

// ------------------------------------------------------------
// summary.md
// ------------------------------------------------------------

export function renderSummaryMd(summary: LlmScoresSummary, records: LlmRunRecord[], meta: ReportMeta): string {
    const s = summary.settings;
    const cases = new Set(records.map((r) => r.case_id)).size;
    const L: string[] = [];

    L.push("# Resumen de Evaluación — LLM", "");
    L.push(`- **Modelo:** \`${s.model}\``);
    L.push(`- **Dataset:** \`${s.dataset ?? "n/d"}\` (${meta.datasetFile})`);
    L.push(`- **Prompts:** \`${meta.promptsLabel}\``);
    if (s.tag) L.push(`- **Tag:** \`${s.tag}\``);
    L.push(`- **Filtro de Etapa:** \`${meta.stageFilter}\``);
    L.push(`- **Endpoint:** \`${s.url}\``);
    L.push(`- **Contexto:** \`${s.num_ctx}\` tokens`);
    L.push(`- **Timeouts:** \`${s.timeout_ms}ms\` (sin thinking) / \`${s.thinking_timeout_ms}ms\` (thinking)`);
    L.push(`- **Max tokens:** \`${maxTokensLabel(s)}\``);
    L.push(`- **Final thinking:** \`${s.final_thinking}\``);
    L.push("");

    L.push("## Métricas Globales", "");
    L.push(
        ...mdTable(
            ["Métrica", "Valor"],
            [
                ["**Casos**", cases],
                ["**Ejecuciones** (caso × modo thinking)", summary.total],
                ["**Aprobadas (PASS)**", `${summary.passed} (${pct(summary.pass_rate)})`],
                ["**Falladas (FAIL)**", summary.failed],
                ["**Errores de ejecución**", summary.errors],
                ["**Latencia Promedio** (sin errores)", `${summary.avg_latency_ms} ms`],
                ["**Finish Reasons**", `\`${JSON.stringify(summary.finish_reasons)}\``],
            ]
        )
    );
    L.push("");

    L.push("## Desglose por Etapa", "");
    L.push(
        ...mdTable(
            ["Etapa", "Aprobadas / Total", "Pass Rate", "Errores", "Truncadas", "Latencia Promedio"],
            Object.entries(summary.by_stage).map(([stage, d]) => [
                `**${stage.toUpperCase()}**`,
                `${d.passed}/${d.total}`,
                pct(d.pass_rate),
                d.errors,
                d.truncated,
                `${d.avg_latency_ms} ms`,
            ])
        )
    );
    L.push("");

    L.push("## Checks por Etapa", "");
    L.push(
        "Cada fila cuenta las ejecuciones donde se evaluó el check. Si una salida se trunca o falla por excepción el evaluador no registra los demás checks, por eso el total puede ser menor al de la etapa. `(soft)` = se registra pero no afecta pass/fail.",
        ""
    );
    for (const [stage, d] of Object.entries(summary.by_stage)) {
        L.push(`### ${stage.toUpperCase()}`, "");
        const checks = sortedChecks(d.metrics_breakdown);
        if (checks.length === 0) {
            L.push("Sin checks evaluados (todas las ejecuciones fallaron por excepción).");
        } else {
            L.push(...mdTable(["Check", "Aprobados / Evaluados"], checks.map(([name, m]) => [name, ratio(m.pass, m.total)])));
        }
        L.push("");
    }

    if (Object.keys(summary.thinking_comparison).length > 0) {
        L.push("## Comparación Thinking (On vs Off)", "");
        for (const [stage, cmp] of Object.entries(summary.thinking_comparison)) {
            L.push(`### Etapa: ${stage.toUpperCase()}`, "");
            L.push(
                ...mdTable(
                    ["Modo", "Aprobadas / Total", "Pass Rate", "Errores", "Latencia Avg", "Tokens Out Avg"],
                    [
                        ["Sin thinking", `${cmp.off.passed}/${cmp.off.total}`, pct(cmp.off.pass_rate), cmp.off.errors, `${cmp.off.avg_latency_ms} ms`, cmp.off.avg_completion_tokens],
                        ["Con thinking", `${cmp.on.passed}/${cmp.on.total}`, pct(cmp.on.pass_rate), cmp.on.errors, `${cmp.on.avg_latency_ms} ms`, cmp.on.avg_completion_tokens],
                    ]
                )
            );
            L.push("", "#### Detalle por caso", "");
            for (const { caseId, off, on } of thinkingPairs(records, stage as LlmEvalStage)) {
                L.push(`- **${caseId}:** off=${outcomeLabel(off)} | on=${outcomeLabel(on)}`);
            }
            L.push("");
        }
    }

    L.push("## Ejecuciones no aprobadas", "");
    const notPassed = records.filter((r) => r.status !== "pass");
    if (notPassed.length === 0) {
        L.push("Todas las ejecuciones pasaron.");
    } else {
        L.push(
            ...mdTable(
                ["Caso", "Etapa", "Thinking", "Estado", "Primer error"],
                notPassed.map((r) => [r.case_id, r.stage, thinkingLabel(r.thinking), r.status.toUpperCase(), clip(r.errors[0] ?? "", MAX_ERROR_CHARS)])
            )
        );
    }
    L.push("");

    return L.join("\n");
}

// ------------------------------------------------------------
// Consola
// ------------------------------------------------------------

const RULE = "-------------------------------------------------------------------------------";

export function renderConsoleSummary(summary: LlmScoresSummary, records: LlmRunRecord[]): string {
    const L: string[] = [];
    L.push("===============================================================================");
    L.push("RESUMEN DE EVALUACIÓN — LLM");
    L.push("===============================================================================");
    L.push(`Ejecuciones:        ${summary.total}`);
    L.push(`Aprobadas (PASS):   ${summary.passed} (${pct(summary.pass_rate)})`);
    L.push(`Falladas (FAIL):    ${summary.failed}`);
    L.push(`Errores ejecución:  ${summary.errors}`);
    L.push(`Latencia Promedio:  ${summary.avg_latency_ms} ms`);
    L.push(`Finish reasons:     ${JSON.stringify(summary.finish_reasons)}`);
    L.push(RULE);
    for (const [stage, d] of Object.entries(summary.by_stage)) {
        L.push(`Etapa [${stage.toUpperCase()}]: ${d.passed}/${d.total} (${pct(d.pass_rate)}) | errores ${d.errors} | truncadas ${d.truncated} | Latencia avg: ${d.avg_latency_ms}ms`);
    }

    for (const [stage, cmp] of Object.entries(summary.thinking_comparison)) {
        L.push(RULE);
        L.push(`COMPARACIÓN THINKING — ${stage.toUpperCase()}`);
        for (const [label, d] of [["sin thinking", cmp.off], ["con thinking", cmp.on]] as const) {
            L.push(`  ${label}: ${d.passed}/${d.total} (${pct(d.pass_rate)}) | lat avg ${d.avg_latency_ms}ms | tokens out avg ${d.avg_completion_tokens}`);
        }
        for (const { caseId, off, on } of thinkingPairs(records, stage as LlmEvalStage)) {
            L.push(`  ${caseId}: off=${off.status.toUpperCase()} ${off.latency_ms}ms | on=${on.status.toUpperCase()} ${on.latency_ms}ms`);
        }
    }
    return L.join("\n");
}