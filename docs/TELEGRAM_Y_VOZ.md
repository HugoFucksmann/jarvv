# Telegram y voz

Dos vías opcionales sobre la misma API HTTP (`docs/JARVIS_API.md`): Telegram para pedir tareas y responderlas desde el teléfono, y la voz (TTS local) para leer las respuestas. Sin configurar nada, JARVIS funciona igual.

## Telegram

El bot (`src/telegram/`) es un cliente más de la API, como la interfaz web: inicia tareas con `POST /process`, sigue los eventos por SSE y resuelve las esperas con `/confirm-plan`, `/approve`, `/deny`, `/user-answer` y `/cancel`.

**Configuración** (`.env` en la raíz; ver `.env.example`):

| Variable | Qué es |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token de @BotFather. Es un secreto: no va en `jarvis-config.json` y `run_command` no lo hereda. |
| `TELEGRAM_CHAT_ID` | Id numérico de **tu chat privado** (@userinfobot lo dice). Obligatorio: sin él el bot no arranca. Los ids negativos (grupos) se rechazan porque cualquier miembro podría aprobar operaciones. |
| `TELEGRAM_MODE` | Opcional: `reactive` o `deliberative` (pide confirmar el plan). Vacío = el modo por defecto del servidor. |

Al arrancar, el servidor dice `[Telegram] Desactivado: <motivo>` o `[telegram] @bot activo`.

**Comportamiento**
- Comandos (el menú aparece al escribir `/`; cada uno tiene un alias de una letra):
  - `/auto on|off` (`/a`): modo automático de Guard. Sin argumento muestra el estado. Encenderlo pide confirmar con un botón porque quita la aprobación humana, y vale para toda JARVIS (también la interfaz).
  - `/modo r|d` (`/m`): `r` reactivo, `d` deliberativo (también se entienden las palabras enteras). Vale para las tareas que se inician desde ese momento; vive en memoria y al reiniciar vuelve a `TELEGRAM_MODE`.
  - `/voz on|off` (`/v`): nota de voz de Telegram (`telegramVoice`). `/v ui on|off`: lectura en voz alta de la interfaz (`voiceEnabled`).
  - `/cancel` (`/c`) y `/start` (ayuda).
- Una tarea a la vez, y solo las que inicia el bot: las de la interfaz no generan mensajes. `/cancel` la cancela.
- Un mensaje de progreso que se edita (pasos, qué hace cada llamada, su resultado y veredicto) y "escribiendo…" mientras trabaja; al terminar, la respuesta final como mensaje nuevo.
- Planes, aprobaciones y preguntas llegan con botones. Los botones se quitan cuando la espera se resuelve (aquí, en la interfaz o por cancelación). Si los argumentos de una aprobación no entran enteros en el chat, no se ofrece "Aprobar": se aprueba desde la interfaz.
- Los mensajes pendientes de cuando JARVIS estaba apagado se descartan al arrancar.

## Voz

`scripts/phonon_server.py` levanta un servidor TTS local (Phonon) con API compatible con OpenAI. JARVIS lo consume en `POST /api/jarvis/tts` (audio PCM 16-bit, mono, 24 kHz, en streaming).

**Configuración** (`jarvis-config.json` o Ajustes → Voz): `voiceEnabled` (la interfaz lee la respuesta final; botón Leer/Detener), `telegramVoice` (Telegram suma una nota de voz al texto), `voiceUrl` (`http://127.0.0.1:8880`) y `voiceName`.

**Servidor de voz**

```powershell
python -m venv .venv-tts
.venv-tts\Scripts\python -m pip install ptts fastapi uvicorn
.venv-tts\Scripts\python scripts/phonon_server.py
```

- El modelo en español (`gradium/phonon-40m-es`) es *gated*: hay que aceptar sus términos en Hugging Face y poner `HF_TOKEN` en `.env` (el script lo lee). Sin acceso se corta con un mensaje claro; `PTTS_ALLOW_EN_FALLBACK=1` permite el modelo público en inglés (el español suena con acento).
- Las notas de voz de Telegram necesitan `ffmpeg` (PCM → OGG/Opus): `winget install Gyan.FFmpeg`. Se busca en `FFMPEG_PATH`, en el PATH y en la carpeta de winget; sin él, el texto llega igual y se avisa al arrancar. La nota lee como mucho unos 1500 caracteres, cortados en una frase entera.
- Con la interfaz abierta en varias pestañas del mismo navegador, solo una lee cada respuesta.
