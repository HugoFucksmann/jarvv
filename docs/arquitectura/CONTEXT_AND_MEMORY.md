# Contexto, Memoria y Persistencia

## 1. El Contexto de Tarea
Todo lo que el sistema sabe de una tarea vive en un único objeto, el **contexto** (`TaskContext`), cuya secuencia de mutaciones se persiste en un log por tarea (`taskLog.ts`). No hay memorias paralelas dentro de una tarea: el estado que ve la interfaz, lo que leen los modelos y lo que audita la traza salen de las mismas secciones. Lo que se recuerda **entre** tareas (hechos del usuario en `src/memory` y el hilo con la tarea anterior) entra al contexto por `apply` en la sección `recalled` y queda congelado en el log: ver §10.

### Cómo se ve
Forma del snapshot (`v: 1`). Los valores son tipos; los comentarios `//` no existen en el JSON real.

```jsonc
{
  "v": 1,
  "task": {
    "id": string,
    "mode": "reactive" | "deliberative",
    "request": string,
    "state": "running" | "completed" | "partial" | "failed" | "cancelled",
    "stopReason": StopReason | null,       // solo en partial, failed y cancelled
    "startedAt": number
  },

  "plans": [{
    "id": string,                          // "p1", "p2"…
    "at": number,
    "trigger": "initial" | "user_feedback" | "step_failure",
    "feedback": string | null,             // solo user_feedback
    "stepId": string | null                // solo step_failure
  }],

  "steps": [{
    "id": string,                          // "s1"…
    "at": number,
    "planId": string | null,               // null en reactivo
    "instruction": string | null,          // siempre presente; en reactivo, el primer pendiente
    "route": string | null,                // null en reactivo
    "expected": string | null,             // null en reactivo
    "state": "pending" | "running" | "completed" | "failed",
    "superseded": boolean
  }],

  "calls": [{
    "id": string,                          // "c1"…
    "stepId": string,
    "at": number,
    "route": string,
    "tool": string,
    "kind": "read" | "write",
    "args": object | null,
    "sig": string | null,                  // huella de args resueltos
    "status": CallStatus,                  // §2
    "verdict": "approved" | "rejected" | null,
    "reason": "no_usable_data" | "not_accomplished" | "wrong_place" | "wrong_position" | "wrong_scope" | "wrong_item" | "missing_attribute" | null, // solo con rejected
    "summary": string | null,
    "ref": string | null                   // id de ref si el resumen no es completo
  }],

  "errors": [{
    "id": string,                          // "e1"…
    "stepId": string,
    "at": number,
    "kind": "service_unavailable"
  }],

  "facts": {
    [key: string]: {                       // "process" | "answer_<paso>_<n>" | "answer_<paso>_<n>_p<pid>"
      "value": string | null,              // null = retirado
      "stepId": string,
      "at": number
    }
  },

  "refs": [{
    "id": string,                          // "r1"…
    "stepId": string,
    "at": number,
    "label": string,
    "size": number,                        // caracteres
    "where": string                        // ruta absoluta del archivo
  }],

  "recalled": [{
    "id": string,                          // "m1"…
    "at": number,
    "stepId": string | null,               // null al iniciar la tarea
    "source": "user_memory" | "thread",
    "key": string,                         // clave del hecho, "previous_request" o "previous_answer"
    "value": string,
    "from": string | null                  // id de la tarea origen en "thread"
  }],

  "result": { "text": string, "origin": "model" | "fallback" } | null
}
```

### Secciones
| Sección | Contenido | Quién la escribe |
|---|---|---|
| `task` | Id, modo, solicitud, estado, motivo de detención, inicio | Alta al crear; estado y motivo solo con `finish` |
| `plans` | Un plan por vez que se planificó | Planificador |
| `steps` | Pasos; en reactivo la instrucción es el primer pendiente y el plan, la ruta y el resultado esperado quedan vacíos | Bucle de pasos y planificador |
| `calls` | Una por llamada a herramienta | Ejecutor de llamadas (alta) y verificación (veredicto) |
| `errors` | Fallos de infraestructura asociados a un paso | Motor |
| `facts` | `process` (procesos vivos de la tarea, como texto: `4321` o `4321, 5678`) y `answer_<paso>_<n>` (`pregunta -> respuesta`; si excede 500 caracteres, el texto completo va a una ref). La respuesta a la pregunta de un proceso agrega `_p<pid>` a la clave (las vistas muestran el texto, nunca la clave); `ctx.answers(paso)` lista las respuestas de un paso con su clave | Motor |
| `refs` | Resultados completos en disco: etiqueta, tamaño, ruta. Solo para el pre-chequeo y la depuración: ninguna vista las muestra a los modelos | Ejecutor de llamadas |
| `recalled` | Aportes externos congelados durante la tarea (`user_memory` y `thread`), sin duplicar `(source, key)`; su confianza y visibilidad salen de `recalledPolicy.ts` | Motor (al iniciar y en cada paso) |
| `result` | Respuesta final y origen | Cierre |

