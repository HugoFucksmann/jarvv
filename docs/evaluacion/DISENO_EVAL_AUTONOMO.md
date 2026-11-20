# Diseño de Implementación: `eval` Autónomo (`eval:auto`)

Especificación técnica para incorporar un modo iterativo autónomo en `eval/`: un LLM optimizador lee `conclusiones.md`, genera 2 variantes nuevas por vuelta, las evalúa frente a `prod` y las 2 mejores variantes vigentes sobre los datasets de la etapa, actualiza `conclusiones.md` cuando hay evidencia nueva y repite hasta alcanzar `--target` o `--max-loops`.

---

## 1. Idea central y flujo del bucle

```text
  [Inicio]
     │  --stage=<etapa> --max-loops=N --target=0.80 --optimizer-model=<llm>
     ▼
  [Inicialización Top-2 (100 % en código)]
     │  1. Reutiliza resúmenes vigentes en `eval/results/` si coinciden los hashes
     │     de dataset, casos, modelo, thinking, src y variante.
     │  2. Si falta alguno → corre Vuelta 0 con `prod` + variantes activas de la etapa.
     ▼
  ┌──▶ [Vuelta k = 1 .. maxLoop]
  │       1. Lee `conclusiones.md` (de la etapa; puede estar vacío) + `prod` + Top-2
  │          + muestra acotada de fallos reales (`runs.jsonl`).
  │       2. LLM optimizador genera 2 variantes nuevas (`a`, `b`) modificando
  │          solo el texto/estructura del prompt (sin tocar `params` ni `read.*`).
  │       3. Validación previa (allowlist de imports, carga ESM, `loadDatasets`).
  │          (Si falla sintaxis/carga → reintenta reparación con el error.)
  │       4. Ejecuta 1 corrida comparativa unificada:
  │          `[prod, top1, top2, nueva_a, nueva_b]` (sin duplicados) sobre los datasets.
  │       5. Recalcula Top-2 por código (`passRate` canónico y desempates); mueve las
  │          descartadas a `eval/variants/_auto/<stage>/descartadas/` (sin borrar).
  │       6. Si hay hallazgos, regresiones claras o nuevo Top-2 → actualiza `conclusiones.md`
  │          (y estado JSON de la sesión).
  │       │
  │       ├─ ¿Alguna variante != `prod` alcanza `>= target` (y holdout si se usó)? ──▶ [FIN: exit 0]
  │       ├─ ¿k == maxLoop? ──────────────────────────────────────────────────────▶ [FIN: exit 1]
  └───────┴─ Si no, siguiente vuelta (k + 1)
```

---

## 2. Puntos críticos identificados al contrastar la idea con `eval/` actual

Al revisar `eval/cli.ts`, `eval/core/config.ts`, `eval/core/variants/load.ts`, `eval/core/datasets.ts` y `eval/core/report.ts` surgen 6 decisiones técnicas indispensables para que el bucle sea confiable:

### 2.1. Alcance por etapa (`--stage` obligatorio por corrida)
En `eval/`, cada `Variant` sobrescribe constructores de una etapa concreta (`DECISION_PROMPTS.buildRouteChoice`, `PROMPTS.FINAL_VIEW`, etc.), y `report.ts` advierte `Resultado mixto` si se mezclan etapas de decisión y generativas.
- **Decisión:** cada ejecución de `eval:auto` optimiza **una etapa** (`--stage=<etapa>`).
- **Resolución de datasets:** resuelve automáticamente todos los `.jsonl` de `eval/datasets/` que contengan casos de esa etapa (excluyendo `smoke.jsonl` por defecto para no mezclar 1 caso suelto si ya existe la carpeta de la etapa, salvo que se pase `--dataset=...` explícito).

### 2.2. Dos roles de modelos distintos (no mezclar flags)
En `eval/core/config.ts`, `--model=<generativo>+<decisión>` define **los modelos de Jarvis bajo evaluación** (p. ej. `qwen3.5:4b+d3:2b`).
- El LLM que propone variantes es un **modelo optimizador externo al sistema evaluado** (normalmente un modelo más capaz, local grande o vía API/túnel compatible con OpenAI `/v1/chat/completions`).
- **Decisión:** separar explícitamente `--optimizer-model=<id>` (y `--optimizer-url`, `--optimizer-api-key-env` opcional) de `--model=<gen>+<dec>` (el sujeto evaluado).

