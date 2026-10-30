# Contexto de JARVIS: idea de diseño

> Estado: borrador v0.9. v0.8 + registro de llamadas en dos tiempos, estado `interrupted`, lectura con `get`/`find`/`current` y sin tope de cantidad en `facts`. Esquema del objeto cerrado (tipos, nulos y valores por defecto). Lo que sigue abierto está en la sección 11. Sin referencias al código actual.

## 1. Problema

La información de una tarea está repartida: una parte en la tarea, otra en el contexto de ejecución y otra en claves sueltas de propósito poco claro. Esas claves acumulan datos y es difícil corregir algo específico. Para saber qué pasarle al modelo en cada paso hay que recorrer todo.

## 2. Objetivo

Un único contexto por tarea que:

- esté **centralizado**, sin dependencias excesivas entre archivos;
- **separe la información por tipo**;
- sea **fácil de construir y consultar**, para saber rápido qué pasarle al modelo en cada paso;
- permita **agregar, buscar y editar** un elemento sin tocar el resto (no se borra: el estado actual se refleja con updates);
- sea **rápido, eficiente y escalable**.

## 3. Principios

1. **Simplicidad primero.** Ante la duda, la opción más simple.
2. **Una sola fuente de verdad.** Cada dato se guarda una vez; lo demás se deriva.
3. **Se guardan hechos, se derivan vistas.** Lo calculable desde otra sección no se guarda. Las derivadas son funciones de solo lectura: cuando una decide un estado (cierre del plan, estado terminal), quien ejecuta lo escribe una sola vez en `task`.
4. **Los datos grandes viven fuera del contexto.** Se guarda solo una referencia y un resumen corto.
5. **Todo es JSON plano.** Lo no serializable (por ejemplo, la señal de cancelación) queda fuera.
6. **Todo elemento tiene identificador, paso de origen y marca de tiempo** (detalle en 5.1).
7. **El texto libre de los modelos no entra al contexto.** Excepciones: la salida para el usuario (respuesta final, pregunta) y el plan (`instruction`, `expected`), que es estructura de trabajo. Los `args` de una llamada son estructura validada contra el esquema de la herramienta, no prosa, y entran con los strings recortados (sección 9). Los veredictos son categorías, no prosa, y los `summary` los genera quien ejecuta recortando el resultado de la herramienta, sin modelo.
8. **El contexto no conoce a nadie.** No depende de herramientas, modelos ni traza; quien lo usa le pasa los datos ya resueltos.
9. **Una sola puerta de escritura.** Todo cambio entra por `ctx.apply`, que valida en un único lugar y emite un evento por cambio.
10. **Nada se borra.** No existe operación de borrado: el estado actual se refleja con updates.

## 4. Almacenamiento y persistencia

- Durante la tarea, el contexto vive **en memoria** como un objeto JSON plano.
- Para persistir, se guarda un **snapshot en JSON** al terminar la tarea, adjunto a la traza (sección 7). En v0.9 sirve para **auditoría y pruebas**; reanudar tras un reinicio queda fuera de alcance, aunque el diseño no lo bloquea (todo es JSON plano). `load` rechaza snapshots con un `v` distinto.
- **SQLite** queda como respaldo opcional a futuro, detrás de la misma API, solo si hace falta consultar entre tareas.

Por qué: el contexto se lee muchas veces por paso, y en memoria es lo más rápido. Como los datos grandes quedan fuera, el objeto crece con la cantidad de pasos y llamadas, no con el tamaño de los resultados. SQLite sumaría una dependencia nativa y una escritura por cada cambio sin beneficio mientras el alcance sea una sola tarea. Hay un solo escritor por tarea (el ciclo de ejecución), así que no hace falta control de concurrencia.

## 5. Objeto de contexto (v0.9)

