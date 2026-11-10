# JARVIS API — lo que necesita saber la UI

Base: `/api/jarvis`. Solo local (Host y Origin `localhost`, `127.0.0.1` o `[::1]`). JSON en ambos sentidos. Los errores son siempre `{ "error": string }`: **400** entrada inválida, **404** tarea inexistente, **409** la tarea no espera eso.

## Modelo

Una **tarea** es un contexto único: todo el estado sale de un solo objeto (`TaskDto`, abajo). No hay `Task` con `memory` ni iteraciones de modelo: la UI se arma desde `steps`, `calls`, `facts`, `refs` y `result`.

- **Modo** (`mode`): `reactive` (por defecto; elige herramientas paso a paso) o `deliberative` (planifica, pide confirmar el plan y lo ejecuta).
- **Estado** (`task.state`): `running` → termina en `completed`, `partial` (quedó algo logrado), `failed` o `cancelled`. Un estado terminal no cambia.
- **Motivo** (`task.stopReason`, solo si no es `completed`): `max_steps`, `no_alternatives`, `security_denied`, `user_cancelled`, `replans_exhausted`, `unrecoverable` (falló un modelo o el catálogo de herramientas, no la tarea).
- **Respuesta final** (`result`): `null` hasta que exista; se escribe **después** de pasar a estado terminal. `result.origin` es `model` o `fallback` (texto fijo en español, sin modelo; siempre en `cancelled`).

## Endpoints

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `POST /process` | `{ message, mode? }` | Crea y lanza la tarea. Responde `{ task: TaskDto }` |
| `POST /cancel` | `{ taskId? }` | Cancela. Sin `taskId`, la última abierta. Idempotente |
| `POST /confirm-plan` | `{ taskId, waitId }` | Acepta el plan que espera confirmación |
| `POST /modify-plan` | `{ taskId, feedback, waitId }` | Pide un plan nuevo con la instrucción (sin tope de veces); vuelve a pedir confirmación |
| `POST /reject-plan` | `{ taskId, waitId }` | Rechaza sin instrucción: la tarea se cancela |
| `POST /approve` | `{ taskId, waitId }` | Acepta la operación sensible pendiente |
| `POST /deny` | `{ taskId, reason?, waitId }` | Rechaza la operación; `reason` (opcional) llega al modelo como instrucción. La tarea no termina |
| `POST /user-answer` | `{ taskId?, answer }` | Responde la pregunta abierta (no vacía) |
| `GET /state?taskId=` | | `{ task: TaskDto \| null, tasks: TaskSummary[], discoveredTools, unavailableServers }`. Sin `taskId`, la última |
| `GET /events` | | SSE, ver abajo |
| `GET /tasks/:taskId/refs/:refId` | | Texto completo de una ref de la tarea (`calls[].ref`, `refs[].id`), `text/plain`. 404 si la tarea o la ref no existen o el archivo ya no está |
| `GET /tasks/:taskId/trace?format=` | | Traza de una tarea **terminada**: `summary` (Markdown, por defecto; alertas, línea de tiempo con las decisiones D1 a D4, esperas y respuesta final) o `json` (snapshot, consultas a modelos con sus opciones, herramientas y duraciones). 400 si `format` es otro; 404 si la tarea sigue en curso, la traza está desactivada (`traceEnabled`) o no existe |
| `GET /environment` | | Datos de esta PC: `platform`, `home`, `desktop`, `documents`, `downloads` (los que se pudieron consultar), más `now` (ISO) y `timeZone` |
| `GET /limits` | | Topes del motor: `maxSteps`, `maxReplans`, `maxEscalations`, `maxItemFailures`, `maxCallsPerStep`, `maxRepeatsPerStep`, `maxReviewRejectionsPerStep`, `maxUserRejectionsPerStep`, `maxQuestionsPerStep`: para mostrar progreso (paso 3 de 20, llamada 2 de 6) |
| `GET/POST /config`, `ALL /refresh-discovery` | | `/config` devuelve y acepta la configuración completa; `POST` fusiona las claves que se envían y descarta las inválidas; ignora `refsDir` y `tracePath` (dónde escribe y borra Jarvis) y `command`, `args`, `env` y `cwd` de los servidores MCP (definen qué proceso se lanza: se editan en `jarvis-config.json` y se reinicia). Claves de seguridad: `autoMode` (boolean) y `blacklist` (ver abajo) |

