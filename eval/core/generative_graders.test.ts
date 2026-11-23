/**
 * eval/core/generative_graders.test.ts
 *
 * Reglas de producción que los graders generativos aplican a toda salida: no filtrar ids ni herramientas y no empezar con saludo.
 * Hay que detectar la filtración y el saludo reales sin rechazar respuestas correctas (nombres de archivo, «Buenas noticias»).
 * Ejecución: `npx tsx --test eval/core/generative_graders.test.ts`
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCollector, findInternalLeak } from "./graders/common.ts";
import { FinalResponseGrader } from "./graders/final.ts";
import { getStage, runGraders } from "./stages/index.ts";

function finalErrors(text: string): string[] {
  const { collector, errors } = createCollector();
  FinalResponseGrader.grade({ response: text }, { mustContainFacts: [] }, { rawOutput: text, durationMs: 0 }, collector);
  return errors;
}

describe("findInternalLeak", () => {
  it("detecta ids sueltos, herramientas y estados internos", () => {
    for (const text of ["El paso c1 falló", "Listo, ver (c1).", "El paso c1.", "Resultado r3 guardado", "usa read_file", "quedó en tool_error"]) {
      assert.notEqual(findInternalLeak(text), undefined, text);
    }
  });

  it("no confunde nombres de archivo ni rutas del usuario con ids", () => {
    for (const text of ["Se copió c1.csv a la carpeta", "El archivo s3.txt pesa 2 KB", "Mira la carpeta C:/datos/r2/", "Está en datos\c1\a.txt", "backup-s2 listo"]) {
      assert.equal(findInternalLeak(text), undefined, text);
    }
  });
});

describe("FinalResponseGrader: saludo", () => {
  it("rechaza saludos reales", () => {
    for (const text of ["Hola, listo", "¡Hola! Se copió el archivo", "Buenos días, listo", "Buenas tardes: terminé", "¡Buenas! Hecho", "Hello, done", "Estimado usuario: listo"]) {
      assert.equal(finalErrors(text).some((e) => e.includes("saludo")), true, text);
    }
  });

  it("acepta respuestas que empiezan con palabras parecidas a un saludo", () => {
    for (const text of ["Buenas noticias: se copiaron 3 archivos.", "Buenos Aires figura en 3 archivos.", "Hice la copia.", "Highlights: 3 archivos"]) {
      assert.equal(finalErrors(text).some((e) => e.includes("saludo")), false, text);
    }
  });
});

describe("salida truncada: igual que producción", () => {
  const run = (stage: "plan" | "arguments" | "pending" | "final" | "question", parsed: unknown, expectObj: unknown, finishReason?: string) => {
    const { collector, errors, warnings, metrics } = createCollector();
    runGraders(getStage(stage), parsed, expectObj, { rawOutput: "", finishReason, durationMs: 0 }, collector);
    return { errors, warnings, metrics };
  };
  const outputs = {
    plan: { parsed: { steps: [{ goal: "leer", suggested_mcp: "files_read", expected_outcome: "ok" }] }, expect: { minSteps: 1 } },
    arguments: { parsed: { args: { path: "a" } }, expect: { requiredFields: ["path"] } },
    pending: { parsed: { pending: ["Leer el archivo"] }, expect: { expectEmpty: false } },
    final: { parsed: { response: "Listo: 3 archivos." }, expect: { mustContainFacts: ["3 archivos"] } },
    question: { parsed: { question: "¿Cuál archivo?" }, expect: { mustContainKeywords: ["archivo"] } },
  } as const;

  it("plan, arguments y pending (JSON): una salida cortada falla el run, porque producción la rechaza", () => {
    for (const stage of ["plan", "arguments", "pending"] as const) {
      const cut = run(stage, outputs[stage].parsed, outputs[stage].expect, "length");
      assert.equal(cut.errors.some((e) => e.includes("truncada")), true, stage);
      const whole = run(stage, outputs[stage].parsed, outputs[stage].expect, "stop");
      assert.deepEqual(whole.errors, [], stage);
    }
  });

  it("final y question (texto libre): producción acepta la salida cortada en el último intento, así que no falla el run pero se avisa", () => {
    for (const stage of ["final", "question"] as const) {
      const cut = run(stage, outputs[stage].parsed, outputs[stage].expect, "length");
      assert.deepEqual(cut.errors, [], stage);
      assert.equal(cut.metrics.not_truncated, false, stage);
      assert.equal(cut.warnings.some((w) => w.includes("cortada")), true, stage);
      const whole = run(stage, outputs[stage].parsed, outputs[stage].expect, "stop");
      assert.deepEqual([whole.errors, whole.warnings], [[], []], stage);
    }
  });
});
