# JARVIS — Verificación de ejecución de herramientas

**Estado:** borrador v0.1 · 29 de octubre de 2026
**Alcance de esta versión:** validación de argumentos (pre-ejecución) y validación del resultado (post-ejecución).
**Fuera de esta versión (pendiente):** diagnóstico y reparación tras una desviación, flujo `ask_user`, criterio de éxito por paso en FAST. Ver la sección 10.

Convención: **[Decidido]** lo definido por el equipo; **[Propuesta]** lo que se sugiere y falta validar; **[Abierto]** lo que no está resuelto.

---

## 1. Problema

JARVIS comprueba que una herramienta *se ejecutó bien*, pero no observa *qué hizo*. Ejemplo: la tarea era crear un Excel. La herramienta lo creó sin error, pero en una ubicación distinta de la pedida. El sistema marca la ejecución como correcta.

Hay tres carencias, relacionadas pero distintas:

1. **No hay observación del resultado real.** La verificación se apoya en lo que la herramienta dice de sí misma.
2. **No se valida la generación de argumentos.** Qwen genera los args y solo se comprueba el schema (tipos, requeridos, enum). Un path incorrecto pero bien formado pasa.
3. **No hay camino de reparación que distinga la causa.** Un resultado "ejecutado pero incorrecto" cae en el mismo manejo que cualquier fallo.

## 2. Estado actual (resumen del código)

Pipeline de `runStep` (`callExecutor.ts`):

```
discoverCandidateTools → selectTool (Decision #2) → generateStepArguments (Qwen)
→ resolveReferences → checkAntiLoop → authorizeCall (Guard) → dispatchTool
→ absorbResult → verifyResult → settleCall
```

Hallazgos relevantes:

- **Verificación (`verifyResult`).** Si las señales son limpias (`isCleanSignals`), se llama a `evaluateStepVerification` con dos preguntas `noul`: `ok` y `cumple`. Recibe `step.instruction`, el nombre de la tool, `callLabel: finding`, `evidence.summary`, `expectedOutcome` y un fragmento de `compactObs`. **No recibe los args.**
- **`refLabel` recorta a 60 caracteres** el destino (ruta, comando). Un comando largo (p. ej. un script que crea un Excel) llega al verificador prácticamente sin su ruta.
- **FAST no tiene criterio de éxito por paso.** `runFastLoop` crea el paso con `instruction: task.message` y sin `expectedOutcome`; el verificador compara contra el mensaje completo del usuario. PLAN sí tiene `expectedOutcome`.
- **Segundo juez (solo PLAN).** Si Eos no aprueba, `deps.llm.verifyStage` (Qwen) emite un veredicto. Solo corre ante rechazos: un falso "ok" nunca lo revisa nadie.
- **Reparación.** Un `rejected` produce `logical_error`. En FAST, `handleEscalation` excluye la tool usada (`excludedToolForNextCall`) y pide arbitraje a Decision #1 (máx. `MAX_ESCALATIONS = 2`). En PLAN, `handleReplan` reemplaza el paso y todos los siguientes (máx. `MAX_REPLAN = 2`). Ninguno distingue "args mal generados" de "tool inadecuada".
- **Bug latente.** `recordFailedCall` fija `step.tool` y la escalación la excluye, incluso cuando el fallo fue de argumentos y la tool era la correcta.
- **Validación de args actual (`validateArgs`, `qwen.ts`).** Solo nivel superior: requeridos, tipo y enum. Sin validación semántica.
- **Memoria sin prosa de modelos.** `FAIL_TEXT` es fijo y `failReason` es determinista. El `reason` de los modelos viaja solo en eventos y trazas.
- **Efectos.** `buildEffectsContext` conserva las mutaciones aplicadas (incluidas las `rejected`) con sus argumentos. Es la base para compensar un efecto equivocado.
- **Catálogo.** Sondas de lectura disponibles: `list_directory`, `read_file`. No hay `get_file_info` en el manifest. Crear `.xlsx` con `write_file` está documentado en el manifest (JSON de filas), por lo que no hace falta pasar por la terminal.

