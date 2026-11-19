# Desalineaciones detectadas en el eval

Estado: actualizado contra el código vigente de `src/` y `eval/` (2026-11-19). Fuente de verdad: `src/`. Lo ya corregido en código o documentación (D1–D7, D9–D15, D17–D30) se quitó (el historial queda en git).

## Índice

| ID | Prio | Resumen | Qué lado |
|---|---|---|---|
| D16 | A | El eval reintenta decisiones inválidas; producción dejó de hacerlo | Eval (`runner.ts`, `INSTRUCCIONES.md`) |
| D8 | B | `arguments` en el eval siempre corre como primer intento (`priorAttempts = 0`) | Eval (`scenario.ts`, `stages/arguments.ts`) |

---

## D16. El eval reintenta respuestas de decisión inválidas; producción ya no

- **Dónde:** `eval/core/runner.ts` (`runDecision`, líneas 258–281) e `eval/INSTRUCCIONES.md` §7 vs `src/core/engine/failures.ts` (`queryModel`, líneas 11–13) y `src/core/engine/verify.ts` (`verifyCall`).
- **Qué pasa:**
  - `eval/core/runner.ts` vuelve a consultar al modelo de decisión hasta `LLM_INVALID_OUTPUT_RETRIES` veces cuando `entry.parseOutput` falla, con el comentario *"Como producción (`queryModel`)"*.
  - En producción, `src/core/engine/failures.ts` (cabecera, líneas 11–13) dejó de reintentar `DecisionValidationError` sin `overflow`: Qwen reintenta una vez por su cuenta (`BUDGET.invalidResponseRetries`), pero **Decision no se reintenta** (*"Decision es determinista (repetir da lo mismo)"*).
- **Por qué es desalineación:** hoy la dirección está invertida respecto del reporte original: el eval puede dar por aprobado en segundo intento un caso de decisión que en producción cerraría en el primero.

## D8. `arguments` en el eval no ejercita `priorAttempts > 0`

- **Dónde:** `eval/core/stages/arguments.ts` (`buildRequest`, línea 99) y `eval/core/scenario.ts` (`ScenarioAt`) vs `src/core/engine/adapters.ts` (`argsInput`).
- **Qué pasa:** `scenario.ts` ya toma `temperature` y `retryThinking` de `StageRequest`, y `runner.ts` respeta `req.retryThinking ?? req.thinking` al reintentar. Sin embargo, `ScenarioAt` no modela `priorAttempts`, así que `argumentsStage.buildRequest` llama a `argsInput(tool, env, ...)` siempre con `priorAttempts = 0` (`temperature = 0.1`), sin cubrir la subida de temperatura de producción cuando hay intentos previos (`0.3` / `0.5`).

---

## Sin desalineación en lo revisado

- Registro de etapas (`ALL_STAGES`), contrato de validación de datasets (`datasets.ts`, `case.ts`) y constantes reexportadas en `eval/core/contract.ts` (`NOT_JSON_ERROR`, `argsProblemText`, `parsePlanStepsResult`, `NOUL_APPROVE = 0.6`, `reviewOutcome`, `RETRY_TEMPERATURE`, `RETRY_TOKEN_FACTOR`, `TRUNCATED_ERROR`, `LLM_INVALID_OUTPUT_RETRIES`, `MAX_STEPS`).
- Reintentos generativos (`runner.ts`): `Math.max(RETRY_TEMPERATURE, req.temperature)`, `req.retryThinking ?? req.thinking`, mensajes y orden de validación de `plan` (`stages/plan.ts:64-69`), `arguments`, `pending`, `final` y `question`.
- Reserva de contexto y URLs (`client/generative.ts`, `client/decision.ts`): `reserveCompletionTokens` con margen mínimo de 256 tokens, `resolveUrl` con recorte y error de URL vacía, `DECISION_MAX_CONTEXT` desde `ConfigManager`, timeouts desde `PROD`, e `isTransportError` en `runner.ts`.
- Desborde en decisiones (`runner.ts:231-239`): `decision_context_ok` corta antes de llamar al cliente.
- Oráculo, asistente y CLI (`client/oracle.ts`, `ui/wizard.ts`, `core/config.ts`): `--client=oracle` restringido a `prod`, default de concurrencia `"3"` en el asistente, flags `--no-baseline` / `--baseline`, `stageConfigHash` con `pendingMaxTokens`, documentación de carpetas de resultados (`README.md`, `INSTRUCCIONES.md`) y comentarios de `RunRecord` (`types.ts:398-411`).
- Herramientas de cruce y validación (`cross.ts`, `psvalid.ts`, `INSTRUCCIONES.md`): `eval:cross` usa `resolveDatasetPaths`, `NOUL_APPROVE` (0.6) y avisa cuando falta `prod`; `INSTRUCCIONES.md` documenta `eval:cross`, `eval:psvalid`, `_cross/`, `args_review` sin `tool_rejected`, `forbiddenHardcodedValues` por subcadena y códigos de salida en `--dry-run`.
