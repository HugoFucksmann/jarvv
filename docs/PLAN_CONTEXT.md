# Contexto de JARVIS: idea de diseño

> Estado: borrador v0.6. Sin referencias al código actual. Lo que falta definir está en la sección 10.

## 1. Problema

La información de una tarea vive repartida en varios sitios: una parte en la tarea, otra en el contexto de ejecución y otra en claves sueltas cuyo propósito no es claro. Esas claves acumulan datos y es difícil quitar o corregir algo específico. Para saber qué pasarle al modelo en cada paso hay que recorrer todo.

## 2. Objetivo

Un único contexto por tarea que:

- esté **centralizado** y no cree dependencias excesivas entre archivos;
- **separe la información por tipo**;
- sea **fácil de construir y de consultar**, para saber rápido qué pasarle al modelo en cada paso;
- permita **agregar, buscar, editar y quitar** un elemento específico sin tocar el resto;
- sea **rápido, eficiente y escalable**.

## 3. Principios

1. **Simplicidad primero.** Ante la duda, la opción más simple.
2. **Una sola fuente de verdad.** Cada dato se guarda una vez; lo demás se deriva.
3. **Se guardan hechos, se derivan vistas.** Lo que se puede calcular desde otra sección no se guarda.
4. **Los datos grandes viven fuera del contexto.** El contexto guarda solo una referencia y un resumen corto.
5. **Todo es JSON plano.** Lo que no se puede serializar (por ejemplo, la señal de cancelación) queda fuera del contexto.
6. **Todo elemento tiene `id`, paso de origen y marca de tiempo.**
7. **El texto libre de los modelos no entra al contexto**, salvo el que es salida para el usuario (respuesta final, pregunta). Los veredictos son categorías, no prosa.
8. **El contexto no conoce a nadie.** No depende de las herramientas, los modelos ni la traza. Quien lo usa le pasa los datos ya resueltos.

## 4. Almacenamiento

- Durante la tarea, el contexto vive **en memoria** como un objeto JSON plano.
- Para persistir, se guarda una **copia (snapshot) en JSON**; con ella se puede reanudar o auditar.
- **SQLite** queda como respaldo opcional a futuro, detrás de la misma API, solo si hace falta consultar entre tareas.

Por qué: el contexto se lee muchas veces por paso y en memoria esa lectura es la más rápida. Como los datos grandes quedan fuera, el objeto crece con la cantidad de pasos y llamadas, no con el tamaño de los resultados. SQLite sumaría una dependencia nativa y una escritura por cada cambio sin beneficio mientras el alcance sea una sola tarea. Un solo escritor por tarea (el ciclo de ejecución), así que no hace falta control de concurrencia.

## 5. Contexto inicial (v0.6)

```ts
{
  v: 1,
  task:    { id, mode, request, state, stopReason, startedAt },
  steps:   [],
  calls:   [],
  errors:  [],
  facts:   {},
  refs:    {},
  control: { pending, override, escalations, replans, seq },
  result:  null
}
```

### 5.1 Campos comunes de los elementos

`id` (prefijo de sección + número creciente, nunca se reutiliza: `s1`, `c4`, `e1`; no se renumera tras un replan), `stepId` (paso de origen) y `at` (marca de tiempo). El orden del arreglo es el orden cronológico.

### 5.2 Secciones

| Sección | Qué guarda | Campos mínimos (además de los comunes) |
|---|---|---|
| `task` | Identidad y estado de la tarea. | `mode` (`reactive` o `deliberative`), `request` (solicitud original), `state`, `stopReason` (`null` mientras no termine), `startedAt` |
| `steps` | Pasos ejecutados o planificados. En modo reactivo se crean al ejecutar. | `instruction`, `route` (ruta asignada por el plan; `null` en reactivo, donde se lee de las llamadas), `expected` (criterio de éxito; `null` en reactivo), `state`, `rev` (0 en el plan inicial; vale `control.replans` al crearse el paso), `superseded` (solo deliberativo: un replan lo reemplazó; no se borra) |
| `calls` | Todo intento de llamada a una herramienta, incluso los que no llegaron a ejecutarse. Un paso puede tener varias. | `route` (destino operativo usado), `tool`, `kind` (`read` o `write`), `args`, `sig`, `status`, `verdict`, `summary` (resultado en corto), `ref` (resultado completo) |
| `errors` | Fallos que no son una llamada. | `kind` (el texto es fijo por tipo) |
| `facts` | Hechos descubiertos; el último valor de cada clave reemplaza al anterior. | clave → `{ value, stepId, at }`; el valor es siempre texto |
| `refs` | Contenidos recuperables que no caben en el contexto. | clave → `{ label, size, where }` |
| `control` | Estado de ejecución serializable. | `pending`, `override`, `escalations`, `replans`, `seq` |
| `result` | Respuesta final al usuario, o `null` hasta que exista. | `text`, `origin` (`model` o `fallback`) |