### Escritura: una sola puerta
`apply` es la única forma de modificar el contexto. Recibe un lote de operaciones (`add`, `update`, `set`, `finish`) y lo valida **completo antes de tocar nada**: si cualquier operación o comprobación falla, el contexto queda intacto y no se emite ningún evento. Reglas, en orden:

1. La tarea debe estar abierta; una vez terminal, toda escritura se rechaza.
2. La operación y su destino deben ser válidos.
3. El valor debe cumplir su esquema.
4. Solo los campos mutables pueden actualizarse (por ejemplo, el estado de un paso o el veredicto de una llamada).
5. Las referencias entre elementos se resuelven contra el contexto previo al lote: un lote no puede usar ids que él mismo crea.
6. Las transiciones e invariantes (por ejemplo, el estado terminal que corresponde a cada motivo de detención) se comprueban una sola vez, al final del lote.
7. Los topes de tamaño se validan, nunca recortan.

Cada `apply` exitoso incrementa una versión `n` y emite un evento `change` con las operaciones normalizadas. El contexto se puede copiar a un snapshot en JSON plano (`v: 1`), que se valida con las mismas reglas al cargarse.

## 2. Estado de una Llamada
El resultado de cada llamada se determina una sola vez y se guarda en `status`; el veredicto de la verificación se escribe después, junto con su motivo.

| Grupo | `status` | Significado |
|---|---|---|
| Ejecutadas | `ok` | Se ejecutó y devolvió datos |
| | `no_data` | Se ejecutó, pero no hay datos (archivo vacío, búsqueda sin resultados) |
| | `not_found` | El recurso no existe |
| | `tool_error` | Error, timeout o código de salida distinto de 0 |
| | `exception` | La ejecución lanzó una excepción |
| | `interrupted` | La cancelación llegó con la herramienta ya despachada |
| | `waiting_input` | El proceso que lanzó `run_command` sigue vivo y pide una respuesta del usuario; no se verifica y el paso se la pregunta |
| | `denied` | La política del servidor la denegó (`denied`); una denegación de Guard queda registrada como `tool_rejected` y no cierra la tarea |
| No ejecutadas | `args_invalid` | Argumentos inválidos (validación, pre-chequeo o revisión; el pre-chequeo y la revisión dejan un motivo fijo como resumen) |
| | `loop_blocked` | El anti-bucle bloqueó una repetición |
| | `tool_rejected` | Guard, la lista negra o una regla de comando vetó la herramienta o el comando (no cierra la tarea) |
| | `info_missing` | La revisión detectó información faltante |
| | `user_rejected` | El usuario rechazó la operación |

- **Veredicto**: `approved` o `rejected`. Se verifican las llamadas ejecutadas salvo `interrupted`, `waiting_input` y `denied`. Un rechazo lleva un motivo cerrado (`VERDICT_REASONS`): `no_usable_data`, `not_accomplished` o los motivos de sondas por herramienta (`wrong_place`, `wrong_position`, `wrong_scope`, `wrong_item`, `missing_attribute`).
- **Efecto**: una escritura con `status = ok`, con cualquier veredicto. Una escritura que terminó en `tool_error`, `exception`, `interrupted` o `waiting_input` se registra como **posible efecto**: pudo dejar cambios parciales y se muestra aparte.
- **Texto fijo**: lo que se le dice a los modelos sobre un estado o un motivo son frases fijas, nunca prosa de un modelo.

## 3. Se Deriva, No se Guarda
Todo lo que no es un dato primario se recalcula desde `calls`, `steps`, `plans` y `facts`. No hay almacenes secundarios que puedan desincronizarse.