### 2.3. Cómo determinar "las 2 mejores variantes actuales" en código (sin LLM)
`eval/MEJORES_VARIANTES.md` es un resumen narrativo para humanos; además, `INSTRUCCIONES.md` §7 recuerda que dos corridas solo son comparables si comparten **`datasetHash`**, **`cases.hash`**, **modelos evaluados (`--model`)**, **`--thinking`** y **`promptEnv.stageConfigHash`**.
- **Decisión:** la selección del Top-2 se resuelve **100 % en código** a partir de métricas medidas (`scores.json` / `comparison.json`), sin gastar inferencia de modelos:
  - **Reutilización previa:** antes de correr nada, el código escanea `auto_state.json` y los `meta.json` + `scores.json` ya existentes en `eval/results/<modelo>/`. Si encuentra corridas vigentes con exactamente la misma huella `(stage, datasetHashes, cases.hash, model, decisionModel, thinking, stageConfigHash, variantHash actual)` para `prod` y las variantes activas de la etapa (excluyendo `_auto/<stage>/descartadas/`), arma el **Top-2 inicial sin re-ejecutar**.
  - **Vuelta 0 (solo si faltan datos comparables):** corre `prod` + las variantes existentes de la etapa en `eval/variants/` (sin `descartadas/`) sobre los datasets de la etapa para calcular el Top-2 real. Puede omitirse con `--seed-top=v1,v2`.
  - **En cada vuelta `k`:** corre siempre `[prod, top1, top2, nueva_a, nueva_b]` (deduplicando si `prod` está en el Top-2) en la **misma invocación**. Así `comparison.json` entrega deltas emparejados por caso (`deltaPassRate`), `signTestP`, mejoras y regresiones sin sesgo entre tandas.

### 2.4. Seguridad, validez y orden de archivos para variantes generadas
`eval/core/variants/load.ts` carga variantes mediante `import()` dinámico en Node, recorriendo recursivamente `eval/variants/` y exigiendo que cada archivo tenga `default.name === basename` único en todo el árbol.
- **Decisión:** validar toda variante generada en 4 pasos **antes** de enviarla al runner y no borrar perdedoras:
  1. Guardar inicialmente en `eval/variants/_auto/<stage>/` con nombres únicos (`auto_<stage>_<runTag>_r<k>_a.ts`, `_b.ts`).
  2. **Chequeo estático (AST o regex estricta):** prohibir imports fuera de `src/core/*` y `eval/core/variants/types.ts`, y rechazar propiedades `params` o `read` (por ahora el optimizador **solo edita texto/estructura del prompt**).
  3. **Verificación de carga ESM:** ejecutar `loadVariant(name)` + `loadDatasets(..., variant)` (materializa todos los escenarios y valida que los requests cumplan el contrato).
  4. **Reintento de reparación:** si falla algún paso, devolver el error exacto al optimizador (hasta 2 intentos) antes de dar la vuelta por fallida.
  5. **Archivo en subcarpeta (sin borrado):** al cerrar cada vuelta, las variantes generadas que no entren al Top-2 ni superen a `prod` se mueven a `eval/variants/_auto/<stage>/descartadas/` (conservando nombres únicos para que `load.ts` nunca colisione y permitiendo limpiarlas luego borrando esa subcarpeta).

### 2.5. Varianza y `--holdout` (opcional por ahora)
- Por defecto, `eval:auto` corre sobre **todos** los datasets disponibles de `--stage` (sin `smoke.jsonl`), siguiendo exactamente el flujo pedido.
- **`--holdout=<dataset>` (opcional por ahora):** pensado para cuando quieras evitar que el LLM sobreajuste tras muchas vueltas. Si se pasa, ese dataset queda oculto del muestreo de errores durante las vueltas y solo se corre como confirmación al alcanzar `--target`.
- En etapas generativas (`plan`, `arguments`, `final`, `question`, `pending`), `MEJORES_VARIANTES.md` midió ~3 puntos de ruido entre corridas: se soporta `--repeat=<n>` (default `1` en decisión, recomendable `2` en generativas).