Notas:

- `kind` se fija al registrar la llamada. Así las vistas distinguen lecturas de escrituras sin consultar el catálogo de herramientas.
- `route` es la categoría de herramientas (por ejemplo, archivos o terminal), no el recurso concreto. El recurso vive dentro de `args`.
- `sig` es la huella de los argumentos ya resueltos. La calcula quien ejecuta, porque los argumentos grandes no viven en el contexto. El anti-loop compara `sig`, nunca los argumentos.
- El proceso en segundo plano activo es un hecho (`process`, con su id como texto). Quien ejecuta lo agrega al lanzarlo y lo quita cuando termina.
- `control.pending` es `null` o `{ kind, stepId o callId, text? }`, con `kind` = `plan`, `mutation` o `question`. El `text` solo existe en las preguntas, que son salida para el usuario.
- `control.override` es la ruta forzada o la herramienta excluida para la siguiente llamada.
- `control.escalations` y `control.replans` son contadores; `control.seq` son los contadores de ids por sección.
- Los datos constantes del proceso (por ejemplo, las rutas base del usuario) no son parte del contexto: quien arma el prompt se los pasa a la vista.

### 5.3 Estados y vocabularios

| Campo | Valores |
|---|---|
| `task.state` | `running`, `awaiting_input`, `completed`, `partial`, `failed`, `cancelled` (terminales: los cuatro últimos) |
| `task.stopReason` | `max_steps`, `loop_blocked`, `unverified_steps`, `no_alternatives`, `security_denied`, `user_rejected`, `replans_exhausted`, `unrecoverable` |
| `step.state` | `pending`, `running`, `completed`, `unverified`, `failed` |
| `call.status` (qué pasó al ejecutar) | `ok`, `no_data`, `not_found`, `tool_error`, `exception`; no ejecutadas: `args_invalid`, `refs_unresolved`, `loop_blocked`, `denied`, `user_rejected` |
| `call.verdict` (qué dijo la verificación) | `approved`, `unverified`, `rejected`, `null` (no verificada o no ejecutada) |
| `error.kind` | `service_unavailable`, `fin_rejected`, `insufficient_info` |

Separar `status` de `verdict` evita mezclar dos preguntas distintas en un solo campo: qué hizo la herramienta y qué decidió la verificación. Una llamada `unverified` no es un fallo: es un estado provisional que impide cerrar la tarea como completada mientras no se observe.

### 5.4 Se deriva, no se guarda

| Dato | Se calcula desde |
|---|---|
| Efectos | `calls` con `kind = write` y `status = ok` (cualquier veredicto), sin tope |
| Fallos de llamada recientes | `calls` con `status` distinto de `ok` o con `verdict = rejected` (`unverified` no cuenta) |
| Evidencia | `summary` y `verdict` de cada llamada |
| Llamada repetida (anti-loop) | herramienta y `sig` entre las llamadas ya ejecutadas; una lectura idéntica se bloquea, y una escritura repetida se bloquea salvo que haya una lectura intermedia |
| Contadores (llamadas totales, bloqueos seguidos) | `calls` |
| Búsqueda activa | `calls`: existe una llamada exitosa que inició una búsqueda (lo resuelve quien conoce las herramientas, consultando `calls`) |
| Llamada sin verificar pendiente (modo reactivo) | existe `calls` con `verdict = unverified` y ninguna lectura exitosa (`kind = read`, `status = ok`) posterior a la última; sirve cualquier lectura, no hace falta que sea sobre el mismo recurso |
| Existe llamada aprobada | `calls` con `verdict = approved` |
| Cierre del plan (modo deliberativo) | pasos vigentes (sin `superseded`): todos `completed` → `completed`; alguno `unverified` → `partial` |
| Preguntas hechas en un paso | `errors` de tipo `insufficient_info` de ese paso |
| Nivel de historial visible | `control.escalations` |
| Última llamada y últimas lecturas con datos | `calls` (`kind = read`, `status = ok`) |
| Intentos previos por ruta o herramienta | `calls` |
| Handoff del paso anterior al actual | el paso inmediato anterior, solo si está `completed`, con el resumen de su llamada y el primer hecho que registró (el de menor `at` entre los `facts` de ese paso) |
| Historial y fallos en texto para los prompts | las vistas (sección 7) |

## 6. Trazas

La traza queda **fuera del contexto** y no agrega código dentro de él.

