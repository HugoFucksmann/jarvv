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
| `POST /confirm-plan` | `{ taskId?, waitId? }` | Acepta el plan que espera confirmación |
| `POST /modify-plan` | `{ taskId?, feedback, waitId? }` | Pide un plan nuevo con la instrucción (sin tope de veces); vuelve a pedir confirmación |
| `POST /reject-plan` | `{ taskId?, waitId? }` | Rechaza sin instrucción: la tarea se cancela |
| `POST /approve` | `{ taskId?, waitId? }` | Acepta la operación sensible pendiente |
| `POST /deny` | `{ taskId?, reason?, waitId? }` | Rechaza la operación; `reason` (opcional) llega al modelo como instrucción. La tarea no termina |
| `POST /user-answer` | `{ taskId?, answer }` | Responde la pregunta abierta (no vacía) |
| `GET /state?taskId=` | | `{ task: TaskDto \| null, tasks: TaskSummary[], discoveredTools, unavailableServers }`. Sin `taskId`, la última |
| `GET /events` | | SSE, ver abajo |
| `GET/POST /config`, `ALL /refresh-discovery` | | Sin cambios |

`taskId` es opcional por compatibilidad (toma la última tarea); con varias tareas conviene enviarlo siempre. `waitId` es el `request.id` de la espera actual: si se envía y no coincide (respuesta tardía), responde 409.

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

- **Reactivo:** `plans` está vacío y los pasos traen `planId`, `instruction`, `route` y `expected` en `null`; lo que se hizo se lee de `calls`. Cada iteración del bucle es un paso.
- **Deliberativo:** un replan o una modificación del usuario marca `superseded: true` los pasos que reemplaza: se muestran como descartados, no como fallidos. Los vigentes son los que no están `superseded`.
- **`calls[].status`:** ejecutadas `ok`, `no_data`, `not_found`, `tool_error`, `exception`, `interrupted`, `denied` (la rechazó el servidor de la herramienta); no ejecutadas `args_invalid`, `refs_unresolved`, `loop_blocked`, `user_rejected`, `tool_rejected`, `info_missing`, `denied` (la rechazó la política de seguridad: la tarea termina con `security_denied`). `verdict` es lo que dijo la verificación del resultado (`null` si no se verificó). `reason`: `no_usable_data` o `not_accomplished`.
- **Escrituras:** `kind: "write"` con `status: "ok"` son cambios hechos en la PC; con `tool_error`, `exception` o `interrupted` pudieron dejar cambios parciales.
- **`summary`:** resultado ya resumido (máx. 2500 caracteres, con marcadores `…(+N)` si se recortó). Si `ref` no es `null`, el resultado completo está en el archivo de esa ref (`refs[].where`, ruta absoluta en la PC; `size` en caracteres).
- **`facts`:** `process` (id del proceso en segundo plano activo; `value: null` = ya no hay) y `answer_<stepId>_<n>` (`"pregunta -> respuesta"`).
- `args` van como los propuso el modelo, con los strings recortados; `{{ref:rN}}` es una referencia a un resultado guardado.

## Esperas (`waiting`)

La tarea queda detenida hasta que el usuario responde; solo hay una espera a la vez. `waiting` es `null` si no espera nada.

```jsonc
{ "kind": "plan",     "request": { "id", "planId", "steps": [{ "id", "instruction", "route", "expected" }] } }   // → /confirm-plan, /modify-plan, /reject-plan
{ "kind": "approval", "request": { "id", "mcp", "tool", "capability", "reason", "args" } }                    // → /approve, /deny
{ "kind": "question", "question": { "stepId", "question" } }                                                  // → /user-answer
```

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
- **Fin de la tarea:** `task.state` se vuelve terminal antes que `result`: mostrar el estado y esperar `result` (llega en el evento `set result`). `result.text` es el mensaje al usuario; con `origin: "fallback"` es un resumen fijo de lo hecho y de los cambios que quedaron en la PC.
- **`partial` o `failed`:** mostrar `stopReason` y, de `calls`, los cambios que permanecen (escrituras `ok`) y los posibles (escrituras `tool_error`, `exception` o `interrupted`).
- **Proceso en segundo plano:** si `facts.process.value` no es `null`, la tarea terminó dejando uno corriendo.
- **Tareas retenidas:** hasta 20 en memoria; las terminales más antiguas se descartan (la lista `tasks` es la vigente).