### 2.6. Diferencia entre fallo de prompt y fallo de infraestructura
Si durante una vuelta cae Ollama, ngrok o hay timeouts masivos (`allNetworkFailed`), no debe contar como `0 %` de la variante ni anotarse en `conclusiones.md` como regresión del prompt.
- **Regla:** ante error de transporte/infraestructura (código 2 equivalente a `eval/cli.ts`), abortar la corrida con código `2` sin modificar `conclusiones.md` ni `auto_state.json`.

---

## 3. Interfaz CLI

Se mantiene intacta la sintaxis de `eval/cli.ts` (`parseConfig` rechaza posicionales y valida `KNOWN_FLAGS`) agregando un entrypoint dedicado `eval/auto.ts` (`npm run eval:auto -- ...`):

```bash
npm run eval:auto -- \
  --stage=args_review \
  --max-loops=8 \
  --target=0.80 \
  --optimizer-model=qwen3:32b \
  [--optimizer-url=http://127.0.0.1:11434] \
  [--optimizer-api-key-env=OPENAI_API_KEY] \
  [--conclusions=eval/variants/_auto/args_review/conclusiones.md] \
  [--dataset=args_review_16_cases,args_review_gemai] \
  [--holdout=args_review_gemaiL] \
  [--model=qwen3.5:4b+d3:2b] \
  [--url=...] [--decision-url=...] \
  [--repeat=1] [--concurrency=3] [--thinking=off] \
  [--metric=passRate|macroPassRate] \
  [--seed-top=var1,var2] \
  [--archive-losers=true|false] \
  [--client=real|mock]
```

### Flags principales

| Flag | Obligatorio | Default | Descripción |
|---|---|---|---|
| `--stage` | Sí | — | Etapa única a optimizar (`d0`, `route`, `tool_choice`, `args_review`, `result_verification`, `fragment_judge`, `d5`, `recovery`, `continuation`, `plan`, `arguments`, `final`, `question`, `pending`). |
| `--max-loops` | Sí | — | Entero `>= 1`. Límite de iteraciones de generación + evaluación (`Vuelta 1..N`). |
| `--target` | Sí | — | Decimal en `(0, 1]` (ej. `0.8` o `0.85`). Umbral de corte sobre `--metric`. |
| `--optimizer-model` | Sí | — | Modelo LLM que lee `conclusiones.md` y redacta las 2 variantes nuevas. |
| `--optimizer-url` | No | `DEFAULT_URL` | Endpoint OpenAI-compatible (`/v1/chat/completions`: Ollama local, API externa o ngrok). |
| `--optimizer-api-key-env` | No | — | Nombre de variable de entorno para enviar `Authorization: Bearer` al optimizador. |
| `--conclusions` | No | `eval/variants/_auto/<stage>/conclusiones.md` | Ruta al markdown por etapa leído y actualizado por el optimizador (si no existe, arranca vacío). |
| `--dataset` | No | Todos los de `--stage` (sin `smoke`) | Datasets de trabajo para el bucle. |
| `--holdout` | No | — | **Opcional por ahora.** Dataset(s) ocultos al feedback del LLM que solo confirman al alcanzar `--target`. |
| `--metric` | No | `passRate` | Métrica comparada contra `--target`: `passRate` canónico (`pasaron / total`, sin `isRaw` ni `prod_shortcut`) o `macroPassRate`. |
| `--seed-top` | No | auto (results / Vuelta 0) | Omite la detección automática fijando manualmente las 2 variantes campeonas iniciales. |
| `--archive-losers` | No | `true` | Mueve variantes generadas perdedoras (fuera de Top-2 y sin superar a `prod`) a `descartadas/` sin borrarlas. |

---

## 4. Arquitectura de módulos propuesta

Todo el código nuevo vive dentro de `eval/` sin modificar `src/`:

```text
eval/
├── auto.ts                     # CLI y orquestador principal del bucle (Vuelta 0..N)
├── auto/
│   ├── config.ts               # Parseo/validación de flags de `eval:auto`
│   ├── discover.ts             # Descubre datasets de la etapa y variantes existentes aplicables
│   ├── optimizer.ts            # Cliente del LLM optimizador, armado de contexto y parser de salida
│   ├── stageContract.ts        # Prompt/plantilla por etapa (helpers permitidos, firma de Variant, claves fijas)
│   ├── tsScanner.ts            # Tokenizador TypeScript (createScanner) usado por stageContract y validateVariant
│   ├── validateVariant.ts      # Allowlist estática + sandbox node:vm + loadDatasets (smoke estructural)
│   ├── feedback.ts             # Extrae resumen de `comparison.json` + streaming de fallos de `runs.jsonl`
│   ├── ranking.ts              # Cálculo de Top-2, desempates y estado persistido (`auto_state.json`)
│   └── conclusions.ts          # Lectura acotada y actualización estructurada de `conclusiones.md`
└── variants/
    └── _auto/<stage>/          # Variantes activas, `conclusiones.md`, `auto_state.json`
        └── descartadas/        # Variantes generadas que no superaron Top-2/prod (conservadas para borrar fácil luego)
```

### Integración con `eval/core/*`: en proceso vs subproceso
- **Recomendación:** reutilizar directamente los módulos de `eval/core/` (`loadDatasets`, `loadVariantSpec`, `runDataset`, `computeScoreSummary`, `generateComparisonReport`, `writeComparison`, `createGenerativeClient`, `createDecisionClient`) desde `eval/auto.ts` en el mismo proceso, **excepto** para validar la variante recién escrita (que conviene cargar con query string cache-busting o en un subproceso rápido de validación para aislar cualquier error de módulo ESM antes del run real).
- Así cada vuelta genera exactamente la misma carpeta estándar en `eval/results/<modelo>/<ts>_auto_<stage>_r<k>/` con `comparison.md`, `comparison.json`, `runs.jsonl`, `scores.json` y `meta.json`.

---

## 5. Diseño del Agente Optimizador (`optimizer.ts`)

### 5.1. Qué contexto recibe el LLM en cada vuelta `k`

Para evitar prompts gigantes que confundan o excedan contexto, el input al optimizador debe ser **estructurado y acotado**:

1. **Contrato de la etapa (`stageContract.ts`):**
   - Tipo de etapa (`decision` o `generative`), firma exacta a implementar (ej. `DECISION_PROMPTS.buildArgsReview` o `PROMPTS.PENDING_VIEW`), claves obligatorias de salida (`route`, `selected_tool`, `ok`/`cumple`, etc.) y reglas del evaluador (`eval/core/stages/<stage>.ts`).
   - Lista exacta de imports y helpers reutilizables (`frameLines`, `listBlock`, `lastFailedBy`, `DATA_NOTICE_EN`, etc.) y restricción explícita de **modificar únicamente el texto/estructura del prompt** (prompts **enteros**, sin `params` ni `read.*`).
2. **Memoria acumulada (`conclusiones.md`):**
   - Si está vacío (primera corrida), se informa explícitamente *"Archivo `conclusiones.md` vacío: primera iteración sobre esta etapa."*
   - Límite duro sugerido (ej. máx. 12 000 caracteres; si crece más, exigir compactación al actualizarlo).
3. **Código fuente actual de referencia:**
   - Prompt actual de `prod` (extraído del constructor/vista real de `src/core/models/prompts.ts` o inspeccionado vía `--dry-run` de un caso representativo) — si el archivo ya está en el Top-2, no duplicarlo.
   - Código completo `.ts` de las **2 mejores variantes actuales** (`top1`, `top2`) con sus métricas por dataset (`passRate`, `p50DurationMs`, `retriedRuns`).
4. **Diagnóstico de fallos de la vuelta anterior (máx. 12–15 casos):**
   - Tomados de `runs.jsonl` del `top1` (priorizando errores compartidos con `prod`, regresiones vs `prod` y falsos positivos/negativos por clase).
   - Por cada caso fallido: `id`, `dataset`, entrada compacta (`request` / `state` resumido si supera 1 200 chars), `expected`, `predicted` / checks que fallaron (`metrics`), y `rawOutput` recortado.
   - Si existe `--holdout`, **nunca** incluir casos del holdout aquí.
5. **Instrucción de diversidad entre las 2 variantes (`a` y `b`):**
   - Pedir explícitamente **2 hipótesis distintas** (no cambiar solo una coma entre `a` y `b`): por ejemplo, `variante A` refinamiento conservador sobre `top1` atacando el patrón #1 de fallo; `variante B` hipótesis estructural alternativa (reordenar bloques, recortar ruido, cambiar criterios/instrucción) evitando las ideas ya listadas en `Descartadas` de `conclusiones.md`.

