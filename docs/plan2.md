# JARVIS — Verificación de ejecución de herramientas

**Estado:** borrador v0.2 · 29 de octubre de 2026
**Cambios en v0.2:** se agrega la sección 13, que separa los pendientes en 5 temas para debatirlos de a uno e incorpora lo discutido con el agente anterior. Las secciones 1 a 12 no se modificaron.
**Alcance de esta versión:** validación de argumentos (pre-ejecución) y validación del resultado (post-ejecución).
**Fuera de esta versión (pendiente):** diagnóstico y reparación tras una desviación, flujo `ask_user`, criterio de éxito por paso en FAST. Ver la sección 10.

Convención: **[Decidido]** lo definido por el equipo; **[Propuesta]** lo que se sugiere y falta validar; **[Abierto]** lo que no está resuelto; **[Posición]** lo que expresó el usuario y todavía no es decisión cerrada; **[Verificar]** lo que depende de código que no se ha visto.

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

> Cada pendiente de esta sección se trabaja por tema en la sección 13.

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

---

## 13. Temas para debatir de a uno

Los pendientes se separan en 5 temas. Cada tema es una llamada o un componente, y las consecuencias de una llamada se tratan dentro de su propio tema. Se debate uno por vez. **Ninguno está cerrado.**

**Fuera de esta lista:**

- **Tope de llamadas.** Existe el anti-loop (`nonReadCounter`, `executedSignatures`). Se deja de lado por ahora. No se confirmó qué límite pone ni si se reinicia por paso.
- **Keys de D3.** Las define el agente Eval. Son un contrato pendiente. El flujo razona sobre tipos de situaciones, no sobre keys. Si alguna situación no se puede distinguir con las keys de Eval, es un requisito de vuelta hacia Eval.

**Dependencias entre temas:**

- La parte del tema 2 sobre qué hacer ante un desvío depende en parte del tema 3, porque la reparación es distinta en FAST (cambiar de tool) y en PLAN (rehacer el paso y los siguientes).
- El tema 4 depende de los temas 1 y 2, porque su disparador sale de lo que ellos decidan.
- Los temas 1 y 5 son los más independientes.
- El orden de tratamiento lo elige el usuario.

**Marco propuesto por el agente anterior [Propuesta]:** separar qué garantiza cada llamada.

- PRE compara los args contra la intención del usuario. Es el único tramo que compara contra la intención.
- POST compara el efecto observado contra los args. Es una comparación casi determinista.
- Si ambos pasan, el efecto coincide con la intención.
- En tools con args legibles (`write_file`, `move_file`, `create_directory`), si PRE pasó, un POST de D3 sobre "destino correcto" es redundante.
- En tools con args opacos (`terminal`, `start_process`) esto no vale, porque PRE no puede verificar un comando contra su efecto. Ahí POST carga el peso de la intención.

### Tema 1. Llamada PRE (a D3, antes de ejecutar)

**Estado actual**

- Solo existe `validateArgs` (`qwen.ts`): requeridos, tipos y enum, a nivel superior. No hay chequeo de sentido: un path bien formado pero equivocado pasa.
- Ya decidido (sección 3, punto 4): D3 valida los args; si los marca incorrectos se regenera una vez con indicación fija; si la segunda validación falla, el paso se marca como fallido.
- La sección 6 contiene las propuestas de helper, checks, preguntas, regeneración y fallo.

**Situaciones que el flujo necesita distinguir (sin keys)**

1. Args correctos: seguir.
2. Args incorrectos y hay una corrección calculable por código: regenerar con corrección fija.
3. Args incorrectos y no hay corrección calculable: la regeneración casi seguro no sirve.
4. Falta información (el usuario no dijo el destino, o hay varias lecturas posibles): regenerar no ayuda. Se conecta con el tema 4.
5. Zona gris (ni aprueba ni rechaza): requiere una política.
6. D3 no disponible o salida inválida: requiere una política.

**A decidir**

- Qué recibe D3 antes de ejecutar (args, mensaje del usuario; ya propuesto en 6.3).
- Si aplica a todas las tools o solo a las que mutan. [Posición] del usuario: solo las que mutan, como idea, no como algo determinista.
- Qué se hace si los args están mal (regenerar una vez, etc.).
- Zona gris. Alternativas del agente anterior: aprobar (como hoy, más permisivo y simple); rechazar (más falsos rechazos y más latencia); aprobar según riesgo, es decir, aprobar si la tool es reversible o se puede sobrescribir sin pérdida, y exigir aprobación de Guard con los args a la vista si sobrescribe o es destructiva. [Propuesta] del agente: la tercera. Depende de lo que Guard pueda mostrar (tema 5). Efecto señalado: los umbrales pueden ser menos tensos porque la zona gris deja de ser binaria.
- D3 no disponible. [Propuesta] del agente: seguir con checks deterministas si la tool es reversible; exigir Guard si sobrescribe o no se puede deshacer.