```ts
{
  v: 1,
  task:   { id: string, mode: "reactive" | "deliberative", request: string,            // solicitud original
            state: "running" | "awaiting_input" | "completed" | "partial" | "failed" | "cancelled",
            stopReason: string | null,            // vocabulario de 5.3; solo en partial, failed y cancelled
            startedAt: number },

  steps:  [{ id, at,
             instruction: string | null,          // null en reactivo
             route: string | null,                // null en reactivo
             expected: string | null,             // null en reactivo
             state: "pending" | "running" | "completed" | "unverified" | "failed",
             rev: number,                         // control.replans al crearse; lo asigna apply
             superseded: boolean }],              // true si un replan lo reemplazó (solo deliberativo); lo asigna apply (false)

  calls:  [{ id, stepId, at, route, tool, kind: "read" | "write",
             args: object | null,                 // como los propuso el modelo, refs sin resolver, strings recortados
             sig: string | null,                  // null si no hubo args resueltos
             status: string,                      // vocabulario de 5.3
             verdict: "approved" | "unverified" | "rejected" | null,   // lo asigna apply (null)
             summary: string | null,              // tope 2500; sin modelo
             ref: string | null }],               // solo si el resultado superó el tope

  errors: [{ id, stepId, at, kind: "service_unavailable" | "fin_rejected" | "insufficient_info" }],

  facts:  { [clave]: { value: string | null, stepId, at } },   // solo `process` y `answer_<stepId>`; value ≤ 500; null = retirado

  refs:   [{ id, stepId, at, label: string, size: number, where: string }],

  control: { pending: null | { kind: "plan" | "mutation" | "question", stepId,
                               text: string | null,   // solo question
                               tool: string | null,   // solo mutation
                               sig: string | null },  // solo mutation
             override: string | null,                 // ruta forzada para la siguiente llamada
             escalations: number, replans: number,
             seq: { s: number, c: number, e: number, r: number },
             n: number },

  result: null | { text: string, origin: "model" | "fallback" }
}
```

**Estado inicial:** `task.state = "running"`, `stopReason = null`; `steps`, `calls`, `errors` y `refs` son arreglos vacíos; `facts = {}`; `pending = override = result = null`; `escalations = replans = n = 0`; `seq = { s: 0, c: 0, e: 0, r: 0 }`.

### 5.1 Campos comunes de los elementos

Aplican a `steps`, `calls`, `errors` y `refs`: `id` (prefijo de sección + número creciente: `s1`, `c4`, `e1`, `r3`; único en todo el contexto, nunca se reutiliza ni se renumera tras un replan), `stepId` (paso de origen) y `at` (marca de tiempo). El orden del arreglo es el cronológico.

Todos los campos de un elemento están siempre presentes: lo que no aplica vale `null` (nunca se omite ni se usa `""`). Única excepción, `stepId` en `steps`.

- En `steps`, `stepId` se omite: el `id` es el propio paso.
- En `errors`, `stepId` es obligatorio: los fallos ocurren dentro de un paso. Un fallo anterior a que existan pasos (por ejemplo, el servicio caído al planificar) se expresa con `stopReason = unrecoverable`, no con un error.
- `facts` se identifica por su clave (no por `id`) y guarda `stepId` y `at`.
- `task`, `control` y `result` son únicos y no llevan campos comunes.

### 5.2 Secciones

| Sección | Qué guarda |
|---|---|
| `task` | Identidad y estado de la tarea. |
| `steps` | Pasos ejecutados o planificados (en modo reactivo se crean al ejecutar). |
| `calls` | Todo intento de llamada a una herramienta, incluso los no ejecutados. Un paso puede tener varias. |
| `errors` | Fallos que no son una llamada. |
| `facts` | Estado del entorno o respuestas del usuario que no se derivan de `calls`; el último valor de cada clave reemplaza al anterior. |
| `refs` | Contenidos recuperables que no caben en el contexto. |
| `control` | Estado de ejecución serializable. |
| `result` | Respuesta final al usuario; `null` hasta que exista. |

Los campos y sus tipos están en el esquema de la sección 5.

Notas:

- `kind` se fija al registrar la llamada, así las vistas distinguen lecturas de escrituras sin consultar el catálogo de herramientas.
- `route` es la categoría de herramientas (por ejemplo, archivos o terminal), no el recurso concreto, que vive en `args`. Paso y llamada usan el mismo vocabulario. La de la llamada puede diferir de la del paso por `control.override`; en reactivo, la del paso es `null` y se lee de las llamadas.
- El texto de un `error` es fijo por `kind`.
- `args` son los argumentos como los propuso el modelo, con las referencias sin resolver y los strings recortados (sección 9). Es `null` cuando no hay objeto que guardar (`args_invalid` por JSON no parseable).
- `sig` es la huella de los argumentos ya resueltos, calculada por quien ejecuta (los argumentos grandes no viven en el contexto). El anti-loop compara `sig`, nunca los argumentos. Es `null` cuando no hubo argumentos resueltos (`args_invalid`, `refs_unresolved`); existe en `denied`, `user_rejected` y `loop_blocked`.
- `summary` es `null` cuando el `status` basta. En el resto es texto de quien ejecuta o de la herramienta, nunca de un modelo: el resultado recortado, el error de la herramienta o, en `args_invalid`, el error de validación (útil para `forArgs`).
- `ref` solo existe cuando el resultado superó el tope de `summary`; si el resumen está completo, es `null`.
- Un replan marca `superseded` los pasos `pending`, `running` y `failed`, y agrega los nuevos al final; los `completed` y `unverified` siguen vigentes. Así el orden de los pasos vigentes es el orden del arreglo.
- Un hecho es estado del entorno o respuesta del usuario que escribe quien ejecuta (nunca un modelo) y que no se deriva de `calls`. Lo que se infiere de `args` (el archivo o la URL leídos) se deriva y no se guarda. Hoy hay solo dos: `process` y `answer_<stepId>`. Las claves las define quien ejecuta y `apply` valida el formato `^[a-z][a-z0-9_]*$`.
- Un hecho se corrige escribiendo su valor nuevo y se retira escribiendo `value: null`; las vistas omiten los retirados. El valor anterior no se conserva en el contexto; queda en la traza si esta registra los eventos `change`.
- El proceso en segundo plano activo es un hecho (`process`, con su id como texto): quien ejecuta lo agrega al lanzarlo y lo retira (`null`) cuando el proceso termina o una interacción devuelve `not_found`. Ante otros errores se conserva (pueden ser transitorios). Solo se registra cuando la mutación que lo lanza termina `ok`. Si la tarea termina con el proceso activo, el hecho queda en el snapshot.
- `answer_<stepId>` lo escribe quien ejecuta cuando el usuario responde una pregunta: `pregunta -> respuesta`, recortada al tope (sección 9). La respuesta completa va a `refs`; la pregunta, mientras se espera, vive en `control.pending.text`.
- `control.pending` es `null` o `{ kind, stepId, text, tool, sig }`, con `kind` = `plan`, `mutation` o `question` (`question` es provisorio, ver sección 11). Los cinco campos están siempre presentes: `text` es la pregunta (salida para el usuario) y vale `null` fuera de `question`; `tool` y `sig` son los de la llamada que espera aprobación y valen `null` fuera de `mutation`. Mientras se espera no se registra ninguna llamada; el registro sigue las reglas de 5.3.
- `control.override` es la ruta forzada para la siguiente llamada, o `null`. No se excluyen herramientas: lo que salió mal queda registrado en `calls` y las vistas lo muestran como fallo reciente (`forRoute`) o del paso actual (`forArgs`).
- `control.escalations` y `control.replans` son contadores que solo suben. `escalations` suma 1 en el mismo lote que marca un paso `failed`, con tope 2; `replans` suma 1 en cada replan, con tope 2. `control.seq` son los contadores de ids por sección. El ajuste fino de `escalations` queda para el final.
- `control.n` es la versión del contexto: la cantidad de cambios aplicados. Solo la modifica `apply`.
- Los datos constantes del proceso (rutas base del usuario y límites: máximo de pasos, 15; de replans, 2; de escalaciones, 2; reintentos de argumentos y de resultado por paso, una vez cada uno; y preguntas al usuario por paso, 2, provisorio) no son parte del contexto: quien ejecuta o arma el prompt los pasa donde hagan falta.

