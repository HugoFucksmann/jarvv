/**
 * JARVIS Core — «recovery» en modo sombra.
 *
 * Tras cada paso fallido del reactivo calcula qué haría la recuperación (las reglas de `recoveryRules.ts` y, si no deciden, la consulta de Decisión) y lo REGISTRA
 * en la traza; **no actúa**: el motor sigue reescribiendo el ítem con `pending` como siempre (`runTask.ts`). Sirve para medir con tareas reales, antes de dejar que
 * decida, cuánto acierta contra lo que pasó después (ver `eval/GUIA_DECISION.md`, sección 5).
 *
 * Garantías: apagado por defecto en el motor (`EngineDeps.recoveryShadow` omitida) y por configuración (`recoveryShadow`); nunca lanza ni cambia la lista, los contadores, el
 * contexto ni el cierre; usa su propio `try/catch` y no pausa ni reintenta si el modelo de decisión no responde (se registra el error y se sigue). Agrega una consulta a
 * Decisión por fallo solo cuando las reglas no deciden.
 *
 * Registro: un solo evento `llm` de etapa `recovery` por evaluación, con `input` = la entrada cruda a Decisión (o `null` si decidieron las reglas) y `output` = un JSON
 * `{ cause, attempts, callsInStep, rule, ruleIfCalls, model, final, source, modelRawOutput }`. `attempts` son los pasos fallidos seguidos (lo que significa el prompt);
 * `callsInStep`, las llamadas del paso que falló: un paso solo falla tras 2 o 3 errores de la herramienta, así que son números distintos, y `ruleIfCalls` es lo que habrían
 * decidido las reglas contando llamadas. Quien analice la traza puede comparar las dos lecturas.
 */

import type { RecoveryAction } from "../contracts.ts";
import { errorMessage } from "../utils.ts";
import { recoveryInput } from "./adapters.ts";
import type { EngineEnv } from "./env.ts";
import type { StepFailureCause } from "./outcomes.ts";
import { recoveryRule } from "./recoveryRules.ts";
import type { RecoveryRuleInput } from "./recoveryRules.ts";

/** Lo que se registra de una evaluación (el `output` del evento, serializado). */
export interface RecoveryShadowRecord {
  readonly cause: StepFailureCause;
  /** Pasos fallidos seguidos desde el último completado (incluye el que acaba de fallar). */
  readonly attempts: number;
  /** Llamadas registradas del paso que falló. */
  readonly callsInStep: number;
  /** Lo que deciden las reglas con `attempts`; `null` = no deciden. */
  readonly rule: "replan" | "close" | null;
  /** Lo que habrían decidido contando `callsInStep` como intentos. */
  readonly ruleIfCalls: "replan" | "close" | null;
  /** Lo que dijo Decisión (solo si las reglas no decidieron y respondió). */
  readonly model: RecoveryAction | null;
  /** Lo que habría hecho la recuperación: la regla, si decidió, y si no, el modelo. */
  readonly final: RecoveryAction | null;
  readonly source: "rule" | "model" | "none";
  readonly modelRawOutput: string | null;
}

export async function shadowRecovery(env: EngineEnv, previous: readonly string[], cause: StepFailureCause): Promise<void> {
  if (env.deps.recoveryShadow?.() !== true) return;
  const startedAt = Date.now();
  const n = env.ctx.n;
  let rawInput: string | null = null;
  let record: RecoveryShadowRecord | null = null;
  let error: string | null = null;
  try {
    const { ctx, runtime, deps } = env;
    const failedStep = ctx.find("steps", { state: "failed" }).at(-1);
    if (failedStep === undefined) return;
    const calls = ctx.find("calls", { stepId: failedStep.id });
    const last = calls.at(-1);
    const attempts = Math.max(1, ctx.consecutiveFailures());
    const command = last?.args !== null && last?.args !== undefined && typeof last.args.command === "string" ? last.args.command : undefined;
    const ruleInput = (count: number): RecoveryRuleInput => ({
      kind: last?.kind === "write" ? "write" : "read",
      text: last?.summary ?? "",
      attempts: count,
      cause,
      ...(command === undefined ? {} : { command }),
    });
    const rule = recoveryRule(ruleInput(attempts));
    const ruleIfCalls = recoveryRule(ruleInput(calls.length));
    let model: RecoveryAction | null = null;
    let modelRawOutput: string | null = null;
    if (rule === null && deps.decision.chooseRecovery !== undefined) {
      try {
        const decided = await deps.decision.chooseRecovery(recoveryInput(ctx, previous, cause, attempts), runtime.signal);
        model = decided.action;
        rawInput = decided.rawInput;
        modelRawOutput = decided.rawOutput;
      } catch (e) {
        error = errorMessage(e);
      }
    }
    const final: RecoveryAction | null = rule ?? model;
    record = { cause, attempts, callsInStep: calls.length, rule, ruleIfCalls, model, final, source: rule !== null ? "rule" : model !== null ? "model" : "none", modelRawOutput };
  } catch (e) {
    error = errorMessage(e);
  }
  try {
    env.sink.llm({ stage: "recovery", n, startedAt, durationMs: Date.now() - startedAt, input: rawInput, output: record === null ? null : JSON.stringify(record), error });
  } catch (e) {
    console.error("[RecoveryShadow] el receptor falló:", e);
  }
}