### 5.2. Formato de salida del optimizador (JSON Schema estricto)

Pedir JSON estructurado (`response_format: json_schema` o `json_object` con fallback de extracción):

```json
{
  "analysis": "Breve diagnóstico de por qué fallaron los casos mostrados (máx. 4 líneas).",
  "variants": [
    {
      "suffix": "a",
      "hypothesis": "Acortar criterios de args_invalid para evitar confusión con info_missing.",
      "code": "import ... export default auto_...;"
    },
    {
      "suffix": "b",
      "hypothesis": "Mover Previous Errors arriba de Candidate call y explicitar regla de rutas válidas.",
      "code": "import ... export default auto_...;"
    }
  ]
}
```

### 5.3. Validación previa antes de evaluar (`validateVariant.ts`)
Antes de gastar tiempo del modelo target:
1. Verificar que `variants` tenga exactamente 2 entradas con código no vacío.
2. Ajustar/inyectar el `name` exacto del archivo (`auto_<stage>_<runTag>_r<k>_a` / `_b`) para evitar mismatches triviales de nombre.
3. Verificar imports permitidos (rechazar `fs`, `child_process`, `http`, `net`, `eval`, etc.) y bloquear propiedades `params` o `read` para respetar la edición solo de prompt.
4. Escribir en `eval/variants/_auto/<stage>/` y ejecutar `loadVariant(name)` + `loadDatasets(devSpecs, { stages: [stage] }, variant)`.
5. Opcional pero muy útil: validar los primeros N `PreparedRequest` con `reserveCompletionTokens` (etapas generativas) y `estimateDecisionPromptTokens` (etapas decisión, límite `DECISION_MAX_CONTEXT`) para detectar de inmediato si el prompt nuevo excede contexto antes de correr toda la tanda.
6. Si falla, reenviar el error al optimizador (máx. 2 reintentos de reparación). Si tras los reintentos solo 1 variante es válida, decidir si correr esa 1 o abortar la vuelta (recomendado: correr igual si al menos 1 pasó validación y anotar el fallo en el log).

---

## 6. Reglas de Ranking, Promoción y Corte

### 6.1. Selección del Top-2
En cada vuelta se evalúan en un solo lote:
`participantes = unique(["prod", ...currentTop2, nueva_a, nueva_b])`

Para cada participante se calcula sobre el bucket canónico:
1. **`score` principal (`--metric`):** `passRate` (default) o `macroPassRate`.
2. **Desempates ordenados (si diferencia `< 0.0001`):**
   1. Menor cantidad de `clientFailedRuns` / `retriedRuns`.
   2. Mayor `signTestP` favorable vs `prod` (o menos regresiones frente a `prod`).
   3. Menor `p50DurationMs` (importante en JARVIS para `d3:2b` y `qwen3.5:4b`).
   4. Menor `avgPrompt` tokens.

El nuevo `currentTop2` son las **2 primeras variantes** del ranking resultante. *(Si `prod` está en el Top-2, entra normalmente al Top-2; de todos modos `prod` siempre corre en la comparativa como baseline).*

### 6.2. Condición de corte (`--target`) y códigos de salida
- **`prod` como referencia:** `prod` siempre corre como baseline y puede ocupar lugar en el Top-2, pero **no dispara el corte por `--target`**: para terminar anticipadamente, al menos una variante distinta de `prod` debe alcanzar `score >= target`.
- **Sin `--holdout` (default actual):** el bucle termina con **éxito (`exit 0`)** apenas una variante `!= prod` cumple `score >= target`.
- **Con `--holdout` (opcional):** cuando una variante `!= prod` alcanza `score >= target` en los datasets de trabajo, ejecuta `[prod, candidata]` sobre `--holdout`; si confirma `holdout.score >= target`, termina con **`exit 0`**, y si cae (sobreajuste), anota la alerta en `conclusiones.md` y continúa.
- **Al alcanzar `--max-loops` sin llegar a `--target`:** guarda `conclusiones.md`, `auto_state.json` y los resultados de la mejor variante encontrada y sale con **`exit 1`**. (Ante error de red/infraestructura o config, sale con **`exit 2`** sin tocar `conclusiones.md`.)

---

