# JARVIS Lab — Laboratorio de Prompts

Entorno aislado y reproducible para experimentar, evaluar y contrastar variantes de prompts contra el comportamiento de los prompts en producción de JARVIS, comparando resultados cuantitativos sobre casos históricos y de prueba sin efectos colaterales.

---

## 1. Reglas de Aislamiento y Arquitectura

1. **Aislamiento de Código**:
   - `src/` **nunca** importa nada de `lab/`.
   - Dentro de `lab/`, **únicamente `adapter.ts`** tiene permitido importar módulos desde `src/` (`ConfigManager`, `postJson`, `PROMPTS`, validadores). Ningún otro archivo (`run.ts`, `evaluate.ts`, `extract-cases.ts`, `types.ts`) importa desde `src/`.
2. **Cero Efectos Colaterales**:
   - No se ejecutan herramientas físicas ni servidores MCP.
   - No se modifican archivos de trazas (`jarvis-traces.jsonl`), referencias (`jarvis-refs/`) ni configuraciones del sistema.
   - Nada dentro de `lab/` escribe fuera del directorio `lab/`.
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
| `decision_two` | `DECISION_TWO` | Eos-0.8B | *Pendiente (registrada)* |
| `step_verification` | `STEP_VERIFICATION` | Eos-0.8B | *Pendiente (registrada)* |
| `plan` | `PLAN_GENERATION` | Qwen 3.5 9B | *Pendiente (registrada)* |
| `replan` | `REPLAN` | Qwen 3.5 9B | *Pendiente (registrada)* |
| `stage_verification` | `STAGE_VERIFICATION` | Qwen 3.5 9B | *Pendiente (registrada)* |
| `final_response` | `FINAL_RESPONSE` | Qwen 3.5 9B | *Pendiente (registrada)* |

---

## 3. Comandos y Flujo de Trabajo

### Flujo Completo de Trabajo:
1. **Habilitar el registro**: Activar en JARVIS el registro continuo de trazas (escribirá en `jarvis-traces.jsonl`).
2. **Generar trazas reales**: Ejecutar entre 10 y 20 tareas reales en JARVIS que involucren navegación de archivos, búsqueda y herramientas.
3. **Extraer borradores**: Correr `npx tsx lab/extract-cases.ts`.
4. **Completar expectativas**: Inspeccionar los borradores en `lab/cases/<etapa>/_drafts/`, apoyándose en el bloque `reference` (salida original, `retried`, `error`, resultado de herramienta `toolRun`), y definir `expect: [...]` manualmente.
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
Lee el registro JSONL en modo **solo lectura** y genera borradores en `cases/<etapa>/_drafts/` con la entrada exacta registrada, `expect: null`, `source: { taskId, seq }` y un bloque `reference`. Los casos preexistentes no se sobrescriben.

### B. Ejecutar un benchmark (Stable o Variante)
```bash
# Eos: Decision #1
npx tsx lab/run.ts decision_one stable
npx tsx lab/run.ts decision_one example-concise --split dev

# Qwen: Arguments
npx tsx lab/run.ts arguments stable
npx tsx lab/run.ts arguments example-strict-refs --split test
```
- Realiza sondeo previo en la primera llamada: si el endpoint está desconectado (`ECONNREFUSED`), aborta de inmediato con código 1 sin guardar resultados en disco.
- Corre cada caso $N$ veces de forma secuencial (según `lab/config.json`, por defecto 3).
- Genera un archivo inmutable en `lab/results/<timestamp>-<etapa>-<variante>.json` (con flag `wx` para evitar sobreescrituras).
- Registra el prompt exacto (o el prompt efectivo fusionado en Eos), hashes estables deterministas globales y por caso, parámetros de modelo, latencias, salidas crudas y banderas de truncamiento.

### C. Comparar dos corridas
```bash
npx tsx lab/evaluate.ts lab/results/<run-stable>.json lab/results/<run-variant>.json
```
- Valida la integridad de ambas corridas: rechaza corridas con errores de conexión o con 100% de errores en sus repeticiones.
- Valida que ambas corridas cubran exactamente los mismos casos y repeticiones.
- Muestra el split evaluado (`Split: dev`) y reporta tasa de acierto global, detalle caso a caso (ej. 3/3 vs 2/3), casos que mejoran / empeoran / neutros, errores sintácticos de JSON, errores de schema y latencia media.

---

## 4. Formato de Casos y Variantes

