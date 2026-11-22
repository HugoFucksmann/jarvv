# JARVIS API — lo que necesita saber la UI

Base: `/api/jarvis` (más endpoints directos en `/api/mcp` y alias `/mcp`). Diseñada para entorno local (`localOnly.ts` valida `Host` y `Origin` en `localhost`, `127.0.0.1` o `[::1]` y responde **403** si no coinciden; `ALLOW_PROXY_HOST=1` apaga solo el chequeo de `Host`, para sandboxes con proxy). JSON con límite de **256 KB**. Los errores son siempre `{ "error": string }`: **400** entrada o JSON inválido, **404** tarea/ref/traza inexistente, **409** la tarea no espera eso, **413** cuerpo mayor a 256 KB, **429** tope de tareas o SSE.

## Modelo

Una **tarea** es un contexto único: todo el estado sale de un solo objeto (`TaskDto`, abajo). No hay `Task` con `memory` ni iteraciones de modelo: la UI se arma desde `steps`, `calls`, `facts`, `refs` y `result`.

- **Modo** (`mode`): `reactive` (por defecto; elige herramientas paso a paso) o `deliberative` (planifica, pide confirmar el plan y lo ejecuta).
- **Estado** (`task.state`): `running` → termina en `completed`, `partial` (quedó algo logrado), `failed` o `cancelled`. Un estado terminal no cambia.
- **Motivo** (`task.stopReason`, solo si no es `completed`): `max_steps`, `no_alternatives`, `security_denied` (histórico: el motor ya no lo emite, queda para leer trazas anteriores), `user_cancelled`, `replans_exhausted`, `unrecoverable` (falló un modelo o el catálogo de herramientas, no la tarea), `restart` (el servidor se reinició mientras la tarea corría: se cierra al arrancar, con `partial` si dejó efectos y `failed` si no, y la respuesta fija «El servidor se reinició mientras la tarea corría»; la tarea no se reanuda).
- **Respuesta final** (`result`): `null` hasta que exista; se escribe **después** de pasar a estado terminal. `result.origin` es `model` o `fallback` (texto fijo en español, sin modelo; siempre en `cancelled`).

## Endpoints

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `POST /process` | `{ message, mode? }` | Crea y lanza la tarea. Responde `{ task: TaskDto }`, o `429` si ya hay 4 tareas en curso |
| `POST /cancel` | `{ taskId? }` | Cancela. Sin `taskId`, la última abierta. Idempotente |
| `POST /confirm-plan` | `{ taskId, waitId }` | Acepta el plan que espera confirmación |
| `POST /modify-plan` | `{ taskId, feedback, waitId }` | Pide un plan nuevo con la instrucción (sin tope de veces); vuelve a pedir confirmación |
| `POST /reject-plan` | `{ taskId, waitId }` | Rechaza sin instrucción: la tarea se cancela |
| `POST /approve` | `{ taskId, waitId, remember? }` | Acepta la operación sensible pendiente (`remember: true` intenta recordarla en RAM para la tarea si `canRemember` es `true`) |
| `POST /deny` | `{ taskId, reason?, waitId }` | Rechaza la operación; `reason` (opcional) llega al modelo como instrucción. La tarea no termina |
| `POST /user-answer` | `{ taskId?, answer, waitId? }` | Responde la pregunta abierta (no vacía; `waitId` opcional, si se envía debe coincidir con `question.id`) |
| `GET /state?taskId=` | | `{ task: TaskDto \| null, tasks: TaskSummary[], discoveredTools, unavailableServers }`. Sin `taskId`, la última |
| `GET /tasks/:taskId` | | `TaskDto` individual (liviano: sin listado global ni catálogo de herramientas). `404` si no existe |
| `GET /events?taskId=` | | SSE, ver abajo (`429` con 8 conexiones abiertas) |
| `GET /tasks/:taskId/refs/:refId` | | Texto completo de una ref de la tarea (`calls[].ref`, `refs[].id`), `text/plain`. 404 si la tarea o la ref no existen o el archivo ya no está |
| `GET /tasks/:taskId/trace?format=` | | Traza de una tarea **terminada**: `summary` (Markdown, por defecto; línea de tiempo con decisiones D1–D4 por llamada, esperas y respuesta final), `json` (snapshot, todas las consultas D0–D5 y generativas, herramientas y duraciones) o `full` (lo anterior más prompts y salidas crudas). 400 si `format` es otro; 404 si sigue en curso, `traceEnabled` es `false` o no existe |
| `GET /environment` | | Datos de esta PC: `platform`, `home`, `desktop`, `documents`, `downloads` (los que se pudieron consultar), más `now` (ISO) y `timeZone` |
| `GET /limits` | | Topes del motor (15 campos): `maxSteps`, `maxReplans`, `maxEscalations` (pasos fallidos seguidos), `maxCallsPerStep`, `maxAttemptsPerStep`, `maxRepeatsPerStep`, `maxReviewRejectionsPerStep`, `maxVerifyRejectionsPerStep`, `maxToolErrorsPerStep`, `maxSameToolErrorsPerStep`, `maxUserRejectionsPerStep`, `maxDeniedPerStep`, `maxQuestionsPerStep`, `maxProcessPromptsPerStep`, `maxNotAccomplishedPerRoute` |
| `GET/POST /config`, `POST /refresh-discovery` | | `/config` devuelve y acepta configuración en JSON (exige objeto plano; **omite `env`** de los servidores MCP en las respuestas HTTP). `POST` fusiona las claves válidas y descarta `FILE_ONLY_KEYS` (`refsDir`, `traceDir`; también el nombre anterior `tracePath`) y `LAUNCH_ONLY_KEYS` (`command`, `args`, `env`, `cwd` de los MCP). Detalle en [`../configuracion/CONFIGURACION.md`](../configuracion/CONFIGURACION.md) |
| `POST /tts` | `{ text }` | Voz: audio PCM 16-bit, mono, 24 kHz en streaming (`audio/L16`), sintetizado por el servidor TTS de `voiceUrl` (`scripts/phonon_server.py`). 400 sin `text` o > 20 000 caracteres, 422 si queda vacío, 503 con `voiceEnabled` apagado, 502 si el servidor falla |