| Derivación | Definición |
|---|---|
| Efectos / posibles efectos | Escrituras `ok` / escrituras con `tool_error`, `exception`, `interrupted` o `waiting_input`. Sin tope |
| Hechas | Llamadas con veredicto `approved` |
| Intentos | Llamadas sin veredicto `approved` (fallos, rechazos y no ejecutadas) |
| Último resultado | Última llamada aprobada que no es un efecto |
| Últimas lecturas | Lecturas `ok` aprobadas más recientes (hasta 3) |
| Entrada del usuario | Respuestas (`answer_*`) y las instrucciones dadas al rechazar una operación |
| Cierre reactivo (`canFinish`) | Cuando la lista de pendientes (mantenida por el código; el modelo solo la genera al empezar, tras un fallo y al vaciarse) queda vacía: `completed` si no hay llamadas o alguna está aprobada; `no_alternatives` si solo hubo rechazos del usuario; `null` (no se puede cerrar) si solo hubo fallos |
| Cierre deliberativo | `completed` si hay al menos un paso vigente y todos están `completed` |
| Contadores | Llamadas por paso (sin rechazos del usuario), replans, escalaciones (pasos `failed`) |
| Ventana reciente | Los últimos 2, 5 o 10 elementos según haya 0, 1 o 2 o más escalaciones |
| Anti-bucle | Ver abajo |

**Anti-bucle**: una llamada se bloquea si repite herramienta y huella de argumentos con la última llamada ejecutada idéntica. Una lectura idéntica se permite solo si hubo una escritura exitosa en el medio; una escritura idéntica, solo si hubo una lectura ejecutada en el medio. Una respuesta del usuario posterior también cuenta como intermedia. Las herramientas marcadas como exentas en el catálogo no se controlan. Para las lecturas, además, cuenta lo que pasó con la anterior (aprobada, rechazada, fallo pasajero, `no_data`); el detalle está en [`CORE_FLOW.md`](CORE_FLOW.md).

## 4. Vistas y Prompts
Cada consumidor recibe una vista distinta del mismo contexto, estructurada, de solo lectura y determinista. El texto lo arma después un renderizador, fuera del contexto.

| Vista | Consumidor |
|---|---|
| `forRoute` | Decisión 1 y 2 (ruta y herramienta) |
| `forPlan` | Planificador y replan |
| `forArgs` | Generación de argumentos (con `lastError`: el último intento fallido de la herramienta para la que se generan, de cualquier paso) |
| `forReview` | Decisión 3 (revisión de argumentos) |
| `forVerify` | Decisión 4 (verificación): criterio del paso, la llamada evaluada, lo hecho (`done`, solo reactivo), la entrada del usuario y las llamadas aprobadas previas completas (`previous`, en ambos modos; el adaptador toma las últimas `caps.lastReads` como `recent`) |
| `forAsk` | Pregunta al usuario |
| `forPending` | Lista de pendientes del reactivo: solicitud, lista anterior, lo hecho (con argumentos y resumen), últimos intentos fallidos y entrada del usuario |
| `forFinal` / `forFallback` | Respuesta final con modelo / respuesta de respaldo sin modelo |

- **Qué muestra cada una** depende del modo, pero en ambos las decisiones, los argumentos y la verificación ven el paso actual (en reactivo, el primer pendiente; la solicitud completa solo la ven la lista de pendientes, la pregunta al usuario y la respuesta final). En reactivo suman lo hecho y el último resultado; en deliberativo, los pasos completados con su resultado. Los intentos que ven las decisiones son los del paso actual.
- **Topes por sección**: cada bloque de una vista tiene su tope de caracteres (tabla `caps` de `budget.ts`), y los elementos largos se recortan con un marcador de omisión. Los efectos y posibles efectos **nunca se recortan**: comparten una reserva de 12 000 caracteres y, si no caben, la tarea se cierra con `unrecoverable` en vez de mostrar una versión parcial.
- **Saneamiento**: todo texto externo (resúmenes, argumentos, rutas, instrucciones) pasa por un saneador que neutraliza las etiquetas `<obs>` y los encabezados de bloque del prompt (`LOG:`, `PASOS:`, etc.), de modo que un dato no pueda hacerse pasar por estructura.
- **Guarda de contexto**: antes de cada llamada al modelo generativo se estima el prompt (3 caracteres por token); si no deja margen mínimo para la salida, la llamada se rechaza. `qwenNumCtx` debe coincidir con el contexto real del servidor.

