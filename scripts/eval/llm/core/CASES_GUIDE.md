# Guía para escribir casos del eval LLM

Todo lo necesario para escribir o generar casos sin abrir `types.ts`, `evaluator.ts` ni `src/core/reasoner/prompts.ts`.
Un dataset solo importa `core/cases.ts`.

> **Snapshot.** Las formas de datos (§3) vienen de `src/core/reasoner/prompts.ts` y las expectativas (§4) de
> `core/evaluator.ts`. Si cambian, actualiza este archivo. `MCPTool` y `UserEnvironment` están en
> `src/core/types.ts` (`types/mcp.ts` y `types/execution.ts`) y no están copiados aquí.

## 1. Estructura

```
scripts/eval/llm/
  runner.ts
  core/    cases.ts  types.ts  client.ts  promptBuilder.ts  evaluator.ts  report.ts
  datasets/cases_<nombre>.ts      # exporta `testCases`
  prompts/<nombre>.ts             # variante de PROMPTS (opcional)
```

## 2. Escribir un caso

Cada constructor recibe `(datos del caso, expectativas)`. Los campos comunes son `id`, `category`, `description`,
`notes?` y `thinking?` (pisa el default de la etapa).

```ts
import { planCase, replanCase, argsCase, finalCase } from "../core/cases.ts";

export const testCases = [
  planCase(
    { id: "plan_x", category: "plan_formato", description: "...", goal: "crea un excel con..." },
    { minSteps: 2, maxSteps: 6, firstRoute: "web", forbiddenKeywordsInGoal: ["csv"] }
  ),
  replanCase({ id, category, description, data: { /* ReplanPromptData */ } }, { expectedAction: "continue" }),
  argsCase(
    { id, category, description, goal, taskInstruction, tool: { name, description, inputSchema }, /* + opcionales */ },
    { requiredFields: ["path"], noInventedFields: true }
  ),
  finalCase({ id, category, description, data: { /* FinalResponsePromptData */ } }, { mustContainFacts: ["..."] }),
];
```

Lo que hacen por ti los constructores:

- `stage` se escribe una vez y `expect` va plano (sin `expect.<stage>`).
- `argsCase`: `cleanedSchema` = `tool.inputSchema` y `environment` = `DEFAULT_ENV` si no los pasas.
- `replanCase`: si pasas `effects` o `completedSteps`, activa `mustNotRepeatEffects` / `mustNotRepeatCompleted`.
  En el evaluador, la lista sin el flag no hace nada.
- `planCase`: sin `compactCatalog`, el prompt usa `buildCompactCatalog()` (catálogo **vivo** de `src`).
  El caso puede cambiar de comportamiento sin que cambie su `case_hash`; fija el catálogo si necesitas reproducibilidad.

Un caso de regresión se escribe para que **falle con la salida mala observada** y pase con la correcta.
Pon el comportamiento real en `notes`.

## 3. Datos de entrada por etapa

### Traza → caso

Una traza trae, por llamada, `stage`, `rawInput` (el prompt renderizado) y `rawOutput`. Para convertir una llamada:
abre `rawInput` → `messages[1].content` y reparte cada bloque en su campo con las tablas de abajo.
El `rawOutput` no se copia al caso: úsalo para decidir las expectativas y anótalo en `notes`.

| Traza (`calls[].stage`) | Constructor |
| --- | --- |
| `PLAN_GENERATION` | `planCase` |
| `REPLAN` | `replanCase` |
| `ARGUMENT_GENERATION` | `argsCase` (la tool y su schema están en las líneas `TOOL:` y `SCHEMA:`) |
| `FINAL_RESPONSE` | `finalCase` |
| `DECISION_TWO`, `STEP_VERIFICATION` | Sin cobertura: usan otro modelo (no es chat completions) |
| `STAGE_VERIFICATION` | Sin cobertura: existe en `PROMPTS` pero el eval solo tiene 4 etapas |

Reglas de transcripción:

- Los bloques con `<obs>` son listas de líneas; **las líneas llevan su prefijo** (`[x] s1 ...`, `[>] s4 ...`).
  `(+1 pasos anteriores)` es la primera línea de `planLines`.
- `FACTS` vacío → `facts: {}`. Un bloque ausente → omite el campo.
- `GOAL` y `TASK` son campos distintos (`goal` / `taskInstruction`). Si `taskInstruction` empieza con `goal`, el prompt omite `GOAL`.

### plan

| Bloque | Campo |
| --- | --- |
| `CATÁLOGO COMPACTO` | `compactCatalog` (opcional, ver §2) |
| `CHAT` | `chatContext` |
| `PLAN PREVIO A MODIFICAR` | `existingPlanSummary` |
| `MODIFICACIÓN SOLICITADA` | `modificationFeedback` |
| `OBJETIVO` | `goal` |

### replan — `ReplanPromptData`

```ts
{ goal: string; completedStepsSummary: string[]; facts: Record<string,string>; failLines: string[];
  effects?: string[]; logLines?: string[]; failedStepGoal: string; failedStepResult: string;
  remainingPlanGoals: string[]; nextStepNumber: number /* no se renderiza */ }
```

Bloques: `OBJETIVO`=goal, `COMPLETADOS`, `FACTS`, `LOG`, `EFFECTS`, `FAIL`, `PASO FALLIDO`=failedStepGoal,
`RESULTADO DEL PASO FALLIDO`=failedStepResult, `PLAN RESTANTE`=remainingPlanGoals.

### arguments — `ArgumentPromptData`

```ts
{ goal: string; chatContext?: string; logLines?: string[]; planLines?: string[]; failLines?: string[];
  facts?: Record<string,string>; effects?: string[]; refs?: string[]; environment: UserEnvironment;
  tool: MCPTool; cleanedSchema: Record<string,unknown>;
  dataObs?: { stepId: string; label: string; obsText: string }[];   // más antigua primero
  lastObs?: { stepId: string; toolName: string; obsText: string };
  taskInstruction: string }
```

Bloques: `ENV`=environment, `TOOL`=tool.name + primera oración de description, `SCHEMA`=cleanedSchema, `GOAL`, `CHAT`,
`LOG`, `PLAN`, `FAIL`, `FACTS`, `EFFECTS`, `REFS`, `DATA (paso X, label)`=dataObs, `LAST (paso X, tool)`=lastObs,
`TASK`=taskInstruction.

### final_response — `FinalResponsePromptData`

```ts
{ goal: string; logLines: string[]; facts: Record<string,string>; failLines: string[];
  effects?: string[]; evidenceSummaries: string[]; abortReason?: string }
```

Bloques: `GOAL`, `LOG`, `FACTS`, `EFFECTS`, `FAIL`, `EVID`=evidenceSummaries (separados por `---`),
`MOTIVO DE DETENCIÓN`=abortReason. Con `abortReason` el prompt cambia la instrucción final.

## 4. Expectativas y métricas

Todas las comparaciones de texto normalizan (sin tildes, minúsculas, espacios colapsados) y son **substring**.
Una métrica *soft* se registra pero no afecta pass/fail.

**plan**

| Campo | Métrica |
| --- | --- |
| (siempre) | `valid_json`, `valid_steps_structure`, `has_objective` (soft) |
| `minSteps` / `maxSteps` | `min_steps_met` / `max_steps_met` |
| `allowedRoutes` | `routes_allowed` |
| `firstRoute` | `first_route_matches` |
| `requiredRoutes` | `required_routes_used` |
| `requiredKeywordsInGoal` / `forbiddenKeywordsInGoal` | `required_keywords_met` / `no_forbidden_keywords` (sobre las instrucciones de los pasos) |
| `allowEmpty` | Por defecto `true` |

**replan**

