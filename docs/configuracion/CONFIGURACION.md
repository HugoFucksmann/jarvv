# Configuración

La configuración de tiempo de ejecución vive en `jarvis-config.json` (raíz del proyecto) y se normaliza en `src/core/config.ts`. Toda lectura y escritura pasa por `normalize`, que descarta claves desconocidas o valores inválidos. Las credenciales y canales opcionales se configuran en `.env` (plantilla en `.env.example`).

## 1. Defaults del código vs `jarvis-config.json` incluido

Si falta `jarvis-config.json`, `ConfigManager` aplica `DEFAULT_CONFIG` (`src/core/config.ts`). El archivo `jarvis-config.json` incluido en el repositorio ajusta cuatro valores pensados para desarrollo local con 8 GB de VRAM:

| Clave | Default en `config.ts` | `jarvis-config.json` incluido | Qué controla |
|---|---|---|---|
| `qwenModel` | `"qwen3.5:4b"` | `"qwen3.5:4b-text"` | Modelo generativo (ver [`../operacion/OLLAMA_MODELOS_TEXTO.md`](../operacion/OLLAMA_MODELOS_TEXTO.md)) |
| `decisionModel` | `"d3:2b"` | `"d3:2b-text"` | Modelo de decisión (`/v1/systemone`) |
| `autoMode` | `false` | `true` | Omitir confirmación humana cuando no aplican niveles |
| `approvalTiers` | `false` | `true` | Clasificación verde/amarillo/rojo para escrituras (reemplaza a `autoMode` binario) |

## 2. Claves principales (`jarvis-config.json`)

| Grupo | Claves | Valores por defecto / descripción |
|---|---|---|
| **Modelo generativo** | `qwenUrl`, `qwenModel`, `qwenNumCtx`, `thinking`, `qwenMaxTokens`, `qwenTimeoutMs`, `qwenThinkingTimeoutMs` | `http://127.0.0.1:11434`, `qwenNumCtx: 16384`, `thinking: false` (solo gobierna `final`; `plan`/`replan` usan `true`, `args`/`verify` `false`), `{ arguments: 2048, plan: 4096, replan: 4096, final: 2048 }`, timeouts `120000` / `180000` ms |
| **Modelo de decisión** | `decisionUrl`, `decisionModel`, `decisionMaxContext`, `decisionTimeoutMs` | `http://127.0.0.1:11434`, `decisionMaxContext: 16384`, timeout `30000` ms |
| **Ciclo de vida Ollama** | `modelKeepAlive` | `"30m"` (`-1` = permanente, `0` = descargar tras cada consulta) |
| **Servidores MCP** | `desktopCommanderMcp`, `freeSearchMcp`, `mcpTimeoutMs` | Binario, argumentos, `env`, `cwd`, `allowedDirectories: []` (`desktop_commander`) y timeout MCP (`60000` ms) |
| **Trazas y refs** | `traceEnabled`, `tracePath`, `refsDir`, `retentionDays` | `true`, `"jarvis-traces.jsonl"` (ubica carpeta `jarvis-traces/`), `"data/refs"`, `30` días (`0` desactiva borrado) |
| **Políticas y web** | `blacklist`, `autoMode`, `approvalTiers`, `webSearchUseJudge` | `[]`, ver §1 arriba y detalle de reglas en [`../api/JARVIS_API.md`](../api/JARVIS_API.md) y [`../arquitectura/CORE_FLOW.md`](../arquitectura/CORE_FLOW.md) |
| **Voz (TTS)** | `voiceEnabled`, `telegramVoice`, `voiceUrl`, `voiceName` | `false`, `false`, `"http://127.0.0.1:8880"`, `"default"` (detalle en [`../operacion/TELEGRAM_Y_VOZ.md`](../operacion/TELEGRAM_Y_VOZ.md)) |

### Reglas de seguridad HTTP (`POST /api/jarvis/config` y `GET /config`)
- **Solo editables en disco**: `FILE_ONLY_KEYS` (`refsDir`, `tracePath`) y `LAUNCH_ONLY_KEYS` (`command`, `args`, `env`, `cwd` de los servidores MCP) son ignoradas por `POST /config` para que un cliente HTTP no cambie ejecutables ni rutas de borrado en caliente.
- **Sin exposición de `env`**: `GET /config` y la respuesta de `POST /config` omiten `env` de ambos servidores MCP (`sanitizeConfigForHttp`).
- **`allowedDirectories`**: requiere reiniciar el servidor tras editarse en la configuración actual; ver [`../pendientes/DIAGNOSTICO_PENDIENTES.md`](../pendientes/DIAGNOSTICO_PENDIENTES.md) §3.

## 3. Variables de entorno (`.env`) y memoria (`data/memory.json`)

- **`.env`** (ver `.env.example`):
  - `PORT` (`3000`) y `HOST` (`127.0.0.1`): puerto e interfaz de escucha (no usar `0.0.0.0` fuera de redes confiables).
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_MODE`: configuración del bot ([`../operacion/TELEGRAM_Y_VOZ.md`](../operacion/TELEGRAM_Y_VOZ.md)).
  - `HF_TOKEN`: token de Hugging Face para `scripts/phonon_server.py`.
  - Los comandos de `run_command` no heredan las variables cargadas desde `.env` ni los secretos de Telegram/voz.
- **`data/memory.json`** (opcional, fuera de git): pares manuales `[{ "key": "...", "value": "..." }]` leídos por `src/core/memory.ts` (formato y reglas en [`../arquitectura/CONTEXT_AND_MEMORY.md`](../arquitectura/CONTEXT_AND_MEMORY.md) §10).