## 3. Decisiones tomadas

1. **[Decidido]** Todo lo detectable por código se comprueba por código primero, tanto en pre como en post-ejecución, aislado en un hook/helper.
2. **[Decidido]** Qwen deja de ser segundo juez de verificación.
3. **[Decidido]** El modelo de decisión pasa a **d3:2b**, que se encarga de validaciones y decisiones.
4. **[Decidido]** Pre-ejecución: d3 valida los args. Si los marca como incorrectos, se **regenera una vez** con una indicación fija según la opción que d3 haya elegido (d3 no genera texto). Si la segunda validación también falla, el paso se marca como fallido y sigue el bucle (`runStep`/escalación en FAST, replan en PLAN).
5. **[Decidido]** Post-ejecución: se reemplazan las preguntas `ok`/`cumple` por un conjunto mayor (d3 admite múltiples preguntas por inferencia), y se envía a d3 el resultado de lo ejecutado.

## 4. Principios de diseño

- **Código primero, modelo después.** Un check determinista que falla evita la llamada a d3.
- **Los modelos clasifican, no redactan.** Toda salida de d3 es una probabilidad. Todo mensaje que vuelve al flujo es plantilla fija más datos que calcula el código.
- **Sin prosa de modelos en la memoria.** Se mantiene la regla vigente (`FAIL_TEXT`, `failReason`).
- **Validar antes de mutar.** Un efecto aplicado cuesta más corregir que prevenir. Por eso la validación de args va antes de Guard y del despacho.
- **Presupuestos acotados y separados.** La regeneración de args tiene su propio tope; no consume escalaciones ni replans.
- **Observación ≠ juicio.** Mirar el entorno aporta hechos; decidir si coinciden con la intención es otra cosa (ver sección 7).

## 5. Pipeline propuesto

```
discoverCandidateTools → selectTool (Decision #2) → generateStepArguments (Qwen)
→ resolveReferences
→ [PRE-A] checks deterministas de args          (helper, puro)
→ [PRE-B] validación de args con d3             (solo tools que mutan, ver 6.3)
     └─ si falla: 1 regeneración con corrección fija → repetir PRE-A y PRE-B
     └─ si vuelve a fallar: fallo del paso (args_rejected)
→ checkAntiLoop → authorizeCall (Guard) → dispatchTool → absorbResult
→ [OBS]    sonda interna de lectura               (si la tool la declara)
→ [POST-A] checks deterministas del efecto        (helper, puro)
→ [POST-B] checklist con d3                       (omitido si POST-A ya falló)
→ settleCall
```

Puntos de colocación **[Propuesta]**:

- PRE va **después de `resolveReferences`** (el `content` suele venir de refs) y **antes de `checkAntiLoop` y Guard** (no se pide aprobación por args que se van a corregir; el anti-loop solo registra su firma en el despacho, así que no interfiere).
- OBS y POST van entre `absorbResult` y `settleCall`. Los extractores (`processor/extractors`) no sirven para esto: reciben solo el resultado de la tool y no pueden invocar otras.

## 6. Validación pre-ejecución

### 6.1 Helper determinista [Propuesta]

Módulo aislado (nombre tentativo: `checks/executionChecks.ts`), con funciones **puras**:

```ts
interface CheckContext {
  goal: string;              // task.message
  instruction: string;       // step.instruction (+ handoff)
  environment: UserEnvironment;
  tool: MCPTool;
  policy: Readonly<ToolPolicy>;
  args: Record<string, unknown>;   // ya con refs resueltas
}

interface Finding {
  code: string;              // vocabulario cerrado, p. ej. "path_relative"
  severity: "fail" | "warn";
  detail: string;            // determinista, calculado por código
}

validateArgsDeterministic(ctx: CheckContext): Finding[]
checkEffectDeterministic(ctx: CheckContext & { processed: ProcessedResult; observation?: Observation }): Finding[]
```

