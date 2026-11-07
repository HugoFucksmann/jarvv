# Contexto, Memoria y Persistencia

## 1. El Contexto de Tarea
Todo lo que el sistema sabe de una tarea vive en un único objeto, el **contexto** (`TaskContext`). No hay memorias paralelas: el estado que ve la interfaz, lo que leen los modelos y lo que audita la traza salen de las mismas secciones.

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
    "reason": "no_usable_data" | "not_accomplished" | null,   // solo con rejected
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
    [key: string]: {                       // "process" | "answer_<paso>_<n>"
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
| `facts` | `process` (proceso activo, como texto) y `answer_<paso>_<n>` (`pregunta -> respuesta`; si excede 500 caracteres, el texto completo va a una ref) | Motor |
| `refs` | Resultados completos en disco: etiqueta, tamaño, ruta | Ejecutor de llamadas |
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
| | `denied` | La política del servidor la denegó (la denegación de Guard cierra la tarea) |
| No ejecutadas | `args_invalid` | Argumentos inválidos (validación o revisión) |
| | `refs_unresolved` | Una referencia `rN` no se pudo resolver |
| | `loop_blocked` | El anti-bucle bloqueó una repetición |
| | `tool_rejected` | La revisión de argumentos descartó la herramienta |
| | `info_missing` | La revisión detectó información faltante |
| | `user_rejected` | El usuario rechazó la operación |

- **Veredicto**: `approved` o `rejected`. Se verifican las llamadas ejecutadas salvo `interrupted` y `denied`. Un rechazo lleva un motivo: `no_usable_data` o `not_accomplished`.
- **Efecto**: una escritura con `status = ok`, con cualquier veredicto. Una escritura que terminó en `tool_error`, `exception` o `interrupted` se registra como **posible efecto**: pudo dejar cambios parciales y se muestra aparte.
- **Texto fijo**: lo que se le dice a los modelos sobre un estado o un motivo son frases fijas, nunca prosa de un modelo.

## 3. Se Deriva, No se Guarda
Todo lo que no es un dato primario se recalcula desde `calls`, `steps`, `plans` y `facts`. No hay almacenes secundarios que puedan desincronizarse.

| Derivación | Definición |
|---|---|
| Efectos / posibles efectos | Escrituras `ok` / escrituras con `tool_error`, `exception` o `interrupted`. Sin tope |
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

**Anti-bucle**: una llamada se bloquea si repite herramienta y huella de argumentos con la última llamada ejecutada idéntica. Una lectura idéntica se permite solo si hubo una escritura exitosa en el medio; una escritura idéntica, solo si hubo una lectura ejecutada en el medio. Una respuesta del usuario posterior también cuenta como intermedia. Las herramientas marcadas como exentas en el catálogo no se controlan.

## 4. Vistas y Prompts
Cada consumidor recibe una vista distinta del mismo contexto, estructurada, de solo lectura y determinista. El texto lo arma después un renderizador, fuera del contexto.

| Vista | Consumidor |
|---|---|
| `forRoute` | Decisión 1 y 2 (ruta y herramienta) |
| `forPlan` | Planificador y replan |
| `forArgs` | Generación de argumentos |
| `forReview` | Decisión 3 (revisión de argumentos) |
| `forVerify` | Decisión 4 (verificación) |
| `forAsk` | Pregunta al usuario |
| `forPending` | Lista de pendientes del reactivo: solicitud, lista anterior, lo hecho (con argumentos y resumen), últimos intentos fallidos y entrada del usuario |
| `forFinal` / `forFallback` | Respuesta final con modelo / respuesta de respaldo sin modelo |

- **Qué muestra cada una** depende del modo, pero en ambos las decisiones, los argumentos y la verificación ven el paso actual (en reactivo, el primer pendiente; la solicitud completa solo la ven la lista de pendientes, la pregunta al usuario y la respuesta final). En reactivo suman lo hecho y el último resultado; en deliberativo, los pasos completados con su resultado. Los intentos que ven las decisiones son los del paso actual.
- **Topes por sección**: cada bloque de una vista tiene su tope de caracteres (tabla `caps` de `budget.ts`), y los elementos largos se recortan con un marcador de omisión. Los efectos y posibles efectos **nunca se recortan**: comparten una reserva de 12 000 caracteres y, si no caben, la tarea se cierra con `unrecoverable` en vez de mostrar una versión parcial.
- **Saneamiento**: todo texto externo (resúmenes, argumentos, rutas, instrucciones) pasa por un saneador que neutraliza las etiquetas `<obs>` y los encabezados de bloque del prompt (`LOG:`, `PASOS:`, etc.), de modo que un dato no pueda hacerse pasar por estructura.
- **Guarda de contexto**: antes de cada llamada al modelo generativo se estima el prompt (3 caracteres por token); si no deja margen mínimo para la salida, la llamada se rechaza. `qwenNumCtx` debe coincidir con el contexto real del servidor.

## 5. Resultados Voluminosos y Referencias
1. **Procesamiento**: el resultado crudo de la herramienta se convierte en un estado, un resumen (hasta 2 500 caracteres) y el texto completo. Extractores por herramienta condensan listados de carpetas (40 entradas), lecturas largas (primeras y últimas 15 líneas), procesos (últimas 30 líneas) y búsquedas (10 resultados). Una herramienta sin extractor usa el genérico (inicio y final del texto).
2. **Almacén**: si el resumen no contiene todo el resultado, el texto completo se guarda en disco en `<refsDir>/<tarea>/<uuid>.txt` (UTF-8, nunca se sobrescribe) y la llamada lleva una `ref` con su etiqueta, tamaño y ruta. Nada se borra automáticamente.
3. **Uso por los modelos**: un modelo nunca ve el contenido completo. Para usarlo, escribe `{{ref:rN}}` (o `ref:rN` como valor completo de un argumento) y el resolutor lo sustituye por el contenido real **antes de Guard y del despacho**; o lee la ruta del archivo con la herramienta de archivos, por tramos. La vista de argumentos le indica qué tramos de cada ref ya leyó.
4. **Resolución segura**: solo se aceptan ids `rN` de la propia tarea, la sustitución es de una sola pasada (el contenido inyectado no se vuelve a analizar) y una ref desconocida o ilegible nunca llega a la herramienta: la llamada queda `refs_unresolved`.
5. **Protección**: Guard deniega las escrituras de archivos sobre la carpeta de refs.

## 6. Persistencia
- **Tareas en memoria**: el estado de las tareas vive solo en RAM. Se retienen como máximo 20; al excederse, se expulsan las terminales más antiguas y, si aun así se supera, se cancela la tarea en espera más antigua.
- **Sin restauración**: al reiniciar el servidor no se recuperan tareas; el sistema arranca limpio.
- **En disco**: la configuración (`jarvis-config.json`), los resultados crudos de las refs y la traza.
- **Traza por tarea** (`src/core/trace/`): si `traceEnabled` está activo, al terminar cada tarea se escribe una carpeta `jarvis-traces/AAAAMMDD-HHMMSS_<id>/` (junto a `tracePath`, sin la extensión) y una línea en `jarvis-traces/index.jsonl`. Es de consumo externo (auditoría y laboratorio de evaluación) y el backend nunca la lee. La carpeta tiene: `summary.md` (lo que se lee o se pega a un agente: alertas, línea de tiempo de pasos y llamadas con lo que decidieron D1 a D4, esperas, refs con un fragmento y la respuesta final); `trace.json` (el snapshot final del contexto, las consultas a modelos con la salida ya interpretada y las opciones que se ofrecieron, las herramientas con un fragmento del resultado, las esperas y un bloque `meta` con modelos, versión del código, entorno y schemas de las herramientas); y `full.json.gz` (todo lo anterior más la entrada y la salida crudas de cada consulta, comprimido). Los resultados grandes no se copian: viven en las refs de `data/refs` y la traza guarda su id (`rN`), tamaño y un fragmento. La traza no registra refs nuevas en el contexto. El archivo único `jarvis-traces.jsonl` de la versión 2 ya no se escribe.
- **Pensamiento de los modelos**: la salida cruda de los modelos se reduce a una lista blanca de campos (identificador, modelo, motivo de fin, contenido y uso de tokens); el razonamiento interno no se registra.

## 7. Invariantes de Acceso a Memoria
1. **Escritura solo por el motor**: los modelos nunca escriben en el contexto ni en las refs; todo pasa por `apply` (§1).
2. **Sin prosa de modelos en el contexto**: lo que un modelo razona o justifica solo viaja en eventos y trazas. Motivos de rechazo y de detención son claves cerradas con texto fijo.
3. **Efectos permanentes**: se derivan de `calls`, que nunca se borran (un paso reemplazado solo se marca `superseded`). Ni el replan ni ningún retroceso pueden ocultarlos.
4. **Aislamiento por tarea**: las refs se resuelven solo contra la tarea activa (§5).
5. **Estado terminal cerrado**: una tarea terminal rechaza toda escritura; ninguna respuesta tardía puede modificarla.

## 8. Limitaciones Conocidas
- **Refs sin retención**: los archivos de refs no se borran nunca; tras expulsar la tarea o reiniciar el servidor quedan en disco sin tarea que las referencie.
- **Timeouts de modelos**: un timeout durante un paso se registra como servicio no disponible, sin distinguirlo de una caída.

## 9. Archivos Base
| Tema | Ruta en `src/core/` |
|---|---|
| Contexto (`apply`, validación, derivaciones, cierre, snapshot, vistas) | `ctx/` |
| Renderizado de prompts y topes | `render/`, `budget.ts` |
| Resultados y refs | `result/processResult.ts`, `result/extractors/`, `refs/refVault.ts`, `refs/refResolver.ts` |
| Escritura desde el motor | `engine/callRunner.ts`, `engine/args.ts` |
| Tareas, traza y configuración | `tasks.ts`, `trace/recorder.ts`, `config.ts` |
