/**
 * eval/auto/optimizer.ts
 *
 * Agente optimizador externo (`/v1/chat/completions`, reutilizando `postJson` de `src/core/models/transport.ts`
 * y `resolveUrl` de `eval/core/client/generative.ts`):
 * - Arma el contexto acotado (§5.1): contrato de etapa, historial de ideas probadas (`ledger.jsonl`), prompt `prod`, Top-2 con métricas y fallos reales.
 * - Exige 2 hipótesis distintas (`a` y `b`) en JSON estricto (§5.2) y reintenta reparación hasta 2 veces con el error exacto (§5.3).
 */

import { resolveUrl } from "../core/client/generative.ts";
import { parseJsonObject, postJson as prodPostJson, stripThink, TransportError } from "../core/contract.ts";
import type { RawDatasetCache } from "../core/datasets.ts";
import { fmtDeltaPct, fmtMs, fmtPct } from "../core/report-format.ts";
import { isDecisionStage } from "../core/stages/index.ts";
import type { AutoConfig, AutoMode } from "./config.ts";
import {
  buildPatchedVariantSource,
  buildSystemVariantSource,
  formatShape,
  mergePatch,
  patchFromRaw,
  systemFromRaw,
  type DecisionShape,
  type PromptPatch,
} from "./patchVariant.ts";
import type { VariantDatasetStat } from "./feedback.ts";
import type { RankedVariant } from "./ranking.ts";
import { getGenerativeContract, getStageContract } from "./stageContract.ts";
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
  maxTokens?: number;
  reasoningEffort?: "none" | "low";
}

export type OptimizerLlmCaller = (params: OptimizerCallParams) => Promise<string>;

export interface TopVariantContext {
  name: string;
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

const MAX_REPAIR_RETRIES = 2;

/** Formato de respuesta de las etapas generativas: solo el texto SYSTEM; el código arma el archivo de la variante. */
const SYSTEM_TEXT_SCHEMA: Record<string, unknown> = {
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
          system: { type: "string" },
        },
        required: ["suffix", "hypothesis", "system"],
        additionalProperties: false,
      },
    },
  },
  required: ["analysis", "variants"],
  additionalProperties: false,
};

/** Formato de respuesta de las etapas de decisión: solo textos; el código arma el archivo de la variante. */
const DECISION_PATCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    analysis: { type: "string" },
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          suffix: { type: "string", enum: ["a", "b"] },
          hypothesis: { type: "string" },
          instructions: { type: "object", additionalProperties: { type: "string" } },
          criteria: { type: "object", additionalProperties: { type: "object", additionalProperties: { type: "string" } } },
          state_note: { type: "string" },
        },
        required: ["suffix", "hypothesis"],
        additionalProperties: false,
      },
    },
  },
  required: ["analysis", "variants"],
  additionalProperties: false,
};

