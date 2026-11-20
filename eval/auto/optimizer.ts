/**
 * eval/auto/optimizer.ts
 *
 * Agente optimizador externo (`/v1/chat/completions`, reutilizando `postJson` de `src/core/models/transport.ts`
 * y `resolveUrl` de `eval/core/client/generative.ts`):
 * - Arma el contexto acotado (§5.1): contrato de etapa, `conclusiones.md`, prompt `prod`, Top-2 con métricas y fallos reales.
 * - Exige 2 hipótesis distintas (`a` y `b`) en JSON estricto (§5.2) y reintenta reparación hasta 2 veces con el error exacto (§5.3).
 * - Decide condicionalmente si actualizar `conclusiones.md` al final de cada vuelta (§7.1).
 */

import { parseJsonObject, stripThink } from "../../src/core/models/qwen.ts";
import { postJson as prodPostJson, TransportError } from "../../src/core/models/transport.ts";
import { resolveUrl } from "../core/client/generative.ts";
import { fmtDeltaPct, fmtMs, fmtPct } from "../core/report-format.ts";
import type { AutoConfig } from "./config.ts";
import type { FailureSample, VariantDatasetStat } from "./feedback.ts";
import type { RankedVariant } from "./ranking.ts";
import { extractProdPromptSource, getStageContract } from "./stageContract.ts";
import { validateAndWriteVariant, type ValidationSuccess } from "./validateVariant.ts";

export class OptimizerTransportError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "OptimizerTransportError";
  }
}

export interface OptimizerCallParams {
  url: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
}

export type OptimizerLlmCaller = (params: OptimizerCallParams) => Promise<string>;

export interface TopVariantContext {
  name: string;
  code: string;
  summary: RankedVariant;
  perDataset: VariantDatasetStat[];
}

export interface GeneratedVariantResult {
  name: string;
  suffix: string;
  hypothesis: string;
  filePath: string;
  code: string;
  normalizedHash: string;
}

export interface RoundGenerationOutput {
  analysis: string;
  validVariants: GeneratedVariantResult[];
  rejectedNotes: string[];
}

export interface ConclusionsDecision {
  update: boolean;
  reason: string;
  markdown?: string;
}

const MAX_REPAIR_RETRIES = 2;

const GENERATE_VARIANTS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    analysis: { type: "string" },
    variants: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          suffix: { type: "string", enum: ["a", "b"] },
          hypothesis: { type: "string" },
          code: { type: "string" },
        },
        required: ["suffix", "hypothesis", "code"],
        additionalProperties: false,
      },
    },
  },
  required: ["analysis", "variants"],
  additionalProperties: false,
};

const CONCLUSIONS_UPDATE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    update: { type: "boolean" },
    reason: { type: "string" },
    markdown: { type: "string" },
  },
  required: ["update", "reason"],
  additionalProperties: false,
};

/**
 * Cliente por defecto contra `/v1/chat/completions` usando `src/core/models/transport.ts` (`postJson`).
 * Degrada automáticamente `json_schema` -> `json_object` -> sin `response_format` ante HTTP 400.
 */
export async function defaultOptimizerLlmCall(params: OptimizerCallParams): Promise<string> {
  const endpoint = resolveUrl(params.url);
  const headers: Record<string, string> = {};
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const formats: Array<Record<string, unknown> | undefined> = [
    {
      type: "json_schema",
      json_schema: { name: params.schemaName, strict: false, schema: params.schema },
    },
    { type: "json_object" },
    undefined,
  ];

  for (let i = 0; i < formats.length; i++) {
    const responseFormat = formats[i];
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
      stream: false,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };

    let res;
    try {
      res = await prodPostJson({
        url: endpoint,
        body: JSON.stringify(body),
        timeoutMs: params.timeoutMs,
        headers,
      });
    } catch (e) {
      if (e instanceof TransportError) {
        throw new OptimizerTransportError(`Error de transporte llamando al optimizador (${e.kind}): ${e.message}`, e);
      }
      throw new OptimizerTransportError(`Error de red llamando al optimizador: ${e instanceof Error ? e.message : String(e)}`, e);
    }

    if (!res.ok) {
      // Si el servidor rechaza response_format con 400/422, probamos el siguiente modo de compatibilidad.
      if ((res.status === 400 || res.status === 422) && i < formats.length - 1) {
        continue;
      }
      throw new OptimizerTransportError(
        `Optimizador devolvió HTTP ${res.status} (${res.statusText}): ${res.text.slice(0, 300)}`,
      );
    }

    let parsedResp: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      parsedResp = JSON.parse(res.text) as { choices?: Array<{ message?: { content?: unknown } }> };
    } catch {
      throw new OptimizerTransportError(`Respuesta del optimizador no es JSON válido: ${res.text.slice(0, 200)}`);
    }

    const content = parsedResp.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new OptimizerTransportError("El optimizador devolvió una respuesta vacía.");
    }
    return content;
  }

  throw new OptimizerTransportError("No se pudo invocar al optimizador en ninguno de los modos de formato.");
}