### 5.3 Estados y vocabularios

| Campo | Valores |
|---|---|
| `task.state` | `running`, `awaiting_input`, `completed`, `partial`, `failed`, `cancelled` (terminales: los cuatro últimos) |
| `task.stopReason` | `max_steps`, `loop_blocked`, `unverified_steps`, `no_alternatives`, `security_denied`, `user_rejected`, `user_cancelled`, `replans_exhausted`, `unrecoverable` |
| `step.state` | `pending`, `running`, `completed`, `unverified`, `failed` |
| `call.status` (resultado del intento) | ejecutadas: `ok`, `no_data`, `not_found`, `tool_error`, `exception`, `interrupted` (la ejecución empezó y no terminó, por ejemplo por cancelación); no ejecutadas: `args_invalid`, `refs_unresolved`, `loop_blocked`, `denied`, `user_rejected` |
| `call.verdict` (qué dijo la verificación) | `approved`, `unverified`, `rejected`, `null` (no verificada o no ejecutada) |
| `error.kind` | `service_unavailable`, `fin_rejected`, `insufficient_info` |

**Cuándo se crea cada `error.kind`** (siempre con el `stepId` del paso en curso):

- `service_unavailable`: la ejecución del paso captura un error de servicio no disponible de cualquiera de los modelos.
- `fin_rejected`: en modo reactivo, el modelo elige la ruta `fin` y se rechaza porque no es el primer paso y se cumple alguna de dos: no hay ninguna llamada con `status = ok`, o `hasUnresolvedUnverified()` es verdadero. Quien ejecuta pide entonces otra ruta.
- `insufficient_info`: provisorio, pendiente (sección 11).

`status` y `verdict` están separados porque responden preguntas distintas: qué hizo la herramienta y qué decidió la verificación. Una llamada `unverified` no es un fallo: es un estado provisional que impide cerrar la tarea como completada mientras no se observe. Una llamada es **ejecutada** si su `status` no es ninguno de los "no ejecutadas".

**Registro de una llamada**

Elegir una herramienta o generar argumentos no es una llamada: la llamada existe cuando hay un intento con resultado. Se registra **una sola vez, al terminar el intento, con su `status` final**; antes no existe en `calls`. La verificación del resultado es otra consulta al modelo, así que va en un segundo `apply` que actualiza `verdict`. Mientras tanto `verdict = null` significa "ejecutada, aún sin verificar" (distinto de `unverified`, que es "el verificador no pudo decidir").

| Momento | Qué se registra |
|---|---|
| Los argumentos no pasan la validación | llamada `args_invalid` (cada rechazo cuenta) |
| Antes de ejecutar: refs sin resolver, anti-loop, política, confirmación del usuario | `refs_unresolved`, `loop_blocked`, `denied` o `user_rejected`. Mientras se espera la confirmación no hay registro, solo `control.pending` |
| Ejecución terminada | `ok`, `no_data`, `not_found`, `tool_error` o `exception`, con `verdict = null` |
| Ejecución cancelada o abortada | `interrupted`, registrada por quien ejecuta (por ejemplo, en un `finally`) |
| Verificación del resultado | `update` de `verdict` |

- Si se cancela la tarea, la llamada `interrupted` se registra **antes** de `finish`: tras un estado terminal, `apply` rechaza todo salvo `result`.
- Los reintentos (argumentos y resultado, una vez cada uno) no se guardan: se derivan contando las llamadas del paso con `status = args_invalid` o `verdict = rejected`.

**Reglas de estado**

