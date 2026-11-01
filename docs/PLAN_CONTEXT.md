# Contexto de JARVIS: idea de diseño

> Estado: borrador v0.28. Esquema y API aprobados para empezar la implementación; lo pendiente está en la sección 10 y ajusta valores y vocabularios, no la estructura. Sin referencias al código actual; las notas sobre él están en la sección 11.

## Propósito de este documento

Reflejar la idea de diseño del contexto de una tarea y llevarla a un estado cerrado. Una vez cerrada, este documento junto con el código servirá de base para escribir el plan de implementación previo a la refactorización. El esquema y la API están aprobados; falta cerrar la sección 10.

**Cómo leerlo.** La sección 5 es el esquema y las reglas; la sección 10, las decisiones abiertas. *Provisorio* marca lo que depende de una decisión de la sección 10; *tentativo*, un nombre o valor que puede cambiar. Este documento no es un plan de implementación ni describe el código; lo observado en el código está separado en la sección 11.

**Al cerrar una decisión:** se pasa de la sección 10 al cuerpo del documento; se actualizan el esquema y las reglas que la mencionan (5.3, sección 6, sección 9); se quitan los marcadores *provisorio* que dependían de ella y se actualizan las referencias cruzadas.

## 1. Problema

La información de una tarea está repartida: una parte en la tarea, otra en el contexto de ejecución y otra en claves sueltas de propósito poco claro. Esas claves acumulan datos y es difícil corregir algo específico. Para saber qué pasarle al modelo en cada paso hay que recorrer todo.

## 2. Objetivo del contexto

Un único contexto por tarea que:

- esté **centralizado**;
- **separe la información por tipo**;
- sea **fácil de construir y consultar**, para saber rápido qué pasarle al modelo en cada paso;
- permita **agregar, buscar y editar** un elemento sin tocar el resto;
- sea **rápido y escalable**: las lecturas y las vistas recorren solo ventanas recientes, no todo el historial, y el objeto crece con la cantidad de pasos y llamadas, no con el tamaño de los resultados.

## 3. Principios

1. **Una sola fuente de verdad.** Cada dato se guarda una vez; lo calculable desde otra sección no se guarda, se deriva en vistas de solo lectura. Cuando una derivada decide un estado (cierre del plan, estado terminal), quien ejecuta lo escribe una sola vez en `task`.
2. **Los datos grandes viven fuera del contexto.** Se guarda solo una referencia y un resumen corto.
3. **Todo elemento de `plans`, `steps`, `calls`, `errors` y `refs` tiene identificador y marca de tiempo; los de `calls`, `errors` y `refs` además el paso de origen** (en `steps`, el `id` es el propio paso; en `plans`, `stepId` es el paso que falló, o `null`). `facts` se identifica por su clave y guarda paso de origen y marca de tiempo (detalle en 5.1).
4. **El texto libre de los modelos no entra al contexto.** Excepciones: la salida para el usuario (respuesta final, pregunta) y el plan (`instruction`, `expected`), que es estructura de trabajo. Los `args` de una llamada son estructura validada contra el esquema de la herramienta, no prosa, y entran con los strings recortados (sección 9). Los veredictos son categorías, no prosa, y los `summary` los genera quien ejecuta recortando el resultado de la herramienta, sin modelo.
5. **El contexto no conoce a nadie.** No depende de herramientas, modelos ni traza; quien lo usa le pasa los datos ya resueltos.
6. **Una sola puerta de escritura.** Todo cambio entra por `ctx.apply`, que valida en un único lugar y emite un evento por cada `apply` exitoso.
7. **Nada se borra.** No existe operación de borrado: el estado actual se refleja con updates. El valor anterior de un hecho no queda en el contexto, pero se reconstruye desde los eventos `change` (sección 7).

## 4. Almacenamiento y persistencia

- Durante la tarea, el contexto vive **en memoria** como un objeto JSON plano (lo no serializable, como la señal de cancelación, queda fuera). Se lee muchas veces por paso, y hay un solo escritor por tarea (el ciclo de ejecución), así que no hace falta control de concurrencia.
- Para persistir, se guarda un **snapshot en JSON** al terminar la tarea, adjunto a la traza (sección 7). En esta versión sirve para **auditoría y pruebas**; reanudar tras un reinicio queda fuera de alcance, aunque el diseño no lo bloquea. `create.fromSnapshot` rechaza snapshots con un `v` distinto.
- Los contenidos de las `refs` (5.2) viven en disco y **no se borran nunca** en esta etapa: el snapshot de auditoría referencia sus `where`. Borrarlas al terminar la tarea es una idea pendiente (sección 10.2).

## 5. Objeto de contexto

El esquema contiene solo lo decidido; lo pendiente está en la sección 10.

```ts
{
  v: 1,
  task:   { id: string, mode: "reactive" | "deliberative", request: string,            // solicitud original
            state: "running" | "completed" | "partial" | "failed" | "cancelled",
            stopReason: string | null,            // vocabulario de 5.3; solo en partial, failed y cancelled
            startedAt: number },

  plans:  [{ id, at, trigger: "initial" | "user_feedback" | "step_failure",   // solo deliberativo
             feedback: string | null,             // instrucción del usuario; solo en user_feedback
             stepId: string | null }],            // paso que falló; solo en step_failure

  steps:  [{ id, at,
             planId: string | null,               // plan que creó el paso; null en reactivo
             instruction: string | null,          // null en reactivo
             route: string | null,                // null en reactivo
             expected: string | null,             // null en reactivo
             state: "pending" | "running" | "completed" | "failed",
             superseded: boolean }],              // true si un replan lo reemplazó (solo deliberativo); false al crearse

  calls:  [{ id, stepId, at, route, tool, kind: "read" | "write",
             args: object | null,                 // como los propuso el modelo, refs sin resolver, strings recortados
             sig: string | null,                  // null si no hubo args resueltos
             status: string,                      // vocabulario de 5.3
             verdict: "approved" | "rejected" | null,   // null al crearse; se actualiza tras la verificación
             reason: string | null,                    // causa del rechazo (opción elegida por el modelo de decisión); solo con rejected
             summary: string | null,              // tope 2500; sin modelo
             ref: string | null }],               // id de una ref; solo si el resumen no contiene el resultado completo

  errors: [{ id, stepId, at, kind: "service_unavailable" }],

  facts:  { [clave]: { value: string | null, stepId, at } },   // claves en 5.2; value ≤ 500 (tentativo); null = retirado

  refs:   [{ id, stepId, at, label: string, size: number, where: string }],   // el contenido vive fuera del contexto (5.2)

  result: null | { text: string, origin: "model" | "fallback" }
}
```