**Notas**

- `NOUL_APPROVE = 0.5` se calibró para Eos, no para D3.
- La reversibilidad de cada tool debería ser una propiedad declarada en la política o el manifest. [Verificar] si `ToolPolicy` ya tiene algo así.

**Archivos necesarios:** `callExecutor.ts` (`runStep`), manifest, tipos de `ToolPolicy` y capability.

### Tema 2. Llamada POST (a D3, después de ejecutar)

**Estado actual**

- El verificador de hoy es Eos, no D3.
- Si las señales son limpias (`isCleanSignals`), `evaluateStepVerification` recibe `step.instruction`, el nombre de la tool, `finding`, `evidence.summary`, `expectedOutcome` y un fragmento de `compactObs`.
- No recibe los args ni ninguna observación del entorno. La ruta llega recortada a 60 caracteres.
- El resultado de la tool sí viaja. La brecha está en la calidad de la evidencia (lo que la tool dice de sí misma), no en la ausencia de validación.
- No se confirmó qué pregunta hoy `cumple` (falta `reasoner/prompts.ts`). Si ya compara el resultado contra la instrucción, el caso del Excel pudo fallar porque el verificador no tenía la ruta delante, y parte del arreglo sería solo darle mejores datos.
- [Posición] del usuario: hay que hacerle más preguntas a D3 en la misma iteración y agregar el resultado de la tool, quizá solo en tools que mutan. Es una idea, no algo determinista.

**Situaciones que el flujo necesita distinguir (sin keys)**

1. Efecto correcto y paso cumplido: cerrar.
2. Efecto correcto pero paso incompleto: hay que seguir, no deshacer.
3. No hubo efecto o la tool falló en silencio: no hay nada que compensar.
4. Efecto existente pero equivocado (ubicación, contenido): hay estado a corregir o compensar.
5. Resultado de lectura o búsqueda que no sirve: no hay efectos; reintentar o cambiar de enfoque.
6. La tool no puede hacer lo pedido: cambiar de tool.
7. Zona gris o D3 caído: el paso queda `UNVERIFIED`.

**A decidir: evidencia y pregunta**

- Qué evidencia agregar (args, observación; ya propuesto en 7.1 y 7.3).
- Si aplica solo a tools que mutan.
- Qué pregunta hace D3 sobre lo que la tool hizo.
- Para tools con args legibles, el agente anterior propone reservar D3 en POST para el resultado de lecturas y búsquedas y para la completitud. Para tools opacas, POST carga la intención. [Propuesta]
- Un POST que falla en una tool con args legibles indica un fallo silencioso de la tool o que PRE aprobó mal. La causa cambia la reparación.

**Consecuencia 1: causa del fallo y exclusión de la tool**

- Bug acordado: `recordFailedCall` fija `step.tool` y la escalación la excluye aunque el fallo fuera de args y la tool fuera la correcta.
- Alternativas: (1) que el registro de fallo lleve una causa y la escalación la consulte (si es de args, no excluye); (2) no fijar `step.tool` cuando el fallo es de args. [Propuesta] del agente: la 1, porque también sirve para el reintento y el diagnóstico tipado.
- A la memoria iría `[DIVERGED] tipo: detalle`, con tipo del vocabulario cerrado y detalle calculado por código, sin prosa de modelos.

**Consecuencia 2: escalera de reparación**

El usuario está de acuerdo en la idea, pero hay que debatir más. Son cuatro respuestas posibles, de la más barata a la más costosa, y la causa decide por cuál se entra. Ejemplo: "crear un Excel en el escritorio" y el archivo termina en otra carpeta.

1. **Corregir los argumentos antes de ejecutar.** Si el chequeo previo detecta que la ruta no es el escritorio, se le dice una vez a Qwen qué está mal y genera de nuevo. No pasó nada en el mundo real.
2. **Reintentar dentro del mismo paso con la misma tool.** El archivo ya se creó mal. Se hace una corrección (mover el archivo o escribirlo de nuevo con la ruta correcta) sin volver a preguntar qué tool usar. La corrección se genera con una plantilla fija con datos calculados por código (ruta observada, ruta esperada, diferencia). Evita descartar la tool correcta y evita rehacer el plan entero.
3. **Cambiar de camino.** En FAST, otra tool. En PLAN, rehacer el paso y los siguientes. Hoy todo fallo cae aquí y además excluye la tool.
4. **Preguntar al usuario o terminar como bloqueado.**

