# JARVIS Lab — Laboratorio de Prompts

Entorno aislado y reproducible para experimentar, evaluar y contrastar variantes de prompts contra el comportamiento de los prompts en producción de JARVIS, comparando resultados cuantitativos sobre casos históricos y de prueba sin efectos colaterales.

> **Documento de Contexto Técnico y Visión**: Para un detalle exhaustivo de mapas, diferencias con producción y visión en fases, consultar [`lab/CONTEXT.md`](./CONTEXT.md).

---

## 1. Reglas de Aislamiento y Arquitectura

1. **Aislamiento de Código**:
   - `src/` **nunca** importa nada de `lab/`.
   - Dentro de `lab/`, **únicamente `adapter.ts`** tiene permitido importar módulos desde `src/` (`ConfigManager`, `postJson`, `PROMPTS`, validadores). Ningún otro archivo (`run.ts`, `evaluate.ts`, `extract-cases.ts`, `types.ts`) importa desde `src/`.
2. **Cero Efectos Colaterales**:
   - No se ejecutan herramientas físicas ni servidores MCP.
   - No se modifican archivos de trazas (`jarvis-traces.jsonl`), referencias (`jarvis-refs/`) ni configuraciones del sistema.
   - Nada dentro de `lab/` escribe fuera del directorio `lab/` (solo `lab/results/` y `lab/cases/<etapa>/_drafts/`).
3. **Quien Propone No Evalúa**:
   - Las variantes de prompt (`prompts/variants/`) están estrictamente separadas de los casos de evaluación (`cases/`) y de la lógica de checks (`evaluate.ts`).
4. **Sin Dependencias Nuevas**:
   - Funciona exclusivamente con `tsx` ya presente en el entorno (`npx tsx lab/<script>.ts`). Sin librerías externas adicionales ni frameworks pesados de testing.

---

## 2. Nombres Reales de Etapas

En el núcleo de JARVIS (`src/types/debug.ts`), las etapas se identifican con identificadores en mayúsculas. En `lab/`, se utilizan nombres canónicos en minúsculas para archivos y comandos CLI:

| Nombre CLI en Lab | Etapa Interna en JARVIS | Modelo | Estado en Lab |
| :--- | :--- | :--- | :--- |
| `decision_one` | `DECISION_ONE` | Eos-0.8B | **Implementada** |
| `arguments` | `ARGUMENT_GENERATION` | Qwen 3.5 9B | **Implementada** |
| `decision_two` | `DECISION_TWO` | Eos-0.8B | **Implementada** (Fase B) |
| `step_verification` | `STEP_VERIFICATION` | Eos-0.8B | **Implementada** (Fase B) |
| `stage_verification` | `STAGE_VERIFICATION` | Qwen 3.5 9B | **Implementada** (Fase C) |
| `plan` | `PLAN_GENERATION` | Qwen 3.5 9B | **Implementada** (Fase C) |
| `replan` | `REPLAN` | Qwen 3.5 9B | **Implementada** (Fase C) |
| `final_response` | `FINAL_RESPONSE` | Qwen 3.5 9B | **Implementada** (Fase D) |

---

## 3. Comandos y Flujo de Trabajo

### Flujo Completo de Trabajo:
1. **Habilitar el registro**: Activar en JARVIS el registro continuo de trazas (escribirá en `jarvis-traces.jsonl`).
2. **Generar trazas reales**: Ejecutar tareas reales en JARVIS que involucren navegación de archivos, búsqueda y herramientas.
3. **Extraer borradores**: Correr `npx tsx lab/extract-cases.ts`.
4. **Completar expectativas**: Inspeccionar los borradores en `lab/cases/<etapa>/_drafts/`, apoyándose en el bloque `reference` (salida original, `error`, resultado de herramienta `toolRun`, `recordedParams`), y definir `expect: [...]` manualmente.
5. **Promover casos**: Mover los casos validados fuera de `_drafts/` al directorio `lab/cases/<etapa>/`.
6. **Ejecutar benchmarks**: Evaluar el prompt estable y variantes con `run.ts`.
7. **Comparar cuantitativamente**: Contrastar corridas con `evaluate.ts`.