function parseJsonResponse(raw: string): Record<string, unknown> | null {
  const cleaned = stripThink(raw).trim();
  const direct = parseJsonObject(cleaned);
  if (direct) return direct;
  // Intentar quitar fences ```json ... ``` si quedaron envolviendo
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  if (fence) {
    return parseJsonObject(fence[1].trim());
  }
  return null;
}

function formatMetricsSummary(
  top2Contexts: TopVariantContext[],
  allRanked: RankedVariant[],
  cfg: AutoConfig,
): string {
  const lines: string[] = [];
  for (const r of allRanked) {
    const delta = r.variant === "prod"
      ? "baseline"
      : r.deltaPassRate !== undefined
        ? fmtDeltaPct(cfg.metric === "macroPassRate" ? (r.deltaMacroPassRate ?? r.deltaPassRate) : r.deltaPassRate)
        : "—";
    lines.push(
      `- ${r.variant}: ${cfg.metric}=${fmtPct(r.score)} (${r.passedRuns}/${r.totalRuns}), Δ=${delta}, mej=${r.improvements}, reg=${r.regressions}, reint=${r.retriedRuns}, p50=${fmtMs(r.p50DurationMs)}`,
    );
  }
  if (top2Contexts.some((t) => t.perDataset.length > 0)) {
    lines.push("", "Desglose Top-2 por dataset:");
    for (const ctx of top2Contexts) {
      const dsParts = ctx.perDataset.map(
        (d) => `${d.dataset}: ${fmtPct(d.passRate)} (${d.passedRuns}/${d.totalRuns}, p50=${fmtMs(d.p50DurationMs)}, reint=${d.retriedRuns})`,
      );
      lines.push(`- ${ctx.name}: ${dsParts.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

function formatFailuresBlock(samples: FailureSample[]): string {
  if (samples.length === 0) {
    return "No hubo fallos en los casos evaluados del Top-1.";
  }
  return samples
    .map((s, i) => [
      `### Caso ${i + 1}: ${s.id} [${s.dataset}] (${s.priority})`,
      `Checks fallidos: ${s.failedChecks.join(", ") || "ninguno"}`,
      s.errors.length > 0 ? `Errores: ${s.errors.join(" | ")}` : null,
      `Expected: ${s.expected}`,
      `Predicted: ${s.predicted}`,
      `Input:\n${s.inputCompact}`,
      s.rawOutput ? `RawOutput: ${s.rawOutput}` : null,
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}

function buildGenerationMessages(opts: {
  cfg: AutoConfig;
  round: number;
  nameA: string;
  nameB: string;
  conclusionsText: string;
  prodPromptSource: string;
  top2Contexts: TopVariantContext[];
  allRanked: RankedVariant[];
  failureSamples: FailureSample[];
}): Array<{ role: "system" | "user"; content: string }> {
  const { cfg, round, nameA, nameB, conclusionsText, prodPromptSource, top2Contexts, allRanked, failureSamples } = opts;
  const contract = getStageContract(cfg.stage);

  const system = [
    "Sos un ingeniero experto en diseño y optimización de prompts para modelos pequeños (Qwen 4B generativo y D3 2B de decisión).",
    "Tu tarea es proponer exactamente 2 variantes nuevas de prompt en TypeScript (`a` y `b`) para mejorar la etapa indicada.",
    "",
    "RESTRICCIONES ESTRICTAS:",
    "1. Editá ÚNICAMENTE el texto y estructura del prompt de la etapa indicada (`PROMPTS.<vista>` o `DECISION_PROMPTS.<fn>`).",
    "2. PROHIBIDO definir `params` o `read` en el objeto `Variant` exportado.",
    "3. PROHIBIDO importar módulos fuera de `../../../../src/core/*` y `../../../core/variants/types.ts` (nada de `fs`, `path`, `eval`, `fetch`, etc.).",
    "4. Devolvé código TypeScript completo y autocontenido en cada variante (sin placeholders ni comentarios tipo '// ...resto igual').",
    "5. Diversidad obligatoria entre las 2 variantes:",
    "   - Variante `a`: refinamiento conservador y focalizado sobre el Top-1 actual (o `prod`) atacando el patrón #1 de error.",
    "   - Variante `b`: hipótesis estructural alternativa (reordenar bloques, podar ruido, reformular criterios/instrucciones) evitando ideas listadas en `Descartadas`.",
    "6. Respondé EXCLUSIVAMENTE con un JSON válido que siga el esquema `{ analysis, variants: [{ suffix: 'a'|'b', hypothesis, code }] }`.",
  ].join("\n");

  const prodInTop2 = top2Contexts.some((t) => t.name === "prod");
  const top2Section = top2Contexts
    .map(
      (t, idx) =>
        `### Top-${idx + 1}: \`${t.name}\` (${cfg.metric}=${fmtPct(t.summary.score)}, p50=${fmtMs(t.summary.p50DurationMs)})\n\`\`\`ts\n${t.code.trim()}\n\`\`\``,
    )
    .join("\n\n");

  const userParts = [
    `## Objetivo y Ronda`,
    `- Etapa: \`${cfg.stage}\` (${contract.requestType})`,
    `- Ronda actual: Vuelta ${round} de ${cfg.maxLoops}`,
    `- Meta: \`${cfg.metric} >= ${fmtPct(cfg.target)}\` (modelos evaluados: \`${cfg.model}\` + \`${cfg.decisionModel}\`)`,
    `- Nombres exactos a generar: \`${nameA}\` (suffix \`a\`) y \`${nameB}\` (suffix \`b\`)`,
    "",
    `## Contrato de la Etapa`,
    `- Grupo y clave en \`Variant.prompts\`: \`${contract.promptGroup}.${contract.promptKey}\``,
    `- Contrato de salida/preguntas: ${contract.outputContract}`,
    `- Reglas de parseo y grader: ${contract.graderRules}`,
    ...contract.allowedHelpers.map((h) => `- ${h}`),
    ...(contract.unexportedWarnings.length > 0
      ? ["", "ATENCIÓN — Símbolos NO exportados en prompts.ts:", ...contract.unexportedWarnings.map((w) => `- ${w}`)]
      : []),
    "",
    "### Plantilla mínima compilable para esta carpeta (`eval/variants/_auto/<stage>/`):",
    "```ts",
    contract.minimalTemplate(nameA).trim(),
    "```",
    "",
    "## Memoria acumulada (`conclusiones.md`)",
    conclusionsText,
    "",
    "## Métricas actuales",
    formatMetricsSummary(top2Contexts, allRanked, cfg),
    "",
    ...(prodInTop2
      ? []
      : [
          "## Código fuente de referencia `prod` (bloque en `src/core/models/prompts.ts`)",
          "```ts",
          prodPromptSource.trim(),
          "```",
          "",
        ]),
    "## Código fuente completo de Top-2 vigente",
    top2Section || "(sin variantes adicionales en Top-2; usar `prod` como base)",
    "",
    `## Muestra acotada de fallos del Top-1 (${failureSamples.length} casos)`,
    formatFailuresBlock(failureSamples),
  ];

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n") },
  ];
}

interface ParsedProposal {
  analysis: string;
  entries: Array<{ suffix: "a" | "b"; hypothesis: string; code: string }>;
}

function extractProposal(raw: string, expectedSuffixes: Array<"a" | "b">): { proposal?: ParsedProposal; error?: string } {
  const obj = parseJsonResponse(raw);
  if (!obj) {
    return { error: "La respuesta del optimizador no contiene un objeto JSON válido." };
  }
  const analysis = typeof obj.analysis === "string" ? obj.analysis.trim() : "";
  const rawVars = obj.variants;
  if (!Array.isArray(rawVars) || rawVars.length === 0) {
    return { error: "El JSON debe incluir un array `variants` no vacío." };
  }

  const entries: Array<{ suffix: "a" | "b"; hypothesis: string; code: string }> = [];
  for (let i = 0; i < rawVars.length; i++) {
    const item = rawVars[i] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    const rawSuffix = typeof item.suffix === "string" ? item.suffix.trim().toLowerCase() : expectedSuffixes[i];
    const suffix = (rawSuffix === "a" || rawSuffix === "b") ? rawSuffix : expectedSuffixes[i];
    if (!suffix) continue;
    const hypothesis = typeof item.hypothesis === "string" ? item.hypothesis.trim() : "(sin hipótesis)";
    const code = typeof item.code === "string" ? item.code.trim() : "";
    if (!code) continue;
    // Evitar duplicado por suffix dentro de la misma respuesta
    if (!entries.some((e) => e.suffix === suffix)) {
      entries.push({ suffix, hypothesis, code });
    }
  }

  if (entries.length === 0) {
    return { error: "Ninguna entrada en `variants` trajo `code` válido." };
  }
  return { proposal: { analysis, entries } };
}

/**
 * Genera y valida hasta 2 variantes (`a` y `b`) para la vuelta `round`.
 * Si alguna falla validación estática/ESM/contexto/duplicado, pide reparación al optimizador hasta 2 veces.
 * Propaga `OptimizerTransportError` ante caídas de red/HTTP del endpoint del optimizador.
 */
export async function generateVariantsForRound(opts: {
  cfg: AutoConfig;
  round: number;
  runTag: string;
  conclusionsText: string;
  top2Contexts: TopVariantContext[];
  allRanked: RankedVariant[];
  failureSamples: FailureSample[];
  devDatasetPaths: string[];
  knownHashes: Set<string>;
  callLlm?: OptimizerLlmCaller;
}): Promise<RoundGenerationOutput> {
  const { cfg, round, runTag, devDatasetPaths, knownHashes } = opts;
  const llm = opts.callLlm ?? defaultOptimizerLlmCall;
  const apiKey = cfg.optimizerApiKeyEnv ? process.env[cfg.optimizerApiKeyEnv] : undefined;
  const prodPromptSource = extractProdPromptSource(cfg.stage);

  const nameFor = (suffix: "a" | "b"): string => `auto_${cfg.stage}_${runTag}_r${round}_${suffix}`;
  const validBySuffix = new Map<"a" | "b", GeneratedVariantResult>();
  const rejectedNotes: string[] = [];
  const roundHashes = new Set<string>(knownHashes);

  let analysis = "";
  let messages: OptimizerCallParams["messages"] = buildGenerationMessages({
    cfg,
    round,
    nameA: nameFor("a"),
    nameB: nameFor("b"),
    conclusionsText: opts.conclusionsText,
    prodPromptSource,
    top2Contexts: opts.top2Contexts,
    allRanked: opts.allRanked,
    failureSamples: opts.failureSamples,
  });

  for (let attempt = 0; attempt <= MAX_REPAIR_RETRIES; attempt++) {
    const raw = await llm({
      url: cfg.optimizerUrl,
      model: cfg.optimizerModel,
      apiKey,
      timeoutMs: cfg.optimizerTimeoutMs,
      messages,
      schemaName: "optimizer_variants",
      schema: GENERATE_VARIANTS_SCHEMA,
      temperature: attempt === 0 ? 0.35 : 0.2,
    });

    const pendingSuffixes = (["a", "b"] as const).filter((s) => !validBySuffix.has(s));
    const extracted = extractProposal(raw, [...pendingSuffixes]);

    if (!extracted.proposal) {
      const errMsg = extracted.error ?? "Formato JSON inválido.";
      if (attempt >= MAX_REPAIR_RETRIES) {
        rejectedNotes.push(`Intento ${attempt + 1}: ${errMsg}`);
        break;
      }
      messages = [
        ...messages,
        { role: "assistant", content: raw.slice(0, 3000) },
        {
          role: "user",
          content: `Tu respuesta anterior falló al parsear el JSON: ${errMsg}\nCorregí la respuesta devolviendo EXCLUSIVAMENTE JSON válido con \`{ "analysis": "...", "variants": [...] }\` para: ${pendingSuffixes.map(nameFor).join(", ")}.`,
        },
      ];
      continue;
    }

    if (!analysis && extracted.proposal.analysis) {
      analysis = extracted.proposal.analysis;
    }

    const attemptErrors: string[] = [];

    for (const s of pendingSuffixes) {
      const candidate = extracted.proposal.entries.find((e) => e.suffix === s);
      const variantName = nameFor(s);
      if (!candidate) {
        attemptErrors.push(`- ${variantName} (suffix '${s}'): faltó en el arreglo \`variants\`.`);
        continue;
      }

      const validation: ValidationSuccess | { ok: false; error: string } = await validateAndWriteVariant({
        stage: cfg.stage,
        variantName,
        rawCode: candidate.code,
        devDatasetPaths,
        knownHashes: roundHashes,
      });

      if (validation.ok) {
        roundHashes.add(validation.normalizedHash);
        validBySuffix.set(s, {
          name: validation.name,
          suffix: s,
          hypothesis: candidate.hypothesis,
          filePath: validation.filePath,
          code: validation.code,
          normalizedHash: validation.normalizedHash,
        });
      } else {
        attemptErrors.push(`- ${variantName} (suffix '${s}'): ${validation.error}`);
      }
    }

    if (validBySuffix.size === 2) {
      break;
    }

    if (attempt >= MAX_REPAIR_RETRIES) {
      rejectedNotes.push(...attemptErrors);
      break;
    }

    const stillMissing = (["a", "b"] as const).filter((s) => !validBySuffix.has(s));
    const repairPrompt = [
      "Falló la validación previa de una o ambas variantes:",
      ...attemptErrors,
      "",
      `Generá únicamente las variantes faltantes corregidas (${stillMissing.map((s) => `suffix '${s}' -> ${nameFor(s)}`).join(", ")}), respetando exactamente el contrato, las rutas relativas desde \`eval/variants/_auto/${cfg.stage}/\` y sin \`params\` ni \`read\`.`,
    ].join("\n");

    messages = [
      ...messages,
      { role: "assistant", content: raw.slice(0, 6000) },
      { role: "user", content: repairPrompt },
    ];
  }

  for (const v of validBySuffix.values()) {
    knownHashes.add(v.normalizedHash);
  }

  return {
    analysis,
    validVariants: (["a", "b"] as const).map((s) => validBySuffix.get(s)).filter((v): v is GeneratedVariantResult => Boolean(v)),
    rejectedNotes,
  };
}

/**
 * Consulta al optimizador al final de una vuelta para decidir si `conclusiones.md` necesita actualizarse.
 * Propaga `OptimizerTransportError` en errores de infraestructura.
 */
export async function decideConclusionsUpdate(opts: {
  cfg: AutoConfig;
  currentConclusions: string;
  roundFacts: string;
  callLlm?: OptimizerLlmCaller;
}): Promise<ConclusionsDecision> {
  const { cfg, currentConclusions, roundFacts } = opts;
  const llm = opts.callLlm ?? defaultOptimizerLlmCall;
  const apiKey = cfg.optimizerApiKeyEnv ? process.env[cfg.optimizerApiKeyEnv] : undefined;

  const system = [
    "Sos el cronista técnico de un bucle autónomo de optimización de prompts.",
    "Recibís el `conclusiones.md` actual y los hechos objetivos medidos en la última vuelta.",
    "Decidí si hay un aprendizaje nuevo, una regresión clara o un cambio relevante de Top-2 que valga guardar.",
    "Si no hay cambios relevantes respecto de lo ya registrado, devolvé `{\"update\":false,\"reason\":\"...\"}`.",
    "Si `update: true`, devolvé el markdown completo actualizado en `markdown` respetando esta plantilla compacta (<= 150 líneas, <= 12 000 chars):",
    "",
    `# Conclusiones — ${cfg.stage}`,
    "",
    "## Estado actual (auto-actualizado)",
    "- Objetivo: ...",
    "- Top 1: ...",
    "- Top 2: ...",
    "- Baseline `prod`: ...",
    "",
    "## Reglas confirmadas (qué ayuda)",
    "- ...",
    "",
    "## Descartadas (qué empeora — no repetir)",
    "- ...",
    "",
    "## Últimas rondas (máx. 5)",
    "- ...",
  ].join("\n");

  const user = [
    "## `conclusiones.md` actual",
    currentConclusions.trim() ? currentConclusions : "(vacío)",
    "",
    "## Hechos medidos de esta vuelta",
    roundFacts,
    "",
    "Respondé SOLO con JSON `{ \"update\": boolean, \"reason\": string, \"markdown\"?: string }`.",
  ].join("\n");

  const raw = await llm({
    url: cfg.optimizerUrl,
    model: cfg.optimizerModel,
    apiKey,
    timeoutMs: cfg.optimizerTimeoutMs,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    schemaName: "conclusions_update",
    schema: CONCLUSIONS_UPDATE_SCHEMA,
    temperature: 0.2,
  });

  const obj = parseJsonResponse(raw);
  if (!obj || typeof obj.update !== "boolean") {
    return { update: false, reason: "Respuesta de conclusiones no parseable; se conserva el archivo actual." };
  }
  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  const markdown = typeof obj.markdown === "string" ? obj.markdown.trim() : undefined;
  if (obj.update && (!markdown || markdown.length === 0)) {
    return { update: false, reason: reason || "update=true sin contenido markdown." };
  }
  return { update: obj.update, reason, markdown };
}