- Registro por `(server, tool)` más reglas genéricas por capability (`FILE_WRITE`, etc.).
- Sin I/O: la sonda la ejecuta el executor y le pasa el resultado.
- Los `Finding` no alimentan la memoria como prosa; se traducen a códigos y datos fijos.

### 6.2 Checks deterministas candidatos (pre)

| Check | Aplica a | Detecta |
|---|---|---|
| Ruta absoluta | `write_file`, `create_directory`, `move_file`, lecturas | Una ruta relativa se resuelve contra el cwd del servidor, no del usuario |
| Ruta bajo raíces conocidas | ídem | Rutas fuera de las carpetas de `UserEnvironment` (alerta, no necesariamente fallo) |
| Ruta literal del mensaje | ídem | El mensaje contiene una ruta y `args.path` no coincide |
| Alias de ubicación | ídem | "escritorio/desktop", "documentos", "descargas" mencionados y la ruta no cuelga de la carpeta correspondiente |
| Contenido por extensión | `write_file` | `.xlsx/.xls/.xlsm`: el `content` debe parsear como arreglo de filas u objeto de arreglos (nota del manifest) |
| Contenido vacío | `write_file` | Escritura sin contenido |

El diccionario de alias debe cubrir español e inglés. Lista a refinar con trazas reales.

### 6.3 Validación con d3 [Propuesta]

**Una pregunta `noul` por check**, en una sola inferencia. Se prefiere `noul` sobre un `choice` porque en `choice` la opción "ok" compite con los defectos y no admite dos defectos simultáneos. Con `noul`, cada pregunta se asocia 1:1 a un mensaje fijo y los que fallen se concatenan.

Preguntas candidatas (la redacción final depende de `prompts.ts`):

| Clave | Aplica a | Pregunta |
|---|---|---|
| `ubicacion_pedida` | tools de escritura | ¿La ruta de destino corresponde a la ubicación pedida (o no se pidió ninguna)? |
| `nombre_pedido` | tools de escritura | ¿El nombre y la extensión corresponden a lo pedido? |
| `contenido_pedido` | tools de escritura | ¿El contenido corresponde a lo pedido, completo y correcto? |
| `comando_coherente` | `start_process`, `interact_with_process` | ¿El comando hace lo que pide el paso? |
| `objetivo_pedido` | lecturas y búsquedas | ¿El recurso, la consulta o la URL son los que pidió el usuario? |

**Alcance:** solo tools con `policy.mutates` por defecto, para acotar latencia. Extender a lecturas es una decisión de costo.

**Entrada a d3:** mensaje del usuario, instrucción del paso, tool y args finales (ya resueltos), y los `Finding` de tipo `warn` del helper como hechos extraídos. Conviene darle hechos ya calculados para que compare, no para que deduzca.

**Umbrales:** el rechazo debe ser más estricto que la aprobación (hoy `NOUL_APPROVE = 0.5`), para no rechazar args correctos. Valores a calibrar con datos de d3:2b.

### 6.4 Corrección fija y regeneración [Propuesta]

- Cada clave de pregunta tiene una plantilla fija. Puede incluir datos deterministas del código (p. ej. la carpeta deducida del mensaje), nunca texto de un modelo.
- La corrección se pasa a Qwen en un campo nuevo de `ArgumentPromptData` (p. ej. `correction`), sin tocar el resto del prompt.
- **Una regeneración** (constante nueva, p. ej. `MAX_ARG_REGENERATIONS = 1`, separada de `LLM_INVALID_OUTPUT_RETRIES`). La regeneración vuelve a pasar por PRE-A y PRE-B.
- Los args rechazados la primera vez quedan en eventos y auditoría; no entran en FAIL hasta que el segundo intento también falle.