## 5. Resultados Voluminosos y Referencias
1. **Procesamiento**: el resultado crudo de la herramienta se convierte en un estado, un resumen (hasta 2 500 caracteres) y el texto completo. Ninguna herramienta tiene hoy un extractor propio (los de `list_directory` y `read_file` se fueron con Desktop Commander). Los resultados de las herramientas propias (`jarvis_*`) los lee el extractor estructurado: el texto que el proveedor ya preparó para el modelo más las señales (código de salida, `pid` y estado, espera de entrada). El resto usa el genérico (inicio y final del texto, 750 caracteres cada uno).
2. **Almacén**: si el resumen no contiene todo el resultado, el texto completo se guarda en disco en `<refsDir>/<tarea>/<uuid>.txt` (UTF-8, nunca se sobrescribe), cortado a 5 000 000 de caracteres con una marca explícita si lo supera (`REF_MAX_CHARS`), y la llamada lleva una `ref` con su etiqueta, tamaño y ruta. La retención (`retention.ts`) limpia en una sola pasada refs, trazas (10 días por defecto, `retentionDays`) y logs de tareas terminales (30 días por defecto, `logRetentionDays`) con tope compartido de 250 MB (`retentionMaxMb`), al arrancar y cada 6 horas; solo toca carpetas o archivos con los nombres propios de Jarvis y nunca borra los de una tarea retenida en RAM.
3. **Uso**: las refs son solo para depurar y para el pre-chequeo. **Los modelos no las ven ni las usan**: ninguna vista incluye la ref, su ruta ni una instrucción para leerla, y los argumentos que propone el modelo se ejecutan tal cual (no hay sustitución de `{{ref:rN}}`). Cada herramienta deja en `summary` lo que el modelo necesita; la ref guarda el texto crudo completo.
4. **Lectores**: (a) el pre-chequeo (`collectSources`) lee hasta 400 000 bytes de cada ref como fuente de «esto aparece en lo que la tarea sabe», incluidas las refs que ninguna llamada usa (la respuesta larga del usuario que se guarda cuando el hecho `answer_*` queda recortado); si una ref es ilegible o más grande (o fue borrada por retención), las fuentes quedan incompletas (`complete = false`) y la regla de origen de argumentos no se aplica, para no rechazar de más; (b) la depuración: `GET /tasks/:id/refs/:refId` y la traza.
5. **Protección**: Guard deniega las escrituras de archivos y comandos no de solo lectura sobre la carpeta de refs, los logs de tareas, la carpeta del proyecto y `data/memory.json`.

## 6. Persistencia
- **Caché en RAM y log en disco**: en RAM se retienen como máximo 20 tareas (`MAX_RETAINED_TASKS`); al excederse, se expulsan las terminales más antiguas y, si aun así se supera, se cancela la tarea en espera más antigua. Cada `apply` exitoso persiste al instante su registro JSONL (`data/tasks/<id>.jsonl`) con cabecera de versión y límites vigentes; las tareas expulsadas o de ejecuciones previas se reconstruyen bajo demanda por pliegue puro del log (`readTaskLog`).
- **Política de reinicio**: las tareas que quedaron no terminales al apagarse el servidor no se reanudan. Al arrancar se cierran con motivo `restart` (`partial` si hubo efectos, `failed` si no) y texto fijo «El servidor se reinició mientras la tarea corría», conservando visibles sus efectos y posibles efectos; si Telegram está activo, envía un aviso por cada tarea cortada. Un log corrupto en cualquier línea distinta de la última deja la tarea marcada como ilegible sin cargarla a medias.
- **En disco**: la configuración (`jarvis-config.json`), el log de cada tarea (`data/tasks/`), los resultados crudos de las refs (`data/refs/`), la memoria externa (`data/memory.json`) y la traza (`jarvis-traces/`).
- **Traza por tarea** (`src/core/trace/`): si `traceEnabled` está activo, al terminar cada tarea se escribe, en segundo plano, una carpeta `jarvis-traces/AAAAMMDD-HHMMSS_<id>/` (junto a `tracePath`, sin la extensión) y una línea en `jarvis-traces/index.jsonl`. Es de consumo externo (auditoría y laboratorio de evaluación) y el backend nunca la lee. La carpeta tiene: `summary.md` (alertas, línea de tiempo de pasos y llamadas con lo que decidieron D1 a D4, esperas, refs con un fragmento y la respuesta final); `trace.json` (el snapshot final del contexto, todas las consultas D0–D5 y generativas con la salida interpretada y opciones ofrecidas, herramientas, esperas y bloque `meta` con modelos, versión del código, entorno y schemas); y `full.json.gz` (todo lo anterior más entradas y salidas crudas, comprimido). Los resultados grandes no se copian: viven en las refs de `data/refs` y la traza guarda su id (`rN`), tamaño y fragmento.
- **Pensamiento de los modelos**: la salida cruda de los modelos se reduce a una lista blanca de campos (identificador, modelo, motivo de fin, contenido y uso de tokens); el razonamiento interno no se registra.

