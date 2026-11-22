# Desalineaciones detectadas en el eval

Estado: actualizado contra el código vigente de `src/` y `eval/` (2026-11-21). Fuente de verdad: `src/`. Lo ya corregido (D1–D30, incluido D8: `arguments` ya modela `priorAttempts`, ver `eval/core/stages/arguments.ts` y su test en `eval_core.test.ts`) se quitó; el historial queda en git. El detalle y el seguimiento viven en `AUDITORIA_EVAL.md` (raíz del repo).

## Abiertas

| ID (`AUDITORIA_EVAL.md`) | Resumen | Qué lado |
|---|---|---|
| EV-025 | La etapa `plan` no puede evaluar `TRIGGER: initial` (`scenario.ts` crea siempre un plan y un paso sintético). Pendiente por decisión: el flujo deliberativo puede cambiar. | Eval (`scenario.ts`) |
| EV-020 | `scanReusableInitialRanking` no compara `url`, `decisionUrl`, `timeoutMs` ni `promptEnv.date` al reutilizar corridas. Pendiente de discutir. | Eval (`auto/ranking.ts`) |
| EV-022 | Regex de fuga interna con falsos positivos (`snake_case`), comparaciones asimétricas en graders y `oracleOutput` que ignora restricciones negativas. | Eval (`graders/`, `questions.ts`) |
| EV-007 | `eval:traces` reconstruye con imprecisiones `recovery` y `result_verification`. | Eval (`core/traces.ts`) |
| EV-008 | `--limit` no valida el resto del dataset. | Eval (`core/datasets.ts`) |

## Resueltas en esta tanda (2026-11-21)

- `args_review` evalúa con el umbral estricto de producción y pasa `fullView` (EV-018); `continuation` y `pending` recortan `previous_answer` como `previousTaskOf`, y `stageConfigHash` incluye `qwenNumCtx`, `decisionMaxContext`, `approvalTiers`, `reviewFullView` y `blacklist` (EV-012); los clientes envían `keep_alive` (EV-011); el contrato de `route` usa las rutas reales (EV-010).