### 6.5 Fallo tras la segunda validación [Propuesta]

- Nuevo `CallFailureStatus`: `args_rejected`. `FailKind` y `FAIL_TEXT` lo exigen por tipado (el compilador marcará el faltante).
- Se registra con `recordFailedCall` y el paso termina como `logical_error`: FAST pasa a escalación, PLAN a replan.
- **[Abierto, importante]** Evitar que la escalación excluya la tool en este caso. Hoy `step.tool` queda fijado y `handleEscalation` la excluye. Para `args_rejected` (y de paso `args_invalid` y `refs_unresolved`) la tool era la correcta. Se necesita una marca de "reintentable con la misma tool".

## 7. Validación post-ejecución

### 7.1 Observación [Propuesta]

La observación del entorno **no basta para detectar un destino equivocado**. Si `write_file` escribió exactamente en `args.path`, la sonda confirmará que el archivo existe ahí. El error estaba en la distancia entre la intención y los args, y por eso la validación pre-ejecución es la defensa principal. La observación sirve para:

- hacer explícito el estado efectivo (existencia, ubicación real),
- atrapar fallos silenciosos (escritura parcial, contenido inválido, ruta resuelta de otra manera),
- dar a d3 hechos del entorno además de lo que la tool afirma.

Diseño:

- Sonda **declarativa en el manifest** por tool: `(tool, args) → llamada de lectura`. Ej.: `write_file` → `list_directory` del directorio padre (existe el archivo); `move_file` → destino existe y origen ya no; `create_directory` → existe. Opcional: `read_file` para validar contenido.
- Se ejecuta **de forma interna** en el executor (herramientas de lectura: no requieren aprobación) y **no se registra como `StepCall`**, para no alterar `buildAttempts`, el anti-loop (`nonReadCounter`, `lastActionWasRead`, `executedSignatures`) ni `hasUnresolvedUnverified`. Se guarda como `observation` de la llamada y se emite un evento propio.
- **Catálogo:** `get_file_info` no está en el manifest; agregarlo es una línea y daría existencia, tamaño y fecha.
- **`terminal`:** no hay sonda derivable (la ruta vive dentro del comando). Opciones: (a) no observar y marcarlo explícitamente, (b) extraer rutas con regex (frágil), (c) buscar archivos recientes con `start_search` (pesado). **[Propuesta]** empezar con (a) y encaminar la creación de archivos a la ruta `files`. Esto último implica revisar la descripción del destino `terminal` en el manifest, que hoy solo excluye leer y listar archivos.

### 7.2 Checks deterministas post [Propuesta]

- La sonda indica que el recurso no existe → fallo sin consultar a d3.
- Ruta absoluta reportada por la tool distinta de `args.path` (si el `finding` la incluye; a confirmar con el extractor).
- Cantidad de filas/tamaño observado incompatible con los args (p. ej. filas del JSON de un `.xlsx`).

### 7.3 Checklist con d3 [Propuesta]

Se reemplazan `ok` y `cumple`. Notas:

- `ok` solapa con `isCleanSignals` (ya determinista: sin error, sin timeout, `exit_code` 0, salida no vacía). Se puede retirar, o mantenerlo en transición para comparar.
- El resultado de la tool **ya viaja** a d3 (`finding` y `compactObs` hasta `MAX_EVIDENCE_OBS_CHARS`). Lo nuevo que se agrega: **tool y args completos**, la **observación** de la sonda y los **`Finding` de POST-A** como hechos.

Preguntas candidatas:

| Clave | Aplica a | Pregunta |
|---|---|---|
| `resultado_cumple_paso` | todas | ¿El resultado observado cumple lo que pide el paso? |
| `destino_correcto` | tools que mutan | ¿El efecto quedó donde se pidió? |
| `contenido_correcto` | tools que mutan | ¿El contenido producido corresponde a lo pedido? |
| `completo` | todas | ¿No falta nada de lo que pedía este paso? |
| `sin_efectos_extra` | tools que mutan | ¿No hubo efectos no pedidos? (candidata, más dudosa) |

