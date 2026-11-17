/**
 * eval/exp/memory_matching.ts
 *
 * Banco offline (sin modelos) contra `selectFacts` real de `src/memory/index.ts`.
 * Reproduce los casos de `docs/evaluacion/analisis/FRENTE_1_MEMORIA.md` (14 selección + 8 no contaminación)
 * y suma casos de alias, plurales (`-s`), palabras protegidas (`-is`/`-ss`/`<4`), prioridad por especificidad
 * y tope `MAX_FACTS_PER_PROMPT = 3`.
 *
 * Uso: npx tsx eval/exp/memory_matching.ts
 */

import fs from "node:fs";
import { resolve } from "node:path";
import { MAX_FACTS_PER_PROMPT, parseFacts, selectFacts } from "../../src/memory/index.ts";
import type { MemoryFact } from "../../src/memory/index.ts";

interface MemoryCase {
  id: string;
  group: string;
  description: string;
  text: string;
  factsOverride?: MemoryFact[];
  expectedKeys?: string[];
  expectedTopKey?: string;
  expectedContainsKeys?: string[];
  expectedMaxCount?: number;
}

interface CasesFile {
  description: string;
  facts: MemoryFact[];
  cases: MemoryCase[];
}

const DATA_PATH = resolve("eval/exp/memory_matching_cases.json");
const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as CasesFile;
const baseFacts = parseFacts(raw.facts);

let passed = 0;
let failed = 0;
const byGroup = new Map<string, { total: number; passed: number }>();

for (const c of raw.cases) {
  const facts = c.factsOverride ? parseFacts(c.factsOverride) : baseFacts;
  const max = c.expectedMaxCount ?? MAX_FACTS_PER_PROMPT;
  const selected = selectFacts(c.text, facts, max);
  const actualKeys = selected.map((f) => f.key);
  const errs: string[] = [];

  if (c.expectedKeys !== undefined) {
    const same = actualKeys.length === c.expectedKeys.length && actualKeys.every((k, i) => k === c.expectedKeys![i]);
    if (!same) errs.push(`esperado exacto [${c.expectedKeys.join(", ")}], obtenido [${actualKeys.join(", ")}]`);
  }
  if (c.expectedTopKey !== undefined && actualKeys[0] !== c.expectedTopKey) {
    errs.push(`esperado top '${c.expectedTopKey}', obtenido '${actualKeys[0] ?? "(ninguno)"}'`);
  }
  for (const k of c.expectedContainsKeys ?? []) {
    if (!actualKeys.includes(k)) errs.push(`falta clave esperada '${k}' en [${actualKeys.join(", ")}]`);
  }
  if (selected.length > max) {
    errs.push(`superó el tope ${max}: ${selected.length}`);
  }

  const g = byGroup.get(c.group) ?? { total: 0, passed: 0 };
  g.total++;
  if (errs.length === 0) {
    passed++;
    g.passed++;
  } else {
    failed++;
    console.error(`FAIL ${c.id} (${c.group}): ${errs.join("; ")} — "${c.text}"`);
  }
  byGroup.set(c.group, g);
}

console.log(`Memory matching offline (` + `${raw.cases.length} casos, MAX_FACTS_PER_PROMPT=${MAX_FACTS_PER_PROMPT}): ${passed}/${raw.cases.length} pasaron`);
for (const [group, s] of byGroup) {
  console.log(`  - ${group}: ${s.passed}/${s.total}`);
}

if (failed > 0) process.exit(1);