Por qué causa se entra en cada nivel [Propuesta]:

| Causa | Entra en |
|---|---|
| Args incorrectos | Nivel 1 y luego nivel 3; la tool no se excluye |
| Falta información | Nivel 4 directo (ver tema 4) |
| Efecto equivocado con corrección calculable | Nivel 2, con corrección hacia adelante |
| Efecto equivocado sin corrección calculable | Nivel 4: reportar y preguntar |
| Paso incompleto | Nivel 2: continuar sin deshacer |
| Lectura inútil | Nivel 2 y luego nivel 3 |
| Tool inadecuada | Nivel 3 directo; se excluye la tool, como hoy |
| Sin efecto o fallo silencioso | Nivel 2 una vez y luego nivel 3 |

Relación con las opciones del punto 10.1: el nivel 2 corresponde a la opción D1. La opción D2 (paso correctivo insertado o ruta forzada) exige que PLAN y FAST soporten inserción de pasos, [Verificar]. La opción D3 (ajustes mínimos) es el piso.

Riesgo señalado: cada reintento sobre una tool que muta es otro efecto potencial.

Pregunta para debatir: cuánta iniciativa tiene el sistema para reparar. ¿Corrige siempre con aprobación, o puede actuar solo en casos de bajo riesgo?

**Consecuencia 3: compensación del efecto equivocado**

Qué hacer con lo que quedó mal en el mundo, por ejemplo el archivo en la carpeta equivocada:

- **Dejarlo y avisar.** No arriesga nada, pero deja basura y el próximo intento puede chocar con ese archivo.
- **Deshacerlo solo y reintentar.** Deja todo limpio, pero es una acción que nadie pidió. Si la detección se equivoca, se destruye algo bueno. No se vio una tool de borrado en el catálogo.
- **Corregir hacia adelante.** Una sola acción deja todo bien (mover el archivo de donde cayó adonde debía). Pasa por Guard como cualquier otra.
- **Según el caso.** Si la corrección es calculable (mover un archivo), se corrige hacia adelante. Si no (un comando de terminal con efectos desconocidos), se informa y se pregunta. [Propuesta] del agente.

Principio asociado [Propuesta]: las sondas de lectura son internas e invisibles. Toda escritura, incluida la compensación, es un paso de primera clase que pasa por Guard y por el registro de efectos.

Sobrescrituras [Abierto]: si la escritura equivocada pisó un archivo que ya existía, no se puede restaurar sin haberlo leído antes de ejecutar. Alternativas: (a) una lectura previa solo para tools que sobrescriben (cuesta una lectura más); (b) aceptar el hueco y confiar en que PRE y Guard lo evitan (más simple).

La reversibilidad por tool (idempotente o sobrescribible, crea algo nuevo, irreversible o con efecto externo) debería estar declarada. [Verificar] si `ToolPolicy` ya la tiene.

**Consecuencia 4: qué reemplaza a `unrecoverable_blocked`**

- Hoy solo lo emitía el segundo juez (`verifyStage`).
- [Propuesta] del agente: que "bloqueado" sea un estado derivado por código al agotarse presupuestos o por condiciones deterministas (permiso denegado repetido, tool no disponible, mismo fallo tras el reintento y el cambio de camino). El cierre usaría una plantilla fija con la causa y lo ya hecho. Se pierde un juicio semántico de "esto no tiene remedio".

**Consecuencia 5: cómo se marca un efecto compensado en la memoria**

- `buildEffectsContext` conserva incluso las mutaciones `rejected` con sus args. Sin una marca, un efecto corregido sigue figurando como vigente y los pasos siguientes razonarían sobre un archivo que ya no está donde se creó.
- [Propuesta]: que pueda marcar un efecto como compensado. [Verificar] en el código.

**Consecuencia 6: zona gris, D3 caído y `UNVERIFIED` en POST**

- Si D3 no está disponible, el paso queda `UNVERIFIED`, como hoy en FAST. En PLAN desaparece el respaldo de Qwen.
- [Abierto]: si un paso que muta queda `UNVERIFIED`, ¿bloquea a los pasos dependientes o sigue con la marca? Existe `hasUnresolvedUnverified`; [Verificar] su uso actual.
- Falsos "ok" sin revisión. Con Qwen fuera, nadie revisa un falso aprobado. Alternativas del agente: (a) registrar todas las probabilidades para calibración offline; (b) doble inferencia con orden de preguntas permutado solo para tools de alto riesgo; (c) apoyarse más en checks deterministas en POST. [Propuesta]: (a) siempre y (c) como prioridad; (b) solo si los datos muestran el problema.

