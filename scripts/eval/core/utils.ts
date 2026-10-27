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

export function saveScoresSummary(runsFile: string, datasetFile: string, outputFile: string) {
  const casesMap = new Map(loadDataset(datasetFile).map((c) => [c.id, c]));
  const lines = fs.readFileSync(runsFile, "utf-8").split("\n").filter(Boolean);
  const byCase: Record<string, any> = {};

  for (const line of lines) {
    const r: RunRecord = JSON.parse(line);
    const c = casesMap.get(r.case_id);
    if (!byCase[r.case_id]) {
      byCase[r.case_id] = {
        id: r.case_id,
        category: c ? c.category : "unknown",
        gold_post: c ? c.gold_post : "unknown",
        gold_pre: c ? c.gold_pre : "unknown",
        scores: {},
      };
    }

    const varKey = r.perm && r.perm !== "standard" ? `${r.variant}_${r.perm}` : r.variant;
    let scoreSummary: any = null;

    if (r.parsed?.noul) {
      const rounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.parsed.noul)) {
        rounded[k] = Number((v as number).toFixed(3));
      }
      scoreSummary = { approved: r.approved, noul: rounded };
    } else if (r.parsed?.choice) {
      const topProb = r.parsed.probabilities?.[r.parsed.choice];
      scoreSummary = {
        approved: r.approved,
        choice: r.parsed.choice,
        prob: topProb !== undefined ? Number(topProb.toFixed(3)) : undefined,
      };
    } else {
      scoreSummary = { approved: r.approved };
    }

    byCase[r.case_id].scores[varKey] = scoreSummary;
  }

  fs.writeFileSync(outputFile, JSON.stringify(Object.values(byCase), null, 2), "utf-8");
  console.log(`Scores compactos guardados en: ${outputFile}`);
}