**Estado inicial:** `task.state = "running"`, `stopReason = null`; `plans`, `steps`, `calls`, `errors` y `refs` son arreglos vacíos; `facts = {}`; `result = null`.

### 5.1 Campos comunes de los elementos

Aplican a `plans`, `steps`, `calls`, `errors` y `refs`: `id` (prefijo de sección + número creciente: `p1`, `s1`, `c4`, `e1`, `r3`; único en todo el contexto, nunca se reutiliza ni se renumera tras un replan), `stepId` (paso de origen) y `at` (marca de tiempo). El orden del arreglo es el cronológico.

Todos los campos de un elemento están siempre presentes: lo que no aplica vale `null` (nunca se omite ni se usa `""`). Única excepción, `stepId` en `steps`.

- En `steps`, `stepId` se omite: el `id` es el propio paso.
- En `plans`, `stepId` es el paso que falló (`trigger = step_failure`); en los demás vale `null`.
- En `errors`, `stepId` es obligatorio: los fallos ocurren dentro de un paso. Un fallo anterior a que existan pasos se expresa con `stopReason = unrecoverable`, no con un error (5.3).
- `facts` se identifica por su clave (no por `id`) y guarda `stepId` y `at`.
- `task` y `result` son únicos y no llevan campos comunes.

### 5.2 Secciones

| Sección | Qué guarda |
|---|---|
| `task` | Identidad y estado de la tarea. |
| `plans` | Versiones del plan (solo modo deliberativo): el inicial y una por cada replan o rechazo del usuario. |
| `steps` | Pasos ejecutados o planificados. En deliberativo los crea el plan; en reactivo, cada iteración del bucle (ver notas). |
| `calls` | Todo intento de llamada a una herramienta, incluso los no ejecutados. Un paso puede tener varias. |
| `errors` | Fallos que no son una llamada. |
| `facts` | Estado del entorno o respuestas del usuario que no se derivan de `calls`; el último valor de cada clave reemplaza al anterior. |
| `refs` | Referencias a contenidos recuperables que no caben en el contexto. |
| `result` | Respuesta final al usuario; `null` hasta que exista. |

Los campos y sus tipos están en el esquema de la sección 5.

Notas:

- `kind` se fija al registrar la llamada, así las vistas distinguen lecturas de escrituras sin consultar el catálogo de herramientas.
- `route` es la categoría de herramientas (por ejemplo, archivos o terminal), no el recurso concreto, que vive en `args`. Paso y llamada usan el mismo vocabulario. La de la llamada puede diferir de la del paso si el ejecutor fuerza otra ruta; en reactivo, la del paso es `null` y se lee de las llamadas. `fin` y `ask_user` no son rutas: son opciones del modelo de decisión y no crean llamadas.
- **Paso en reactivo.** Es una iteración del bucle (elegir ruta y herramienta, generar argumentos, ejecutar, verificar). Se crea en `running` antes de consultar al modelo de decisión, así todo lo que ocurre dentro lleva `stepId`. Termina `completed` con una llamada `approved` o con `fin`, y `failed` al agotar los reintentos o el tope de llamadas. Los rechazos y los veredictos `rejected` son de las llamadas del mismo paso: se reintenta dentro de él, sin crear uno nuevo. `ask_user` no lo cierra (ver `answer_<stepId>`). `max_steps` cuenta pasos (incluidos los `failed`), no llamadas: antes de crear el paso 16, la tarea cierra con `max_steps`.
- En deliberativo, `instruction`, `route` y `expected` de un paso son obligatorios (no `null`); en reactivo los cuatro campos de plan valen `null`.
- El texto de un `error` es fijo por `kind`.
- `args` son los argumentos como los propuso el modelo, con las referencias sin resolver y los strings recortados (sección 9). Es `null` cuando no hay objeto que guardar (`args_invalid` por JSON no parseable). El recorte por defecto es de 300 caracteres (tentativo); el catálogo de herramientas puede declarar una excepción por parámetro (`argCaps`; inicialmente `command`: 1000). Quien ejecuta recorta antes de escribir; `apply` valida contra un máximo global `ARGS_MAX` (la mayor excepción) sin conocer herramientas: quien crea el contexto se lo pasa, calculado desde el catálogo.
- `sig` es la huella de los argumentos ya resueltos, calculada por quien ejecuta (los argumentos grandes no viven en el contexto). El anti-loop compara `sig`, nunca los argumentos. Es `null` cuando no hubo argumentos resueltos (`args_invalid` por validación, `refs_unresolved`); existe en el resto de las no ejecutadas.
- `summary` es `null` cuando el `status` basta. En el resto es texto de quien ejecuta o de la herramienta, nunca de un modelo: el resultado recortado, el error de la herramienta o, en `args_invalid`, el error de validación (útil para `forArgs`) y, en `user_rejected`, la instrucción opcional del usuario. Se guarda recortado, sin aplanar ni renombrar etiquetas: el saneado del texto externo (neutralizar las marcas de bloque del prompt) lo hacen las vistas al renderizar. No contiene claves de ref: si el extractor omitió contenido, deja un marcador de omisión neutro, y la vista añade la ref a partir de `call.ref`.
- `ref` (en `calls`) existe solo cuando el resumen no contiene el resultado completo: el extractor omitió contenido o el resumen superó el tope de `summary`; si el resumen está completo, es `null`. Apunta al `id` de un elemento de `refs`.
- `refs` no guarda el contenido, solo cómo recuperarlo: `label` dice en pocas palabras qué es (por ejemplo, una búsqueda web), `size` es su tamaño en caracteres y `where` es la ruta absoluta del archivo que contiene el resultado, fuera del contexto; el contexto no la interpreta. El archivo guarda el texto crudo que devolvió la herramienta (los bloques de texto del resultado, unidos), no el resumen, y se lee por trozos con una lectura de archivo normal (`path`, `offset`, `length`). El nombre del archivo no depende del `id` de la ref (que asigna `apply` después de guardar el contenido); lo que vale es `where`. Ejemplo: los resultados de una búsqueda quedan como `r1`, y en la llamada quedan el `summary` y `ref = "r1"`. Las vistas muestran la ref con su tamaño y su ruta (`where`), a partir de `call.ref` y `refs`, para que el modelo sepa qué `path` leer. Su retención está en la sección 4.
- Un plan nuevo (por fallo de un paso o rechazo del usuario) marca `superseded` los pasos `pending`, `running` y `failed`, y agrega los nuevos al final; los `completed` siguen vigentes. Así el orden de los pasos vigentes es el orden del arreglo. Un plan se agrega a `plans` solo si trae entre 1 y 15 pasos. Si la generación es inválida (falla, no trae pasos o excede el tope), se repite una vez: esa repetición es el reintento que ya hace el cliente del modelo ante una salida inválida, y quien ejecuta no repite por su cuenta; para que un plan con 0 pasos o con más de 15 cuente como salida inválida, el cliente valida el rango (el tope se lo pasa quien lo usa); si sigue inválida, en el plan inicial la tarea cierra con `unrecoverable`, en un replan por fallo de paso con `replans_exhausted`, y en uno por rechazo del usuario se conserva el vigente. Un servicio caído no es una generación inválida: cierra con `unrecoverable` (5.3).
- Un hecho es estado del entorno o respuesta del usuario que escribe quien ejecuta (nunca un modelo) y que no se deriva de `calls`. Lo que se infiere de `args` (el archivo o la URL leídos) se deriva y no se guarda. Hay solo dos: `process` y `answer_<stepId>`. Las claves las define quien ejecuta y `apply` valida el formato `^[a-z][a-z0-9_]*$`.
- Un hecho se corrige escribiendo su valor nuevo y se retira escribiendo `value: null`; las vistas omiten los retirados. El valor anterior no se conserva en el contexto.
- `process` es el id (como texto) del proceso en segundo plano activo: quien ejecuta lo agrega cuando la mutación que lo lanza termina `ok` y lo retira (`null`) cuando el proceso termina o una interacción devuelve `not_found`; ante otros errores se conserva (pueden ser transitorios).
- `answer_<stepId>` lo escribe quien ejecuta cuando el usuario responde una pregunta: `pregunta -> respuesta`, recortada al tope (sección 9). La respuesta completa va a `refs`. Hay una pregunta por paso, en ambos modos: `ask_user` se ofrece solo si no existe `answer_<stepId>` del paso actual. Respondida, el paso continúa y el modelo de decisión decide de nuevo; en deliberativo, si el paso necesita más datos, falla y sigue el replan.
- Los datos constantes del proceso no son parte del contexto: quien ejecuta o arma el prompt los pasa donde hagan falta. Son las rutas base del usuario y los límites: máximo de pasos, 15 (en reactivo, pasos ejecutados; en deliberativo, tamaño de cada plan); replans, 2; escalaciones (solo reactivo), 2; reintentos de argumentos y de resultado por paso, una vez cada uno (provisorio); preguntas al usuario, una por paso; llamadas por paso, 8 (provisorio), sin contar `user_rejected`; repetición de un plan inválido, una vez, a cargo del cliente del modelo (provisorio).

### 5.3 Estados y vocabularios

| Campo | Valores |
|---|---|
| `task.state` | `running`, `completed`, `partial`, `failed`, `cancelled` (terminales: los cuatro últimos) |
| `task.stopReason` | `max_steps`, `loop_blocked`, `no_alternatives`, `security_denied`, `user_cancelled`, `replans_exhausted`, `unrecoverable` |
| `step.state` | `pending`, `running`, `completed`, `failed` |
| `call.status` (resultado del intento) | ejecutadas (llegaron a despacharse): `ok`, `no_data`, `not_found`, `tool_error`, `exception`, `interrupted` (la ejecución empezó y no terminó, por ejemplo por cancelación); no ejecutadas: `args_invalid`, `refs_unresolved`, `loop_blocked`, `user_rejected`, `tool_rejected`, `info_missing`; `denied` puede ser de uno u otro tipo (ver abajo) |
| `call.verdict` (qué dijo la verificación) | `approved`, `rejected`, `null` (no verificada o no ejecutada) |
| `call.reason` (causa del rechazo) | lista cerrada: las opciones del modelo de decisión. Valores iniciales (provisorios): `no_usable_data` (el resultado no tiene datos utilizables) y `not_accomplished` (el resultado no cumple lo pedido); si se dan ambas, gana `no_usable_data`. La lista definitiva se define con la evaluación de prompts (sección 10.1). El contexto guarda solo la clave; cada razón tiene un mensaje fijo que arman las vistas (sección 8) |
| `error.kind` | `service_unavailable` |

**Cuándo se crea cada `error.kind`** (siempre con el `stepId` del paso en curso):

- `service_unavailable`: la ejecución del paso captura un error de servicio no disponible de cualquiera de los modelos o del descubrimiento de herramientas (sin herramientas disponibles), o una respuesta inválida del verificador que persiste tras repetir la consulta una vez. Crear este error cierra la tarea con `unrecoverable` (ver Reglas de estado).