Las decisiones (`/approve`, `/deny`, `/confirm-plan`, `/modify-plan`, `/reject-plan`) **exigen `taskId` y `waitId`** (si faltan, 400): sin ellos se aplicarían a la última tarea y un cliente aprobaría a ciegas lo que no vio. `waitId` es el `request.id` de la espera actual: si no coincide (respuesta tardía), responde 409. `/cancel` y `/user-answer` conservan el atajo (toman la última tarea si no se envía `taskId`; en `/user-answer`, `waitId` es opcional).

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
  "recalled": [{ "id", "stepId", "at", "source": "user_memory|thread", "key", "value", "from" }],
  "result": { "text", "origin": "model|fallback" } | null,
  "waiting": Waiting | null,
  "paused": { "since", "model": "llm|decision" } | null
}
```

- **Reactivo:** `plans` está vacío y los pasos traen `planId`, `route` y `expected` en `null`; `instruction` es el primer ítem de la lista de pendientes, que mantiene el código (el modelo la genera al empezar, tras un fallo y al vaciarse); la lista completa no se expone. Lo que se hizo se lee de `calls`. Cada iteración del bucle es un paso.
- **Deliberativo:** un replan o una modificación del usuario marca `superseded: true` los pasos que reemplaza: se muestran como descartados, no como fallidos. Los vigentes son los que no están `superseded`.
- **`calls[].status`:** ejecutadas `ok`, `no_data`, `not_found`, `tool_error`, `exception`, `interrupted`, `waiting_input` (un proceso de `run_command` sigue vivo y pide una respuesta del usuario: no se verifica y el paso emite una espera `question` con el texto que el proceso muestra), `denied` (la rechazó el servidor de la herramienta); no ejecutadas `args_invalid` (el pre-chequeo o la revisión rechazaron los argumentos), `loop_blocked` (la misma llamada ya se había hecho), `user_rejected`, `tool_rejected` (la rechazó Guard, la lista negra o una regla de comando; la tarea sigue), `info_missing`. `verdict` es lo que dijo la verificación del resultado (`null` si no se verificó). `reason`: `no_usable_data`, `not_accomplished`, `wrong_place`, `wrong_position`, `wrong_scope`, `wrong_item` o `missing_attribute`.
- **Escrituras:** `kind: "write"` con `status: "ok"` son cambios hechos en la PC; con `tool_error`, `exception`, `interrupted` o `waiting_input` pudieron dejar cambios parciales.
- **`summary`:** resultado ya resumido (máx. 2500 caracteres, con marcadores `…(+N)` si se recortó). Si `ref` no es `null`, el resultado completo está en el archivo de esa ref (`refs[].where`, ruta absoluta en la PC; `size` en caracteres).
- **`facts`:** `process` (id del proceso en segundo plano activo; `value: null` = ya no hay) y `answer_<stepId>_<n>` (`"pregunta -> respuesta"`).
- `args` van como los propuso el modelo, con los strings recortados.

## Modo automático y lista negra (`/config`)

- `autoMode` (`false` por defecto en código, `true` en el `jarvis-config.json` incluido) y `approvalTiers` (`true` por defecto): con `approvalTiers: true`, las escrituras se clasifican en verde (sin confirmación ni D3), amarillo (con `autoMode`: sin confirmación y con D3 estricto; sin `autoMode`: pide confirmación) y rojo (siempre pide confirmación); con `approvalTiers: false` y `autoMode: true`, las escrituras del catálogo pasan sin espera `approval` por D3. Guard, `blacklist` (`blocked` / `sensitive`) y las rutas sensibles (`sensitivePaths.ts`) siguen exigiendo confirmación u operando según [`../arquitectura/CORE_FLOW.md`](../arquitectura/CORE_FLOW.md). Se lee en cada llamada.
- Voz (`/config`): `voiceEnabled` (la interfaz lee en voz alta la respuesta final; habilita `POST /tts`), `telegramVoice` (Telegram suma una nota de voz; necesita `ffmpeg`), `voiceUrl` (solo http o https; `http://127.0.0.1:8880`) y `voiceName` (`default`). Ver [`../operacion/TELEGRAM_Y_VOZ.md`](../operacion/TELEGRAM_Y_VOZ.md).
- `webSearchUseJudge` (`true` por defecto): `web_search` puntúa extractos y fragmentos con el modelo de decisión (2B). Apagado, solo ordena con BM25 y nunca afirma `found`.
- `blacklist`: entradas **propias** que se suman a las reglas de comando integradas: `[{ "tool": "run_command" | "servidor:herramienta", "pattern"?: "regex", "reason": "texto para el modelo", "level"?: "blocked" | "sensitive" }]` (sin `level`, `blocked`; nota: `blacklistEntries` en `src/core/config.ts` hoy conserva solo `tool`, `pattern` y `reason`, descartando `level` al normalizar). `POST` reemplaza la lista completa.

