/**
 * Suite de Verificación Rigurosa para la Fase 2 de JARVIS Core
 * Pruebas unitarias y de integración de componentes locales.
 */

import fs from "node:fs";
import path from "node:path";
import { TaskPersistenceManager } from "../taskPersistence.ts";
import { RefStore, MAX_REFS_PER_TASK, MAX_REF_CONTENT_CHARS } from "../processor/resultProcessor.ts";
import { createIterationFromEvent, reconstructIterationsFromTask } from "../../utils/debugAccumulator.ts";
import { addRawInteraction, createEmptyMemory } from "../context.ts";
import type { Task, CoreEvent } from "../types.ts";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ [FAIL] ${testName}${detail ? ` — ${detail}` : ""}`);
  }
}

async function runTests() {
  console.log("============================================================");
  console.log("INICIANDO VERIFICACIÓN DE FASE 2: PERSISTENCIA, DEDUPLICACIÓN Y MEMORIA");
  console.log("============================================================\n");

  const testDir = path.resolve(process.cwd(), ".test_scratch");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // ------------------------------------------------------------
  // TEST 1: Persistencia atómica y generación de backup .bak
  // ------------------------------------------------------------
  console.log("1. Persistencia atómica y respaldo .bak:");
  const testFile = path.join(testDir, "tasks_test.json");
  const testBak = `${testFile}.bak`;
  const testTmp = `${testFile}.tmp`;

  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  if (fs.existsSync(testBak)) fs.unlinkSync(testBak);
  if (fs.existsSync(testTmp)) fs.unlinkSync(testTmp);

  const pm = new TaskPersistenceManager({ filePath: testFile, maxPersistedTasks: 3, maxMemoryTasks: 4 });

  const dummyTask1: Task = {
    id: "task_1",
    message: "Primera tarea",
    mode: "NORMAL",
    steps: [],
    currentStep: 0,
    scratchpad: {},
    state: "COMPLETED",
  };

  pm.flushSync([dummyTask1]);
  assert(fs.existsSync(testFile), "El archivo principal se crea atómicamente tras flushSync");
  assert(!fs.existsSync(testTmp), "El archivo temporal .tmp se elimina tras el renombrado atómico");

  // Segunda escritura debe respaldar la versión anterior en .bak
  const dummyTask2: Task = {
    id: "task_2",
    message: "Segunda tarea",
    mode: "NORMAL",
    steps: [],
    currentStep: 0,
    scratchpad: {},
    state: "COMPLETED",
  };
  pm.flushSync([dummyTask1, dummyTask2]);
  assert(fs.existsSync(testBak), "Se genera el archivo de respaldo .bak antes de sobrescribir");
  const bakContent = JSON.parse(fs.readFileSync(testBak, "utf-8"));
  assert(bakContent.length === 1 && bakContent[0].id === "task_1", "El .bak contiene el estado inmediatamente anterior");

  // ------------------------------------------------------------
  // TEST 2: Recuperación automática ante archivo en 0 bytes o corrupto
  // ------------------------------------------------------------
  console.log("\n2. Recuperación automática ante archivo corrupto o en 0 bytes:");
  // Simular truncado a 0 bytes
  fs.writeFileSync(testFile, "", "utf-8");
  assert(fs.statSync(testFile).size === 0, "Archivo principal truncado artificialmente a 0 bytes");

  const recoveredFromZero = pm.loadTasks();
  assert(recoveredFromZero.length === 1 && recoveredFromZero[0].id === "task_1", "loadTasks recuperó las tareas desde el .bak ante archivo de 0 bytes");
  assert(fs.statSync(testFile).size > 0, "Archivo principal fue restaurado automáticamente con el contenido del respaldo");

  // Simular JSON corrupto/dañado en archivo principal
  fs.writeFileSync(testFile, "{ corrupt json data ... [not valid", "utf-8");
  const recoveredFromCorrupt = pm.loadTasks();
  assert(recoveredFromCorrupt.length === 1 && recoveredFromCorrupt[0].id === "task_1", "loadTasks recuperó las tareas desde el .bak ante JSON corrupto");

  // Simular fallo de renameSync en Windows dejando el archivo .tmp intacto y archivo principal ausente/dañado
  const taskSavedInTmp: Task = {
    id: "task_recovered_from_tmp",
    message: "Tarea preservada en .tmp tras fallo de renombrado",
    mode: "NORMAL",
    steps: [],
    currentStep: 0,
    scratchpad: {},
    state: "COMPLETED",
  };
  fs.writeFileSync(testTmp, JSON.stringify([taskSavedInTmp], null, 2), "utf-8");
  fs.writeFileSync(testFile, "", "utf-8"); // Archivo principal vacío por fallo de renombrado previo
  const recoveredFromTmp = pm.loadTasks();
  assert(
    recoveredFromTmp.length === 1 && recoveredFromTmp[0].id === "task_recovered_from_tmp",
    "loadTasks recupera exitosamente las tareas desde el .tmp íntegro cuando renameSync falla"
  );
  assert(
    fs.existsSync(testFile) && fs.readFileSync(testFile, "utf-8").includes("task_recovered_from_tmp"),
    "El archivo principal fue restaurado de forma segura con el contenido del .tmp"
  );

  // ------------------------------------------------------------
  // TEST 3: Desalojo de memoria RAM en taskContexts
  // ------------------------------------------------------------
  console.log("\n3. Desalojo de memoria RAM (pruneMemoryTasks):");
  const dummyContexts = new Map<string, { task: Task }>();

  // Crear 5 tareas: 3 terminales y 2 activas
  dummyContexts.set("t1", { task: { id: "t1", state: "COMPLETED", message: "m1", mode: "NORMAL", steps: [], currentStep: 0, scratchpad: {} } });
  dummyContexts.set("t2", { task: { id: "t2", state: "RUNNING", message: "m2", mode: "NORMAL", steps: [], currentStep: 0, scratchpad: {} } });
  dummyContexts.set("t3", { task: { id: "t3", state: "WAITING_INPUT", message: "m3", mode: "NORMAL", steps: [], currentStep: 0, scratchpad: {} } });
  dummyContexts.set("t4", { task: { id: "t4", state: "FAILED", message: "m4", mode: "NORMAL", steps: [], currentStep: 0, scratchpad: {} } });
  dummyContexts.set("t5", { task: { id: "t5", state: "CANCELLED", message: "m5", mode: "NORMAL", steps: [], currentStep: 0, scratchpad: {} } });

  // maxMemoryTasks configurado en 3
  const evicted = pm.pruneMemoryTasks(dummyContexts);
  assert(dummyContexts.has("t2"), "Tarea en estado RUNNING NUNCA es desalojada de memoria");
  assert(dummyContexts.has("t3"), "Tarea en estado WAITING_INPUT NUNCA es desalojada de memoria");
  assert(dummyContexts.size <= 4, "El total de tareas en memoria se redujo según el límite");
  assert(evicted.length > 0 && evicted.includes("t1"), "La tarea terminal más antigua (t1) fue desalojada correctamente");

  // ------------------------------------------------------------
  // TEST 4: Límites de memoria y desalojo en RefStore
  // ------------------------------------------------------------
  console.log("\n4. Límites de memoria y retención en RefStore:");
  const testTaskId = "task_ref_test";
  RefStore.clear(testTaskId);

  // Insertar más de MAX_REFS_PER_TASK referencias
  for (let i = 1; i <= MAX_REFS_PER_TASK + 5; i++) {
    RefStore.put(`Contenido de prueba número ${i}`, testTaskId);
  }

  const storedKeys = RefStore.list(testTaskId);
  assert(storedKeys.length === MAX_REFS_PER_TASK, `RefStore no supera MAX_REFS_PER_TASK (${MAX_REFS_PER_TASK}) por tarea`);
  assert(!RefStore.has("r1", testTaskId), "La referencia más antigua (r1) fue desalojada por política FIFO");
  assert(RefStore.has(`r${MAX_REFS_PER_TASK + 5}`, testTaskId), "La referencia más reciente se encuentra almacenada");

  // Probar truncamiento de cadenas excesivas
  const hugeString = "X".repeat(MAX_REF_CONTENT_CHARS + 5000);
  const hugeKey = RefStore.put(hugeString, testTaskId);
  const retrieved = RefStore.get(hugeKey, testTaskId);
  assert(Boolean(retrieved && retrieved.length < hugeString.length && retrieved.includes("salida truncada en RefStore")), "Contenido superior a MAX_REF_CONTENT_CHARS es truncado con nota explicativa");

  // Probar limpieza por taskId
  RefStore.clear(testTaskId);
  assert(RefStore.list(testTaskId).length === 0, "RefStore.clear limpia completamente las referencias de la tarea");

  // ------------------------------------------------------------
  // TEST 5: Deduplicación e inmutabilidad de snapshots de iteraciones
  // ------------------------------------------------------------
  console.log("\n5. Deduplicación e inmutabilidad de snapshots de iteraciones:");
  const mutableMemoryTask: Task = {
    id: "task_snapshot_test",
    message: "Meta del usuario",
    mode: "NORMAL",
    steps: [],
    currentStep: 0,
    scratchpad: { text: "v1" },
    state: "RUNNING",
    memory: createEmptyMemory(),
  };

  mutableMemoryTask.memory!.facts["fact1"] = "valor inicial";
  mutableMemoryTask.memory!.log.push("s1|tool|ok|linea 1");

  const d1Event: CoreEvent = {
    type: "DECISION_ONE",
    timestamp: Date.now(),
    taskId: mutableMemoryTask.id,
    data: {
      route: "windows",
      confidence: 0.95,
      rawInput: "PROMPT D1 COMPLETO",
      rawOutput: "OUTPUT D1 COMPLETO",
    },
  };

  const iteration = createIterationFromEvent(d1Event, mutableMemoryTask);
  assert(Boolean(iteration), "createIterationFromEvent generó la iteración de Decision #1");

  // Mutar memoria viva DESPUÉS de crear la iteración
  mutableMemoryTask.memory!.facts["fact1"] = "VALOR MODIFICADO POSTERIORMENTE";
  mutableMemoryTask.memory!.facts["fact2"] = "NUEVO FACT";
  mutableMemoryTask.memory!.log.push("s2|tool|ok|linea 2");

  const capturedFacts = (iteration?.input as any)?.hechosConfirmados;
  const capturedLog = (iteration?.input as any)?.historialRegistrado;

  assert(capturedFacts?.["fact1"] === "valor inicial", "Snapshot inmutable: mutar facts en memoria viva NO altera retrospectivamente la iteración");
  assert(capturedFacts?.["fact2"] === undefined, "Snapshot inmutable: hechos nuevos posteriores no contaminan iteraciones pasadas");
  assert(capturedLog?.length === 1, "Snapshot inmutable: nuevas líneas de LOG no alteran el historial de la iteración previa");

  // Prueba de inmutabilidad profunda sobre arrays y objetos en scratchpad
  mutableMemoryTask.scratchpad.search_results = [{ title: "resultado 1", url: "http://example.com" }];
  const d2Event: CoreEvent = {
    type: "DECISION_TWO",
    timestamp: Date.now(),
    taskId: mutableMemoryTask.id,
    data: {
      tool: "search",
      confidence: 0.9,
      rawInput: "D2 RAW",
      rawOutput: "D2 OUTPUT",
    },
  };
  const iterationD2 = createIterationFromEvent(d2Event, mutableMemoryTask);
  // Mutar el array anidado original en memoria viva
  (mutableMemoryTask.scratchpad.search_results as any[])[0].title = "TITULO MUTADO";
  (mutableMemoryTask.scratchpad.search_results as any[]).push({ title: "resultado 2" });

  const capturedScratchpad = (iterationD2?.input as any)?.variablesScratchpad;
  assert(capturedScratchpad?.search_results?.[0]?.title === "resultado 1", "Snapshot profundo: mutar propiedades de objetos en scratchpad.search_results NO altera la iteración previa");
  assert(capturedScratchpad?.search_results?.length === 1, "Snapshot profundo: agregar elementos a arrays en scratchpad NO altera la iteración previa");

  // Verificar que addRawInteraction no duplica datos
  const initialRawInteractions = mutableMemoryTask.memory!.rawInteractions?.length ?? 0;
  addRawInteraction({ task: mutableMemoryTask } as any, { model: "m", stage: "s", rawInput: "ri", rawOutput: "ro" });
  const finalRawInteractions = mutableMemoryTask.memory!.rawInteractions?.length ?? 0;
  assert(finalRawInteractions === initialRawInteractions, "addRawInteraction no acumula duplicados en memory.rawInteractions");

  // ------------------------------------------------------------
  // TEST 6: Compatibilidad histórica con tareas sin modelIterations
  // ------------------------------------------------------------
  console.log("\n6. Compatibilidad histórica con tareas heredadas:");
  const legacyTask: Task = {
    id: "task_legacy_1",
    message: "Tarea histórica",
    mode: "NORMAL",
    steps: [
      {
        id: "s1",
        route: "windows",
        instruction: "abrir explorador",
        state: "COMPLETED",
        rawInput: "RAW D1 HISTÓRICO",
        rawOutput: "RAW D1 SALIDA",
        calls: [
          {
            id: "c1",
            mcp: "windows",
            tool: "launch_app",
            args: { name: "explorer" },
            rawInput: "RAW CALL HISTÓRICO",
            rawOutput: "RAW CALL SALIDA",
            outcome: { success: true },
          },
        ],
      },
    ],
    currentStep: 0,
    scratchpad: {},
    state: "COMPLETED",
  };

  const reconstructed = reconstructIterationsFromTask(legacyTask);
  assert(reconstructed.length > 0, "reconstructIterationsFromTask genera iteraciones válidas a partir de una tarea histórica sin modelIterations");
  assert(reconstructed.some((it) => it.stage === "DECISION_ONE" && it.rawInput === "RAW D1 HISTÓRICO"), "Reconstrucción preserva rawInput histórico de D1");
  assert(reconstructed.some((it) => it.stage === "ARGUMENT_GENERATION" && it.rawInput === "RAW CALL HISTÓRICO"), "Reconstrucción preserva rawInput histórico de argumentos");

  // Limpieza de scratch
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log("\n============================================================");
  console.log(`RESUMEN DE PRUEBAS: ${passedTests}/${totalTests} PASARON (${failedTests} FALLOS)`);
  console.log("============================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Error fatal ejecutando pruebas:", err);
  process.exit(1);
});