### Formato de Casos (`cases/<etapa>/<id>.json`)
```json
{
  "id": "draft_d1_task_123_seq1",
  "stage": "decision_one",
  "split": "dev",
  "input": {
    "state": "...",
    "questions": { ... }
  },
  "expect": [
    { "type": "valid_json" },
    { "type": "choice_equals", "expected": "files", "questionKey": "route" }
  ],
  "source": {
    "taskId": "task_123",
    "seq": 1
  },
  "reference": {
    "originalOutput": "{\"answers\":{\"route\":{\"choice\":\"files\"}}}",
    "retried": false,
    "error": null,
    "toolRun": { "tool": "read_file", "ok": true, "error": null }
  },
  "notes": "Descripción del caso"
}
```

#### Tipos de Checks en `expect`:
- `valid_json`: Valida que la respuesta sea un JSON sintácticamente correcto.
- `choice_equals`: (Eos) Verifica que `answers[questionKey].choice === expected`.
- `matches_schema`: (Qwen) Valida que los argumentos cumplan con el `SCHEMA` del caso usando `validateArgs`.
- `field_equals`: Comprueba que un valor por ruta (ej. `path: "path"`) sea igual al esperado.

### Formato de Variantes (`prompts/variants/<etapa>/<id>.(md|json)`)

#### Para Qwen (`arguments`): Archivo `.md`
El contenido reemplaza exclusivamente el bloque `SYSTEM`. El `user` prompt del caso se mantiene idéntico.
Ejemplo: `lab/prompts/variants/arguments/example-strict-refs.md`.

#### Para Eos (`decision_one`): Archivo `.json`
Sobrescribe las `instructions` y los textos descriptivos de `criteria` por pregunta.
**Regla de integridad**: Una variante de Eos **no puede alterar las opciones permitidas del choice** ni agregar claves de preguntas. Si lo intenta, el adaptador rechaza la variante inmediatamente. Opciones omitidas en la variante conservan su criterio original.
Ejemplo: `lab/prompts/variants/decision_one/example-concise.json`.

---

## 5. Particularidades de Integración y Diferencias con Producción

### Contrato del Registro de Trazas (Versión 1)
El extractor lee un archivo JSONL (por defecto `jarvis-traces.jsonl`), donde cada línea representa una tarea completa:
```json
{
  "v": 1,
  "taskId": "task-...",
  "startedAt": "...",
  "endedAt": "...",
  "mode": "fast" | "plan",
  "userMessage": "...",
  "status": "completed" | "failed" | "aborted" | "waiting_input",
  "finalResponse": "...",
  "plan": { ... } | null,
  "calls": [
    {
      "seq": 1,
      "step": 1,
      "stage": "DECISION_ONE" | "ARGUMENT_GENERATION",
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

### Aclaración de Pruebas del Extractor
El extractor `extract-cases.ts` fue rediseñado y verificado exhaustivamente contra el fixture representativo `lab/fixtures/example-traces.jsonl`. **No ha sido probado con un archivo `jarvis-traces.jsonl` generado en producción**, dado que la persistencia en `src/` aún debe ser implementada por el agente correspondiente.

### Stable Histórico de Eos (`decision_one`)
En las trazas históricas de JARVIS, el campo `rawInput` de Eos almacena el `{ state, questions }` ya renderizado. El prompt estable corresponde al par `state` y `questions` registrado originalmente en la traza, no a una regeneración en vivo desde `prompts.ts`. El hash estable se calcula sobre el conjunto global ordenado alfabéticamente por `caseId` y por caso individual.

### Fusión de Criteria y Registro del Prompt Efectivo en Eos
Una variante de `decision_one` puede sobrescribir selectivamente solo parte de los criterios. Las opciones no mencionadas conservan su texto original. El benchmark guarda el prompt efectivo final resultante (`effectivePromptsByCase`) para auditar la entrada exacta del modelo.

### Schema en `arguments` (Qwen)
El schema verificado en los checks es el `cleanedSchema` capturado dentro del bloque `SCHEMA:` del user prompt mediante un analizador de llaves balanceadas, no el `inputSchema` del servidor MCP. Esto permite evaluar sin levantar servidores MCP en ejecución.

### Medición Previa a Reintentos
En producción, JARVIS aplica reintentos con notas de corrección (`retryNote`, 1.5x tokens, temperatura 0.3). El laboratorio evalúa **un único intento por repetición** a temperatura base (0.1), midiendo la tasa pura de acierto de primera pasada del prompt evaluado.

---

## 6. Privacidad y Exclusión de Datos

El archivo `lab/.gitignore` local garantiza que:
- Los borradores con datos sensibles en `cases/**/_drafts/` no se suban al repositorio.
- Los casos reales extraídos de tareas del usuario queden excluidos, preservando únicamente los casos de prueba `example-*` y los fixtures en `fixtures/`.
- Los archivos generados en `results/*.json` queden fuera del seguimiento de git.