/**
 * Cliente por defecto contra `/v1/chat/completions` usando `src/core/models/transport.ts` (`postJson`).
 * Envía `reasoning_effort` (`"none"` por defecto para evitar que modelos híbridos tipo Qwen 3.5 consuman el presupuesto
 * en `<think>` o dejen `content` vacío con `json_schema`) y `max_tokens`.
 * Degrada automáticamente `json_schema` -> `json_object` -> sin `response_format` ante HTTP 400/422 o `content` vacío,
 * y reintenta sin `reasoning_effort` si el endpoint lo rechaza con HTTP 400/422.
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

  const reasoningModes: Array<"none" | "low" | undefined> = params.reasoningEffort
    ? [params.reasoningEffort, undefined]
    : [undefined];

  let lastEmptyNote = "";

  for (let rIdx = 0; rIdx < reasoningModes.length; rIdx++) {
    const reasoningEffort = reasoningModes[rIdx];
    let sawClientRejection = false;

    for (let i = 0; i < formats.length; i++) {
      const responseFormat = formats[i];
      const body: Record<string, unknown> = {
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.3,
        max_tokens: params.maxTokens ?? 4096,
        stream: false,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
      };

      let res: Awaited<ReturnType<typeof prodPostJson>>;
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
        if (res.status === 400 || res.status === 422) {
          sawClientRejection = true;
          if (i < formats.length - 1) continue;
          if (rIdx < reasoningModes.length - 1) break;
        }
        throw new OptimizerTransportError(
          `Optimizador devolvió HTTP ${res.status} (${res.statusText}): ${res.text.slice(0, 300)}`,
        );
      }

      let parsedResp: {
        choices?: Array<{
          finish_reason?: unknown;
          message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
        }>;
      };
      try {
        parsedResp = JSON.parse(res.text) as typeof parsedResp;
      } catch {
        throw new OptimizerTransportError(`Respuesta del optimizador no es JSON válido: ${res.text.slice(0, 200)}`);
      }

      const choice = parsedResp.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return content;
      }

      const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
      const reasoningRaw = choice?.message?.reasoning ?? choice?.message?.reasoning_content;
      const reasoningLen = typeof reasoningRaw === "string" ? reasoningRaw.trim().length : 0;
      const formatLabel = (responseFormat as { type?: string } | undefined)?.type ?? "plain";
      lastEmptyNote = `format=${formatLabel}, finish_reason=${finishReason}${reasoningLen > 0 ? `, reasoning=${reasoningLen} chars sin content` : ""}`;
    }

    if (!sawClientRejection) {
      break;
    }
  }

  throw new OptimizerTransportError(
    `El optimizador devolvió una respuesta vacía tras probar todos los modos (${lastEmptyNote || "sin detalles"}).` +
    " Verifique `--optimizer-thinking=off` y que `num_ctx` del servidor soporte el prompt.",
  );
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

/** Contexto de las etapas generativas: el texto SYSTEM vigente y de dónde partir (el código arma el archivo de la variante). */
export interface SystemPromptContext {
  /** Bloque con el texto SYSTEM vigente de las variantes de referencia (ya armado por quien llama). */
  topTexts: string;
  /** Texto SYSTEM del que parte la propuesta (el del Top-1); el modelo no puede devolverlo igual. */
  current: string;
  mode: AutoMode;
  /** Tipos de fallo del Top-1 en desarrollo con su conteo (ya formateado; sin casos). */
  failures: string;
}

/**
 * Instrucciones para etapas generativas: el modelo escribe solo el texto SYSTEM completo. Ve los textos vigentes, las notas, el historial
 * y los tipos de fallo del evaluador con su conteo. No se le muestra ningún caso ni respuesta esperada.
 */