- La dependencia va en un solo sentido: la traza conoce el contexto, el contexto no conoce la traza.
- **Entrada y salida crudas de los modelos** y su texto libre (razones, explicaciones) van a la traza, identificadas con el `id` del elemento del contexto al que pertenecen (por ejemplo `c4`).
- Al terminar la tarea, el **snapshot del contexto** se adjunta a la traza. Es la parte estructurada de la auditoría (qué pasos, llamadas, errores y hechos hubo). Los resultados completos se toman del almacén de `refs`, no del snapshot.
- Ninguna bandera propia de la traza (por ejemplo, "ya registrada") vive en el contexto.

## 7. Vistas por consumidor

Una vista es una función de solo lectura que arma lo que necesita un consumidor. Es determinista: con el mismo contexto devuelve lo mismo. Nombres y contenido tentativos.

| Vista | Consumidor | Incluye |
|---|---|---|
| `forPlan` | Planificador y replan | solicitud, ventana de pasos (hechos, actual, siguientes), todos los efectos sin recorte, hechos, fallos recientes |
| `forRoute` | Decisiones de ruta y herramienta | paso actual y criterio, intentos recientes por ruta y herramienta (cuáles fallaron), fallos recientes, hechos |
| `forArgs` | Generación de argumentos | instrucción del paso con handoff, últimas lecturas con datos, refs disponibles, efectos, hechos |
| `forVerify` | Verificación del paso | paso, criterio de éxito, llamada evaluada (resumen y ref), efectos del paso |
| `forFinal` | Respuesta final redactada por el modelo | solicitud, estado de cada paso, evidencia, hechos |
| `forFallback` | Respuesta final de respaldo, sin modelo | estado, motivo de detención, fallos, efectos, hechos, últimas acciones |

Además, consultas de sí o no para el control de ejecución: `isRepeat(tool, sig)`, `hasUnresolvedUnverified()` y `hasApprovedCall()`.

## 8. Presupuesto y crecimiento

- **Un solo lugar** define el presupuesto: una tabla consumidor → máximo de caracteres y de elementos por sección. Hoy los topes están repartidos.
- Al recortar, el orden de prioridad es: paso actual y criterio, solicitud, último resultado relevante, fallos recientes, hechos, historial anterior.
- Los **efectos nunca se recortan** en `forPlan`: el replan los recibe todos.
- El nivel de historial que ven las vistas sube con `control.escalations`; los niveles los define la tabla de presupuesto.
- Se mide en caracteres al inicio; se valida con el tokenizador real de cada modelo antes de afinar.
- Durante la tarea **no se borra nada**; las vistas solo leen ventanas recientes. Los pasos reemplazados por un replan se conservan marcados.
- Argumentos o resultados grandes pasan a `refs`; `facts` tiene tope de cantidad y de largo por valor.

## 9. Uso (nombres tentativos)

Como los `id` son únicos en todo el contexto, editar y quitar no necesitan indicar la sección.

```ts
const ctx = create.memory({ request, mode });

ctx.add.call({ /* ... */ });            // atajo de add("calls", ...)
ctx.add.error({ /* ... */ });
ctx.find.errors({ stepId: "s2" });      // atajo de find("errors", ...)
ctx.get("c4");
ctx.update("c4", { verdict: "approved" });
ctx.remove("e1");

ctx.facts.set("archivo", "informe.xlsx", "s2");   // secciones tipo mapa: set, get, remove
ctx.facts.remove("process");
ctx.refs.get("r3");

ctx.view.forArgs("s2");
ctx.snapshot();  ctx.load(snapshot);
```

Reglas de escritura: `add` y `update` validan los campos mínimos y rechazan secciones o `id` inexistentes; los errores de uso fallan en voz alta, no en silencio.

## 10. Por definir

- Forma exacta de cada elemento más allá de los campos mínimos.
- Contenido final de cada vista y su presupuesto. En particular, si `forArgs` replica lo que recibe hoy ese prompt (incluye registro cronológico, fallos, ventana del plan y última observación) o es deliberadamente más liviana.
- Persistencia: hoy una tarea no se reanuda tras un reinicio; decidir si el snapshot se usa solo para auditoría y pruebas, o también para reanudar.
- Tope de `facts` frente a la respuesta completa del usuario, que debe conservarse entera.
- Escrituras posteriores a un estado terminal: ningún evento tardío puede cambiarlo; decidir si el contexto las rechaza.
- Escritura que falla dejando cambios parciales: hoy no cuenta como efecto; decidir si se mantiene.
- Estado terminal que corresponde a `no_alternatives` (`partial` o `failed`).
- Cuándo se quita el hecho del proceso activo: hoy puede quedar un id vencido tras un error de interacción.
- Memoria entre tareas: fuera de v0.6. El snapshot es la unidad que, a futuro, otro almacén podría ingerir.