### A. Extraer borradores desde el registro de trazas
```bash
# Extraer desde el archivo de trazas por defecto (jarvis-traces.jsonl)
npx tsx lab/extract-cases.ts

# Extraer desde un archivo alternativo o fixture de prueba
npx tsx lab/extract-cases.ts --file lab/fixtures/example-traces.jsonl

# Extraer únicamente las llamadas de una tarea específica
npx tsx lab/extract-cases.ts --task example-task-fast-01
```
Lee el registro JSONL en modo **solo lectura** y genera borradores en `cases/<etapa>/_drafts/` con la entrada exacta registrada, `expect: null`, `source: { taskId, seq }` y un bloque `reference`.
- **Soporte de 8 etapas**: Mapea automáticamente todas las etapas a sus contratos de entrada base (`CaseInputEos` o `CaseInputQwen`).
- **Saneamiento de reintentos**: Detecta `ERROR_PREVIO:`, separa la nota y reconstruye el user prompt de primera pasada, anotando en `notes`.
- **Fallback de replan**: Identifica llamadas `REPLAN` explícitas y clasifica la segunda llamada `PLAN_GENERATION` de una tarea como `replan` en trazas históricas.
- **Asociación de toolRuns**: Prioriza `callSeq` y preserva `resultPreview` en `reference`.

### B. Ejecutar un benchmark (Stable o Variante)
```bash
# Eos: Decision #1 (repeticiones = 1 por ser determinista)
npx tsx lab/run.ts decision_one stable
npx tsx lab/run.ts decision_one example-concise --split dev

# Eos: Decision #2 (selección de herramienta MCP)
npx tsx lab/run.ts decision_two stable
npx tsx lab/run.ts decision_two example-tool-desc --split dev

# Eos: Step Verification (verificación factual ok / cumple)
npx tsx lab/run.ts step_verification stable
npx tsx lab/run.ts step_verification example-strict-instructions --split dev

# Qwen: Arguments (repeticiones = 3 por defecto)
npx tsx lab/run.ts arguments stable
npx tsx lab/run.ts arguments example-strict-refs --split test

# Qwen: Stage Verification (supervisión semántica de etapa)
npx tsx lab/run.ts stage_verification stable
npx tsx lab/run.ts stage_verification example-strict-evidence --split dev

# Qwen: Plan (plan inicial con thinking)
npx tsx lab/run.ts plan stable
npx tsx lab/run.ts plan example-concise-plan --split dev

# Qwen: Replan (replanificación localizada con thinking)
npx tsx lab/run.ts replan stable
npx tsx lab/run.ts replan example-conservative-replan --split dev

# Qwen: Final Response (respuesta final en texto libre al usuario)
npx tsx lab/run.ts final_response stable
npx tsx lab/run.ts final_response example-concise-summary --split dev

# Correr un único caso específico con --case
npx tsx lab/run.ts plan stable --case example-create-plan
npx tsx lab/run.ts final_response stable --case example-final-response
```
- **Calentamiento (Warmup)**: Ejecuta una llamada de calentamiento mínima previa por modelo antes de medir (para Qwen: prompt mínimo de 16 tokens sin thinking; para Eos: decide mínimo). Se descarta de las métricas. Nunca se ejecuta una llamada real de plan o replan en el warmup.
- **Determinismo de Eos**: `lab/config.json` configura 1 repetición para etapas de Eos (`decision_one`, `decision_two`, `step_verification`). Qwen configura 3 para `arguments`, `stage_verification` y `final_response`, y 2 para `plan` y `replan`.
- **Detección temprana de caídas**: Si el endpoint está desconectado (`ECONNREFUSED`), aborta de inmediato con código 1 sin guardar archivos corruptos en disco.
- **Registro atómico**: Genera un archivo inmutable en `lab/results/<timestamp>-<etapa>-<variante>.json` (con flag `wx` para evitar sobreescrituras).
- **Métricas y Probabilidades**: Guarda probabilidades para Eos y veredictos descriptivos para plan/replan (pasos, rutas y acción), stage_verification (status y pregunta al usuario) y final_response (longitud y texto generado).
- **Chequeo de fidelidad (B2)**: Para etapas de Qwen con prompt estable, advierte si el prompt SYSTEM vivo de `prompts.ts` o los parámetros del body difieren de los grabados. Si un caso no incluye `reference.recordedParams`, emite advertencia explícita y la guarda en el resultado.
- **Sufijo en Decision #2 (B1)**: Si una herramienta en el caso termina con `[last attempt failed]`, una variante que sobrescribe su descripción reemplaza la parte base y conserva el sufijo.