## 7. Estructura y actualización de `conclusiones.md`

El usuario pidió que `conclusiones.md` pueda arrancar vacío y que el modelo **solo lo actualice si necesita** al terminar cada vuelta.

### 7.1. Por qué separar la actualización en un paso dedicado (o condicional)
En lugar de reescribir todo el markdown a ciegas en cada vuelta (lo cual puede borrar aprendizajes viejos o inflar el archivo), al final de cada vuelta:
1. El código arma los hechos medidos de la ronda (tabla objetiva de resultados de la vuelta `k`, deltas vs `prod`, nuevo Top-2).
2. Le pregunta al LLM optimizador: *"Con estos resultados y el `conclusiones.md` actual, ¿hay algún aprendizaje nuevo que valga guardar o alguna idea que marcar como descartada? Si no hay cambios relevantes, devolvé `update: false`."*
3. Si `update: true`, escribe la versión actualizada respetando una **plantilla fija y compacta** (límite recomendado ≤ 150 líneas):

```markdown
# Conclusiones — <etapa>

## Estado actual (auto-actualizado)
- Objetivo: >= 80.0 % (`passRate`) · Modelo evaluado: `qwen3.5:4b + d3:2b`
- Top 1: `<variante>` (`XX.X %`, p50 `XX ms`)
- Top 2: `<variante>` (`XX.X %`, p50 `XX ms`)
- Baseline `prod`: `XX.X %`

## Reglas confirmadas (qué ayuda)
- ...

## Descartadas (qué empeora — no repetir)
- ...

## Últimas rondas (máx. 5)
- R3: `auto_..._a` (XX.X %, Δ +X.X) vs `auto_..._b` (XX.X %, Δ -X.X) — nota breve.
```

### 7.2. Archivo compañero de estado (`auto_state.json`)
Para que el código (sin depender de parsear markdown) sepa siempre con exactitud cuál es el Top-2 vigente, los `datasetHash` y cuántas vueltas van si se reanuda una sesión, conviene guardar junto a `conclusiones.md` un `auto_state.json` (solo lectura/escritura del orquestador; el LLM lee únicamente `conclusiones.md`). Si cambian los datasets, el modelo evaluado o `--thinking`, el código detecta el cambio de huella y vuelve a calibrar la Vuelta 0.

---

## 8. Plan de implementación sugerido

### Fase 1 — Infraestructura base y validación (sin LLM optimizador real)
1. Crear `eval/auto/config.ts`, `eval/auto/discover.ts` y `eval/auto/ranking.ts`.
2. Implementar `eval/auto/validateVariant.ts` (allowlist de imports + carga ESM + validación con `loadDatasets` + verificación de presupuesto de contexto).
3. Implementar `eval/auto/feedback.ts` para extraer los top N fallos desde `runs.jsonl` y el resumen de `comparison.json`.
4. Probar el pipeline completo con `--client=mock` y variantes ficticias en tests unitarios (`tests/eval_auto.test.ts`).

### Fase 2 — Integración del optimizador y `conclusiones.md`
1. Crear `eval/auto/stageContract.ts` cubriendo las 14 etapas (`d0`, `route`, `tool_choice`, `args_review`, `result_verification`, `fragment_judge`, `d5`, `recovery`, `continuation`, `plan`, `arguments`, `final`, `question`, `pending`).
2. Implementar `eval/auto/optimizer.ts` (reutilizando `postJson` / `src/core/models/transport.ts`, con soporte opcional de API key por variable de entorno y reintentos de reparación ante código inválido).
3. Implementar `eval/auto/conclusions.ts` con límite de tamaño y `update: boolean`.
4. Agregar `"eval:auto": "tsx eval/auto.ts"` en `package.json` y documentar su uso en `eval/INSTRUCCIONES.md`.

