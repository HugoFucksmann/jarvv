# Configuración

La configuración de tiempo de ejecución vive en `jarvis-config.json` (raíz del proyecto) y se normaliza en `src/core/config.ts`. Toda lectura y escritura pasa por `normalize`, que descarta claves desconocidas o valores inválidos. Las credenciales y canales opcionales se configuran en `.env` (plantilla en `.env.example`).

## 1. Defaults del código vs `jarvis-config.json` incluido

Si falta `jarvis-config.json`, `ConfigManager` aplica `DEFAULT_CONFIG` (`src/core/config.ts`). Comparativa entre los valores del código y el `jarvis-config.json` incluido en el repositorio (pensado para desarrollo local con 8 GB de VRAM):

| Clave | Default en `config.ts` | `jarvis-config.json` incluido | Qué controla |
|---|---|---|---|
| `qwenModel` | `"qwen3.5:4b"` | `"qwen3.5:4b-text"` | Modelo generativo (ver [`../operacion/OLLAMA_MODELOS_TEXTO.md`](../operacion/OLLAMA_MODELOS_TEXTO.md)) |
| `decisionModel` | `"d3:2b"` | `"d3:2b-text"` | Modelo de decisión (`/v1/systemone`) |
| `autoMode` | `false` | `true` | Omitir la confirmación humana de lo amarillo (D3 lo revisa; lo verde nunca pide); lo rojo y lo obligatorio de Guard siempre se confirman |
| `reviewFullView`, `reviewReads`, `completionCoverageGuard` | `false` | `false` | Experimentales, apagados: D3 con lecturas y entorno; lecturas por D3; D5 con guarda de cobertura (ver `PENDIENTES_EVAL.md` §1 y §3) |
| `recoveryShadow` | `true` | `true` | Modo sombra de la recuperación tras un paso fallido del reactivo: calcula qué haría (reglas de `recoveryRules.ts` y, si no deciden, una consulta de Decisión) y lo registra en la traza (etapa `recovery`). **No actúa ni cambia lo que hace Jarvis**; agrega una consulta a Decisión por fallo solo cuando las reglas no deciden. Se lee en cada fallo (ver `eval/GUIA_DECISION.md`, sección 5) |
| `approvalTiers` | `true` | `true` | Clasificación verde/amarillo/rojo para escrituras; funciona con `autoMode` activo (ver `CORE_FLOW.md`) |

## 2. Claves principales (`jarvis-config.json`)

