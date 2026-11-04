# INFORME — `scripts/eval-next/` segunda pasada

> **Generado:** 2026-11-03

---

## 1. Acoplamiento con producción

### Importaciones de `src/` usadas por eval-next

| Archivo | Uso |
|---|---|
| `src/core/reasoner/prompts.ts` | `PROMPTS`, `DECISION_PROMPTS` — prompts de vistas y decisiones |
| `src/core/reasoner/qwen.ts` | `PLAN_JSON_SCHEMA`, `parseJsonObject`, `parsePlanSteps`, `stripThink`, `validateArgs` |
| `src/core/render/plan.ts` | `renderPlan` — renderizador de vista de plan |
| `src/core/render/args.ts` | `renderArgs` — renderizador de vista de argumentos |
| `src/core/render/final.ts` | `renderFinal` — renderizador de vista de respuesta final |
| `src/core/render/ask.ts` | `renderAsk` — renderizador de vista de pregunta al usuario |
| `src/core/engine/adapters.ts` | `planRenderOptions`, `argsRenderOptions`, `finalRenderOptions`, `askRenderOptions` |
| `src/core/engine/deps.ts` | `RouteDecisionInput`, `ToolDecisionInput`, `ReviewDecisionInput`, `VerifyDecisionInput` |
| `src/core/ctx/index.ts` | `PlanView`, `ArgsView`, `FinalView`, `AskView` |
| `src/core/types.ts` | `MCPTool` |
| `src/core/types/routes.ts` | `ExecutableRoute` |
| `src/core/tools/manifest.ts` | `buildCompactCatalog` |
| `src/core/utils.ts` | `cleanInputSchema` |

### Tiempos de importación (medidos con `tsx`)

Ejecutado con `npx tsx scripts/eval-next/tests/import-timing.ts`:

| Módulo | Tiempo |
|---|---|
| `src/core/reasoner/prompts.ts` | ~25 ms |
| `src/core/reasoner/qwen.ts` | ~14 ms |
| `src/core/render/plan.ts` | ~4 ms |
| `src/core/render/args.ts` | ~2 ms |
| `src/core/render/final.ts` | ~3 ms |
| `src/core/render/ask.ts` | ~2 ms |
| `src/core/engine/adapters.ts` | ~3 ms |
| `src/core/engine/deps.ts` | ~4 ms |

Ningún módulo superó los 30 ms. No se detectaron efectos secundarios (no se abren sockets, bases de datos ni servidores en la importación). Todos los módulos son puramente declarativos o computan strings.

---

## 2. Resultados de verificación

### TypeScript (`npm run lint`)

```
> tsc --noEmit
(sin errores — exit 0)
```

**Verificado:** ✅

### Tests (`npm run test:eval`)

```
Tests finalizados: 18 pasados, 0 fallados.
```

Tests incluidos:

1. `Producción: Prompts de vistas y decisiones exportados` ✅
2. `Producción: Renderizadores y adaptadores exportados` ✅
3. `Utilidades: stripThink y parseJsonObject` ✅
4. `Plan Grader: Replan rechaza metas fallidas y efectos repetidos` ✅
5. `Decision Graders: Detección estricta de etiquetas erróneas` ✅
6. `Question Grader: Falla ante fugas de nombres internos o límites` ✅
7. `Final Grader: Falla ante hechos faltantes o alucinaciones prohibidas` ✅
8. `Producción: validateArgs importado y funcional` ✅
9. `Runner: Corrida completa con Mock escribe runs.jsonl, scores.json y meta.json enriquecidos` ✅
10. `Runner: JSON roto marca fallo y registra error` ✅
11. `Runner: finish_reason=length marca fallo (not_truncated)` ✅
12. `Runner: etiqueta equivocada en decisión baja passRate` ✅
13. `Scores: varianza es null con repeat=1` ✅
14. `Scores: passAllRate=0 cuando mock alterna pass/fail en --repeat=2` ✅
15. `Trazabilidad: mismo request produce mismo requestHash` ✅
16. `Scores: rawPassRate y rawTotalRuns presentes en scores.json` ✅
17. `Meta: schemaVersion y sourceHashes presentes en todos los archivos de salida` ✅
18. `Runner: --minPassRate sube exitCode=1 cuando no se cumple, deja 0 cuando sí` ✅

**Verificado:** ✅