`status` y `verdict` están separados porque responden preguntas distintas: qué hizo la herramienta y qué decidió la verificación. El verificador, que es una consulta al modelo de decisión, devuelve probabilidades sobre las opciones que se le dan; al contexto solo llega el dato final: `verdict` y, si rechaza, `reason` (la opción elegida). Una llamada es **ejecutada** si llegó a despacharse a la herramienta.

`denied` tiene dos orígenes. El de la política del **Guard** se decide antes de ejecutar: la llamada es no ejecutada y cierra la tarea con `security_denied`. El del **servidor de la herramienta** llega en el resultado, después de despachar: se registra al terminar el intento con `status = denied`, no se verifica (`verdict = null`) y deja el paso `failed`, con la recuperación del modo.

**Registro de una llamada**

Una **llamada** es el intento de ejecutar una herramienta. Consultar a un modelo (elegir la herramienta, generar o revisar los argumentos, verificar el resultado) es una consulta al modelo, no una llamada, y no se registra por sí sola. La llamada se registra **una sola vez, al terminar el intento, con su `status` final**, incluidos los rechazos previos a la ejecución; antes no existe en `calls`. La verificación del resultado es otra consulta al modelo, así que va en un segundo `apply` que actualiza `verdict` y `reason`. Mientras tanto `verdict = null` significa "ejecutada, aún sin verificar".

| Momento | Qué se registra |
|---|---|
| Los argumentos no pasan la validación contra el esquema, o la revisión los rechaza por mal generados | llamada `args_invalid` (cada rechazo cuenta como reintento, provisorio); se regeneran con lo rechazado a la vista |
| La revisión rechaza la herramienta elegida | llamada `tool_rejected`; se vuelve al inicio del bucle (elegir ruta y herramienta; en deliberativo la ruta ya viene del plan) con lo rechazado a la vista |
| La revisión detecta que faltan datos del usuario | llamada `info_missing`; igual que `tool_rejected`: se vuelve al inicio del bucle con lo rechazado a la vista, y el modelo de decisión puede elegir `ask_user` |
| Antes de ejecutar: refs sin resolver, anti-loop, política del Guard, confirmación del usuario | `refs_unresolved`, `loop_blocked`, `denied` (Guard) o `user_rejected`. Mientras se espera la confirmación no hay registro |
| Ejecución terminada | `ok`, `no_data`, `not_found`, `tool_error`, `exception` o `denied` (política del servidor de la herramienta, detectada en el resultado), con `verdict = null` |
| Ejecución cancelada o abortada | `interrupted`, registrada por quien ejecuta (por ejemplo, en un `finally`) |
| Verificación del resultado (de toda llamada ejecutada, salvo `interrupted` y `denied`) | `update` de `verdict` y `reason`, juntos y una sola vez (de `null` a un valor); un reintento es una llamada nueva |

- La revisión de argumentos es una consulta al modelo de decisión (no al LLM, para evitar llamadas lentas) que va después de las comprobaciones deterministas (validación, refs, anti-loop, política) y antes de pedir confirmación al usuario. Si aprueba, no deja registro; del rechazo solo importa el escenario elegido, que se refleja en el `status`, sin `reason`.

- Si se cancela la tarea, la llamada `interrupted` se registra **antes** de `finish`: tras un estado terminal, `apply` rechaza todo salvo `result`.

**Esperas del usuario.** Aceptar el plan, confirmar una mutación y responder una pregunta (`ask_user`, opción del modelo de decisión) son control de flujo del ejecutor: la espera no vive en el contexto, solo su resultado.

| Resultado | Qué queda en el contexto |
|---|---|
| Plan aceptado | nada; los pasos empiezan a ejecutarse |
| Plan rechazado con instrucción (sin tope) | plan nuevo `user_feedback` con la instrucción; sus pasos reemplazan a los `pending` del anterior |
| Mutación aceptada | nada; la llamada se ejecuta normal |
| Mutación rechazada (con instrucción opcional) | llamada `user_rejected`, con la instrucción en `summary`; en reactivo, el modelo de decisión decide de nuevo (otra herramienta, la misma, `ask_user` o `fin`, que `canFinish()` habilita: 5.4); en deliberativo, el paso queda `failed` y sigue el replan, que ve la instrucción en los fallos. No consume reintentos del paso ni cuenta para el anti-loop |
| Pregunta respondida | hecho `answer_<stepId>` (5.2); el paso no se cierra |
| Cancelar, en cualquier punto | `finish` con `user_cancelled` |

**Reglas de estado**

- `task.state` pasa de `running` a un estado terminal. Un estado terminal no tiene salida.
- Agotar los reintentos de un paso (argumentos o resultado) o su tope de llamadas lo deja `failed`, en cualquier modo. El tope frena al modelo que insiste con rechazos; `user_rejected` no cuenta porque el usuario puede cancelar. Qué sigue (decidir de nuevo la acción con los fallos del paso, o replan) lo resuelve quien ejecuta, no el contexto.
- En reactivo, 2 llamadas `loop_blocked` seguidas cierran la tarea con `loop_blocked`. En deliberativo, un paso bloqueado por el anti-loop queda `failed` y sigue el replan.
- El tope de escalaciones (2) rige solo en reactivo: al fallar un tercer paso, la tarea cierra con `no_alternatives`. En deliberativo lo reemplaza el tope de replans.
- En deliberativo, si un fallo de paso exige replan y ya hubo 2, o el replan sigue inválido tras repetir la generación, la tarea cierra con `replans_exhausted`.
- Solo un `denied` de la política del Guard cierra la tarea con `security_denied`, en ambos modos. Uno del servidor de la herramienta deja el paso `failed` y la recuperación del modo sigue su curso (escalación o replan).
- `unrecoverable` significa que falla la infraestructura, no la tarea: la tarea cierra sin intentar recuperarse (con un modelo caído, Jarvis no puede operar). Lo dispara: (1) `service_unavailable`: se registra el `error` y se cierra; (2) un fallo anterior a que existan pasos (planificador caído, o plan inicial inválido), sin `error`; (3) un `forPlan` que no entra en el límite del modelo (sección 9). Los fallos de una herramienta (`tool_error`, `exception`) son del paso y no lo disparan. El paso en curso queda como estaba.
- Estado terminal congelado: después de él, `apply` rechaza todo salvo escribir `result` una sola vez (mientras sea `null`). `result` solo se escribe con la tarea ya en estado terminal, en un `apply` posterior al `finish`. Los eventos tardíos (por ejemplo, la respuesta de una herramienta tras cancelar) los descarta quien ejecuta consultando `isClosed()`.

