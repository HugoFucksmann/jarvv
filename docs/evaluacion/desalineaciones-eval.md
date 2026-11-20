# Desalineaciones detectadas en el eval

Estado: actualizado contra el código vigente de `src/` y `eval/` (2026-11-20). Fuente de verdad: `src/`. Lo ya corregido en código o documentación (D1–D7, D9–D30, incluido D16) se quitó (el historial queda en git).

## Índice

| ID | Prio | Resumen | Qué lado |
|---|---|---|---|
| D8 | B | `arguments` en el eval siempre corre como primer intento (`priorAttempts = 0`) | Eval (`scenario.ts`, `stages/arguments.ts`) |

---

## D8. `arguments` en el eval no ejercita `priorAttempts > 0`

- **Dónde:** `eval/core/stages/arguments.ts` (`buildRequest`, línea 99) y `eval/core/scenario.ts` (`ScenarioAt`) vs `src/core/engine/adapters.ts` (`argsInput`).
- **Qué pasa:** `scenario.ts` ya toma `temperature` y `retryThinking` de `StageRequest`, y `runner.ts` respeta `req.retryThinking ?? req.thinking` al reintentar. Sin embargo, `ScenarioAt` no modela `priorAttempts`, así que `argumentsStage.buildRequest` llama a `argsInput(tool, env, ...)` siempre con `priorAttempts = 0` (`temperature = 0.1`), sin cubrir la subida de temperatura de producción cuando hay intentos previos (`0.3` / `0.5`).

---

## Sin desalineación en lo revisado

- Registro de etapas (`ALL_STAGES`), contrato de validación de datasets (`datasets.ts`, `case.ts`) y constantes reexportadas en `eval/core/contract.ts` (`NOT_JSON_ERROR`, `argsProblemText`, `parsePlanStepsResult`, `NOUL_APPROVE = 0.6`, `reviewOutcome`, `RETRY_TEMPERATURE`, `RETRY_TOKEN_FACTOR`, `TRUNCATED_ERROR`, `LLM_INVALID_OUTPUT_RETRIES`, `MAX_STEPS`).
- Reintentos en `runner.ts`: `runDecision` ya no reintenta respuestas inválidas (alineado con `src/core/engine/failures.ts`, D16 resuelto); las etapas generativas usan `Math.max(RETRY_TEMPERATURE, req.temperature)`, `req.retryThinking ?? req.thinking` y conservan mensajes/orden de validación de `plan`, `arguments`, `pending`, `final` y `question`.
- Reserva de contexto y URLs (`client/generative.ts`, `client/decision.ts`): `reserveCompletionTokens` con margen mínimo de 256 tokens, `resolveUrl` con recorte y error de URL vacía, `DECISION_MAX_CONTEXT` desde `ConfigManager`, timeouts desde `PROD`, e `isTransportError` en `runner.ts`.
- Desborde en decisiones (`runner.ts`): `decision_context_ok` corta antes de llamar al cliente.
- Oráculo, asistente y CLI (`client/oracle.ts`, `ui/wizard.ts`, `core/config.ts`): `--client=oracle` restringido a `prod`, default de concurrencia `"3"` en el asistente, flags `--no-baseline` / `--baseline`, `stageConfigHash` con `pendingMaxTokens`, documentación de carpetas de resultados (`README.md`, `INSTRUCCIONES.md`) y comentarios de `RunRecord` (`types.ts`).
- Herramientas de cruce y validación (`cross.ts`, `psvalid.ts`, `INSTRUCCIONES.md`): `eval:cross` usa `resolveDatasetPaths`, `NOUL_APPROVE` (0.6) y avisa cuando falta `prod`; `INSTRUCCIONES.md` documenta `eval:cross`, `eval:psvalid`, `_cross/`, `args_review` sin `tool_rejected`, `forbiddenHardcodedValues` por subcadena y códigos de salida en `--dry-run`.