**Archivos necesarios:** `callExecutor.ts` (`verifyResult`, `settleCall`, `recordFailedCall`, `handleEscalation`), `types.ts` (`Attempt`), `reasoner/prompts.ts`, extractor de `write_file`, `buildEffectsContext` y el registro de efectos, y la traza real del caso del Excel (dice si el problema fue de args, de tool opaca o de ambas, y por lo tanto cuánto de lo anterior hace falta).

### Tema 3. FAST vs PLAN

**Estado actual**

- FAST crea el paso con `instruction: task.message` y sin `expectedOutcome`. El verificador compara contra el mensaje completo del usuario, que es un criterio vago en tareas de varias acciones.
- PLAN tiene `expectedOutcome`.
- Ante un desvío, FAST escala (`handleEscalation`, excluye la tool, máx. `MAX_ESCALATIONS = 2`) y PLAN replanifica (`handleReplan`, reemplaza el paso y los siguientes, máx. `MAX_REPLAN = 2`).

**A decidir**

- Si FAST y PLAN hacen lo mismo o no ante un desvío, es decir, si la política de reparación existe una vez o dos.
- Cuál es el criterio de éxito en cada uno.
- Criterio de éxito en FAST. Opciones: (a) estado esperado derivado de forma determinista a partir de los args; (b) que Decision o Qwen lo produzca al elegir la acción; (c) híbrido: estado esperado determinista como hecho, más el mensaje del usuario para D3 en el caso opaco. [Propuesta] del agente: el híbrido.
- Si FAST ejecuta varias acciones bajo un mismo paso, "completo" no tiene referencia clara. [Verificar] en `runFastLoop`.
- Con un reintento dentro del paso por delante (tema 2), el replan debería dispararse menos.
- Si FAST puede preguntar al usuario (conecta con el tema 4).

**Archivos necesarios:** `runFastLoop`, `runPlanLoop`, `execution.ts`.

### Tema 4. Preguntar al usuario (`ask_user`)

**Estado actual**

- El flujo existe (`suspendForUserAnswer`, `provideUserAnswer`, `PendingQuestion`), pero dependía de `insufficient_info` y de la `questionForUser` que producía Qwen.
- Sin el segundo juez, ese camino no tiene disparador.

**Posición del usuario**

- Cuando falta información no hay que asumir un default: hay que preguntar al usuario.
- Idea: una opción de D3 `ask_user` que, si la elige, dispare un LLM para generar la pregunta; luego se espera la respuesta del usuario.
- El agente anterior había propuesto un default determinista para casos reversibles y baratos. Esa propuesta no se adopta, por la posición del usuario.

**Observaciones del agente anterior:** la idea es razonable y coincide con el flujo existente, que se reutiliza. Con tres condiciones:

1. D3 solo clasifica "falta información", sin decir qué falta. El LLM necesita contexto para no hacer una pregunta genérica: mensaje del usuario, paso y datos calculados por código (carpetas conocidas, candidatos encontrados).
2. Si D3 marca "falta información" con demasiada facilidad, el usuario recibe preguntas de más. Es un requisito de calibración para Eval.
3. Falta definir si la pregunta generada entra en la memoria. La respuesta del usuario es dato del usuario, pero la pregunta es texto de un modelo.

**A decidir**

- Cuándo se dispara: antes de ejecutar (falta el destino) o después (la búsqueda devolvió varios candidatos).
- Quién redacta la pregunta. Alternativas: plantilla fija con datos del código; Qwen redacta solo la pregunta (reintroduce generación libre, y Qwen no sabe qué faltaba si D3 solo clasificó); híbrido de plantilla con opciones y respuesta libre.
- Si la pregunta entra en la memoria.
- Si FAST y PLAN lo soportan.

**Archivos necesarios:** `suspendForUserAnswer`, `provideUserAnswer`.

### Tema 5. Guard

**Estado actual**

- Guard (`authorizeCall`) ya existe para las tools. Según lo conversado, ya pide aprobación en cada mutación.

**A decidir**

- Qué ve el usuario al aprobar: ¿los args completos?
- Si se le agrega una advertencia.
- Si existen permisos concedidos de forma permanente. Si existen, Guard no sirve como red de seguridad en la zona gris (tema 1).
- Se relaciona con el tema 1 (zona gris según riesgo) y con el tema 2 (la compensación pasa por Guard).

**Archivos necesarios:** `authorizeCall`.