**Estado terminal por motivo de detención**

| `stopReason` | Estado terminal |
|---|---|
| `max_steps`, `loop_blocked`, `replans_exhausted`, `no_alternatives`, `unrecoverable` | `partial` si hay efectos o una llamada aprobada con `status = ok`; si no, `failed` |
| `security_denied` | `failed` |
| `user_cancelled` | `cancelled` |

`partial` significa que quedó algo logrado. `completed` no lleva motivo; en reactivo lo fija el cierre con `fin` (5.4).

**Transiciones de `step.state`**

| Desde | Hasta | Cuándo |
|---|---|---|
| (nace) | `pending` | el paso trae `planId` |
| (nace) | `running` | el paso no trae `planId` (reactivo) |
| `pending` | `running` | el ejecutor empieza el paso |
| `running` | `completed` | llamada `approved`; en reactivo, también `fin` |
| `running` | `failed` | reintentos o tope de llamadas agotados; `denied` del servidor; en deliberativo, también anti-loop o `user_rejected` |

`completed` y `failed` son finales. Un `pending` que ya no sirve se marca `superseded`, no `failed`. Invariantes, comprobados al final del lote:

1. `superseded` solo pasa de `false` a `true`, y nunca en un paso `completed`.
2. Hay como máximo un paso vigente `running`.
3. `finish` con `completed`: en deliberativo, el cierre del plan da `completed`; en reactivo, `canFinish()` da `completed` (ambos en 5.4).

### 5.4 Se deriva, no se guarda

| Dato | Se calcula desde |
|---|---|
| Efectos | `calls` con `kind = write` y `status = ok` (cualquier veredicto), sin tope |
| Posibles efectos | `calls` con `kind = write` y `status` `tool_error`, `exception` o `interrupted`: pudieron dejar cambios parciales. No cuentan como efecto para el anti-loop ni el cierre, pero `forPlan`, `forFinal` y `forFallback` los muestran aparte |
| Fallos de llamada recientes | `calls` con `status` distinto de `ok` (incluye `no_data` y `not_found`) o con `verdict = rejected` |
| Evidencia | `summary`, `verdict` y `reason` de cada llamada |
| Llamada repetida (anti-loop) | herramienta y `sig` entre las llamadas ejecutadas, salvo que quien ejecuta indique que la herramienta está exenta (`isRepeat` lo recibe como argumento, sección 8). Lectura idéntica: se bloquea, salvo un único reintento tras un fallo transitorio (`tool_error`, `exception`, `interrupted`) o que haya una escritura `ok` intermedia. Escritura idéntica: se bloquea salvo que haya una lectura intermedia; esto vale también si la anterior falló, porque pudo dejar cambios parciales. Un hecho `answer_*` escrito después de una llamada cuenta como intermedio en ambos casos. Un `denied` del servidor cuenta como ejecutada: una repetición idéntica se bloquea (no es un fallo transitorio) |
| Cierre con `fin` (modo reactivo) | `canFinish()`: `null` (no se ofrece `fin`), `completed` o `no_alternatives` (el cierre que corresponde a elegirlo). `completed` si `calls` está vacío o existe una llamada `approved`; si no, `no_alternatives` si existe una llamada `user_rejected`; si no, `null`. El paso cerrado con `fin` queda `completed` aunque la tarea cierre con `no_alternatives` |
| Existe llamada aprobada | `calls` con `verdict = approved`, de cualquier `status`: un `no_data` aprobado habilita `fin`, pero para `partial` solo cuenta `status = ok` |
| Cierre del plan (modo deliberativo) | pasos vigentes (sin `superseded`): al menos uno, ninguno `failed` (un `failed` vigente dispara replan) y todos `completed` → `completed` |
| Paso actual y última ejecución | `ctx.current()` devuelve `{ step, lastCall }`: `step` es el paso vigente `running` o, si no hay, el primer vigente `pending`; `lastCall` es el último elemento de `calls` |
| Última llamada y últimas lecturas con datos | `calls` (`kind = read`, `status = ok`) |
| Intentos previos por ruta o herramienta | `calls` |
| Fallos del paso actual | `calls` del paso con fallo (misma regla que los fallos recientes) |
| Reintentos de un paso (argumentos, resultado) | conteo de `calls` del paso con `status = args_invalid` o `verdict = rejected` (provisorio) |
| Llamadas de un paso (tope) | conteo de `calls` del paso, sin `user_rejected` (provisorio) |
| Replans realizados | `plans` con `trigger = step_failure` |
| Escalaciones | conteo de pasos `failed`, incluidos los `superseded` |
| Handoff (resultado del paso anterior que se entrega al actual) | el paso vigente inmediato anterior, solo si está `completed`: `summary` de su llamada (provisorio) |
| Valores anteriores, orden entre secciones, duraciones | no se guardan en el contexto; los eventos `change` permiten reconstruirlos fuera de él (sección 7) |

## 6. Escritura: `ctx.apply`

Toda escritura pasa por una sola función. No hay atajos de escritura: si resulta verboso, quien ejecuta arma sus propios helpers.

```ts
ctx.apply(ops, meta?)   // ops: una operación o un arreglo; devuelve { n, ids }
```