Consideraciones:

- **Conjuntos por categoría.** No todas las tools comparten preguntas: lectura, escritura y proceso tienen conjuntos distintos, derivados de la `capability` de la política.
- **Agregación.** Hay que definir cuándo un paso aprueba (¿todas?, ¿críticas vs. informativas?). Cada pregunta extra suma probabilidad de falso rechazo.
- **FAST.** Sin `expectedOutcome`, las preguntas se formulan contra el mensaje del usuario y los args. Ver pendiente 10.3.
- **Contexto.** El payload crece (args + observación). `Decision20Engine` ya aplica una guarda por `decisionMaxContext` con `estimateTokens` (3 caracteres por token); hay que verificar el margen con d3:2b.
- **Firma.** `evaluateStepVerification` recibe siete parámetros posicionales; conviene pasarlo a un objeto de opciones antes de agregar campos.
- **Pregunta → tipo de desviación.** Cada clave puede mapearse de forma determinista a una causa (p. ej. `destino_correcto` → args incorrectos / estado divergente; `completo` → incompleto). Esto habilita el diagnóstico tipado sin prosa; se desarrolla en la sección 10.

## 8. Impacto de retirar a Qwen como segundo juez

Lo que se elimina o cambia (verificar con búsqueda en el repo; lo siguiente sale de los archivos revisados):

- `callExecutor.ts`: la rama `semantic` de `verifyResult`; `Verdict.semantic`; en `settleCall`, `isStepSuccess` pasa a `isCleanSignals && d3Aprobó`, y `noVerdict` pasa a depender solo de d3.
- `StepExecutionResult.semantic` (`execution.ts`) y su uso en `runPlanLoop`.
- `qwen.ts`: `verifyStage`, `STAGE_VERIFICATION_JSON_SCHEMA`, `STAGE_STATUSES`. En `prompts.ts`: `STAGE_VERIFICATION`.
- Tipos: `StageVerificationResult`, `StageVerificationStatus`, `StageVerificationPromptData` (`plan.ts`); `ILLMClient.verifyStage`.
- Eventos y auditoría: `STAGE_VERIFIED` (`events.ts`), el mapeo `fromStageVerified` y `ModelStage` `STAGE_VERIFICATION` (`audit.ts`, `modelIterations.ts`), y el campo `verifiedBy: "qwen"`.
- **Dependencias funcionales (ver 10.2):** en `runPlanLoop`, los estados `insufficient_info` (flujo `ask_user`) y `unrecoverable_blocked` solo los emitía `verifyStage`. Sin el segundo juez, estos caminos no tienen disparador.
- Si d3 no está disponible, el paso queda `UNVERIFIED` (comportamiento actual de FAST). En PLAN antes existía el respaldo de Qwen; deja de existir.

## 9. Impacto en el cambio a d3:2b

- **Backend.** `decision_1.ts` ya soporta `decisionBackend: "d3"` (Ollama, `/v1/systemone`, con `model`). El cambio principal es de configuración.
- **Nombre del modelo.** `ModelType = "EOS_0_8B" | "QWEN_3_5_9B"` (`audit.ts`) y `model: "EOS_0_8B"` está fijo en varias iteraciones de `modelIterations.ts`, además de `FIN_DECISION_TITLE` y los logs que usan `MODELS.EOS_0_8B`. Hay que generalizarlo (p. ej. un tipo "modelo de decisión" que dependa de la configuración).
- **Calibración.** `NOUL_APPROVE = 0.5` se definió para Eos. Medir la distribución de probabilidades de d3 en casos buenos y malos antes de fijar umbrales de aprobación y de rechazo.
- **Múltiples preguntas por inferencia.** Validar con trazas reales que la calidad se mantiene al subir de 2 preguntas a 5–6, y definir un máximo.