## 7. Invariantes de Acceso a Memoria
1. **Escritura solo por el motor**: los modelos nunca escriben en el contexto ni en las refs; todo pasa por `apply` (§1), incluidos los aportes de `recalled`.
2. **Sin prosa nueva de un modelo**: lo que un modelo razona o justifica solo viaja en eventos y trazas; las respuestas finales ya mostradas al usuario se guardan marcadas con su origen (`thread` en `recalled`). Motivos de rechazo y de detención son claves cerradas con texto fijo.
3. **Efectos permanentes**: se derivan de `calls`, que nunca se borran (un paso reemplazado solo se marca `superseded`). Ni un replan ni un reinicio pueden ocultarlos.
4. **Aislamiento por tarea**: un log por tarea; el pre-chequeo solo lee las refs y `recalled` de la tarea activa (§5).
5. **Estado terminal cerrado**: una tarea terminal rechaza toda escritura; tras el registro terminal, el log no admite escrituras y ninguna respuesta tardía puede modificarla.
6. **Pliegue puro**: el mismo log produce siempre el mismo contexto. Los ids salen de la cantidad de elementos y el instante `at` viene en cada registro, no del reloj real.
7. **Reconstruir no ejecuta**: reproducir un log no llama a modelos, herramientas ni al almacén de memoria.
8. **Memoria, log y proyecto protegidos**: las herramientas de Jarvis no pueden escribir en `data/memory.json`, en la carpeta del log (`data/tasks/`) ni dentro de la carpeta del proyecto de Jarvis. Guard lo deniega siempre, incluidos los comandos de terminal que no son de solo lectura cuando nombran esas rutas.

## 8. Limitaciones Conocidas
- Las vistas `forPending` y `forPlan` aún no leen `recalled` en v1 (requiere habilitar y medir con el eval; el hilo sigue entrando a `pending`).

## 9. Archivos Base
| Tema | Ruta |
|---|---|
| Contexto (`apply`, validación, derivaciones, cierre, snapshot, vistas) | `src/core/ctx/` |
| Log de eventos y reproducción | `src/core/taskLog.ts`, `src/core/retention.ts` |
| Renderizado de prompts, política de `recalled` y topes | `src/core/render/`, `src/core/recalledPolicy.ts`, `src/core/budget.ts` |
| Paquete de memoria externa y adaptador | `src/memory/index.ts` |
| Hilo y escritura de `recalled` | `src/core/engine/thread.ts`, `src/core/engine/recalled.ts`, `src/core/tasks.ts` |
| Resultados, refs y Guard | `src/core/result/`, `src/core/refs/refVault.ts`, `src/core/policy/guard.ts` |
| Escritura desde el motor | `src/core/engine/runTask.ts`, `src/core/engine/callRunner.ts`, `src/core/engine/args.ts` |
| Tareas, traza y configuración | `src/core/tasks.ts`, `src/core/trace/recorder.ts`, `src/core/config.ts` |

## 10. Memoria entre tareas
El contexto de una tarea nace vacío y recibe los aportes externos por `apply` en `recalled` (§1), donde quedan congelados en el log de la tarea para que editar `data/memory.json` no altere tareas pasadas:

| Memoria | Qué guarda | Dónde | Cuándo entra a `recalled` y a los prompts |
|---|---|---|---|
| **Hechos del usuario** (`src/memory`) | Pares `clave → valor` (y `aliases` opcionales) que el usuario escribió a mano | `data/memory.json` (junto a `refsDir`, ignorado por git; caché por `mtimeMs`) | Al iniciar la tarea (`request`) y en cada preparación de llamada (`request + paso`, en `prepareArgs`), sin duplicar `(source, key)`. En v1 se lee en `forArgs`, `forFinal` y como fuente del pre-chequeo |
| **Hilo** (`engine/thread.ts`) | La última tarea `completed` con respuesta del modelo: pedido y 500 caracteres de respuesta | RAM de `TaskManager` (10 minutos); se copia a `recalled` al iniciar si continúa | Si `detectContinuation` (`d3`, umbral 0,3) responde que continúa, se copian `previous_request` y `previous_answer` con `from` = id anterior. Entra a `pending`, `forArgs`, `forFinal` y pre-chequeo |

- **Regla:** la confianza y la visibilidad de cada fuente se derivan de `source` en `recalledPolicy.ts`. Sin coincidencia no se agrega nada y no cambia ningún token.
- **Formato del archivo:** `[{ "key": "carpeta jarvis", "value": "C:\\Users\\Ana\\Desktop\\jarvis", "aliases": ["mi repo"] }]` (también `{ "facts": [...] }`). Archivo ausente o inválido = memoria vacía.
- **Diseño completo:** [`../pendientes/MEMORIA_CONTEXTO_DISENO.md`](../pendientes/MEMORIA_CONTEXTO_DISENO.md) (mediciones en [`../evaluacion/analisis/FRENTE_1_MEMORIA.md`](../evaluacion/analisis/FRENTE_1_MEMORIA.md)).

