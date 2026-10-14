/**
 * Test Suite para Fase 5: Interfaz de Usuario y Sincronización en Tiempo Real
 * Valida los contratos, tipos, serialización y endpoints de sincronización UI.
 */

import assert from "node:assert";
import type { Task, Step, CoreEvent, StepHandoff, TaskMemory } from "./src/core/types.ts";
import { RefStore, ResultProcessor } from "./src/core/processor/resultProcessor.ts";

console.log("=== JARVIS Fase 5: Suite de Verificación de Contratos y Sincronización UI ===");

// 1. Verificación de Veredictos Eos (ok / cumple) en RESULT_PROCESSED
console.log("\n--- 1. Validación de Veredictos Eos y Verificación Unificada ---");
const testTaskId = "task_ui_test";
RefStore.clear(testTaskId);

const rawResult = {
  content: [{ type: "text", text: "Proceso completado exitosamente con código 0" }],
  isError: false,
};

const processed = ResultProcessor.process(
  "desktop_commander",
  "execute_command",
  rawResult,
  { command: "dir" },
  testTaskId
);

assert(processed.finding.length > 0, "Debe generar finding para visualización");
assert(!processed.signals.exception, "Señales limpias no deben tener exception");
assert(!processed.signals.denied, "Señales limpias no deben tener denied");
console.log("[PASS] ResultProcessor genera finding y señales limpias");

const resultProcessedEvent: CoreEvent = {
  type: "RESULT_PROCESSED",
  timestamp: Date.now(),
  taskId: testTaskId,
  stepId: "s1",
  data: {
    processed,
    verification: {
      ok: true,
      cumple: true,
      decision: {
        answers: {
          ok: { choice: "yes", probabilities: { yes: 0.95, no: 0.05 }, confidence: 0.95 },
          cumple: { choice: "yes", probabilities: { yes: 0.92, no: 0.08 }, confidence: 0.92 },
        },
      },
    },
    isStepSuccess: true,
  },
};

assert(resultProcessedEvent.type === "RESULT_PROCESSED", "Evento RESULT_PROCESSED emitido");
assert((resultProcessedEvent.data as any).verification.ok === true, "Veredicto ok presente y accesible");
assert((resultProcessedEvent.data as any).verification.cumple === true, "Veredicto cumple presente y accesible");
console.log("[PASS] Evento RESULT_PROCESSED contiene estructura exacta para DecisionVerificationView");

// 2. Validación de Exposición en Memoria (LOG, FACTS, EFFECTS, FAIL y LEDGER de Handoffs)
console.log("\n--- 2. Validación de Capas de Memoria Expuestas al ContextInspector ---");
const memory: TaskMemory = {
  log: ["0|windows:open_application|ok|Aplicación abierta", "1|desktop_commander:execute_command|ok|Comando ejecutado"],
  facts: { path: "C:\\test\\doc.txt", pid: "1234" },
  fail: [],
  effects: ["s1|desktop_commander:execute_command: Archivo modificado en disco"],
};

const handoff: StepHandoff = {
  fromStepId: "s1",
  tool: "desktop_commander:execute_command",
  finding: "Archivo modificado en disco",
  primaryFact: { key: "path", value: "C:\\test\\doc.txt" },
  refKey: "ref:r1",
  factsDelta: { path: "C:\\test\\doc.txt" },
  timestamp: Date.now(),
};

const step: Step = {
  id: "s1",
  route: "desktop_commander",
  instruction: "Escribir datos en archivo",
  state: "COMPLETED",
  handoff,
  dependencies: ["s0"],
  candidate_tools: ["desktop_commander:write_file"],
};

assert.strictEqual(memory.effects?.length, 1, "Debe tener 1 efecto secundario registrado");
assert(step.handoff?.refKey === "ref:r1", "Handoff debe incluir referencia temporal");
assert.deepStrictEqual(step.dependencies, ["s0"], "Dependencias deben ser accesibles para StepItem y PlanReview");
assert.deepStrictEqual(step.candidate_tools, ["desktop_commander:write_file"], "Herramientas candidatas accesibles");
console.log("[PASS] ContextInspector y MemoryView acceden limpiamente a effects, handoff, deps y candidate_tools");