## 10. Pendiente

### 10.1 Qué pasa después de una desviación [Abierto]

Hoy un resultado "ejecutado pero incorrecto" cae en `rejected` y de ahí en escalación (FAST) o replan (PLAN). Falta definir:

- **Taxonomía cerrada de desviaciones** derivada de las claves de las preguntas (sección 7.3): args incorrectos, tool inadecuada, ruta inadecuada, estado divergente (hay un efecto que compensar), incompleto.
- **Reparación.** Opciones a evaluar: (D1) reintento correctivo dentro del paso, misma tool, saltando Decision #2, con tope propio distinto de `MAX_ESCALATIONS`; (D2) paso correctivo insertado (PLAN) o ruta forzada (FAST); (D3) ajustes mínimos al camino actual (no excluir la tool si la causa son args; propagar `[DIVERGED] tipo: detalle` a `lastCallDecisionSummary` y FAIL).
- **Compensación.** `effects` ya registra el efecto previo con sus args y `move_file` existe. Decidir si el sistema deshace solo o solo reporta; mover pasa por aprobación de Guard.

### 10.2 `ask_user` [Abierto]

El flujo actual (`suspendForUserAnswer`, `provideUserAnswer`, `PendingQuestion`) depende del `insufficient_info` y la `questionForUser` que producía Qwen. Con d3 sin texto, hay que decidir entre: plantillas fijas por clave de pregunta, o Qwen formulando solo la pregunta (tarea de generación) cuando d3 detecta información insuficiente. Falta además decidir qué reemplaza a `unrecoverable_blocked`.

### 10.3 Criterio de éxito por paso en FAST [Abierto]

FAST no tiene `expectedOutcome`. Opciones: derivar un estado esperado de forma determinista a partir de los args (p. ej. `write_file` → "archivo en `<path>` con N filas"); o que Decision/Qwen lo produzca al elegir la acción. El primero detecta fallos de la tool pero no de intención.

### 10.4 Información todavía no revisada

- **Traza real** del caso del Excel mal guardado: dice si fue `write_file` o `start_process`, qué path generó Qwen y qué vio el verificador. Es el insumo que más reduce la especulación.
- **`reasoner/prompts.ts`**: qué preguntan hoy `ok` y `cumple`, qué campos ve el modelo, cómo se renderizan los paths del entorno y `retryNote`. Necesario para redactar las preguntas nuevas y los mensajes fijos.
- **Extractor de `write_file`** (o el genérico): si el `finding` incluye la ruta absoluta resuelta.

## 11. Riesgos

| Riesgo | Mitigación propuesta |
|---|---|
| Falsos rechazos de d3 que fallan pasos válidos | Umbral de rechazo estricto; una sola regeneración; registrar todas las respuestas para calibrar |
| Más latencia por paso que muta | Alcance acotado a `mutates`; checks deterministas primero; múltiples preguntas en una sola inferencia |
| Calidad de d3 con muchas preguntas | Máximo de preguntas por inferencia; medir con trazas |
| Sonda que altera el estado del anti-loop | Sonda interna, fuera de `step.calls` |
| Escalación que excluye la tool correcta | Marca de reintento con la misma tool (6.5) |
| Reglas deterministas frágiles (alias, regex de rutas) | Severidad `warn` por defecto; promover a `fail` solo con evidencia |

## 12. Opciones consideradas y descartadas

- **Qwen como validador de args pre-ejecución:** descartado por peso (decisión 2).
- **`choice` único con "ok" + defectos:** descartado a favor de una `noul` por check (6.3).
- **Observar mediante extractores:** descartado: no pueden invocar otras tools (7.1).
- **Registrar la sonda como `StepCall`:** descartado por su efecto sobre el anti-loop y los intentos (7.1).