### Fase 3 — Pruebas piloto reales
1. Correr un piloto acotado en una etapa rápida de decisión (ej. `--stage=args_review --max-loops=3 --target=0.80`) usando un modelo optimizador capaz contra `d3:2b`.
2. Verificar en `eval/results/` y `eval/variants/_auto/<stage>/` que `comparison.md`, `conclusiones.md` y el archivado de perdedoras en `descartadas/` queden ordenados y reproducibles.
3. Correr un segundo piloto en una etapa generativa con `--repeat=2` (y `--holdout` opcional si se quiere validar generalización).

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El LLM optimizador genera código con errores de sintaxis o rompe la firma de `Variant` | `validateVariant.ts` + hasta 2 reintentos de reparación pasando el error exacto; `stageContract.ts` incluye una plantilla mínima compilable por etapa. |
| El LLM repite exactamente la misma variante ya descartada | `conclusiones.md` mantiene sección `Descartadas` + deduplicación por hash de código/prompt normalizado antes de correr la evaluación. |
| Sobreajuste tras varios loops al mismo dataset | `--holdout` opcional por ahora, invisible al feedback de errores; valida al alcanzar `--target`. |
| Caída temporal de Ollama / ngrok durante una corrida larga | Distinguir error de transporte (`allNetworkFailed` / exit code `2`) de falla de prompt; no actualizar Top-2 ni `conclusiones.md` con corridas incompletas. |
| Acumulación de archivos basura en `eval/variants/` que rompen `listVariantNames()` o `tsc` | Carpeta aislada `eval/variants/_auto/<stage>/` con nombres únicos por `runTag`; las variantes perdedoras no se borran sino que se mueven a `descartadas/` (excluidas del descubrimiento automático). |

---

## 10. Decisiones cerradas

1. **`conclusiones.md` por etapa:** `eval/variants/_auto/<stage>/conclusiones.md` por defecto (override opcional con `--conclusions=<ruta>`).
2. **Selección inicial del Top-2 en código:** primero reutiliza resúmenes compatibles de `eval/results/` (`meta.json` + `scores.json`); si faltan datos vigentes, corre Vuelta 0 automática con `prod` + variantes activas de la etapa (salteable con `--seed-top=v1,v2`). Desempates deterministas en código, sin LLM selector.
3. **Corte con `prod` en el Top-2:** `prod` corre siempre como referencia y puede ocupar lugar en Top-2, pero el corte anticipado por `--target` exige que lo alcance una variante distinta de `prod`.
4. **Métrica y códigos de salida:** `--target` se evalúa sobre `passRate` canónico global de la etapa (`--metric=passRate` default). Códigos de salida: `0` (alcanzó `--target`), `1` (llegó a `--max-loops` sin alcanzarlo), `2` (error de config, carga o transporte).
5. **Optimizador (`--optimizer-model`):** compatible con cualquier endpoint OpenAI (`/v1/chat/completions`), permitiendo modelo local, API externa (`--optimizer-api-key-env`) o URL ngrok (`--optimizer-url`).
6. **`--holdout` opcional por ahora:** por defecto evalúa todos los datasets disponibles de la etapa (excepto `smoke.jsonl`); `--holdout` queda disponible como flag opcional.
7. **Conservación de variantes descartadas:** no eliminar archivos; mover las perdedoras a `eval/variants/_auto/<stage>/descartadas/` para poder revisarlas o borrar esa subcarpeta en bloque más adelante.
8. **Alcance de edición:** el optimizador solo modifica el texto y estructura del prompt de la etapa (`DECISION_PROMPTS.*` o `PROMPTS.*`), sin tocar `params` ni `read.*`.

---

## 11. Estado de implementación, cambios fuera de `eval/` y dudas resueltas

La maquinaria del bucle quedó implementada y refactorizada íntegramente dentro de `eval/`:
- **Entrada unificada:** `eval/cli.ts --auto ...` (`npm run eval -- --auto ...`) delega a `runAutoCli` en `eval/auto.ts`, por lo que tanto `eval/cli.ts --auto` como `npx tsx eval/auto.ts` ejecutan exactamente el mismo orquestador.
- **Cero lógica duplicada:** se extrajo `eval/core/batch.ts` (`createEvalClients`, `executeComparisonBatch`) y los primitivos compartidos de flags/sanitización en `eval/core/config.ts` y `eval/core/results.ts` (`safeName`) para que `eval/cli.ts` y `eval/auto.ts` usen exactamente el mismo ejecutor de lotes, clientes, `meta.json`, `scores.json` y `comparison.{json,md}`.
- Se excluyeron `descartadas/` y `_archivo_*` del listado por defecto en `eval/core/variants/load.ts` y se documentó `--auto` en `eval/ui/views/help.ts` y `eval/INSTRUCCIONES.md`.