- `task.state` transiciona `running` ⇄ `awaiting_input`, y desde cualquiera de los dos a un estado terminal. Un estado terminal no tiene salida.
- Con la tarea abierta, `awaiting_input` si y solo si `control.pending` no es `null`; ambos cambian juntos en un lote atómico (sección 6). `finish` limpia `pending`, de modo que un estado terminal nunca lo conserva.
- Agotar los reintentos de un paso (argumentos o resultado) lo deja `failed` y suma 1 a `control.escalations` en el mismo lote, en cualquier modo. Qué sigue (decidir de nuevo la acción con los fallos del paso, o replan) lo resuelve quien ejecuta, no el contexto.
- Un paso `unverified` en modo deliberativo solo se resuelve volviéndolo a verificar o con un replan; las lecturas posteriores no lo resuelven (en reactivo sí, ver 5.4).
- Estado terminal congelado: después de él, `apply` rechaza todo salvo escribir `result` una sola vez (mientras sea `null`). Los eventos tardíos (por ejemplo, la respuesta de una herramienta tras cancelar) los descarta quien ejecuta consultando `isClosed()`.

**Estado terminal por motivo de detención**

| `stopReason` | Estado terminal |
|---|---|
| `unverified_steps` | `partial` |
| `max_steps`, `loop_blocked`, `replans_exhausted`, `no_alternatives` | `partial` si hay efectos o una llamada aprobada; si no, `failed` |
| `security_denied`, `unrecoverable` | `failed` |
| `user_rejected`, `user_cancelled` | `cancelled` |

`completed` no lleva motivo. `partial` significa que quedó algo logrado o sin verificar.

### 5.4 Se deriva, no se guarda

| Dato | Se calcula desde |
|---|---|
| Efectos | `calls` con `kind = write` y `status = ok` (cualquier veredicto), sin tope |
| Posibles efectos | `calls` con `kind = write` y `status` `tool_error`, `exception` o `interrupted`: pudieron dejar cambios parciales. No cuentan como efecto para el anti-loop ni el cierre, pero `forPlan`, `forFinal` y `forFallback` los muestran aparte |
| Fallos de llamada recientes | `calls` con `status` distinto de `ok` (incluye `no_data` y `not_found`) o con `verdict = rejected` (`unverified` no cuenta) |
| Evidencia | `summary` y `verdict` de cada llamada |
| Llamada repetida (anti-loop) | herramienta y `sig` entre las llamadas ejecutadas. Lectura idéntica: se bloquea, salvo un único reintento tras un fallo transitorio (`tool_error`, `exception`, `interrupted`). Escritura idéntica: se bloquea salvo que haya una lectura intermedia, también tras un fallo (por los cambios parciales) |
| Contadores (llamadas totales, bloqueos seguidos) | `calls` |
| Búsqueda activa | `calls`: existe una llamada exitosa que inició una búsqueda (lo resuelve quien conoce las herramientas, consultando `calls`) |
| Llamada sin verificar pendiente (modo reactivo) | existe `calls` con `verdict = unverified` y ninguna lectura exitosa (`kind = read`, `status = ok`) posterior a la última; sirve cualquier lectura, aunque sea de otro recurso |
| Existe llamada aprobada | `calls` con `verdict = approved` |
| Cierre del plan (modo deliberativo) | pasos vigentes (sin `superseded`), ninguno `failed` (un `failed` vigente dispara replan): todos `completed` → `completed`; alguno `unverified` → `partial` con `unverified_steps` |
| Estado terminal de un motivo | tabla de 5.3, consultando efectos y llamadas aprobadas |
| Preguntas hechas en un paso | pendiente (sección 11) |
| Tamaño de las ventanas recientes de las vistas | `control.escalations` |
| Paso actual y última ejecución | `ctx.current()` devuelve `{ step, lastCall }`: `step` es el paso vigente `running` o, si no hay, el primer vigente `pending`; `lastCall` es el último elemento de `calls` |
| Última llamada y últimas lecturas con datos | `calls` (`kind = read`, `status = ok`) |
| Intentos previos por ruta o herramienta | `calls` |
| Fallos del paso actual | `calls` del paso con fallo (misma regla que los fallos recientes) |
| Reintentos de un paso (argumentos, resultado) | conteo de `calls` del paso con `status = args_invalid` o `verdict = rejected` |
| Handoff del paso anterior al actual | el paso vigente inmediato anterior, solo si está `completed`: `summary` de su llamada |
| Valores anteriores, orden entre secciones, duraciones | la traza, a partir de los eventos `change` (sección 7) |
| Historial y fallos en texto para los prompts | las vistas (sección 8) |