Las decisiones (`/approve`, `/deny`, `/confirm-plan`, `/modify-plan`, `/reject-plan`) **exigen `taskId` y `waitId`** (si faltan, 400): sin ellos se aplicarían a la última tarea y un cliente aprobaría a ciegas lo que no vio. `waitId` es el `request.id` de la espera actual: si no coincide (respuesta tardía), responde 409. `/cancel` y `/user-answer` conservan el atajo (toman la última tarea si no se envía `taskId`).

## TaskDto

```jsonc
{
  "v": 1,
  "n": 42,                                   // versión del contexto
  "task":   { "id", "mode", "request", "state", "stopReason", "startedAt" },
  "plans":  [{ "id", "at", "trigger": "initial|user_feedback|step_failure", "feedback", "stepId" }],
  "steps":  [{ "id", "at", "planId", "instruction", "route", "expected",
               "state": "pending|running|completed|failed", "superseded": false }],
  "calls":  [{ "id", "stepId", "at", "route", "tool", "kind": "read|write", "args", "sig",
               "status", "verdict": "approved|rejected|null", "reason", "summary", "ref" }],
  "errors": [{ "id", "stepId", "at", "kind": "service_unavailable" }],
  "facts":  { "<clave>": { "value", "stepId", "at" } },
  "refs":   [{ "id", "stepId", "at", "label", "size", "where" }],
  "result": { "text", "origin": "model|fallback" } | null,
  "waiting": Waiting | null
}
```

- **Reactivo:** `plans` está vacío y los pasos traen `planId`, `route` y `expected` en `null`; `instruction` es el primer ítem de la lista de pendientes, que mantiene el código (el modelo la genera al empezar, tras un fallo y al vaciarse); la lista completa no se expone. Lo que se hizo se lee de `calls`. Cada iteración del bucle es un paso.
- **Deliberativo:** un replan o una modificación del usuario marca `superseded: true` los pasos que reemplaza: se muestran como descartados, no como fallidos. Los vigentes son los que no están `superseded`.
- **`calls[].status`:** ejecutadas `ok`, `no_data`, `not_found`, `tool_error`, `exception`, `interrupted`, `denied` (la rechazó el servidor de la herramienta); no ejecutadas `args_invalid` (el pre-chequeo o la revisión rechazaron los argumentos), `refs_unresolved`, `loop_blocked` (la misma llamada ya se había hecho), `user_rejected`, `tool_rejected` (la herramienta o el comando está en la lista negra de la configuración), `info_missing`, `denied` (la rechazó la política de seguridad: la tarea termina con `security_denied`). `verdict` es lo que dijo la verificación del resultado (`null` si no se verificó). `reason`: `no_usable_data` o `not_accomplished`.
- **Escrituras:** `kind: "write"` con `status: "ok"` son cambios hechos en la PC; con `tool_error`, `exception` o `interrupted` pudieron dejar cambios parciales.
- **`summary`:** resultado ya resumido (máx. 2500 caracteres, con marcadores `…(+N)` si se recortó). Si `ref` no es `null`, el resultado completo está en el archivo de esa ref (`refs[].where`, ruta absoluta en la PC; `size` en caracteres).
- **`facts`:** `process` (id del proceso en segundo plano activo; `value: null` = ya no hay) y `answer_<stepId>_<n>` (`"pregunta -> respuesta"`).
- `args` van como los propuso el modelo, con los strings recortados; `{{ref:rN}}` es una referencia a un resultado guardado.

## Modo automático y lista negra (`/config`)