| Grupo | Claves | Valores por defecto / descripción |
|---|---|---|
| **Modelo generativo** | `qwenUrl`, `qwenModel`, `qwenNumCtx`, `thinking`, `qwenMaxTokens`, `qwenTimeoutMs`, `qwenThinkingTimeoutMs` | `http://127.0.0.1:11434`, `qwenNumCtx: 16384`, `thinking: false` (solo gobierna `final`; `plan`/`replan` usan `true`, `args`/`verify` `false`), `{ arguments: 2048, plan: 4096, replan: 4096, final: 2048 }`, timeouts `120000` / `180000` ms |
| **Modelo de decisión** | `decisionUrl`, `decisionModel`, `decisionMaxContext`, `decisionTimeoutMs` | `http://127.0.0.1:11434`, `decisionMaxContext: 16384`, timeout `30000` ms (override por modelo: `modelTimeoutsMs`, ver §4) |
| **Ciclo de vida Ollama** | `modelKeepAlive` | `"30m"` (`-1` = permanente, `0` = descargar tras cada consulta) |
| **Servidores MCP** | `desktopCommanderMcp`, `freeSearchMcp`, `mcpTimeoutMs` | Binario, argumentos, `env`, `cwd`, `allowedDirectories: []` (`desktop_commander`) y timeout MCP (`60000` ms; override por herramienta: `toolTimeoutsMs`, ver §4) |
| **Trazas, refs y logs** | `traceEnabled`, `tracePath`, `refsDir`, `retentionDays`, `logRetentionDays`, `retentionMaxMb` | `true`, `"jarvis-traces.jsonl"` (ubica carpeta `jarvis-traces/`), `"data/refs"`, `10` días para refs y trazas, `30` días para el log de eventos de cada tarea (`data/tasks/`, junto a `refsDir`), `250` MB (tope de tamaño en disco compartido entre refs, trazas y logs; `0` lo desactiva) |
| **Pausa por modelo caído** | `modelUnavailablePauseMaxMs` | `600000` (10 min): una tarea espera ese tiempo a que vuelva un modelo que no responde antes de cerrarse; `0` = no espera |
| **Experimentales** (apagados) | `reviewFullView`, `reviewReads`, `completionCoverageGuard` | ver `PENDIENTES_EVAL.md` §1 y §3 |
| **Políticas y web** | `blacklist`, `autoMode`, `approvalTiers`, `webSearchUseJudge`, `webJudgeTimeoutMs` | `[]`, ver §1 arriba, `20000` ms para el juez web y detalle de reglas en [`../api/JARVIS_API.md`](../api/JARVIS_API.md) y [`../arquitectura/CORE_FLOW.md`](../arquitectura/CORE_FLOW.md) |
| **Voz (TTS)** | `voiceEnabled`, `telegramVoice`, `voiceUrl`, `voiceName` | `false`, `false`, `"http://127.0.0.1:8880"`, `"default"` (detalle en [`../operacion/TELEGRAM_Y_VOZ.md`](../operacion/TELEGRAM_Y_VOZ.md)) |

### Reglas de seguridad HTTP (`POST /api/jarvis/config` y `GET /config`)
- **Solo editables en disco**: `FILE_ONLY_KEYS` (`refsDir`, `tracePath`) y `LAUNCH_ONLY_KEYS` (`command`, `args`, `env`, `cwd` de los servidores MCP) son ignoradas por `POST /config` para que un cliente HTTP no cambie ejecutables ni rutas de borrado en caliente.
- **Sin exposición de `env`**: `GET /config` y la respuesta de `POST /config` omiten `env` de ambos servidores MCP (`sanitizeConfigForHttp`).
- **`allowedDirectories`**: se lee en cada llamada (un cambio por `POST /config` rige de inmediato) y aplica a **todas** las herramientas con ruta, incluido `run_command` (su `cwd` y las rutas que detecta el análisis de PowerShell). Las rutas se comparan con `realpathSync` (symlinks). Una ruta fuera se rechaza; lo que no se puede resolver (variables, rutas relativas sin base, comando no analizable) pide confirmación al usuario. Ver [`../pendientes/PENDIENTES_CODIGO.md`](../pendientes/PENDIENTES_CODIGO.md) §6.

## 3. Variables de entorno (`.env`) y memoria (`data/memory.json`)