## 6. Escritura: `ctx.apply`

Toda escritura pasa por una sola función. No hay atajos de escritura: si resulta verboso, quien ejecuta arma sus propios helpers.

```ts
ctx.apply(ops, meta?)   // ops: una operación o un arreglo; devuelve { n, ids }
```

| `op` | Qué hace | Aplica a |
|---|---|---|
| `add` | Crea un elemento; asigna `id` (desde `control.seq`) y `at` | `steps`, `calls`, `errors`, `refs` |
| `update` | Cambia campos mutables de un elemento por `id` | `steps`, `calls` |
| `set` | Escribe un valor en un campo único | `task.state`, `facts.<clave>`, `control.<campo>`, `result` |
| `finish` | Cierra la tarea: estado terminal + motivo, validados contra la tabla de 5.3; deja `control.pending` en `null` | `task` |

No existe `remove`.

**Valores por defecto.** `add` completa `id`, `at`, `rev` (= `control.replans` actual), `verdict = null`, `ref = null`, `superseded = false` y el `state` inicial cuando el elemento lo tiene. Quien ejecuta no los escribe.

**Campos mutables** (cualquier otro cambio se rechaza):

| Destino | Qué puede cambiar |
|---|---|
| `steps` | `state`, `superseded` |
| `calls` | `verdict` |
| `errors`, `refs` | nada (inmutables) |
| `task` | `state`, solo `running` ⇄ `awaiting_input`; los terminales los fija `finish` |
| `facts` | `value` (texto o `null`); `stepId` y `at` se actualizan en cada `set` |
| `control` | todos los campos, salvo `seq` y `n`, que solo toca `apply` |
| `result` | una sola vez |

**Validación**, siempre en este orden y en un solo lugar:

1. La tarea está abierta (si es terminal, solo se admite escribir `result`).
2. La operación está bien formada y el destino existe (sección, `id`, clave).
3. El valor es JSON plano, con los campos mínimos de 5.2 y los vocabularios de 5.3.
4. El campo es mutable.
5. Las referencias existen (`stepId`, `call.ref`).
6. Se cumplen las transiciones e invariantes de 5.3 (se comprueban al final del lote).
7. Se respetan los topes de largo (el del valor de un `fact`) y el formato de clave de `facts`.

**Atomicidad.** Un arreglo de operaciones se aplica completo o no se aplica: ante cualquier error lanza una excepción, no cambia nada y no emite evento. Un lote no puede usar ids que él mismo crea; si hace falta, se aplica en dos pasos con los `ids` que devuelve el primero. Sirve, por ejemplo, para mantener la invariante `awaiting_input` ⇔ `pending`:

```ts
ctx.apply([
  { op: "set", target: "control.pending", value: { kind: "question", stepId: "s2", text, tool: null, sig: null } },
  { op: "set", target: "task.state", value: "awaiting_input" },
]);
```

**Evento.** Cada `apply` exitoso incrementa `control.n` y emite un único evento `change` con `{ n, at, ops, meta }`, donde `ops` son las operaciones ya normalizadas (con el `id` y el `at` asignados). Los suscriptores (`ctx.on("change", fn)`) son de solo lectura: no pueden llamar a `apply` dentro del manejador y, si fallan, el cambio no se revierte. `meta` es opcional, opaco para el contexto y categórico (sin prosa). `at` sale de un reloj inyectable (`now`), para que las pruebas sean deterministas.

**Lectura.** `ctx.get(id)` devuelve un elemento por `id` (`ctx.get("facts.clave")` para un hecho). `ctx.find(sección, where)` devuelve los elementos de una sección que cumplen la igualdad de campos de `where`, incluidos los reemplazados por un replan. `ctx.current()` devuelve `{ step, lastCall }` (sección 5.4). Cualquier consulta más rica es una vista derivada.

## 7. Traza

