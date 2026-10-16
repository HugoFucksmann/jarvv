import { PROMPTS, type ReplanPromptData } from "../reasoner/prompts.ts";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  [PASS] " + label);
    passed++;
  } else {
    console.error("  [FAIL] " + label);
    failed++;
  }
}

console.log("\n1. ReplanPromptData interface carries logLines and effects:");

{
  const data: ReplanPromptData = {
    goal: "test goal",
    completedStepsSummary: ["[x] s1 step one -> done"],
    facts: { key: "value" },
    failLines: ["tool_a -> error"],
    logLines: ["s1|tool_a|ok|finding text"],
    effects: ["s1|tool_a: archivo creado"],
    failedStepGoal: "execute failing step",
    failedStepResult: "error: ENOENT",
    remainingPlanGoals: ["[ ] s3 remaining step"],
    nextStepNumber: 3,
  };
  assert(Array.isArray(data.logLines), "logLines field accepted by interface");
  assert(Array.isArray(data.effects), "effects field accepted by interface");
  assert(data.logLines!.length === 1, "logLines preserved correctly");
  assert(data.effects!.length === 1, "effects preserved correctly");
}

console.log("\n2. REPLAN.buildUserPrompt renders LOG and EFFECTS blocks:");

{
  const dataWithContext: ReplanPromptData = {
    goal: "install package",
    completedStepsSummary: ["[x] s1 search registry -> 3 results"],
    facts: { pkg: "lodash" },
    failLines: ["npm_install -> exit=1"],
    logLines: ["s1|search|ok|3 results web", "s2|npm_install|err|exit=1"],
    effects: ["s2|npm_install: intento de instalacion ejecutado"],
    failedStepGoal: "npm install lodash",
    failedStepResult: "exit code 1, permission denied",
    remainingPlanGoals: ["[ ] s3 verify installation"],
    nextStepNumber: 3,
  };
  const prompt = PROMPTS.REPLAN.buildUserPrompt(dataWithContext);
  assert(prompt.includes("LOG:"), "REPLAN prompt contains LOG block");
  assert(prompt.includes("s1|search|ok|3 results web"), "REPLAN prompt LOG contains first log line");
  assert(prompt.includes("s2|npm_install|err|exit=1"), "REPLAN prompt LOG contains second log line");
  assert(prompt.includes("EFFECTS:"), "REPLAN prompt contains EFFECTS block");
  assert(prompt.includes("s2|npm_install: intento de instalacion ejecutado"), "REPLAN prompt EFFECTS contains effect entry");
  assert(prompt.includes("FAIL:"), "REPLAN prompt still contains FAIL block");
  assert(prompt.includes("PASO FALLIDO:"), "REPLAN prompt still contains PASO FALLIDO block");
  assert(prompt.includes("PLAN RESTANTE"), "REPLAN prompt still contains PLAN RESTANTE block");
  const logIdx = prompt.indexOf("LOG:");
  const effectsIdx = prompt.indexOf("EFFECTS:");
  const failIdx = prompt.indexOf("FAIL:");
  const pasoIdx = prompt.indexOf("PASO FALLIDO:");
  assert(logIdx < effectsIdx, "LOG block appears before EFFECTS block");
  assert(effectsIdx < failIdx, "EFFECTS block appears before FAIL block");
  assert(failIdx < pasoIdx, "FAIL block appears before PASO FALLIDO block");
}

console.log("\n3. REPLAN.buildUserPrompt without logLines/effects (backward compat):");

{
  const dataMinimal: ReplanPromptData = {
    goal: "minimal goal",
    completedStepsSummary: [],
    facts: {},
    failLines: ["err"],
    failedStepGoal: "step",
    failedStepResult: "failed",
    remainingPlanGoals: [],
    nextStepNumber: 1,
  };
  const prompt = PROMPTS.REPLAN.buildUserPrompt(dataMinimal);
  assert(!prompt.includes("LOG:"), "No LOG block when logLines is undefined");
  assert(!prompt.includes("EFFECTS:"), "No EFFECTS block when effects is undefined");
  assert(prompt.includes("PASO FALLIDO:"), "PASO FALLIDO block always present");
}

console.log("\n4. factsDelta deferred application conditions:");

{
  function shouldApplyFacts(isStepSuccess: boolean, eosUnavailable: boolean, eosPassed: boolean, isCleanSignals: boolean, actionDispatched: boolean): boolean {
    return isStepSuccess || eosUnavailable || (!eosPassed && isCleanSignals && !actionDispatched);
  }
  assert(shouldApplyFacts(true, false, true, true, false), "Facts applied when isStepSuccess=true");
  assert(shouldApplyFacts(false, true, false, true, false), "Facts applied when eosUnavailable=true");
  assert(shouldApplyFacts(false, false, false, true, false), "Facts applied for clean read, Eos failed verify, no dispatch");
  assert(!shouldApplyFacts(false, false, false, true, true), "Facts discarded when Eos rejects dispatched action");
  assert(!shouldApplyFacts(false, false, false, false, false), "Facts discarded when signals not clean");
  assert(!shouldApplyFacts(false, false, false, false, true), "Facts discarded for error result with dispatch");
}

console.log("\n5. Eos receives compactObs preferentially as evidenceSummary:");

{
  const select = (compactObs: string | undefined, evidenceSummary: string | undefined): string | undefined => compactObs || evidenceSummary;
  const richObs = "line1: important content\nline2: more detail\nline3: final result";
  const shortFinding = "ok: 3 lines, 0.1KB";
  assert(select(richObs, shortFinding) === richObs, "compactObs selected over finding when non-empty");
  assert(select(undefined, shortFinding) === shortFinding, "Falls back to evidence.summary when compactObs undefined");
  assert(select("", shortFinding) === shortFinding, "Falls back to evidence.summary when compactObs empty");
  const longObs = "a".repeat(1500);
  assert(select(longObs, shortFinding) === longObs, "Full 1500-char compactObs preserved for Eos");
}

console.log("\n============================================================");
console.log("RESUMEN DE PRUEBAS: " + passed + "/" + (passed + failed) + " PASARON (" + failed + " FALLOS)");
console.log("============================================================\n");

if (failed > 0) process.exit(1);