| `op` | Qué hace | Aplica a |
|---|---|---|
| `add` | Crea un elemento; asigna `id` (prefijo de sección y conteo de la sección más 1) y `at` | `plans`, `steps`, `calls`, `errors`, `refs` |
| `update` | Cambia campos mutables de un elemento por `id` | `steps`, `calls` |
| `set` | Escribe un valor en un campo único | `facts.<clave>`, `result` |
| `finish` | Cierra la tarea: estado terminal + motivo, validados contra la tabla de 5.3 | `task` |

**Valores por defecto.** `add` completa `id`, `at`, `verdict = null`, `reason = null`, `superseded = false` y el `state` inicial cuando el elemento lo tiene (en `steps`: `pending` si trae `planId`, `running` si no). Quien ejecuta no los escribe. `ref` en cambio lo informa quien ejecuta (`null` si el resumen está completo): como un lote no puede usar ids que él mismo crea, primero se agrega la `ref` y después la llamada, en dos `apply`. Igual con `planId`: primero el plan y después sus pasos.

**Campos mutables** (cualquier otro cambio se rechaza):

| Destino | Qué puede cambiar |
|---|---|
| `steps` | `state`, `superseded` |
| `calls` | `verdict` y `reason` (se actualizan juntos, una sola vez: mientras `verdict` sea `null`) |
| `plans`, `errors`, `refs` | nada (inmutables) |
| `task` | `state`, solo lo cambia `finish` (a un estado terminal) |
| `facts` | `value` (texto o `null`); `stepId` y `at` se actualizan en cada `set` |
| `result` | una sola vez, solo con la tarea en estado terminal |

**Validación**, en un solo lugar:

1. La tarea está abierta (si es terminal, solo se admite escribir `result`; y `result` solo se escribe con la tarea en estado terminal).
2. La operación está bien formada y el destino existe (sección, `id`, clave).
3. El valor es JSON plano, con los campos y tipos del esquema (sección 5) y los vocabularios de 5.3.
4. El campo es mutable.
5. Las referencias existen (`stepId`, `planId`, `call.ref`).
6. Se cumplen las transiciones e invariantes de 5.3 (se comprueban al final del lote).
7. Se respetan los topes de largo de `summary`, de los strings de `args` (el máximo global `ARGS_MAX`, 5.2) y del valor de un `fact` (sección 9), la profundidad máxima del JSON y el formato de clave de `facts`.

**Atomicidad.** Un arreglo de operaciones se aplica completo o no se aplica: ante cualquier error lanza una excepción, no cambia nada y no emite evento. Un lote no puede usar ids que él mismo crea; si hace falta, se aplica en dos pasos con los `ids` que devuelve el primero. Sirve, por ejemplo, para que un replan deje `superseded` todos los pasos que reemplaza a la vez:

```ts
ctx.apply([
  { op: "update", target: "s3", value: { superseded: true } },
  { op: "update", target: "s4", value: { superseded: true } },
]);
```

**Evento.** Cada `apply` exitoso incrementa `n` (contador interno de `apply`) y emite un único evento `change` con `{ n, at, ops, meta }`, donde `ops` son las operaciones ya normalizadas (con el `id` y el `at` asignados). Los suscriptores (`ctx.on("change", fn)`) son de solo lectura: no pueden llamar a `apply` dentro del manejador y, si fallan, el cambio no se revierte. `meta` es opcional, opaco para el contexto y categórico (sin prosa).

**Lectura.** `ctx.get(id)` devuelve un elemento por `id` (`ctx.get("facts.clave")` para un hecho). `ctx.find(sección, where)` devuelve los elementos de una sección que cumplen la igualdad de campos de `where`, incluidos los reemplazados por un replan. `ctx.current()` devuelve `{ step, lastCall }` (5.4). Cualquier consulta más rica es una vista derivada.

**Resto de la API** (nombres tentativos): `create.context({ request, mode, ... })` crea el contexto y recibe, además de la solicitud y el modo, el `id` de la tarea, un reloj inyectable y los topes numéricos que `apply` valida (`summary`, strings de `args` (`ARGS_MAX`), valor de un `fact` y profundidad del JSON); quien lo usa se los pasa ya resueltos (principio 5) y los nombres exactos son tentativos; `ctx.view.<vista>(...)` arma una vista (sección 8); `ctx.snapshot()` guarda y `create.fromSnapshot(snapshot)` carga (sección 4); no hay un `load` sobre un contexto existente, porque todo cambio entra por `apply`; `ctx.n` es la versión actual: un contador interno de `apply`, fuera del JSON y no se persiste (la traza guarda cada `change` con su `n`).

## 7. Traza

La traza sirve para evaluación y depuración. Queda **fuera del contexto**: la dependencia va en un solo sentido (la traza conoce el contexto, no al revés) y el contexto solo emite eventos `change` (sección 6). Su diseño se cierra al final (sección 10).

- Guarda la entrada y salida crudas de los modelos y su texto libre, identificadas con el `stepId` y su orden dentro del paso, y con el `n` con el que se armó la vista que recibió el modelo. Se enlazan con el `id` de la llamada cuando esta se registra (la llamada se registra al terminar el intento, así que las consultas previas no tienen `id` aún). El plan y la respuesta final se identifican con el `id` del plan y con `result`.
- Recibe el snapshot al terminar la tarea (sección 4); los resultados completos se toman de los archivos de las `refs`, no del snapshot.
- Quien ejecuta reporta a la traza, por llamada, el intervalo de ejecución y el resultado crudo (este último solo si no hay ref; con ref, la traza guarda la referencia). Estos datos no viajan por `meta` ni se guardan en el contexto.
- Puede suscribirse a `change` para registrar cada cambio con su `n`; es opcional. Ninguna bandera propia de la traza vive en el contexto.

## 8. Vistas por consumidor

Una vista es una función de solo lectura y determinista (mismo contexto, mismo resultado) que arma lo que necesita un consumidor. Nombres y contenido tentativos.