function buildSystemTextMessages(opts: {
  cfg: AutoConfig;
  round: number;
  context: SystemPromptContext;
  ledgerText: string;
  top2Contexts: TopVariantContext[];
  allRanked: RankedVariant[];
}): Array<{ role: "system" | "user"; content: string }> {
  const { cfg, round, context, ledgerText, top2Contexts, allRanked } = opts;
  const contract = getGenerativeContract(cfg.stage);
  const improve = context.mode === "improve";
  const system = [
    `Mejorás el texto SYSTEM (las instrucciones) de una etapa de JARVIS. El modelo que lo lee es \`${cfg.model}\`.`,
    ...(improve
      ? ["Te damos el texto base. Mejoralo agregando y quitando lo que haga falta; si lo necesitás, podés cambiarlo entero."]
      : ["Proponé textos nuevos: podés reescribirlo por completo."]),
    "Devolvé exactamente 2 variantes (a y b), con enfoques distintos entre sí. Cada una es el texto SYSTEM completo; no escribas código ni el mensaje del usuario.",
    "",
    "Reglas:",
    "1. Escribí el texto en inglés, igual que el actual, y sin ejemplos de pedidos concretos de usuarios.",
    "2. Conservá lo que el modelo evaluado necesita para responder en el formato exigido (ver «Formato de la respuesta»): si el texto actual nombra campos o claves de la respuesta, mantenelos.",
    "3. a: un cambio acotado que corrija el error más frecuente. b: otro enfoque (otra redacción o estructura). No repitas lo que perdió en el historial.",
    "",
    'Respondé solo con JSON: {"analysis":"<una frase>","variants":[{"suffix":"a","hypothesis":"<una frase>","system":"<texto SYSTEM completo>"},{"suffix":"b","hypothesis":"<una frase>","system":"<texto SYSTEM completo>"}]}',
  ].join("\n");

  const user = [
    "## Etapa",
    `- \`${cfg.stage}\` · Vuelta ${round} de ${cfg.maxLoops} · meta: \`${cfg.metric} >= ${fmtPct(cfg.target)}\``,
    "",
    "## Formato de la respuesta del modelo evaluado",
    contract.outputContract,
    "",
    "## Cómo se evalúa",
    contract.graderRules,
    "",
    improve ? "## Texto base (el que tenés que mejorar)" : "## Textos de referencia",
    context.topTexts,
    "",
    "## Historial de ideas probadas (lo mide el código; no repitas lo que perdió)",
    ledgerText,
    "",
    "## Notas actuales",
    formatMetricsSummary(top2Contexts, allRanked, cfg),
    "",
    "## Fallos del Top-1 en desarrollo (tipos de fallo del evaluador; sin casos)",
    context.failures,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Versiones del pedido al optimizador: cada vuelta usa una (alternan en orden) con su propio enfoque y su temperatura, para que las variantes de vueltas
 * distintas no salgan del mismo molde. La primera tentativa de cada vuelta usa `temperature`; los reintentos de reparación, una más baja y fija.
 */
export const OPTIMIZER_STYLES: ReadonlyArray<{ focus: string; temperature: number }> = [
  { focus: "make small, targeted edits: change only the options involved in the errors.", temperature: 0.3 },
  { focus: "make the scope of each confused option precise: what it covers and where it ends.", temperature: 0.5 },
  { focus: "simplify: shorter, plainer wording that removes ambiguous phrases.", temperature: 0.7 },
];

/** Versión del pedido (y temperatura) que toca en la vuelta `round` (1, 2, 3…). */
export function optimizerStyle(round: number): { focus: string; temperature: number } {
  return OPTIMIZER_STYLES[(Math.max(1, round) - 1) % OPTIMIZER_STYLES.length];
}

/** Contexto extra de las etapas de decisión: preguntas válidas y los textos vigentes del Top-2 (ya armados por quien llama). */
export interface DecisionPromptContext {
  shape: DecisionShape;
  /** Bloque de texto con los textos vigentes (rewrite: Top-1 y Top-2 como referencia; improve: solo el prompt base). */
  topTexts: string;
  /** `rewrite`: prompts nuevos. `improve`: mejora un prompt base. */
  mode: AutoMode;
  /** Solo `improve`: textos completos del prompt base; los cambios del modelo se aplican encima. */
  base?: PromptPatch;
  /** Textos de producción de todas las opciones de dev y holdout: completan la variante con lo que el modelo no escribe. */
  prodTexts?: PromptPatch;
  /** Errores del Top-1 por etiqueta (solo etiquetas y conteos; ya formateado). */
  confusions?: string;
}

interface RawPatch {
  instructions?: unknown;
  criteria?: unknown;
  state_note?: unknown;
}

interface ParsedProposal {
  analysis: string;
  entries: Array<{ suffix: "a" | "b"; hypothesis: string; patchRaw?: RawPatch; systemRaw?: unknown }>;
}

/**
 * Instrucciones para etapas de decisión: el modelo escribe solo textos. No se le muestra ningún caso de evaluación ni respuesta esperada
 * (solo notas, los textos vigentes y el historial medido por el código).
 */
function buildDecisionPatchMessages(opts: {
  cfg: AutoConfig;
  round: number;
  context: DecisionPromptContext;
  ledgerText: string;
  top2Contexts: TopVariantContext[];
  allRanked: RankedVariant[];
}): Array<{ role: "system" | "user"; content: string }> {
  const { cfg, round, context, ledgerText, top2Contexts, allRanked } = opts;
  const firstChoice = context.shape.questions.find((q) => q.type === "choice");
  const exampleKey = (firstChoice ?? context.shape.questions[0]).key;
  const exampleVariant = (suffix: string): string =>
    JSON.stringify({
      suffix,
      hypothesis: "...",
      instructions: { [exampleKey]: "..." },
      ...(firstChoice ? { criteria: { [firstChoice.key]: { [firstChoice.options[0] ?? "..."]: "..." } } } : {}),
      state_note: "...",
    });
  const improve = context.mode === "improve";
  const style = optimizerStyle(round);
  const system = [
    `You improve the prompt texts of a JARVIS decision stage. The model that reads them is \`${cfg.decisionModel}\`.`,
    improve
      ? "You get a base prompt. Change only the texts that need it; whatever you leave out stays as in the base."
      : "Write new texts. Whatever you leave out stays as in production (`prod`).",
    "Return exactly 2 variants (a and b), different from each other. Each one changes texts only; do not write code.",
    "You are not shown evaluation cases: use the current texts, the error summary by label, the history of tried ideas and the notes.",
    "",
    "Rules:",
    "1. Write every text in English, like the current ones.",
    "2. An option description is a neutral criterion: it says what the option covers. No examples, no priority rules, no mention of other options.",
    "3. Keep each text about as long as the current one.",
    "4. Each error says the model chose a label (\"chosen\") when the right one was another (\"correct\"). Fix it by widening the description of the correct one, or narrowing the chosen one. Do not remove from the correct one what already belongs to it.",
    "5. Do not repeat what lost in the history.",
    `6. Approach for this round: ${style.focus}`,
    "",
    "Answer with JSON only, in this format (the \"...\" are the texts you write; question and option names are the real ones of this stage; `criteria` and `state_note` are optional; `instructions` only has question names, `criteria` has question and then option names):",
    `{"analysis":"...","variants":[${exampleVariant("a")},${exampleVariant("b")}]}`,
  ].join("\n");

  const user = [
    "## Stage",
    `- \`${cfg.stage}\` · Round ${round} of ${cfg.maxLoops} · goal: \`${cfg.metric} >= ${fmtPct(cfg.target)}\``,
    "",
    "## What you can change",
    "- `instructions.<question>`: the question instruction.",
    "- `criteria.<question>.<option>`: the description of an option.",
    "- `state_note`: a short line put before the state (optional).",
    "Valid questions and options:",
    formatShape(context.shape),
    "",
    improve ? "## Base prompt (the one to improve)" : "## Reference texts",
    context.topTexts,
    "",
    ...(context.confusions !== undefined ? ["## Top-1 errors on development (labels only; no cases or texts)", context.confusions, ""] : []),
    "## History of tried ideas (measured by the code; do not repeat what lost)",
    ledgerText,
    "",
    "## Current notes",
    formatMetricsSummary(top2Contexts, allRanked, cfg),
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function extractDecisionProposal(raw: string, expectedSuffixes: Array<"a" | "b">): { proposal?: ParsedProposal; error?: string } {
  const obj = parseJsonResponse(raw);
  if (!obj) return { error: "La respuesta del optimizador no contiene un objeto JSON válido." };
  const analysis = typeof obj.analysis === "string" ? obj.analysis.trim() : "";
  const rawVars = obj.variants;
  if (!Array.isArray(rawVars) || rawVars.length === 0) return { error: "El JSON debe incluir un array `variants` no vacío." };

  const entries: ParsedProposal["entries"] = [];
  for (let i = 0; i < rawVars.length; i++) {
    const item = rawVars[i] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    const rawSuffix = typeof item.suffix === "string" ? item.suffix.trim().toLowerCase() : expectedSuffixes[i];
    const match = /(?:^|_)([ab])$/.exec(rawSuffix ?? "");
    const suffix = match ? (match[1] as "a" | "b") : expectedSuffixes[i];
    if (!suffix || entries.some((e) => e.suffix === suffix)) continue;
    const hypothesis = typeof item.hypothesis === "string" ? item.hypothesis.trim() : "(sin hipótesis)";
    entries.push({
      suffix,
      hypothesis,
      patchRaw: { instructions: item.instructions, criteria: item.criteria, state_note: item.state_note },
    });
  }
  if (entries.length === 0) return { error: "Ninguna entrada en `variants` es un objeto válido." };
  return { proposal: { analysis, entries } };
}

function extractSystemProposal(raw: string, expectedSuffixes: Array<"a" | "b">): { proposal?: ParsedProposal; error?: string } {
  const obj = parseJsonResponse(raw);
  if (!obj) return { error: "La respuesta del optimizador no contiene un objeto JSON válido." };
  const analysis = typeof obj.analysis === "string" ? obj.analysis.trim() : "";
  const rawVars = obj.variants;
  if (!Array.isArray(rawVars) || rawVars.length === 0) return { error: "El JSON debe incluir un array `variants` no vacío." };

  const entries: ParsedProposal["entries"] = [];
  for (let i = 0; i < rawVars.length; i++) {
    const item = rawVars[i] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    const rawSuffix = typeof item.suffix === "string" ? item.suffix.trim().toLowerCase() : expectedSuffixes[i];
    const match = /(?:^|_)([ab])$/.exec(rawSuffix ?? "");
    const suffix = match ? (match[1] as "a" | "b") : expectedSuffixes[i];
    if (!suffix || entries.some((e) => e.suffix === suffix)) continue;
    const hypothesis = typeof item.hypothesis === "string" ? item.hypothesis.trim() : "(sin hipótesis)";
    entries.push({ suffix, hypothesis, systemRaw: item.system });
  }
  if (entries.length === 0) return { error: "Ninguna entrada en `variants` es un objeto válido." };
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
  ledgerText: string;
  top2Contexts: TopVariantContext[];
  allRanked: RankedVariant[];
  /** Etapas de decisión: preguntas válidas y textos vigentes. */
  decision?: DecisionPromptContext;
  /** Etapas generativas: el texto SYSTEM vigente. */
  generative?: SystemPromptContext;
  devDatasetPaths: string[];
  knownHashes: Set<string>;
  variantsRoot?: string;
  rawCache?: RawDatasetCache;
  callLlm?: OptimizerLlmCaller;
}): Promise<RoundGenerationOutput> {
  const { cfg, round, runTag, devDatasetPaths, knownHashes, variantsRoot, rawCache } = opts;
  const llm = opts.callLlm ?? defaultOptimizerLlmCall;
  const apiKey = cfg.optimizerApiKeyEnv ? process.env[cfg.optimizerApiKeyEnv] : undefined;
  const decision = isDecisionStage(cfg.stage) ? opts.decision : undefined;
  if (isDecisionStage(cfg.stage) && !decision) {
    throw new Error(`La etapa de decisión '${cfg.stage}' requiere el contexto de textos (decision): el optimizador no escribe archivos completos para ellas.`);
  }
  const generative = isDecisionStage(cfg.stage) ? undefined : opts.generative;
  if (!isDecisionStage(cfg.stage) && !generative) {
    throw new Error(`La etapa generativa '${cfg.stage}' requiere el contexto del texto SYSTEM (generative): el optimizador no escribe archivos completos.`);
  }

  const nameFor = (suffix: "a" | "b"): string => `auto_${cfg.stage}_${runTag}_r${round}_${suffix}`;
  const validBySuffix = new Map<"a" | "b", GeneratedVariantResult>();
  const rejectedNotes: string[] = [];
  const roundHashes = new Set<string>(knownHashes);

  let analysis = "";
  let messages: OptimizerCallParams["messages"] = decision
    ? buildDecisionPatchMessages({
        cfg,
        round,
        context: decision,
        ledgerText: opts.ledgerText,
        top2Contexts: opts.top2Contexts,
        allRanked: opts.allRanked,
      })
    : buildSystemTextMessages({
        cfg,
        round,
        // biome-ignore lint/style/noNonNullAssertion: validado arriba: sin `decision` la etapa es generativa y `generative` existe
        context: generative!,
        ledgerText: opts.ledgerText,
        top2Contexts: opts.top2Contexts,
        allRanked: opts.allRanked,
      });

  for (let attempt = 0; attempt <= MAX_REPAIR_RETRIES; attempt++) {
    const raw = await llm({
      url: cfg.optimizerUrl,
      model: cfg.optimizerModel,
      apiKey,
      timeoutMs: cfg.optimizerTimeoutMs,
      messages,
      schemaName: "optimizer_variants",
      schema: decision ? DECISION_PATCH_SCHEMA : SYSTEM_TEXT_SCHEMA,
      temperature: attempt === 0 ? optimizerStyle(round).temperature : 0.2,
      maxTokens: decision ? 2048 : 4096,
      reasoningEffort: cfg.optimizerThinking === "on" ? "low" : "none",
    });

    const pendingSuffixes = (["a", "b"] as const).filter((s) => !validBySuffix.has(s));
    const extracted = decision ? extractDecisionProposal(raw, [...pendingSuffixes]) : extractSystemProposal(raw, [...pendingSuffixes]);

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
          content: `Your previous answer failed to parse as JSON: ${errMsg}\nAnswer again with ONLY valid JSON, \`{ "analysis": "...", "variants": [...] }\`, for: ${pendingSuffixes.map(nameFor).join(", ")}.`,
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
        attemptErrors.push(`- ${variantName} (suffix '${s}'): missing from the \`variants\` array.`);
        continue;
      }

      let rawCode: string;
      if (decision) {
        // El modelo solo escribió textos: se validan contra las preguntas reales y el código arma el archivo.
        const { patch, errors } = patchFromRaw(candidate.patchRaw ?? {}, decision.shape);
        if (!patch) {
          attemptErrors.push(`- ${variantName} (suffix '${s}'): ${errors.join(" ")}`);
          continue;
        }
        // La variante sale completa: los textos de `prod` de todas las opciones, encima los del prompt base (`improve`) y encima los del modelo.
        // Lo que el modelo no escribe queda con el texto de base o de `prod`, escrito en el archivo.
        const finalPatch = mergePatch(mergePatch(decision.prodTexts ?? {}, decision.mode === "improve" && decision.base ? decision.base : {}), patch);
        rawCode = buildPatchedVariantSource({ promptKey: getStageContract(cfg.stage).promptKey, variantName, patch: finalPatch, dynamic: decision.shape.dynamic });
      } else {
        // biome-ignore lint/style/noNonNullAssertion: este camino solo corre en etapas generativas, donde `generative` existe (validado arriba)
        const { system: text, error } = systemFromRaw(candidate.systemRaw, generative!.current, getGenerativeContract(cfg.stage).requiredText);
        if (text === undefined) {
          attemptErrors.push(`- ${variantName} (suffix '${s}'): ${error}`);
          continue;
        }
        rawCode = buildSystemVariantSource({ promptKey: getStageContract(cfg.stage).promptKey, variantName, system: text });
      }

      const validation: ValidationSuccess | { ok: false; error: string } = await validateAndWriteVariant({
        stage: cfg.stage,
        variantName,
        rawCode,
        devDatasetPaths,
        knownHashes: roundHashes,
        variantsRoot,
        rawCache,
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
    const repairPrompt = decision
      ? [
          "Validation failed for one or both variants:",
          ...attemptErrors,
          "",
          `Return the full JSON in the same format, fixing only: ${stillMissing.map((s) => `suffix '${s}'`).join(", ")}. Use exactly the valid question and option names.`,
        ].join("\n")
      : [
          "Falló la validación de una o ambas variantes:",
          ...attemptErrors,
          "",
          `Devolvé el JSON completo con el mismo formato, corrigiendo solo: ${stillMissing.map((s) => `suffix '${s}'`).join(", ")}. \`system\` es el texto completo, distinto del vigente.`,
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