---

## 3. Roundtrip de etapa dummy

**Procedimiento ejecutado:**

1. Creado `scripts/eval-next/core/stages/dummy.ts` (implementación mínima de `StageDefinition`)
2. Importado `DummyStage` y registrado como `dummy: DummyStage` en `STAGES_REGISTRY`
3. Agregado `"dummy"` a `GenerativeStageName` en `types.ts`
4. Ejecutado `npm run lint` → **exit 0** ✅
5. Eliminado `dummy.ts`, removido del registro y de `types.ts`
6. Ejecutado `npm run lint` → **exit 0** ✅

**Conclusión:** Agregar o remover una etapa requiere exactamente **2 archivos** (el archivo de la etapa + su entrada en `index.ts`) y **1 línea** en `types.ts`. El guard de compilación `_registryCoversAllStages` detecta discrepancias entre `STAGES_REGISTRY` y `StageName` en tiempo de compilación.

---

## 4. Corridas reales (no ejecutadas)

> **No ejecutado.** El entorno de ejecución no tiene acceso a red ni a los modelos de producción.

- **Ollama / Qwen (localhost:11434):** puerto cerrado. No se puede alcanzar desde el sandbox.
- **D3 (decision.vllm-sr.ai):** sin respuesta desde sandbox de red restringida.

**Comandos para ejecutar manualmente en un entorno con los modelos disponibles:**

```bash
# Evaluar modelo generativo local (Qwen vía Ollama):
npx tsx scripts/eval-next/cli.ts --model=qwen2.5:7b --url=http://localhost:11434 --stage=plan --repeat=3 --thinking=on

# Evaluar modelo de decisión remoto (D3):
npx tsx scripts/eval-next/cli.ts --model=d3 --url=https://decision.vllm-sr.ai --stage=route,tool_choice --device=remote

# Con umbral mínimo de CI:
npx tsx scripts/eval-next/cli.ts --model=qwen2.5:7b --url=http://localhost:11434 --stage=all --minPassRate=0.8
```

---

## 5. Riesgos y deuda técnica

| Riesgo | Severidad | Notas |
|---|---|---|
| `sample.jsonl` = 10 casos | Alta | Es un smoke test, no un benchmark. Incapaz de detectar regresiones estadísticas ni sesgos. Necesita dataset real de ≥100 casos por etapa. |
| Graders keyword-based | Media | `mustContainFacts`, `mustReflectFeedback`, `forbiddenRepeatedGoals` etc. son frágiles a reformulaciones del modelo. Un LLM-judge daría más robustez semántica. |
| Sin LLM-judge | Media | Diferido por decisión de diseño. Ver nota en README. |
| Timeout no propagado por-llamada | Baja | `STAGE_TIMEOUT_DEFAULTS_MS` está definido en `config.ts` pero los clientes (`openai-compat`, `decision-remote`) reciben solo el timeout global del config, no el específico por etapa. Pendiente de propagar en `runner.ts`. |
| Sin cobertura de errores de cliente real | Media | Los tests de fallo usan mock. No se prueba qué pasa con red caída real, TLS error, 429 rate limit, etc. |
| `src/` se importa pero no se modifica | Ninguno | Confirmado: ningún archivo de `src/` fue modificado en esta sesión. |

---

## 6. LLM-judge

Diferido. Ver sección correspondiente en README.

---

## 7. Guía para scripts de análisis futuros

Los formatos de salida son estables (`schemaVersion: 1`). Para escribir un script de análisis:

- **`runs.jsonl`:** Una línea JSON por ejecución. Campos clave para análisis: `caseId`, `stage`, `iteration`, `passed`, `predictedLabel`, `expectedLabel`, `probabilities`, `rawScore`, `durationMs`, `requestHash`, `schemaVersion`.
- **`scores.json`:** Resumen por etapa con `passRate`, `passAllRate`, `rawPassRate`, `accuracy`, `confusionMatrix`, `p50DurationMs`, `p95DurationMs`, `variance` por caso.
- **`meta.json`:** Contexto de la corrida: `model`, `gitCommit`, `gitDirty`, `promptHashes`, `sourceHashes`. Necesario para agrupar corridas comparables.

Para detectar regresiones entre dos corridas, comparar `promptHashes` y `sourceHashes` primero para asegurar que el prompt de producción es el mismo.

