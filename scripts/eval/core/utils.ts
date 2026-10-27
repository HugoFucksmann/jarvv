import fs from "node:fs";
import path from "node:path";
import type { TestCase, RunRecord } from "./types.ts";

export function loadDataset(filePath: string): TestCase[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dataset no encontrado en: ${filePath}`);
  }
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TestCase);
}

export function permuteCriteria<T extends Record<string, string>>(criteria: T, mode: "standard" | "reverse"): T {
  const keys = Object.keys(criteria);
  let newKeys = [...keys];
  if (mode === "reverse") {
    newKeys = newKeys.reverse();
  }
  const res: Record<string, string> = {};
  for (const k of newKeys) {
    res[k] = criteria[k];
  }
  return res as T;
}

export function saveScoresSummary(runsFile: string, datasetFile: string, outputFile: string, meta?: { model?: string; dataset?: string }) {
  const casesMap = new Map(loadDataset(datasetFile).map((c) => [c.id, c]));
  const lines = fs.readFileSync(runsFile, "utf-8").split("\n").filter(Boolean);
  const byCase: Record<string, any> = {};

  for (const line of lines) {
    const r: RunRecord = JSON.parse(line);
    const c = casesMap.get(r.case_id);
    if (!byCase[r.case_id]) {
      byCase[r.case_id] = {
        id: r.case_id,
        model: r.model || meta?.model || "unknown",
        dataset: r.dataset || meta?.dataset || path.basename(datasetFile, ".jsonl"),
        category: c ? c.category : "unknown",
        gold_post: c ? c.gold_post : "unknown",
        gold_pre: c ? c.gold_pre : "unknown",
        scores: {},
      };
    }

    const varKey = r.perm && r.perm !== "standard" ? `${r.variant}_${r.perm}` : r.variant;
    let scoreSummary: any = null;

    if (r.parsed?.answers) {
      // Run multi (runMulti): volcar TODAS las preguntas de la variante conjunta.
      const answers: Record<string, any> = {};
      for (const [qk, a] of Object.entries(r.parsed.answers)) {
        if (a.type === "noul") {
          answers[qk] = { type: "noul", noul: Number((a.noul ?? 0).toFixed(3)) };
        } else if (a.type === "choice") {
          const probs: Record<string, number> = {};
          for (const [pk, pv] of Object.entries(a.probabilities || {})) {
            probs[pk] = Number((pv as number).toFixed(3));
          }
          const top = a.choice ? a.probabilities?.[a.choice] : undefined;
          answers[qk] = {
            type: "choice",
            choice: a.choice,
            prob: top !== undefined ? Number(top.toFixed(3)) : undefined,
            probabilities: probs,
            approved: a.approved,
          };
        } else {
          answers[qk] = {
            type: a.type,
            score: a.score !== undefined ? Number(a.score.toFixed(3)) : undefined,
            probabilities: a.probabilities,
          };
        }
      }
      scoreSummary = {
        approved: r.approved,
        multi: true,
        answers,
        latency_ms: r.latency_ms,
        ...(r.error ? { error: r.error } : {}),
      };
    } else if (r.parsed?.noul) {
      const rounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.parsed.noul)) {
        rounded[k] = Number((v as number).toFixed(3));
      }
      scoreSummary = {
        approved: r.approved,
        noul: rounded,
        latency_ms: r.latency_ms,
        ...(r.error ? { error: r.error } : {}),
      };
    } else if (r.parsed?.choice) {
      const topProb = r.parsed.probabilities?.[r.parsed.choice];
      // Redondear distribución completa de probabilidades
      const fullProbs: Record<string, number> = {};
      if (r.parsed.probabilities) {
        for (const [pk, pv] of Object.entries(r.parsed.probabilities)) {
          fullProbs[pk] = Number(pv.toFixed(3));
        }
      }
      scoreSummary = {
        approved: r.approved,
        choice: r.parsed.choice,
        prob: topProb !== undefined ? Number(topProb.toFixed(3)) : undefined,
        probabilities: fullProbs,
        latency_ms: r.latency_ms,
        ...(r.error ? { error: r.error } : {}),
      };
    } else if (r.score || (r.parsed as any)?.score) {
      const sc: any = (r.parsed as any)?.score || {};
      const fullProbs: Record<string, number> = {};
      if (sc.probabilities) {
        for (const [pk, pv] of Object.entries(sc.probabilities)) {
          fullProbs[pk] = Number((pv as number).toFixed(3));
        }
      }
      scoreSummary = {
        approved: r.approved,
        score: true,
        level: sc.level !== undefined ? Number(sc.level.toFixed(3)) : undefined,
        probabilities: fullProbs,
        legend: sc.legend,
        latency_ms: r.latency_ms,
        ...(r.error ? { error: r.error } : {}),
      };
    } else {
      scoreSummary = {
        approved: r.approved,
        latency_ms: r.latency_ms,
        ...(r.error ? { error: r.error } : {}),
      };
    }

    byCase[r.case_id].scores[varKey] = scoreSummary;
  }

  fs.writeFileSync(outputFile, JSON.stringify(Object.values(byCase), null, 2), "utf-8");
  console.log(`Scores compactos guardados en: ${outputFile}`);
}