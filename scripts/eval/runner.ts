import fs from "node:fs";
import path from "node:path";
import { loadDataset, permuteCriteria, saveScoresSummary } from "./core/utils.ts";
import { callDecisionModel, type ClientConfig } from "./core/client.ts";
import { estimateTokens } from "../../src/core/llmTransport.ts";
import type { TestCase, RunRecord } from "./core/types.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {
    model: "d3",          // d3 | eos
    device: "gpu",        // gpu | cpu
    dataset: "v2",        // v1 | v2 | custom_path
    prompts: "v2",        // v1 | v2 | v3 | custom_path
    tag: "",              // optional run tag
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

async function main() {
  const p = parseArgs();

  // 1. Resolver Dataset
  let datasetFile: string;
  if (p.dataset === "v1") datasetFile = path.resolve(process.cwd(), "scripts/eval/datasets/dataset_v1.jsonl");
  else if (p.dataset === "v2") datasetFile = path.resolve(process.cwd(), "scripts/eval/datasets/dataset_v2.jsonl");
  else datasetFile = path.resolve(process.cwd(), p.dataset);

  const cases = loadDataset(datasetFile);

  // 2. Resolver Prompts
  let promptModulePath: string;
  if (["v1", "v2", "v3"].includes(p.prompts)) {
    promptModulePath = path.resolve(process.cwd(), `scripts/eval/prompts/${p.prompts}.ts`);
  } else {
    promptModulePath = path.resolve(process.cwd(), p.prompts);
  }

  if (!fs.existsSync(promptModulePath)) {
    throw new Error(`Módulo de prompts no encontrado en: ${promptModulePath}`);
  }

  const promptModule = await import(`file://${promptModulePath.replace(/\\/g, "/")}`);

  // 3. Configurar Cliente del Modelo
  const isCpu = p.device === "cpu";
  const clientConfig: ClientConfig = {
    backend: p.model === "eos" ? "eos" : "d3",
    url: p.model === "eos" ? "http://127.0.0.1:8765" : "http://127.0.0.1:11434",
    model: p.model === "eos" ? "decision-2.0-eos" : isCpu ? "d3:2b-cpu" : "d3:2b",
    options: isCpu ? { num_gpu: 0 } : {},
  };

  // 4. Directorio de Salida
  const TODAY = new Date().toISOString().split("T")[0];
  const tagSuffix = p.tag ? `_${p.tag}` : "";
  const outputDir = path.resolve(
    process.cwd(),
    `scripts/results/${clientConfig.backend}_${p.device}/${path.basename(datasetFile, ".jsonl")}/${path.basename(promptModulePath, ".ts")}${tagSuffix}`
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
        const res = await callDecisionModel(clientConfig, payload);
        totalCalls++;
        const answers = res.parsed.answers;
        const noulVals: Record<string, number> = {};
        let allApproved = true;

        for (const [k, q] of Object.entries(questions)) {
          const val = answers[k]?.noul ?? 0;
          noulVals[k] = val;
          const isNegative = (q as any).polarity === "negative";
          if (isNegative ? val >= 0.5 : val <= 0.5) allApproved = false;
        }

        recordRun({
          case_id: c.id,
          variant: name,
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
          request: payload,
          approved: false,
          latency_ms: 0,
          tokens_est,
          error: e.message,
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
          const res = await callDecisionModel(clientConfig, payload);
          totalCalls++;
          const choice = res.parsed.answers[questionName]?.choice;
          const probs = res.parsed.answers[questionName]?.probabilities || {};
          const approved = acceptedChoices.includes(choice || "");

          recordRun({
            case_id: c.id,
            variant: name,
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
            perm: mode,
            options: Object.keys(finalCriteria).length,
            request: payload,
            approved: false,
            latency_ms: 0,
            tokens_est,
            error: e.message,
          });
        }
      }
      console.log(`\n   Completado: ${runName}`);
    }
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
    // Protocolo estándar para v3 en adelante: el archivo exporta runEvaluation({ runNoul, runChoice, cases })
    await promptModule.runEvaluation({ runNoul, runChoice, cases });
  } else {
    console.warn(`El módulo de prompts ${p.prompts} no tiene un protocolo definido. Exportá 'runEvaluation' para auto-ejecución.`);
  }

  stream.end();
  console.log(`\n¡Evaluación finalizada! Total llamadas HTTP: ${totalCalls}`);

  // Generar scores.json compacto automáticamente
  saveScoresSummary(runsFile, datasetFile, scoresFile);
}

main().catch(console.error);
