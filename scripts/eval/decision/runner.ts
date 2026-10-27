import fs from "node:fs";
import path from "node:path";
import { loadDataset, permuteCriteria, saveScoresSummary } from "./core/utils.ts";
import { callDecisionModel, type ClientConfig } from "./core/client.ts";
import { estimateTokens } from "../../../src/core/llmTransport.ts";
import type { TestCase, RunRecord, MultiAnswer } from "./core/types.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {
    model: "d3",          // d3 | eos
    device: "gpu",        // gpu | cpu | remote
    dataset: "v2",        // v1 | v2 | v3 | custom_path
    prompts: "v2",        // v0 | v1 | v2 | v3 | v4 | v5 | custom_path
    tag: "",              // optional run tag
    remote: "false",      // true | false
  };

  for (const a of args) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (k && v !== undefined) params[k] = v;
      else if (k) params[k] = "true";
    }
  }
  return params;
}

function getApiKey(): string | undefined {
  if (process.env.D3_API_KEY) return process.env.D3_API_KEY.trim();
  const mdPath = path.resolve(process.cwd(), "scripts/eval/decision/connect_d3.md");
  if (fs.existsSync(mdPath)) {
    const content = fs.readFileSync(mdPath, "utf-8");
    const match = content.match(/sk-vsr-[A-Za-z0-9]+/);
    if (match) return match[0];
  }
  return undefined;
}