- `autoMode` (`false` por defecto): con `true`, las escrituras y comandos del catálogo **no generan espera `approval`**; las valida la revisión de argumentos y se ejecutan. Guard (patrones destructivos y nivel `guard` de las reglas de comando, carpetas protegidas → `security_denied`) y la lista negra siguen actuando: las reglas integradas (`commandRules.ts`) rechazan con `tool_rejected` lo muy destructivo (`blocked`) y mandan lo `sensitive` a la revisión de argumentos con umbral estricto (ver `CORE_FLOW.md`, «Modo automático»). Con `autoMode` en `false`, toda coincidencia con la lista pide aprobación (`approval`) con el motivo de la regla. Las **rutas sensibles** (`policy/sensitivePaths.ts`: claves y credenciales, datos de navegadores, variables de entorno con secretos, y para escribir, lugares de inicio automático, perfiles de shell, carpetas del sistema y `jarvis-config.json`) piden aprobación **también con `autoMode`**. Se lee en cada llamada: cambiarlo no libera una espera `approval` que ya esté abierta (hay que aprobarla o rechazarla).
- `blacklist`: entradas **propias** que se suman a las reglas de comando integradas (que no se configuran): `[{ "tool": "start_process" | "servidor:herramienta", "pattern"?: "regex sobre los argumentos", "reason": "texto para el modelo", "level"?: "blocked" | "sensitive" }]` (sin `level`, `blocked`). Solo afecta a herramientas que modifican el sistema; un acierto registra la llamada como `tool_rejected` (la tarea sigue). Sin `pattern` la herramienta entera deja de ofrecerse. `POST` reemplaza la lista completa.

## Esperas (`waiting`)

La tarea queda detenida hasta que el usuario responde; solo hay una espera a la vez. `waiting` es `null` si no espera nada.

```jsonc
{ "kind": "plan",     "request": { "id", "planId", "steps": [{ "id", "instruction", "route", "expected" }] } }   // → /confirm-plan, /modify-plan, /reject-plan
{ "kind": "approval", "request": { "id", "mcp", "tool", "capability", "reason", "args" } }                    // → /approve, /deny
{ "kind": "question", "question": { "stepId", "question" } }                                                  // → /user-answer
```

- La aprobación se pide después de que el pre-chequeo aceptó los argumentos, y no se pide con `autoMode`. Si el usuario aprueba, no hay otra revisión de argumentos.
- El plan se confirma tras el plan inicial y tras cada plan generado por una modificación del usuario; nunca tras un replan automático.
- `args` de `approval` son los registrados (recortados); un contenido grande aparece como `{{ref:rN}}`.
- Cancelar resuelve cualquier espera y la tarea cierra con `cancelled` / `user_cancelled`.

## Eventos (SSE `GET /events`)

Un mensaje `data: <json>` por evento, más un comentario `: ping` cada 15 s.

```jsonc
{ "type": "created", "taskId", "n" }
{ "type": "change",  "taskId", "n", "at", "ops": [{ "op": "add|update|set|finish", "target", "value" }] }
{ "type": "waiting", "taskId", "waiting": Waiting | null }
```

- `change`: un evento por cada escritura en el contexto, con `n` consecutivo. `ops` ya trae los elementos creados (con `id` y `at`): `add` (`target` = sección), `update` (`target` = id del paso o la llamada, `value` = campos cambiados), `set` (`target` = `facts.<clave>` o `result`) y `finish` (`value` = `{ state, stopReason }`).
- Forma simple y segura de consumirlo: al recibir `change` o `waiting`, pedir `GET /state?taskId=` (con debounce). Si se aplican las `ops` directamente y `n` salta (no es el anterior + 1), hay que releer el estado.
- Al conectar no se reenvía historia: leer primero `/state`.

## Qué mostrar y cómo

- **Progreso:** `steps` (deliberativo: plan con estado por paso) y `calls` (qué herramienta se llamó, con qué `args` y qué devolvió).
- **Fin de la tarea:** `task.state` se vuelve terminal antes que `result`: mostrar el estado y esperar `result` (llega en el evento `set result`). `result.text` es el mensaje al usuario; con la tarea `partial` o `failed` y `origin: "model"` empieza con un encabezado fijo (estado, qué no se logró y cambios hechos en la PC) escrito por el código: no hace falta repetirlo en la UI; con `origin: "fallback"` es un resumen fijo de lo hecho y de los cambios que quedaron en la PC.
- **`partial` o `failed`:** mostrar `stopReason` y, de `calls`, los cambios que permanecen (escrituras `ok`) y los posibles (escrituras `tool_error`, `exception` o `interrupted`).
- **Proceso en segundo plano:** si `facts.process.value` no es `null`, la tarea terminó dejando uno corriendo.
- **Tareas retenidas:** hasta 20 en memoria; las terminales más antiguas se descartan (la lista `tasks` es la vigente).