| Campo | Métrica |
| --- | --- |
| (siempre) | `valid_json`, `valid_action`, `has_objective` (soft, en continue), `has_abort_reason` y `abort_steps_empty` (soft, en abort) |
| `expectedAction` | `action_matches_expected` |
| `minSteps` / `maxSteps` / `allowedRoutes` | Igual que plan; en continue el replan no admite `steps` vacío |
| `effects` | `respects_effects` (ninguna aparece en los pasos) |
| `completedSteps` | `respects_completed` (ninguna aparece en los pasos) |

**arguments**

| Campo | Métrica |
| --- | --- |
| (siempre) | `valid_json`, `schema_valid` (un `null` en un opcional equivale a "no usado") |
| `requiredFields` | `required_fields_present` |
| `noInventedFields` | `no_invented_fields` (necesita `schema.properties`) |
| `exactFieldValues` | `field_<k>_match` (comparación estable de JSON) |
| `allowedRefTokens` | `valid_refs` (tokens `{{ref:rN}}` usados ⊆ permitidos) |
| `forbiddenHardcodedValues` | `no_forbidden_values` (substring sobre todo el JSON de args) |
| `jsonStringFields[]` | `field_<f>_json`, `field_<f>_array2d` / `_sheets` (según `shape`), `field_<f>_includes` |
| `tool` | Informativo: el evaluador no lo usa (`argsCase` lo rellena con `tool.name`) |

**final_response**

| Campo | Métrica |
| --- | --- |
| (siempre) | `not_truncated`, `non_empty` |
| `minChars` | `min_chars_met` |
| `mustContainFacts` | `facts_retained` |
| `mustMentionEffects` | `effects_mentioned` |
| `forbiddenHallucinations` | `no_hallucinations` |
| `mustMentionAbortReason` | **No implementado**: el campo existe en `types.ts` pero el evaluador lo ignora |

Global: `finish_reason=length` en plan, replan y arguments falla de inmediato; en final_response se registra
`not_truncated` (y la métrica `not_truncated` se completa en todas las etapas para métricas consistentes). Para el resto, `status` es `fail` si algún check no soft falla, y `error` si hubo excepción
(timeout, HTTP, prompt que no cabe en el contexto).

### Lo que hoy no se puede expresar

- Que un campo opcional esté **ausente** (p. ej. que no mande `max_results` si no hace falta).
- Atribución o razonamiento en `final_response` (p. ej. culpar al paso equivocado).
- Truncado por cercanía al tope de tokens: el runner solo mira `finish_reason`. En la traza semilla,
  el replan usó 4071 de 4096 tokens con `finish_reason=stop` y producción lo descartó como truncado.
  Compara `completion_tokens` con `max_tokens` en `runs.jsonl`.

## 5. Comportamiento por defecto

- `thinking`: plan y replan **on**; arguments **off**; final_response corre **con y sin** thinking
  (`--finalThinking=both`), es decir, 2 ejecuciones por caso.
- Rutas válidas del plan: `files`, `locate`, `terminal`, `web`.
- Tools de la traza semilla: `search` (query, max_results), `write_file` (path, content, mode; para `.xlsx`, `content` es
  un string JSON de array 2D o de `{Hoja: [[...]]}`), `create_directory` (path), `start_process` (command, timeout_ms, shell).
  Los schemas completos están en `datasets/cases_v1.ts`.

## 6. Ejecutar

```
node scripts/eval/llm/runner.ts                                  # por defecto usa --dataset=v2
node scripts/eval/llm/runner.ts --dataset=v1 --stage=arguments
node scripts/eval/llm/runner.ts --dataset=v2 --prompts=<variante> --tag=<etiqueta>
```

Opciones: `url`, `model`, `stage`, `dataset`, `prompts`, `tag`, `timeout`, `thinkingTimeout`, `maxTokens`, `numCtx`,
`finalThinking`. Los defaults vacíos toman los valores de producción (`config.ts`).
Resultados en `scripts/results/llm/<modelo>/<dataset>_<prompts>[_<tag>]/` (`runs.jsonl`, `scores.json`, `summary.md`).