| Vista | Consumidor | Incluye |
|---|---|---|
| `forPlan` | Planificador y replan | solicitud, ventana de pasos (ya ejecutados, actual, siguientes), todos los efectos sin recorte y los posibles efectos, hechos, fallos recientes, `feedback` de los planes anteriores |
| `forRoute` | Decisiones de ruta y herramienta | paso actual y criterio, intentos recientes por ruta y herramienta (cuáles fallaron), fallos recientes, hechos |
| `forArgs` | Generación de argumentos | instrucción del paso con handoff (5.4; en reactivo, la solicitud y el historial), últimas lecturas con datos, refs disponibles, efectos, hechos, fallos del paso actual |
| `forVerify` | Verificación del paso | paso, criterio de éxito, llamada evaluada (resumen y ref), efectos del paso |
| `forFinal` | Respuesta final redactada por el modelo | solicitud, estado y motivo de detención de la tarea, estado de cada paso, evidencia, efectos y posibles efectos, hechos |
| `forFallback` | Respuesta final de respaldo, sin modelo (también la usada en `cancelled`) | estado, motivo de detención, fallos, efectos y posibles efectos, hechos, últimas acciones |

Las vistas muestran la ref de una llamada como `ref:rN (tamaño, ruta)`, armada a partir de `call.ref` y `refs` (la ruta es `where`, para que el modelo sepa qué `path` leer): el `summary` no contiene claves de ref (5.2).

Los fallos de una llamada rechazada (`args_invalid`, `tool_rejected`, `info_missing`) muestran lo que se quiso ejecutar (herramienta y `args`) y una frase predefinida según el `status`, que aclara el escenario; la frase no se guarda en el contexto. Igual con `reason`: una llamada con `verdict = rejected` muestra un mensaje fijo según su `reason`, que arman las vistas y no se guarda.

`forArgs` es deliberadamente liviana: deja fuera el registro cronológico y la ventana del plan, pero incluye los fallos del paso actual para no regenerar el mismo error de argumentos (el anti-loop bloquearía una repetición idéntica).

Además, consultas para el control de ejecución (`canFinish()` devuelve el cierre posible o `null`; las demás, sí o no): `isRepeat(tool, sig, { exempt })`, `canFinish()` (solo reactivo), `hasApprovedCall()` e `isClosed()`. El contexto no conoce herramientas (principio 5): quien ejecuta resuelve la exención con el catálogo (`loopExempt`) y la pasa como argumento; con `exempt = true`, `isRepeat` devuelve `false` sin comparar.

## 9. Presupuesto y crecimiento

- **Un solo lugar** define el presupuesto: una tabla consumidor → máximo de caracteres y de elementos por sección.
- Al recortar, la prioridad es: paso actual y criterio, solicitud, último resultado relevante, fallos recientes, hechos, historial anterior.
- Los **efectos nunca se recortan** en `forPlan`: el replan los recibe todos, uno por línea. Si aun así exceden el límite del modelo, la vista falla en voz alta (no recorta en silencio) y la tarea termina con `unrecoverable`.
- El tamaño de las ventanas recientes (llamadas e intentos recientes, fallos recientes) sube con las escalaciones (5.4): con 0, 1 y 2 o más escalaciones (`min(escalaciones, 2)`, en ambos modos) las vistas muestran los últimos 2, 5 y 10 elementos de cada lista. La ventana de pasos de `forPlan` no depende de esto.
- `summary` tiene tope de 2500 caracteres.
- **Quién recorta.** Quien ejecuta, por longitud y antes de escribir; el resto de un resultado va a `refs`. `apply` nunca recorta: rechaza los excesos de `summary`, de los strings de `args` (contra `ARGS_MAX`) y del valor de un `fact`. Ni quien ejecuta ni `apply` sanean el texto: el saneado lo hacen las vistas al renderizar (5.2).
- Las vistas leen solo ventanas recientes; los pasos reemplazados por un replan se conservan marcados.
- En `args` se recortan solo los strings (tentativo: 300 caracteres por defecto, con excepciones por parámetro declaradas en el catálogo: `argCaps`, 5.2) con un marcador `…(+N)`, donde N es la cantidad de caracteres omitidos, para que el modelo no tome un valor cortado por el real. Si el modelo necesita más, lee un trozo del archivo de la ref (`where`) con una lectura normal, con el mismo tope que `summary`. La vista indica qué parte de la ref ya se mostró, derivándolo de los `args` de esas lecturas (desplazamiento y límite).
- `facts` **no tiene tope de cantidad**: se conservan todos los hechos de cada paso. El crecimiento lo limita el máximo de pasos, controlado por el anti-loop. Las vistas recortan por la prioridad de arriba. El largo por valor está limitado (tentativo: 500 caracteres), con el mismo marcador.

## 10. Por definir

### 10.1 Decisiones que afectan el esquema y las reglas

- **Reintentos y anti-loop.** Cuando lo demás esté cerrado: qué consume cada rechazo (`args_invalid`, `tool_rejected`, `info_missing`, `verdict = rejected`), cuántos reintentos hay y precisar el "único reintento" del anti-loop (¿por herramienta y `sig`, o por paso?). Incluye ajustar con tareas reales el tope de llamadas por paso (8), definir qué pasa con las lecturas repetidas sin escritura de por medio (por ejemplo, consultar el estado de un proceso en segundo plano, que el anti-loop bloquea) y unificar `loop_blocked` en ambos modos (hoy en reactivo 2 seguidos cierran la tarea, 5.3): el paso queda `failed` y la recuperación del modo se encarga; de aceptarse, evaluar eliminar `stopReason = loop_blocked`, porque la causa ya queda en el `status` de las llamadas. Pregunta abierta: en deliberativo, ¿un `user_rejected` debe consumir replans? Hoy sí: deja el paso `failed` y el replan comparte `trigger = step_failure`, que es lo que cuenta el tope de 2.
- **Razones de rechazo del verificador.** Los valores iniciales son dos (`no_usable_data`, `not_accomplished`; 5.3), derivados de las dos preguntas de verificación actuales. La lista definitiva y su criterio de prioridad salen de la evaluación de prompts.
- **Handoff.** Se mantiene solo si hace falta: `forArgs` ya incluye las últimas lecturas con datos, que lo cubren en parte. Si se mantiene, definir qué llamada usar cuando el paso anterior tuvo varias.
- **Topes y recortes.** Valores numéricos del presupuesto: topes por vista, topes de recorte (valores de `facts`: 500; strings de `args`: 300 por defecto, con las excepciones de `argCaps`; todos tentativos) y tamaños de las ventanas recientes, más el tope de `plans.feedback`. Propuesta: medir primero con tareas reales y fijarlos con el tokenizador de cada modelo; el ajuste por escalaciones va al final. Además: decidir si los efectos se recortan en `forFinal` y `forFallback` (5.4 dice "sin tope"; la sección 9 solo lo explicita para `forPlan`), y cómo se leen los resultados largos por trozos: cada trozo es una llamada y, por tanto, un paso, así que en reactivo (tope 15) un documento grande no alcanza. Opciones: lectura dirigida (buscar dentro del archivo), un tope aparte para estas lecturas o aceptar el límite; se mide con tareas reales.