La traza queda **fuera del contexto** y no agrega código dentro de él. La dependencia va en un solo sentido: la traza conoce el contexto, no al revés. El contexto solo emite eventos `change` (sección 6).

- **Entrada y salida crudas de los modelos** y su texto libre (razones, explicaciones) van a la traza, identificadas con el `id` del elemento al que pertenecen (por ejemplo `c4`) y con el `n` con el que se armó la vista que recibió el modelo.
- Al terminar la tarea, el **snapshot** se adjunta a la traza como parte estructurada de la auditoría. Los resultados completos se toman del almacén de `refs`, no del snapshot.
- La traza puede suscribirse a `change` para registrar cada cambio con su `n`. Es opcional.
- Ninguna bandera propia de la traza (por ejemplo, "ya registrada") vive en el contexto.

**Idea a evaluar a futuro (fuera de v0.9):** un log de cambios simple y separado de la traza, de solo agregado, que el modelo pueda consultar (por ejemplo, qué valía un hecho antes). No requiere cambios en el contexto: `apply` ya emite eventos con `n` consecutivo y operaciones normalizadas. Se retoma solo si aparece un caso de uso concreto.

## 8. Vistas por consumidor

Una vista es una función de solo lectura y determinista (mismo contexto, mismo resultado) que arma lo que necesita un consumidor. Nombres y contenido tentativos.

| Vista | Consumidor | Incluye |
|---|---|---|
| `forPlan` | Planificador y replan | solicitud, ventana de pasos (ya ejecutados, actual, siguientes), todos los efectos sin recorte y los posibles efectos, hechos, fallos recientes |
| `forRoute` | Decisiones de ruta y herramienta | paso actual y criterio, intentos recientes por ruta y herramienta (cuáles fallaron), fallos recientes, hechos |
| `forArgs` | Generación de argumentos | instrucción del paso con handoff (en reactivo, la solicitud y el historial), últimas lecturas con datos, refs disponibles, efectos, hechos, fallos del paso actual |
| `forVerify` | Verificación del paso | paso, criterio de éxito, llamada evaluada (resumen y ref), efectos del paso |
| `forFinal` | Respuesta final redactada por el modelo | solicitud, estado y motivo de detención de la tarea, estado de cada paso, evidencia, efectos y posibles efectos, hechos |
| `forFallback` | Respuesta final de respaldo, sin modelo (también la usada en `cancelled`) | estado, motivo de detención, fallos, efectos y posibles efectos, hechos, últimas acciones |

`forArgs` es deliberadamente liviana: deja fuera el registro cronológico y la ventana del plan, pero incluye los fallos del paso actual para no regenerar el mismo error de argumentos (el anti-loop bloquearía una repetición idéntica). Si las pruebas muestran que falta contexto, se suma primero la última observación.

Además, consultas de sí o no para el control de ejecución: `isRepeat(tool, sig)`, `hasUnresolvedUnverified()`, `hasApprovedCall()` e `isClosed()`. Y `ctx.current()`, que devuelve `{ step, lastCall }`.

## 9. Presupuesto y crecimiento