async function main() {
  const p = parseArgs();

  // 1. Resolver Dataset
  let datasetFile: string;
  if (p.dataset === "v1") datasetFile = path.resolve(process.cwd(), "scripts/eval/decision/datasets/dataset_v1.jsonl");
  else if (p.dataset === "v2") datasetFile = path.resolve(process.cwd(), "scripts/eval/decision/datasets/dataset_v2.jsonl");
  else if (p.dataset === "v3") datasetFile = path.resolve(process.cwd(), "scripts/eval/decision/datasets/dataset_v3.jsonl");
  else datasetFile = path.resolve(process.cwd(), p.dataset);

  const cases = loadDataset(datasetFile);

  // 2. Resolver Prompts
  let promptModulePath: string;
  if (["v0", "v1", "v2", "v3", "v4", "v5"].includes(p.prompts)) {
    promptModulePath = path.resolve(process.cwd(), `scripts/eval/decision/prompts/${p.prompts}.ts`);
  } else {
    promptModulePath = path.resolve(process.cwd(), p.prompts);
  }

  if (!fs.existsSync(promptModulePath)) {
    throw new Error(`Módulo de prompts no encontrado en: ${promptModulePath}`);
  }

  const promptModule = await import(`file://${promptModulePath.replace(/\\/g, "/")}`);

  // 3. Configurar Cliente del Modelo
  const isRemote = p.device === "remote" || p.remote === "true";
  const isCpu = p.device === "cpu";
  const apiKey = isRemote ? getApiKey() : undefined;

  const clientConfig: ClientConfig = {
    backend: p.model === "eos" ? "eos" : "d3",
    url: isRemote
      ? "https://decision.vllm-sr.ai/v1/systemone"
      : p.model === "eos"
        ? "http://127.0.0.1:8765"
        : "http://127.0.0.1:11434",
    model: isRemote
      ? "vllm-sr/d3-turbo"
      : p.model === "eos"
        ? "decision-2.0-eos"
        : isCpu
          ? "d3:2b-cpu"
          : "d3:2b",
    apiKey,
    options: isCpu ? { num_gpu: 0 } : {},
  };

  // 4. Directorio de Salida: scripts/results/decision/<modelo>/<fecha>_<dataset>_<prompts>[_<tag>]
  const TODAY = new Date().toISOString().split("T")[0];
  const tagSuffix = p.tag ? `_${p.tag}` : "";
  const modelDir = p.device === "remote" ? `${p.model}_remote` : p.model;
  const dsName = path.basename(datasetFile, ".jsonl");
  const promptName = path.basename(promptModulePath, ".ts");
  const runDirName = `${TODAY}_${dsName}_${promptName}${tagSuffix}`;
  const outputDir = path.resolve(
    process.cwd(),
    `scripts/results/decision/${modelDir}/${runDirName}`
  );

  fs.mkdirSync(outputDir, { recursive: true });
  const runsFile = path.join(outputDir, "runs.jsonl");
  const scoresFile = path.join(outputDir, "scores.json");

  console.log("===============================================================================");
  console.log(` Framework de Evaluación Unificado`);
  console.log(` Modelo:   ${clientConfig.backend} (${clientConfig.model})`);
  console.log(` Dataset:  ${datasetFile} (${cases.length} casos)`);
  console.log(` Prompts:  ${promptModulePath}`);
  console.log(` Salida:   ${outputDir}`);
  console.log("===============================================================================\n");

  const stream = fs.createWriteStream(runsFile, { flags: "w", encoding: "utf-8" });
  const recordRun = (run: RunRecord) => stream.write(JSON.stringify(run) + "\n");

  let totalCalls = 0;

  // Helper con hasta 3 reintentos
  async function callWithRetry(payload: any, maxRetries = 3) {
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await callDecisionModel(clientConfig, payload);
        totalCalls++;
        return res;
      } catch (err: any) {
        lastErr = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    throw lastErr;
  }

  const datasetName = path.basename(datasetFile, ".jsonl");
  const modelName = clientConfig.model || p.model;

  // Ejecutor Noul
  async function runNoul(
    name: string,
    stateFn: (c: TestCase) => string,
    questions: Record<string, any>,
    preamble = ""
  ) {
    console.log(`-> Evaluando [Noul] ${name}`);
    let idx = 0;
    for (const c of cases) {
      idx++;
      const baseState = stateFn(c);
      const state = preamble ? `${preamble}\n\n${baseState}` : baseState;
      const payload = { state, questions };
      const tokens_est = estimateTokens(JSON.stringify(payload));

      try {
        const res = await callWithRetry(payload);
        const answers = res.parsed.answers;
        const noulVals: Record<string, number> = {};
        let allApproved = true;

        for (const [k, q] of Object.entries(questions)) {
          const ans = answers[k];
          if (!ans || typeof ans.noul !== "number") {
            throw new Error(`Respuesta faltante o inválida para pregunta '${k}'`);
          }
          const val = ans.noul;
          noulVals[k] = val;
          const isNegative = (q as any).polarity === "negative";
          if (isNegative ? val >= 0.5 : val <= 0.5) allApproved = false;
        }

        recordRun({
          case_id: c.id,
          variant: name,
          model: modelName,
          dataset: datasetName,
          request: payload,
          raw_output: res.rawOutput,
          parsed: { noul: noulVals },
          approved: allApproved,
          latency_ms: res.latencyMs,
          tokens_est,
          error: null,
        });
        process.stdout.write(`   [${idx}/${cases.length}] ${c.id}: ${allApproved ? 'APROB' : 'RECH'} (${res.latencyMs}ms)\r`);
      } catch (e: any) {
        recordRun({
          case_id: c.id,
          variant: name,
          model: modelName,
          dataset: datasetName,
          request: payload,
          approved: false,
          latency_ms: 0,
          tokens_est,
          error: e.message || String(e),
        });
      }
    }
    console.log(`\n   Completado: ${name}`);
  }

  // Ejecutor Choice
  async function runChoice(
    name: string,
    stateFn: (c: TestCase) => string,
    questionName: string,
    instructions: string,
    criteria: Record<string, string>,
    acceptedChoices: string[],
    modes: ("standard" | "reverse")[] = ["standard"]
  ) {
    for (const mode of modes) {
      const runName = mode === "standard" ? name : `${name}-reverse`;
      console.log(`-> Evaluando [Choice] ${runName}`);
      const finalCriteria = permuteCriteria(criteria, mode);
      let idx = 0;
      for (const c of cases) {
        idx++;
        const state = stateFn(c);
        const payload = {
          state,
          questions: {
            [questionName]: {
              type: "choice",
              instructions,
              criteria: finalCriteria,
            },
          },
        };
        const tokens_est = estimateTokens(JSON.stringify(payload));

        try {
          const res = await callWithRetry(payload);
          const ans = res.parsed.answers[questionName];
          if (!ans || !ans.choice) {
            throw new Error(`Respuesta faltante o inválida para pregunta choice '${questionName}'`);
          }
          const choice = ans.choice;
          const probs = ans.probabilities || {};
          const approved = acceptedChoices.includes(choice || "");

          recordRun({
            case_id: c.id,
            variant: name,
            model: modelName,
            dataset: datasetName,
            perm: mode,
            options: Object.keys(finalCriteria).length,
            request: payload,
            raw_output: res.rawOutput,
            parsed: { choice, probabilities: probs },
            approved,
            latency_ms: res.latencyMs,
            tokens_est,
            error: null,
          });
          process.stdout.write(`   [${idx}/${cases.length}] ${c.id}: ${choice} (${res.latencyMs}ms)\r`);
        } catch (e: any) {
          recordRun({
            case_id: c.id,
            variant: name,
            model: modelName,
            dataset: datasetName,
            perm: mode,
            options: Object.keys(finalCriteria).length,
            request: payload,
            approved: false,
            latency_ms: 0,
            tokens_est,
            error: e.message || String(e),
          });
        }
      }
      console.log(`\n   Completado: ${runName}`);
    }
  }

  // Ejecutor Score (tipo "score")
  async function runScore(
    name: string,
    stateFn: (c: TestCase) => string,
    questionName: string,
    instructions: string,
    levels: string[]
  ) {
    console.log(`-> Evaluando [Score] ${name}`);
    let idx = 0;
    for (const c of cases) {
      idx++;
      const state = stateFn(c);
      const payload = {
        state,
        questions: {
          [questionName]: {
            type: "score",
            instructions,
            criteria: levels,
          },
        },
      };
      const tokens_est = estimateTokens(JSON.stringify(payload));

      try {
        const res = await callWithRetry(payload);
        const ans = res.parsed.answers[questionName];
        if (!ans || typeof ans.score !== "number") {
          throw new Error(`Respuesta faltante o inválida para pregunta score '${questionName}'`);
        }
        const scoreVal = ans.score;
        const probs = ans.probabilities || {};
        const legend = (ans as any).legend;

        recordRun({
          case_id: c.id,
          variant: name,
          model: modelName,
          dataset: datasetName,
          request: payload,
          raw_output: res.rawOutput,
          parsed: {
            score: {
              level: scoreVal,
              probabilities: probs,
              legend,
            },
          },
          approved: false,
          score: true,
          latency_ms: res.latencyMs,
          tokens_est,
          error: null,
        });
        process.stdout.write(`   [${idx}/${cases.length}] ${c.id}: score=${scoreVal.toFixed(2)} (${res.latencyMs}ms)\r`);
      } catch (e: any) {
        recordRun({
          case_id: c.id,
          variant: name,
          model: modelName,
          dataset: datasetName,
          request: payload,
          approved: false,
          score: true,
          latency_ms: 0,
          tokens_est,
          error: e.message || String(e),
        });
      }
    }
    console.log(`\n   Completado: ${name}`);
  }

  // Ejecutor Multi: UN request con varias preguntas (choice / noul / score) y guardado del mapa completo.
  // acceptedChoices es POR pregunta choice: { effect: ["matches"], result_status: ["effect_confirmed"] }.
  // Aprobado = todas las noul > 0.5 (o < 0.5 si polarity negative) y todas las choice dentro de su lista.
  async function runMulti(
    name: string,
    stateFn: (c: TestCase) => string,
    questions: Record<string, any>,
    acceptedChoices: Record<string, string[]>
  ) {
    console.log(`-> Evaluando [Multi] ${name}`);
    let idx = 0;
    for (const c of cases) {
      idx++;
      const state = stateFn(c);
      const payload = { state, questions };
      const tokens_est = estimateTokens(JSON.stringify(payload));

      try {
        const res = await callWithRetry(payload);
        const answers = res.parsed.answers;
        const stored: Record<string, MultiAnswer> = {};
        let allApproved = true;

        for (const [k, q] of Object.entries(questions)) {
          const ans = answers[k];
          const qtype = (q as any).type;
          if (!ans) throw new Error(`Respuesta faltante para pregunta '${k}'`);

          if (qtype === "noul") {
            if (typeof ans.noul !== "number") {
              throw new Error(`Respuesta noul inválida para pregunta '${k}'`);
            }
            stored[k] = { type: "noul", noul: ans.noul };
            const isNegative = (q as any).polarity === "negative";
            if (isNegative ? ans.noul >= 0.5 : ans.noul <= 0.5) allApproved = false;
          } else if (qtype === "choice") {
            if (!ans.choice) throw new Error(`Respuesta choice inválida para pregunta '${k}'`);
            const accepted = acceptedChoices[k];
            if (!accepted) throw new Error(`Falta acceptedChoices para la pregunta choice '${k}'`);
            const ok = accepted.includes(ans.choice);
            stored[k] = { type: "choice", choice: ans.choice, probabilities: ans.probabilities || {}, approved: ok };
            if (!ok) allApproved = false;
          } else if (qtype === "score") {
            if (typeof ans.score !== "number") {
              throw new Error(`Respuesta score inválida para pregunta '${k}'`);
            }
            stored[k] = { type: "score", score: ans.score, probabilities: ans.probabilities || {} };
          } else {
            throw new Error(`Tipo de pregunta no soportado en runMulti: '${qtype}' (${k})`);
          }
        }

        recordRun({
          case_id: c.id,
          variant: name,
          model: modelName,
          dataset: datasetName,
          request: payload,
          raw_output: res.rawOutput,
          parsed: { answers: stored },
          approved: allApproved,
          latency_ms: res.latencyMs,
          tokens_est,
          error: null,
        });
        process.stdout.write(`   [${idx}/${cases.length}] ${c.id}: ${allApproved ? 'APROB' : 'RECH'} (${res.latencyMs}ms)\r`);
      } catch (e: any) {
        recordRun({
          case_id: c.id,
          variant: name,
          model: modelName,
          dataset: datasetName,
          request: payload,
          approved: false,
          latency_ms: 0,
          tokens_est,
          error: e.message || String(e),
        });
      }
    }
    console.log(`\n   Completado: ${name}`);
  }

  // Ejecución dinámica según las variantes exportadas por el módulo de prompts
  if (p.prompts === "v1") {
    await runNoul("V0", promptModule.buildStateV0, promptModule.QUESTIONS_V0);
    await runNoul("V0b", promptModule.buildStateSPlus, promptModule.QUESTIONS_V0);
    await runChoice(
      "V1",
      promptModule.buildStateSPlus,
      "effect",
      "Compare the step instruction with the arguments used and the tool output. What best describes the effect of the tool call?",
      promptModule.CRITERIA_V1,
      ["matches"],
      ["standard", "reverse"]
    );
    await runChoice(
      "V1-3",
      promptModule.buildStateSPlus,
      "effect",
      "Compare the step instruction with the arguments used and the tool output. What best describes the effect of the tool call?",
      promptModule.CRITERIA_V1_3,
      ["matches"],
      ["standard"]
    );
    await runNoul("V3", promptModule.buildStateSPlus, promptModule.QUESTIONS_V3);
  } else if (p.prompts === "v2") {
    // prompts2.ts
    const v1Module = await import("./prompts/v1.ts");
    await runNoul("R1_V0_clipHT", promptModule.buildStateV0HT, v1Module.QUESTIONS_V0);
    await runNoul("R2_V0_preguntasB", promptModule.buildStateV0HT, promptModule.QUESTIONS_V0_B);
    await runNoul("R3_V0_preambuloB", promptModule.buildStateV0HT, v1Module.QUESTIONS_V0, promptModule.JUDGE_PREAMBLES?.B);
    await runNoul("R4_V3_targetsS4", promptModule.buildStateS4, v1Module.QUESTIONS_V3);
    await runNoul("R5_V3_B", promptModule.buildStateS4, promptModule.QUESTIONS_V3_B);
    await runNoul("R6_V3_C", promptModule.buildStateS4, promptModule.QUESTIONS_V3_C);
    await runChoice(
      "R7_V1_3_B",
      promptModule.buildStateSPlusHT,
      "effect",
      "Compare the step instruction with the arguments used and the tool output. What best describes the effect of the tool call?",
      promptModule.CRITERIA_V1_3_B,
      ["matches"],
      ["standard", "reverse"]
    );
    await runChoice(
      "R8_V1_3_C",
      promptModule.buildStateS4,
      "effect",
      "Compare the step instruction with the arguments used and the tool output. What best describes the effect of the tool call?",
      promptModule.CRITERIA_V1_3_C,
      ["matches"],
      ["standard", "reverse"]
    );
    await runChoice(
      "R9_V1_B",
      promptModule.buildStateSPlusHT,
      "effect",
      "Compare the step instruction with the arguments used and the tool output. What best describes the effect of the tool call?",
      promptModule.CRITERIA_V1_B,
      ["matches"],
      ["standard", "reverse"]
    );
    await runNoul("R10_Preguntas_Negativas", promptModule.buildStateS4, promptModule.QUESTIONS_NEG);
  } else if (typeof promptModule.runEvaluation === "function") {
    // Protocolo estándar para v3 en adelante: el archivo exporta runEvaluation({ runNoul, runChoice, runScore, cases })
    await promptModule.runEvaluation({ runNoul, runChoice, runScore, runMulti, cases });
  } else {
    console.warn(`El módulo de prompts ${p.prompts} no tiene un protocolo definido. Exportá 'runEvaluation' para auto-ejecución.`);
  }

  stream.end();
  console.log(`\n¡Evaluación finalizada! Total llamadas HTTP: ${totalCalls}`);

  // Generar scores.json compacto automáticamente
  saveScoresSummary(runsFile, datasetFile, scoresFile, { model: modelName, dataset: datasetName });
}

main().catch(console.error);