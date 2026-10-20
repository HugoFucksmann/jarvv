# JARVIS Lab — Laboratorio de Prompts

Entorno aislado y reproducible para experimentar, evaluar y contrastar variantes de prompts contra el comportamiento de los prompts en producción de JARVIS, comparando resultados cuantitativos sobre casos históricos y de prueba sin efectos colaterales.

---

## 1. Reglas de Aislamiento y Arquitectura

1. **Aislamiento de Código**:
   - `src/` **nunca** importa nada de `lab/`.
   - Dentro de `lab/`, **únicamente `adapter.ts`** tiene permitido importar módulos desde `src/` (`ConfigManager`, `postJson`, `PROMPTS`, validadores). Ningún otro archivo (`run.ts`, `evaluate.ts`, `extract-cases.ts`, `types.ts`) importa desde `src/`.
2. **Cero Efectos Colaterales**:
   - No se ejecutan herramientas físicas ni servidores MCP.
   - No se modifican archivos de tareas (`jarvis-tasks.json`), referencias (`jarvis-refs/`) ni configuraciones del sistema.
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

### A. Extraer borradores desde tareas reales
```bash
npx tsx lab/extract-cases.ts
```
Lee `jarvis-tasks.json` en modo **solo lectura** y genera borradores en `cases/<etapa>/_drafts/` con la entrada real registrada, la salida histórica y `expect: null`. Los casos con `expect: null` no se ejecutan hasta que el usuario defina sus expectativas a mano y los mueva fuera de `_drafts/`.

### B. Ejecutar un benchmark (Stable o Variante)
```bash
# Eos: Decision #1
npx tsx lab/run.ts decision_one stable
npx tsx lab/run.ts decision_one example-concise --split dev

# Qwen: Arguments
npx tsx lab/run.ts arguments stable
npx tsx lab/run.ts arguments example-strict-refs --split test
```
- Corre cada caso $N$ veces de forma secuencial (según `lab/config.json`, por defecto 3).
- Genera un archivo inmutable en `lab/results/<timestamp>-<etapa>-<variante>.json`.
- Registra el texto exacto del prompt, hash del prompt estable, parámetros del modelo, latencia por repetición y salidas crudas.

### C. Comparar dos corridas
```bash
npx tsx lab/evaluate.ts lab/results/<run-stable>.json lab/results/<run-variant>.json
```
- Valida que ambas corridas cubran exactamente los mismos casos y repeticiones.
- Informa tasa de éxito global, detalle caso a caso (ej. 3/3 vs 2/3), casos que mejoran / empeoran / neutros, errores sintácticos de JSON, errores de schema y latencia media.

---

## 4. Formato de Casos y Variantes

### Formato de Casos (`cases/<etapa>/<id>.json`)
```json
{
  "id": "example-routing-files",
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
    "iterationId": "iter_456"
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
**Regla de integridad**: Una variante de Eos **no puede alterar las opciones permitidas del choice** ni agregar/quitar claves de preguntas. Si lo intenta, el adaptador rechaza la variante inmediatamente.
Ejemplo: `lab/prompts/variants/decision_one/example-concise.json`.

---

## 5. Particularidades de Integración y Modelos

### Stable de Eos (`decision_one`)
En las trazas históricas de JARVIS (`modelIterations`), el campo `rawInput` almacena el `{ state, questions }` ya renderizado, sin conservar los datos estructurados originales en ese nivel. En consecuencia, el **prompt estable** de `decision_one` para un caso histórico corresponde al par `state` y `questions` registrado originalmente en la traza del caso, no a una regeneración en vivo desde `prompts.ts`.

### Schema en `arguments` (Qwen)
El schema verificado en la capa 2 de checks es el `cleanedSchema` capturado dentro del bloque `SCHEMA` del user prompt, no el `inputSchema` original completo con metadatos del servidor MCP. Esto garantiza que las pruebas sean 100% reproducibles sin requerir servidores MCP en ejecución.

### Medición Previa a Reintentos
En producción, JARVIS aplica reintentos con notas de corrección (`retryNote`). El laboratorio evalúa **un único intento por repetición**, midiendo la tasa pura de acierto de primera pasada del prompt evaluado.

---

## 6. Privacidad y Exclusión de Datos

El archivo `lab/.gitignore` local garantiza que:
- Los borradores con datos sensibles en `cases/**/_drafts/` no se suban al repositorio.
- Los casos reales extraídos de tareas del usuario queden excluidos, preservando únicamente los casos de prueba `example-*`.
- Los archivos generados en `results/*.json` queden fuera del seguimiento de git.