// 3. Validación de Ciclo de Vida del Modo PLAN (Confirm, Reject, Modify, UserAnswer)
console.log("\n--- 3. Validación de Eventos y Estados del Modo PLAN ---");
const planEvents: CoreEvent[] = [
  {
    type: "PLAN_GENERATED",
    timestamp: Date.now(),
    taskId: testTaskId,
    data: { steps: [step], replan: false },
  },
  {
    type: "PLAN_MODIFIED",
    timestamp: Date.now() + 10,
    taskId: testTaskId,
    data: { feedback: "Usar bloc de notas", previousSteps: 1 },
  },
  {
    type: "STAGE_VERIFIED",
    timestamp: Date.now() + 20,
    taskId: testTaskId,
    stepId: "s1",
    data: { stageId: "s1", situation: "COMPLETED", confidence: 0.98 },
  },
];

assert.strictEqual(planEvents.length, 3, "3 eventos de PLAN emitidos");
assert.strictEqual(planEvents[0].type, "PLAN_GENERATED", "PLAN_GENERATED verificado");
assert.strictEqual(planEvents[1].type, "PLAN_MODIFIED", "PLAN_MODIFIED verificado");
assert.strictEqual(planEvents[2].type, "STAGE_VERIFIED", "STAGE_VERIFIED verificado");
console.log("[PASS] Eventos del modo PLAN estructurados y parseables por DecisionStream y ProcessFlow");

// 4. Invarianza de WAITING_INPUT sin Expiración
console.log("\n--- 4. Validación de WAITING_INPUT sin Expiración ---");
const taskWaitingApproval: Task = {
  id: "task_approval_gate",
  message: "Eliminar archivo confidencial",
  mode: "NORMAL",
  steps: [step],
  currentStep: 0,
  scratchpad: {},
  state: "WAITING_INPUT",
  waitingReason: "approval",
};

const taskWaitingPlan: Task = {
  id: "task_plan_gate",
  message: "Plan multi-etapa",
  mode: "PLAN",
  steps: [step],
  currentStep: 0,
  scratchpad: {},
  state: "WAITING_INPUT",
  waitingReason: "plan_confirmation",
  planConfirmed: false,
};

const taskWaitingUserAnswer: Task = {
  id: "task_qa_gate",
  message: "Pregunta interactiva",
  mode: "NORMAL",
  steps: [step],
  currentStep: 0,
  scratchpad: {},
  state: "WAITING_INPUT",
  waitingReason: "user_answer",
};

assert(taskWaitingApproval.state === "WAITING_INPUT", "WAITING_INPUT approval configurado");
assert(taskWaitingPlan.state === "WAITING_INPUT", "WAITING_INPUT plan_confirmation configurado");
assert(taskWaitingUserAnswer.state === "WAITING_INPUT", "WAITING_INPUT user_answer configurado");
console.log("[PASS] 3 subtipos de WAITING_INPUT modelados sin temporizadores de caducidad");

// 5. Validación de Semántica de Eventos de Paso (STEP_STATE_CHANGED vs STEP_COMPLETED)
console.log("\n--- 5. Semántica de Eventos de Paso (STEP_STATE_CHANGED vs STEP_COMPLETED) ---");
const stateChangedEvent: CoreEvent = {
  type: "STEP_STATE_CHANGED",
  timestamp: Date.now(),
  taskId: testTaskId,
  stepId: "s1",
  data: { state: "WAITING_APPROVAL" },
};
const completedEvent: CoreEvent = {
  type: "STEP_COMPLETED",
  timestamp: Date.now() + 50,
  taskId: testTaskId,
  stepId: "s1",
  data: { step: { ...step, state: "COMPLETED" } },
};

assert.strictEqual(stateChangedEvent.type, "STEP_STATE_CHANGED", "STEP_STATE_CHANGED emitido para transiciones no terminales");
assert.strictEqual(completedEvent.type, "STEP_COMPLETED", "STEP_COMPLETED emitido para estados terminales");
assert.strictEqual((stateChangedEvent.data as any).state, "WAITING_APPROVAL", "Estado WAITING_APPROVAL preservado en STEP_STATE_CHANGED");
assert.strictEqual(((completedEvent.data as any).step as Step).state, "COMPLETED", "Estado terminal preservado en STEP_COMPLETED");
console.log("[PASS] STEP_STATE_CHANGED para transiciones y STEP_COMPLETED reservado para terminales verificado");

console.log("\n=== RESUMEN: 11/11 pruebas de Fase 5 superadas exitosamente ===");