### 10.2 Ideas y temas por pensar

- **Traza.** Se define al final. Incluye una idea fuera de alcance: un log de cambios simple y separado de la traza, de solo agregado, que el modelo pueda consultar (por ejemplo, qué valía un hecho antes). No requiere cambios en el contexto, porque `apply` ya emite eventos con `n` consecutivo y operaciones normalizadas. Se retoma solo si aparece un caso de uso concreto.
- **Arquitectura del motor.** ¿Un solo bucle, con el plan y el replan como una capa que provee los pasos? El contexto ya lo admite (el paso es el mismo objeto en ambos modos). Los modos difieren en quién provee el paso y cómo se recupera un fallo (escalación o replan); `loop_blocked` y `user_rejected` son los candidatos a unificar. El reactivo no crea entradas en `plans`. Punto a resolver: el verificador debería aceptar pasos sin criterio de éxito explícito (`expected = null`).
- **Hechos fijados por el modelo.** Si se aceptan, se agrega una referencia (`facts.ref`, para hechos de valor largo) y se revisa el vocabulario cerrado de claves.
- **Archivo y URL en uso.** Hoy se derivan de `args` y no se guardan (5.2); reincorporarlos como hechos si las pruebas muestran que el modelo los pierde.
- **Vistas pendientes.** La revisión de argumentos y la generación de la pregunta de `ask_user` no tienen vista en la sección 8. No requieren datos nuevos: se derivan de `forRoute` y `forArgs` y se definen al implementar.
- **Recuperación ante servicio caído.** Hoy un modelo caído o la ausencia de herramientas cierra la tarea con `unrecoverable`. A futuro, el caso "sin herramientas para la ruta elegida" podría probar otra ruta o replanificar; requeriría que las vistas muestren los `errors`.
- **Almacenamiento alternativo.** SQLite detrás de la misma API, solo si hace falta consultar entre tareas (sumaría una dependencia nativa y una escritura por cada cambio).
- **Borrado de refs.** Hoy las refs no se borran nunca (sección 4). Idea: borrarlas al terminar la tarea, cuando la auditoría ya no las necesite.
- **Memoria entre tareas.** Fuera de alcance. El snapshot es la unidad que otro almacén podría ingerir a futuro.

## 11. Notas sobre la implementación actual

Esta sección no es parte del diseño: reúne observaciones sobre el código existente que pueden servir al implementar. El resto del documento no depende de ella.

- **Búsqueda activa.** La implementación actual distingue si hay una búsqueda activa: existe una llamada exitosa que inició una búsqueda, y lo resuelve quien conoce las herramientas consultando `calls`. Ninguna vista del diseño lo usa; se retoma solo si hace falta.
- **Rechazo del usuario.** Hoy un rechazo de mutación se trata como una denegación del Guard y termina la tarea.
- **`denied` del servidor.** Hoy una denegación detectada en el resultado de la herramienta (`[DENIED]` o "access denied") activa la misma señal que la del Guard y cierra la tarea en ambos modos; el diseño la separa (5.3).
- **Segundo juez y verificación no disponible.** Hoy, en modo PLAN, si el modelo de decisión no aprueba un paso, un segundo modelo (Qwen) lo juzga; y si ninguno de los dos está disponible, el paso queda `UNVERIFIED` y la tarea continúa. El diseño elimina ambas cosas: decide solo el modelo de decisión y un verificador caído que persiste cierra la tarea con `unrecoverable` (5.3).
- **Preguntas al usuario.** Hoy `ask_user` solo existe en modo PLAN, lo dispara el segundo juez (`insufficient_info`) y el tope es de 2 preguntas por paso (`MAX_USER_QUESTIONS_PER_STEP`). El diseño lo ofrece en ambos modos, con tope de una.
- **Plan en espera de confirmación.** Hoy la modificación del plan solo actúa mientras espera confirmación y reemplaza todos los pasos sin dejar versión (los ids reinician), y el rechazo cancela la tarea. El diseño registra la modificación como un plan nuevo `user_feedback` (5.3).
- **Máximo de pasos.** Hoy solo se aplica en reactivo; en deliberativo lo acotan el tamaño del plan y los replans.
- **Instrucción del paso en reactivo.** Hoy es la solicitud completa de la tarea.
- **Verificación.** Hoy el verificador juzga una llamada antes de que se registre, así que no ve su efecto en el log ni en los hechos.
- **Observaciones recientes.** Hoy se guardan antes de verificar: una lectura luego rechazada sigue entre ellas.
- **Estado hacia la UI.** Hoy el estado completo viaja por SSE en cada evento y es contrato con la UI; el diseño asume refactorizar esos consumidores.
- **Cancelación.** Hoy no interrumpe una llamada en curso a un servidor externo: sigue hasta su tiempo máximo y puede terminar de escribir (de ahí `interrupted` y los posibles efectos).