/** TaskManager: ciclo de una tarea y cierre ordenado (`drain`): la traza queda escrita y una tarea colgada no demora el apagado más que el plazo. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { JarvisConfig } from "../src/core/config.ts";
import type { EngineLLM } from "../src/core/contracts.ts";
import type { EngineServices } from "../src/core/engine/services.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { TaskBusyError, TaskManager } from "../src/core/tasks.ts";
import type { TaskManagerOptions } from "../src/core/tasks.ts";
import { MAX_RETAINED_TASKS } from "../src/core/types/limits.ts";

function manager(
  root: string,
  pending: EngineLLM["generatePendingFromView"],
  extraDecision: object = {},
  extraLlm: Partial<EngineLLM> = {},
  options?: TaskManagerOptions,
): TaskManager {
  const getConfig = (): JarvisConfig => ({ traceEnabled: true, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d", autoMode: false }) as JarvisConfig;
  const services: EngineServices = {
    vault: createRefVault({ dir: path.join(root, "refs") }),
    guardScope: { protectedDirs: [], relativeBases: [root] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
    autoMode: () => false,
  };
  const llm: EngineLLM = {
    generateArgumentsFromView: async () => {
      throw new Error("no se usa");
    },
    generateQuestion: async () => {
      throw new Error("no se usa");
    },
    generatePendingFromView: pending,
    generatePlanFromView: async () => {
      throw new Error("no se usa");
    },
    generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
    ...extraLlm,
  };
  const discovery = { getServer: () => undefined, getDiscoveredTools: async () => [], getUnavailableServers: () => ({}), validateToolExists: async () => false };
  const decision = {
    ...extraDecision,
    chooseRoute: async () => {
      throw new Error("no se usa");
    },
    chooseTool: async () => {
      throw new Error("no se usa");
    },
    reviewArgs: async () => {
      throw new Error("no se usa");
    },
    verifyResult: async () => {
      throw new Error("no se usa");
    },
    checkCompletion: async () => {
      throw new Error("no se usa");
    },
  };
  return new TaskManager({ decision, discovery, llm }, getConfig, services, options);
}

test("una tarea sin nada que hacer se completa; drain espera a que su traza quede en disco", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const tasks = manager(root, async () => ({ pending: [], rawInput: "", rawOutput: "" }));
  const dto = tasks.start("no hay nada que hacer", "reactive");
  assert.equal(dto.task.state, "running");
  assert.deepEqual(tasks.taskIds(), [dto.task.id]);

  await tasks.drain(3000);
  assert.notEqual(tasks.get(dto.task.id)?.task.state, "running");
  const traces = path.join(root, "traces");
  const folders = fs.readdirSync(traces).filter((n) => n !== "index.jsonl");
  assert.equal(folders.length, 1, "la traza se escribió antes de que drain devolviera");
  assert.ok(folders[0].endsWith(dto.task.id));
  fs.rmSync(root, { recursive: true, force: true });
});

test("drain sin tareas en curso devuelve al instante", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const tasks = manager(root, async () => ({ pending: [], rawInput: "", rawOutput: "" }));
  const t0 = Date.now();
  await tasks.drain(5000);
  assert.ok(Date.now() - t0 < 500);
  fs.rmSync(root, { recursive: true, force: true });
});

test("drain no espera más que el plazo a una tarea colgada, aunque se la cancele", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const tasks = manager(root, () => new Promise(() => undefined));
  const dto = tasks.start("se cuelga", "reactive");
  // Deja que la tarea llegue a la consulta colgada: la primera espera (D0) cede el turno y una cancelación inmediata cerraría la tarea antes de colgarse.
  await new Promise((resolve) => setTimeout(resolve, 20));
  tasks.cancelActive();
  const t0 = Date.now();
  await tasks.drain(300);
  const waited = Date.now() - t0;
  assert.ok(waited >= 250 && waited < 2000, `esperó ${waited} ms`);
  assert.equal(tasks.get(dto.task.id)?.task.state, "running", "la tarea colgada sigue sin cerrar: el plazo manda");
  fs.rmSync(root, { recursive: true, force: true });
});

test("cancel y las decisiones sobre tareas o esperas inexistentes devuelven el código esperado", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const tasks = manager(root, async () => ({ pending: [], rawInput: "", rawOutput: "" }));
  assert.equal(tasks.cancel("task_inexistente"), "unknown_task");
  assert.equal(tasks.approveCall("task_inexistente", "w1"), "unknown_task");
  const dto = tasks.start("x", "reactive");
  await tasks.drain(3000);
  assert.equal(tasks.approveCall(dto.task.id, "w1"), "not_waiting");
  assert.equal(tasks.answer(dto.task.id, "algo"), "not_waiting");
  fs.rmSync(root, { recursive: true, force: true });
});

test("hilo: una tarea completada con respuesta del modelo queda como tarea anterior de la siguiente; una cancelada o con respaldo, no", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const seen: unknown[] = [];
  let failFinal = false;
  const tasks = manager(
    root,
    async () => ({ pending: [], rawInput: "", rawOutput: "" }),
    {
      continuation: async (input: { previous: unknown }) => {
        seen.push(input.previous);
        return { follows: 0, rawInput: "", rawOutput: "" };
      },
    },
    {
      generateFinalFromView: async () => {
        if (failFinal) throw new Error("sin generativo");
        return { response: "Listo.", rawInput: "", rawOutput: "" };
      },
    },
  );
  tasks.start("primera tarea", "reactive");
  await tasks.drain(3000);
  assert.equal(seen.length, 0, "la primera tarea no tiene tarea anterior");

  // Una tarea que cierra con respuesta de respaldo no reemplaza el hilo ni lo borra.
  failFinal = true;
  const fallbackTask = tasks.start("falla respuesta", "reactive");
  await tasks.drain(3000);
  assert.equal(tasks.get(fallbackTask.task.id)?.result?.origin, "fallback");
  assert.deepEqual(seen, [{ request: "primera tarea", answer: "Listo." }]);

  // Una tarea cancelada tampoco pisa el hilo vigente.
  failFinal = false;
  const cancelledTask = tasks.start("cancelada", "reactive");
  tasks.cancel(cancelledTask.task.id);
  await tasks.drain(3000);
  assert.equal(tasks.get(cancelledTask.task.id)?.task.state, "cancelled");

  tasks.start("cuarta tarea", "reactive");
  await tasks.drain(3000);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[2], { request: "primera tarea", answer: "Listo." }, "el hilo sigue apuntando a la última completada con modelo");
  fs.rmSync(root, { recursive: true, force: true });
});

test("TaskBusyError: rechaza iniciar otra tarea mientras la activa sigue en curso o esperando respuesta final", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-busy-"));
  let releaseFinal!: () => void;
  const finalGate = new Promise<void>((r) => { releaseFinal = r; });
  const tasks = manager(
    root,
    async () => ({ pending: [], rawInput: "", rawOutput: "" }),
    {},
    {
      generateFinalFromView: async () => {
        await finalGate;
        return { response: "Listo.", rawInput: "", rawOutput: "" };
      },
    },
  );

  const first = tasks.start("primera", "reactive");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(tasks.get(first.task.id)?.task.state, "completed");
  assert.equal(tasks.get(first.task.id)?.result, null);
  // Aunque la tarea ya esté en estado terminal, sigue ocupando el lugar único hasta cerrar respuesta final y traza.
  assert.throws(() => tasks.start("segunda", "reactive"), (err: unknown) => err instanceof TaskBusyError && err.activeTaskId === first.task.id);

  releaseFinal();
  await tasks.drain(3000);
  const second = tasks.start("segunda", "reactive");
  assert.equal(second.task.state, "running");
  await tasks.drain(3000);
  fs.rmSync(root, { recursive: true, force: true });
});

test("cancel + settleCancel libera el lugar incluso si la ejecución está colgada y permite iniciar otra tarea", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-hung-"));
  const tasks = manager(root, () => new Promise(() => undefined), {}, {}, { cancelGraceMs: 25 });
  const hung = tasks.start("se cuelga", "reactive");
  await new Promise((r) => setTimeout(r, 15));

  assert.throws(() => tasks.start("bloqueada", "reactive"), TaskBusyError);
  assert.equal(tasks.cancel(hung.task.id), "ok");
  await tasks.settleCancel(hung.task.id);

  assert.equal(tasks.get(hung.task.id)?.task.state, "cancelled");
  assert.equal(tasks.get(hung.task.id)?.task.stopReason, "user_cancelled");

  const next = tasks.start("nueva tras cancelar colgada", "reactive");
  assert.notEqual(next.task.id, hung.task.id);
  assert.equal(tasks.cancel(next.task.id), "ok");
  await tasks.settleCancel(next.task.id);
  fs.rmSync(root, { recursive: true, force: true });
});

test("cancel libera automáticamente una tarea colgada al vencer cancelGraceMs sin settleCancel", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-grace-"));
  const tasks = manager(root, () => new Promise(() => undefined), {}, {}, { cancelGraceMs: 30 });
  const hung = tasks.start("se cuelga", "reactive");
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(tasks.cancel(hung.task.id), "ok");
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(tasks.get(hung.task.id)?.task.state, "cancelled");
  assert.equal(tasks.get(hung.task.id)?.task.stopReason, "user_cancelled");
  const next = tasks.start("después del timer", "reactive");
  assert.equal(tasks.cancel(next.task.id), "ok");
  await tasks.settleCancel(next.task.id);
  fs.rmSync(root, { recursive: true, force: true });
});

test("resolución tardía de una tarea colgada tras forceRelease no pisa el slot activo ni el hilo global", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-detached-"));
  let releaseHung!: (v: { pending: string[]; rawInput: string; rawOutput: string }) => void;
  let releaseSecondFinal!: () => void;
  const secondFinalGate = new Promise<void>((r) => { releaseSecondFinal = r; });
  const seenPrev: unknown[] = [];
  let mode: "hung" | "second" | "third" = "hung";

  const tasks = manager(
    root,
    () => {
      if (mode === "hung") return new Promise((resolve) => { releaseHung = resolve; });
      return Promise.resolve({ pending: [], rawInput: "", rawOutput: "" });
    },
    {
      continuation: async (input: { previous: unknown }) => {
        seenPrev.push(input.previous);
        return { follows: 0, rawInput: "", rawOutput: "" };
      },
    },
    {
      generateFinalFromView: async () => {
        if (mode === "second") {
          await secondFinalGate;
          return { response: "Respuesta segunda.", rawInput: "", rawOutput: "" };
        }
        return { response: "Respuesta tardía descartada.", rawInput: "", rawOutput: "" };
      },
    },
    { cancelGraceMs: 20 },
  );

  const hung = tasks.start("colgada", "reactive");
  await new Promise((r) => setTimeout(r, 15));
  tasks.cancel(hung.task.id);
  await tasks.settleCancel(hung.task.id);

  mode = "second";
  const second = tasks.start("segunda activa", "reactive");
  await new Promise((r) => setTimeout(r, 15));

  // La promesa colgada finalmente resuelve mientras la segunda sigue ocupando el slot activo.
  releaseHung({ pending: [], rawInput: "", rawOutput: "" });
  await new Promise((r) => setTimeout(r, 20));

  assert.throws(() => tasks.start("tercera prematura", "reactive"), TaskBusyError, "el cierre tardío de la colgada no debe liberar el slot de la segunda");
  assert.equal(tasks.get(hung.task.id)?.task.state, "cancelled");

  releaseSecondFinal();
  await tasks.drain(3000);

  mode = "third";
  tasks.start("tercera", "reactive");
  await tasks.drain(3000);
  assert.deepEqual(seenPrev, [{ request: "segunda activa", answer: "Respuesta segunda." }]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("historial: retiene hasta MAX_RETAINED_TASKS (20) terminadas en orden FIFO sin cancelar la tarea activa ni su espera", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-hist-"));
  const tasks = manager(root, async () => ({ pending: [], rawInput: "", rawOutput: "" }));

  const ids: string[] = [];
  for (let i = 1; i <= MAX_RETAINED_TASKS + 3; i++) {
    const dto = tasks.start(`tarea ${i}`, "reactive");
    ids.push(dto.task.id);
    await tasks.drain(3000);
  }
  assert.equal(tasks.list().length, MAX_RETAINED_TASKS);
  assert.deepEqual(tasks.taskIds(), ids.slice(-MAX_RETAINED_TASKS));
  assert.equal(tasks.get(ids[0]), null);
  assert.notEqual(tasks.get(ids[ids.length - 1]), null);

  // Inicia una tarea deliberativa que queda esperando confirmación de plan: no se cancela aunque el historial ya tenga 20.
  const waitingManager = manager(
    root,
    async () => ({ pending: [], rawInput: "", rawOutput: "" }),
    {},
    {
      generatePlanFromView: async () => ({
        steps: [{ instruction: "paso 1", route: "terminal", expected: "ok" }],
        rawInput: "",
        rawOutput: "",
      }),
    },
  );
  for (let i = 1; i <= MAX_RETAINED_TASKS; i++) {
    waitingManager.start(`prev ${i}`, "reactive");
    await waitingManager.drain(3000);
  }
  const delib = waitingManager.start("espera plan", "deliberative");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(waitingManager.get(delib.task.id)?.waiting?.kind, "plan");
  assert.equal(waitingManager.list().length, MAX_RETAINED_TASKS + 1);
  assert.equal(waitingManager.cancel(delib.task.id), "ok");
  await waitingManager.drain(3000);
  fs.rmSync(root, { recursive: true, force: true });
});