### C. Comparar dos corridas
```bash
npx tsx lab/evaluate.ts lab/results/<run-stable>.json lab/results/<run-variant>.json
```
- Valida la integridad de ambas corridas: rechaza corridas con errores de conexión o con 100% de errores en sus repeticiones.
- Valida que ambas corridas cubran exactamente los mismos casos y repeticiones.
- Informa split evaluado, tasa de acierto global, latencia promedio y **mediana de latencia**.
- Desglosa checks individuales por caso para A y B.
- Para Eos (`decision_one`, `decision_two`), muestra por caso la probabilidad de la opción esperada en A y B y su diferencia porcentual ($p_B - p_A$).
- Para Eos (`step_verification`), muestra por caso las probabilidades de `ok` y `cumple`, sus diferencias y el veredicto de aprobación de Eos (`ok > 0.5 && cumple > 0.5`).
- Para `plan` y `replan`, muestra descriptivamente la cantidad de pasos planificados, las rutas sugeridas y la acción (`continue` / `abort`).
- Para `stage_verification`, muestra el status obtenido y si se formuló pregunta al usuario.
- Para `final_response`, presenta una vista comparativa delimitada en consola que contrasta directamente el texto completo de la respuesta de la Corrida A vs la Corrida B junto con la diferencia de caracteres generados ($len_B - len_A$), facilitando al evaluador juzgar tono, completitud y estilo.

---

## 4. Formato de Casos y Variantes

### Formato de Casos (`cases/<etapa>/<id>.json`)
```json
{
  "id": "example-select-tool",
  "stage": "decision_two",
  "split": "dev",
  "input": {
    "state": "...",
    "questions": { ... }
  },
  "expect": [
    { "type": "valid_json" },
    { "type": "choice_equals", "questionKey": "selected_tool", "expected": "search_files" }
  ],
  "source": {
    "taskId": "task_123",
    "seq": 2
  },
  "reference": {
    "originalOutput": "{\"answers\":{\"selected_tool\":{\"choice\":\"search_files\"}}}",
    "error": null,
    "toolRun": { "callSeq": 2, "tool": "search_files", "ok": true, "resultPreview": "..." }
  },
  "notes": "Descripción del caso"
}
```

#### Tipos de Checks en `expect`:
- `valid_json`: Valida que la respuesta sea un JSON sintácticamente correcto.
- `choice_equals`: (Eos) Verifica que `answers[questionKey].choice === expected`.
- `noul_approved`: (Eos) Verifica si una pregunta noul (`ok` o `cumple`) aprueba (`p > 0.5`) según `expected: true|false`.
- `matches_schema`: (Qwen) Valida que los argumentos cumplan con el `SCHEMA` del caso usando `validateArgs`. Falla explícitamente si el schema está ausente o vacío.
- `field_equals`: Comprueba que un valor por ruta (ej. `path: "path"`) sea igual al esperado.
- `status_equals`: (stage_verification) Comprueba el valor de `status` ("completed" | "recoverable_deviation" | "insufficient_info" | "unrecoverable_blocked").
- `has_question_for_user`: (stage_verification) Valida si hay pregunta formulada al usuario (`expected: true|false`).
- `action_equals`: (replan) Comprueba si la acción es `"continue"` o `"abort"`.
- `min_steps` / `max_steps`: (plan / replan) Valida cantidad mínima o máxima de pasos generados.
- `routes_allowed`: (plan / replan) Valida que las rutas sugeridas pertenezcan a la lista permitida (`files`, `locate`, `terminal`, `web`).
- `not_empty`: (final_response) Comprueba que la salida contenga texto no vacío.
- `contains_text`: (final_response) Comprueba la presencia de palabras clave requeridas.
- `min_length`: (final_response) Comprueba una longitud mínima en caracteres para evitar respuestas incompletas.

### Formato de Variantes (`prompts/variants/<etapa>/<id>.(md|json)`)

#### Para Qwen (`arguments`, `stage_verification`, `plan`, `replan`, `final_response`): Archivo `.md`
El contenido reemplaza exclusivamente el bloque `SYSTEM`. El `user` prompt del caso se mantiene idéntico.