### 11.1. Cambios requeridos fuera de `eval/` (pendientes de aplicar si se aprueban)

Como el alcance de esta implementación se restringió estrictamente a `eval/`, quedaron anotados para aplicar fuera de `eval/`:

1. **`package.json` (`scripts`):**
   - Ya quedaron configurados `"eval:auto": "tsx eval/auto.ts"` e integrados `eval/core/*.test.ts` y `eval/auto/*.test.ts` dentro de `"test"`.
2. **`.gitignore`:**
   - Decidir si `eval/variants/_auto/` (o solo `eval/variants/_auto/**/auto_state.json` y `descartadas/`) debe ignorarse en Git o versionarse como parte de las corridas de laboratorio.
3. **`npm run lint` (`tsc --noEmit`):**
   - Verificar periódicamente si querés incluir o excluir archivos en `_auto/` cuando acumules muchas variantes experimentales (hoy `validateVariant.ts` valida tipado/sintaxis con `esbuild` antes de persistir cada archivo).

### 11.2. Aclaraciones y dudas detectadas respecto al borrador inicial

1. **14 etapas en el codebase vs 13 mencionadas en el doc (§3 y §8):**
   - El registro actual de `eval/core/stages/index.ts` tiene **14** etapas: se incorporó `continuation` (`eval/core/stages/continuation.ts`, `PROMPTS.CONTINUATION_VIEW`). `eval/auto/config.ts` y `eval/auto/stageContract.ts` cubren las **14** etapas leyendo `allStageNames()` dinámicamente.
2. **Exclusión por defecto de datasets `*_holdout*.jsonl` en `--dataset` automático (§2.1 y §2.5):**
   - El repo ya cuenta con archivos holdout dedicados en varias etapas (`d0_real_usuario_holdout*.jsonl`, `route_pasos_reales_holdout*.jsonl`, `tool_choice_terminal_locate_holdout*.jsonl`, `verify_pasos_reales_holdout*.jsonl`, `continuation_holdout*.jsonl`).
   - **Criterio adoptado:** si `--dataset` se omite, `discoverStageDatasets` excluye tanto `smoke.jsonl` como cualquier archivo cuyo nombre contenga `holdout` (`*_holdout*.jsonl`) para evitar fuga involuntaria al loop dev. Siguen disponibles si se pasan explícitamente en `--holdout=...` o en `--dataset=...`.
3. **Variantes archivadas heredadas:**
   - Las antiguas variantes de 4 opciones (`skip_continue`) y las variantes legacy con `params`/`read` fueron retiradas del repositorio (`eval/variants/_archivo_legacy/` eliminado). `eval/core/variants/load.ts` excluye carpetas `_auto/<otra_etapa>/` y `descartadas/` del descubrimiento por defecto.
4. **Contrato uniforme sin `params` ni `read`:**
   - El soporte heredado de `params`, `read` y lectores de decisión personalizados fue retirado completamente de `eval/core/`; todas las variantes activas y generadas siguen el contrato uniforme de constructores enteros (`DECISION_PROMPTS` o `PROMPTS`).
5. **Desempate por `signTestP` frente a `prod` (§6.1):**
   - `signTestP` es un *p*-value bilateral (menor = más significativo estadísticamente, tanto a favor como en contra). Para evitar favorecer variantes que empatan con muchas regresiones y `signTestP` chico, el desempate implementado compara primero ventaja neta `(improvements - regressions)`, luego menor número de `regressions`, y recién a igualdad de ventaja neta positiva elige el **menor `signTestP`** (evidencia estadísticamente más fuerte a favor).
6. **Validación previa en `validateVariant.ts` (§5.3):**
   - Además de la allowlist de imports y carga ESM (`?v=...` cache-busting para poder re-importar archivos durante reparación), el validador exige que no haya referencias no declaradas a constantes no exportadas de `src/core/models/prompts.ts` (ej. `ROUTE_HINTS`, `POWERSHELL_RULES`), verifica compatibilidad con `loadDatasets`, comprueba el presupuesto de contexto (`DECISION_MAX_CONTEXT` / `reserveCompletionTokens`) y verifica invariantes específicas de etapa (claves fijas en `route` / `tool_choice` / `fragment_judge`, ausencia de `read` o `params`).



