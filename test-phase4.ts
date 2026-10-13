import { RefStore } from "./src/core/processor/resultProcessor.ts";
import { resolveReferences } from "./src/core/processor/refResolver.ts";
import { addLogEntry, addEffectEntry, applyStepHandoff, TaskExecutionContext } from "./src/core/context.ts";
import { Guard } from "./src/core/policy/guard.ts";
import { Step, Task } from "./src/core/types.ts";

console.log("=== JARVIS Fase 4: Suite de Verificación Técnica ===");

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
    total++;
    if (condition) {
        console.log(`[PASS] ${msg}`);
        passed++;
    } else {
        console.error(`[FAIL] ${msg}`);
        process.exitCode = 1;
    }
}

// 1. Prueba de RefStore y resolveReferences
console.log("\n--- 1. Prueba de RefStore y resolveReferences ---");
const taskId = "task_test_fase4";
const r1Key = RefStore.put("C:/Users/test/documento_importante.txt", taskId);
const r2Key = RefStore.put(JSON.stringify({ user: "admin", role: "operator" }), taskId);
const r3Content = "Resultado muy largo de terminal con 1000 lineas";
const r3Key = RefStore.put(r3Content, taskId);

assert(r1Key === "r1", `r1Key generado correctamente: ${r1Key}`);
assert(r2Key === "r2", `r2Key generado correctamente: ${r2Key}`);
assert(r3Key === "r3", `r3Key generado correctamente: ${r3Key}`);

const rawArgs = {
    targetPath: "{{ref:r1}}",
    details: "Procesar {{ref:r1}} con perfil {{ref:r2}}",
    config: "{{ref:r2}}",
    nested: {
        rawToken: "ref:r3",
        items: ["item1", "{{ref:r1}}"]
    },
    unresolved: "{{ref:r999}}"
};

const res = resolveReferences(rawArgs, taskId);
assert(res.replacedCount >= 4, `Reemplazos totales esperados >= 4, obtenidos: ${res.replacedCount}`);
assert(res.resolvedArgs.targetPath === "C:/Users/test/documento_importante.txt", "targetPath resuelto exactamente");
assert(typeof res.resolvedArgs.config === "object" && (res.resolvedArgs.config as any).user === "admin", "config JSON parseado y resuelto");
assert(typeof res.resolvedArgs.details === "string" && (res.resolvedArgs.details as string).includes("documento_importante.txt"), "details embebido resuelto");
assert((res.resolvedArgs.nested as any).rawToken === r3Content, "nested.rawToken resuelto");
assert((res.resolvedArgs.nested as any).items[1] === "C:/Users/test/documento_importante.txt", "array item resuelto");
assert(res.unresolvedRefs.includes("r999"), "r999 registrado como unresolvedRef");

// 2. Prueba de Guard evaluando argumentos resueltos vs token sin resolver
console.log("\n--- 2. Prueba de Guard sobre argumentos resueltos ---");
// Si el comando fuera "{{ref:r4}}" que contiene un comando destructivo "rmdir /s /q C:\\", Guard debe detectarlo tras resolución
const r4Key = RefStore.put("rmdir /s /q C:\\Windows", taskId);
const argsWithRef = { command: "{{ref:r4}}" };
const resolvedArgsGuard = resolveReferences(argsWithRef, taskId);
const guardDecision = Guard.evaluate("desktop_commander", "run_command", resolvedArgsGuard.resolvedArgs);
assert(guardDecision.decision === "APPROVAL" || guardDecision.decision === "DENY", `Guard inspecciona comando real resuelto y exige aprobación o deniega: ${guardDecision.decision}`);

// 3. Prueba de LOG continuo sin colapso estadístico prematuro
console.log("\n--- 3. Prueba de LOG continuo ---");
const mockContext: TaskExecutionContext = {
    task: {
        id: taskId,
        message: "Test task",
        mode: "PLAN",
        steps: [],
        currentStep: 0,
        scratchpad: {},
        state: "RUNNING",
        memory: { log: [], facts: {}, fail: [], effects: [] },
    },
    abortController: new AbortController(),
    isCancelled: false,
    pendingApproval: null,
    executedSignatures: new Set(),
    nonReadCounter: 0,
    lastActionWasRead: false,
    consecutiveLoopBlocks: 0,
    totalToolCalls: 0,
    escalations: 0,
    startTime: Date.now(),
    overridesCount: 0,
    retriesCount: 0,
    memoryRetrievalLimit: 2,
};

for (let i = 1; i <= 15; i++) {
    addLogEntry(mockContext, `${i}|tool_${i}|ok|Hallazgo del paso ${i}`);
}
assert(mockContext.task.memory!.log.length === 15, `Log contiene las 15 entradas completas sin colapso a 1-N (actual: ${mockContext.task.memory!.log.length})`);
assert(!mockContext.task.memory!.log.some((l: string) => l.startsWith("1-")), "Ninguna línea fue reemplazada por resumen estadístico '1-N: X ok, Y err'");

// 4. Prueba de effects
console.log("\n--- 4. Prueba de Registro de Effects ---");
addEffectEntry(mockContext, "s1|write_file|Archivo creado: config.json");
addEffectEntry(mockContext, "s2|delete_file|Archivo temporal eliminado: tmp.txt");
assert(mockContext.task.memory!.effects!.length === 2, `Effects registrados correctamente: ${mockContext.task.memory!.effects!.length}`);
assert(mockContext.task.memory!.effects![0].includes("config.json"), "Effect 1 contiene detalle de mutación");

// 5. Prueba de Handoff determinista
console.log("\n--- 5. Prueba de Step Handoff Determinista ---");
mockContext.lastHandoff = {
    fromStepId: "s1",
    tool: "search_files",
    finding: "3 archivos hallados",
    primaryFact: { key: "path", value: "C:/docs/report.pdf" },
    refKey: "r1",
    factsDelta: { path: "C:/docs/report.pdf" },
    timestamp: Date.now(),
};

const step2: Step = {
    id: "s2",
    route: "desktop_commander",
    instruction: "Leer el archivo hallado",
    state: "PENDING",
    calls: [],
};

const enrichedInstruction = applyStepHandoff(step2, mockContext);
assert(enrichedInstruction.includes("[HANDOFF s1 (search_files)]"), "Enriched instruction incluye prefijo de handoff");
assert(enrichedInstruction.includes("path=C:/docs/report.pdf"), "Enriched instruction incluye hecho clave");
assert(enrichedInstruction.includes("ref:r1"), "Enriched instruction incluye refKey");

console.log(`\n=== RESUMEN: ${passed}/${total} pruebas pasaron satisfactoriamente ===`);