#### Para Eos (`decision_one`, `decision_two`, `step_verification`): Archivo `.json`
- **En `decision_one`**: Sobrescribe `instructions` y `criteria` por pregunta. Las opciones permitidas de choice son fijas.
- **En `decision_two`**: Sobrescribe `instructions` y las descripciones en `criteria` referenciando el nombre de la herramienta. Herramientas de la variante que no existan en el caso se omiten para ese caso con aviso (nunca se agregan). Es error si una variante no coincide con ninguna herramienta de ningún caso evaluado.
- **En `step_verification`**: Solo se pueden sobrescribir las `instructions` de `ok` y `cumple`. El tipo `noul` no cambia y no admite `criteria`.

---

## 5. Particularidades de Integración y Paridad con Producción

### Contrato del Registro de Trazas
El extractor lee un archivo JSONL (por defecto `jarvis-traces.jsonl`), donde cada línea representa una tarea completa terminada. Los campos `mode` y `status` son cadenas abiertas que reflejan fielmente el estado interno de Jarvis (`task.mode` y `task.state`), sin traducciones ni enums cerrados:
```json
{
  "v": 1,
  "taskId": "task-...",
  "startedAt": "...",
  "endedAt": "...",
  "mode": "FAST",
  "userMessage": "...",
  "status": "COMPLETED",
  "finalResponse": "...",
  "plan": null,
  "calls": [
    {
      "seq": 1,
      "step": 1,
      "stage": "DECISION_ONE",
      "rawInput": "...",
      "rawOutput": "...",
      "latencyMs": 120,
      "promptTokens": 140,
      "completionTokens": 35,
      "retried": false,
      "error": null
    }
  ],
  "toolRuns": [
    {
      "step": 1,
      "tool": "read_file",
      "args": { ... },
      "ok": true,
      "error": null
    }
  ]
}
```
Estados válidos de Jarvis: `"COMPLETED"`, `"FAILED"`, `"CANCELLED"`, `"PARTIAL"`. El estado `"WAITING_INPUT"` es un estado transitorio y no se registra como finalización de tarea.

### Paridad de Validación en `arguments` (IMP-01)
En producción (`src/core/reasoner/qwen.ts`), los parámetros opcionales que el modelo retorna con valor `null` se eliminan antes de llamar a `validateArgs`, dado que `null` en un parámetro opcional equivale a "no invocado". El adaptador de `lab/` replica esta misma lógica para garantizar paridad exacta de evaluación.

### Stable Histórico de Eos (`decision_one`)
En las trazas históricas de JARVIS, el campo `rawInput` de Eos almacena el `{ state, questions }` ya renderizado. El prompt estable corresponde al par `state` y `questions` registrado originalmente en la traza, no a una regeneración en vivo desde `prompts.ts`. El hash estable se calcula sobre el conjunto global ordenado alfabéticamente por `caseId` y por caso individual.

### Fusión de Criteria y Registro del Prompt Efectivo en Eos
Una variante de `decision_one` puede sobrescribir selectivamente solo parte de los criterios. Las opciones no mencionadas conservan su texto original. El benchmark guarda el prompt efectivo final resultante (`effectivePromptsByCase`) para auditar la entrada exacta del modelo.

### Schema en `arguments` (Qwen)
El schema verificado en los checks es el `cleanedSchema` capturado dentro del bloque `SCHEMA:` del user prompt mediante un analizador de llaves balanceadas propio, no el `inputSchema` del servidor MCP. Esto permite evaluar sin levantar servidores MCP en ejecución.

### Medición Previa a Reintentos
En producción, JARVIS aplica reintentos con notas de corrección (`retryNote`, 1.5x tokens, temperatura 0.3). El laboratorio evalúa **un único intento por repetición** a temperatura base (0.1), midiendo la tasa pura de acierto de primera pasada del prompt evaluado.

---

## 6. Privacidad y Exclusión de Datos

El archivo `lab/.gitignore` local garantiza que:
- Los borradores con datos sensibles en `cases/**/_drafts/` no se suban al repositorio.
- Los casos reales extraídos de tareas del usuario queden excluidos, preservando únicamente los casos de prueba `example-*` y los fixtures en `fixtures/`.
- Los archivos generados en `results/*.json` queden fuera del seguimiento de git.