## Esperas (`waiting`)

La tarea queda detenida hasta que el usuario responde; solo hay una espera a la vez. `waiting` es `null` si no espera nada.

```jsonc
{ "kind": "plan",     "request": { "id", "planId", "steps": [{ "id", "instruction", "route", "expected" }] } }                      // → /confirm-plan, /modify-plan, /reject-plan
{ "kind": "approval", "request": { "id", "mcp", "tool", "capability", "reason", "args", "canRemember?", "tier?", "blacklist?" } } // → /approve, /deny
{ "kind": "question", "question": { "id", "stepId", "question", "source", "pid?" } }                                            // → /user-answer
```

- La aprobación se pide después de que el pre-chequeo aceptó los argumentos. Con `autoMode` solo la piden lo rojo, lo obligatorio de Guard, la lista negra y lo que `allowedDirectories` no puede resolver. Si el usuario aprueba, no hay otra revisión de argumentos.
- El plan se confirma tras el plan inicial y tras cada plan generado por una modificación del usuario; nunca tras un replan automático.
- `args` de `approval` son los registrados (recortados).
- Cancelar resuelve cualquier espera y la tarea cierra con `cancelled` / `user_cancelled`.

## Pausa por modelo no disponible (`paused`)

Si el LLM o el modelo de decisión no responden (red, timeout o error HTTP), la tarea **no se cierra de inmediato**: queda pausada y repite la misma consulta con esperas crecientes (2 s a 30 s) hasta `modelUnavailablePauseMaxMs` (10 minutos por defecto). `paused` es `{ since, model }` mientras espera (`since` en ms; `model` es `llm` o `decision`) y `null` si no. No es una espera del usuario: la única acción posible es `POST /cancel`. Si el modelo vuelve, la tarea sigue donde estaba. Si se agota el tiempo, o la causa no se arregla esperando (URL del modelo sin configurar, el prompt no cabe en su contexto), la tarea cierra `unrecoverable`. Una respuesta inválida del modelo se trata aparte: D0, la continuación y D5 siguen sin su aporte y las demás consultas reintentan una vez.