- **`.env`** (`.env.example` incluye solo `HF_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` y `TELEGRAM_MODE`):
  - `PORT` (`3000` por defecto) y `HOST` (`0.0.0.0` por defecto en `server.tsx`; no figuran en `.env.example`): puerto e interfaz de escucha. La validación estricta de loopback (`127.0.0.1`, `localhost` o `::1`) y `localOnly()` están comentados actualmente en `server.tsx` por compatibilidad con el sandbox de AI Studio Build (ver [`../pendientes/PENDIENTES_CODIGO.md`](../pendientes/PENDIENTES_CODIGO.md) §1); en despliegue local puro se recomienda `HOST=127.0.0.1` porque la API no tiene autenticación.
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_MODE`: configuración del bot ([`../operacion/TELEGRAM_Y_VOZ.md`](../operacion/TELEGRAM_Y_VOZ.md)).
  - `HF_TOKEN`: token de Hugging Face para `scripts/phonon_server.py`.
  - Los comandos de `run_command` no heredan las variables cargadas desde `.env` ni los secretos de Telegram/voz.
- **`data/memory.json`** (opcional, fuera de git): pares manuales `[{ "key": "...", "value": "..." }]` leídos por `src/memory/index.ts` (formato y reglas en [`../arquitectura/CONTEXT_AND_MEMORY.md`](../arquitectura/CONTEXT_AND_MEMORY.md) §10).

## 4. Tiempos de espera (inventario)

Todos los valores viven en `src/core/timeouts.ts` (`TIMEOUT_DEFAULTS` los configurables, `FIXED_TIMEOUTS` los internos); los configurables se leen en cada uso (se pueden cambiar con una tarea en curso, salvo que se indique). **No existe un tope de tiempo de la tarea ni del paso:** las tareas se acotan por cantidad (`BUDGET`: pasos, llamadas por paso, rechazos), no por reloj.

**Overrides.** Por herramienta, `toolTimeoutsMs`: `{ "desktop_commander:read_file": 120000, "web_search": 200000 }` (clave `servidor:herramienta` o `herramienta`; la primera gana). Rige sobre el plazo del catálogo y sobre `mcpTimeoutMs`, también para las herramientas de los servidores MCP (el transporte por stdio usa el plazo propio de la llamada). Por modelo, `modelTimeoutsMs`: `{ "qwen3.5:4b": 240000, "qwen3.5:4b#thinking": 400000, "d3:2b": 10000 }` (clave el tag; `#thinking` solo para el razonamiento). Valores inválidos (no enteros, cero o negativos) se descartan.

| Qué | Valor por defecto | Clave en `jarvis-config.json` | Override |
|---|---|---|---|
| Petición a un servidor MCP (stdio) | 60 000 ms | `mcpTimeoutMs` | `toolTimeoutsMs` |
| Plazo de una llamada a `run_command` | 315 000 ms (espera máxima + 15 s) | sigue a `runCommandMaxWaitSec` | `toolTimeoutsMs` |
| Plazo de una llamada a `web_search` | 150 000 ms (catálogo) | — | `toolTimeoutsMs` |
| `run_command`: espera por omisión de una llamada / tope de `timeoutSec` | 30 s / 300 s | `runCommandDefaultWaitSec` / `runCommandMaxWaitSec` | — (la descripción de la herramienta para el modelo sigue diciendo 30 y 300) |
| Qwen sin razonamiento | 120 000 ms | `qwenTimeoutMs` | `modelTimeoutsMs["<tag>"]` |
| Qwen con razonamiento | 180 000 ms | `qwenThinkingTimeoutMs` | `modelTimeoutsMs["<tag>#thinking"]` |
| Modelo de decisión | 30 000 ms | `decisionTimeoutMs` | `modelTimeoutsMs["<tag>"]` |
| Precalentamiento (warmup) | el de cada modelo | los mismos | los mismos |
| `web_search`: cada consulta al juez | 20 000 ms | `webJudgeTimeoutMs` | — |
| SSE: `ping` de mantenimiento | 15 000 ms | `sseKeepAliveMs` | — |
| Apagado: espera a que terminen las tareas | 3 000 ms | `shutdownDrainMs` | — |
| Keep-alive de Ollama (carga de modelos) | `30m` | `modelKeepAlive` | — (no es un plazo de espera) |

Internos, **no configurables** (en `FIXED_TIMEOUTS`): margen de seguridad de las llamadas 5 s; analizador de PowerShell del pre-chequeo 8 s; consulta de carpetas del usuario 8 s; lectura de páginas de códigos 5 s; arranque de PowerShell 15 s; cortar un proceso 5 s; tabla de procesos 15 s; proceso terminado que nadie leyó, 10 min; silencio para detectar un prompt 1,5 / 3 / 5 s (según la forma de la última línea); espera entre reintentos de red hacia un LLM 1 s (un reintento, nunca ante timeout); hilo de continuación 10 min; caché del catálogo de herramientas 30 s; retención de refs y trazas cada 6 h; Telegram: progreso 2,5 s, «escribiendo…» 4,5 s, espera del resultado 30 s, reconexión 2 s.