- **Un solo lugar** define el presupuesto: una tabla consumidor → máximo de caracteres y de elementos por sección.
- Al recortar, la prioridad es: paso actual y criterio, solicitud, último resultado relevante, fallos recientes, hechos, historial anterior.
- Los **efectos nunca se recortan** en `forPlan`: el replan los recibe todos, uno por línea. Si aun así exceden el límite del modelo, la vista falla en voz alta (no recorta en silencio) y la tarea termina con `unrecoverable`.
- El tamaño de las ventanas recientes (llamadas e intentos recientes, fallos recientes) sube con `control.escalations`: con 0, 1 y 2 escalaciones las vistas muestran los últimos 2, 5 y 10 elementos de cada lista. La ventana de pasos de `forPlan` no depende de esto. Se ajusta al final.
- `summary` tiene tope de 2500 caracteres.
- Se mide en caracteres al inicio; se valida con el tokenizador real de cada modelo antes de afinar.
- Las vistas leen solo ventanas recientes; los pasos reemplazados por un replan se conservan marcados.
- Los resultados grandes (páginas web, contenido de archivos) pasan a `refs`: en `calls` quedan el `summary` y el id de la ref, y las vistas los muestran con el tamaño.
- En `args` se recortan solo los strings (tentativo: 300 caracteres) con un marcador `…(+N)`, donde N es la cantidad de caracteres omitidos, para que el modelo no tome un valor cortado por el real. Si el modelo necesita más, lee un trozo de la ref con una lectura normal, con el mismo tope que `summary`.
- `facts` **no tiene tope de cantidad**: se conservan todos los hechos de cada paso. El crecimiento lo limita el máximo de pasos, controlado por el anti-loop. Las vistas recortan por la prioridad de arriba. El largo por valor está limitado (tentativo: 500 caracteres): quien ejecuta recorta antes de escribir, con el mismo marcador, y `apply` rechaza un `set` de `facts` que exceda el tope.
- La respuesta completa del usuario a una pregunta se guarda siempre entera como `ref` (los topes de `facts` no aplican a `refs`); en `facts` queda, si hace falta, una versión recortada.

## 10. Uso (nombres tentativos)

```ts
const ctx = create.memory({ request, mode, now });

// escritura: todo por apply
const { ids } = ctx.apply({ op: "add", section: "calls", data: { /* status: "ok", ... */ } });   // al terminar la ejecución; ids: ["c4"]
ctx.apply({ op: "update", id: "c4", patch: { verdict: "approved" } });                // tras la verificación
ctx.apply({ op: "set", target: "facts.process", value: "12345", stepId: "s2" });
ctx.apply({ op: "set", target: "facts.process", value: null, stepId: "s5" });      // retirar un hecho
ctx.apply({ op: "finish", state: "partial", stopReason: "max_steps" });
ctx.apply({ op: "set", target: "result", value: { text, origin: "model" } });      // única escritura tras el cierre

// lectura
ctx.get("c4");                          // por id; también ctx.get("r3") o ctx.get("facts.process")
ctx.find("errors", { stepId: "s2" });   // igualdad de campos
ctx.current();                          // { step, lastCall }
ctx.view.forArgs("s2");
ctx.isClosed();
ctx.n;                                  // versión actual (control.n)

// eventos y snapshot
ctx.on("change", (event) => { /* solo lectura */ });
ctx.snapshot();  ctx.load(snapshot);
```

Los errores de uso (validación de la sección 6) fallan en voz alta, no en silencio.

## 11. Por definir

- Definir el objeto de contexto: el esquema de la sección 5 está propuesto y pendiente de aprobación. Ya confirmado: de `calls` solo cambia `verdict`.
- Valores numéricos del presupuesto: topes por vista, topes de recorte (valores de `facts`: 500; strings de `args`: 300; ambos tentativos) y tamaños de las ventanas recientes. Propuesta: medir primero con tareas reales y fijarlos con el tokenizador de cada modelo. El ajuste de `escalations` va al final.
- Mecanismo de preguntas al usuario (`ask_user`): puede ser decisión del ejecutor y no del contexto. Se define al fijar las keys. Depende de esto, y es provisorio: el kind `insufficient_info`, `pending.kind = question`, `task.state = awaiting_input` y el máximo de 2 preguntas por paso. Hasta decidirlo no se agrega `refs.kind`.
- Arquitectura del motor: ¿un solo bucle, con el plan y el replan como una capa que provee los pasos? El contexto ya lo admite (el paso es el mismo objeto en ambos modos). Punto a resolver: el verificador debería aceptar pasos sin criterio de éxito explícito (`expected = null`).
- Hechos fijados por el modelo: hoy solo escribe quien ejecuta. Si se aceptan, se agrega una referencia (`facts.ref`) para valores largos y se revisa el vocabulario cerrado de claves.
- Reincorporar el archivo y la URL actuales como hechos si las pruebas muestran que el modelo los pierde.
- Memoria entre tareas: fuera de alcance. El snapshot es la unidad que otro almacén podría ingerir a futuro.