## Eventos (SSE `GET /events`)

Un mensaje `id: <n>\ndata: <json>` por evento, más un comentario `: ping` cada 15 s (configurable con `sseKeepAliveMs`).

```jsonc
{ "type": "snapshot", "task": TaskDto | null, "tasks": TaskSummary[], "discoveredTools", "unavailableServers" }
{ "type": "created",  "taskId", "n", "summary": TaskSummary }
{ "type": "change",   "taskId", "n", "at", "ops": [{ "op": "add|update|set|finish", "target", "value" }] }
{ "type": "waiting",  "taskId", "waiting": Waiting | null }
{ "type": "paused",   "taskId", "paused": { "since", "model": "llm|decision" } | null }
```

- `snapshot`: se emite de inmediato al conectar (toma `?taskId=` o la última tarea, equivalente a `GET /state`).
- `change`: un evento por cada escritura en el contexto, con `n` consecutivo. `ops` ya trae los elementos creados (con `id` y `at`): `add` (`target` = sección), `update` (`target` = id del paso o la llamada, `value` = campos cambiados), `set` (`target` = `facts.<clave>` o `result`) y `finish` (`value` = `{ state, stopReason }`).
- Forma simple y segura de consumirlo: hidratarse desde el `snapshot` inicial y aplicar `ops` por delta (`change`); si `n` salta (no es el anterior + 1), releer `GET /tasks/:taskId` o `GET /state?taskId=`.
- En reconexiones no se reenvían deltas perdidos (no usa `Last-Event-ID`): el nuevo `snapshot` al reconectar entrega el estado vigente completo.

## Qué mostrar y cómo

- **Progreso:** `steps` (deliberativo: plan con estado por paso) y `calls` (qué herramienta se llamó, con qué `args` y qué devolvió).
- **Fin de la tarea:** `task.state` se vuelve terminal antes que `result`: mostrar el estado y esperar `result` (llega en el evento `set result`). `result.text` es el mensaje al usuario; con la tarea `partial` o `failed` y `origin: "model"` empieza con un encabezado fijo (estado, qué no se logró y cambios hechos en la PC) escrito por el código: no hace falta repetirlo en la UI; con `origin: "fallback"` es un resumen fijo de lo hecho y de los cambios que quedaron en la PC.
- **`partial` o `failed`:** mostrar `stopReason` y, de `calls`, los cambios que permanecen (escrituras `ok`) y los posibles (escrituras `tool_error`, `exception`, `interrupted` o `waiting_input`).
- **Proceso en segundo plano:** si `facts.process.value` no es `null`, la tarea terminó dejando uno corriendo.
- **Tareas retenidas:** hasta 20 en memoria; las terminales más antiguas se descartan (la lista `tasks` es la vigente).

## Endpoints directos MCP (`/api/mcp` y `/mcp`)

Permiten inspeccionar y probar servidores registrados sin crear una tarea (`src/server/mcpRouter.ts`):

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `GET /discover-all` | | Descubre herramientas de todos los servidores registrados |
| `GET /:server/tools` | | Lista herramientas de un servidor (`404` si no existe) |
| `POST /:server/call` | `{ name, args? }` | Ejecuta una lectura directa (`404` servidor inexistente, `400` `name` faltante o `args` no objeto). Devuelve **`403`** si `policy.mutates` o `Guard !== ALLOW`: toda escritura debe pasar por una tarea |
| `POST /:server/reconnect` | | Reconecta un servidor stdio (`404` si no existe) |
| `GET /:server/status` | | Devuelve `{ connected: boolean }` |
