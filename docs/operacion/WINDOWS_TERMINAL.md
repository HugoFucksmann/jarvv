# Terminal en Windows (`run_command`)

JARVIS está diseñado para **Windows con PowerShell** (sin soporte de Linux/WSL). Las herramientas de terminal viven en el proveedor nativo `jarvis_terminal` (`src/tools/terminal/`). Para el historial detallado de hallazgos y decisiones de diseño (`RC-01` a `RC-41`), ver [`REVISION_run_command.md`](REVISION_run_command.md).

## 1. `run_command`

Lanza comandos de PowerShell o interactúa con procesos iniciados dentro de la misma tarea.

- **Argumentos** (`command` o `pid` obligatorio):
  - `command`: texto PowerShell (se registra recortado a 1000 caracteres en `argCaps`).
  - `pid`: id de un proceso vivo de la misma tarea.
  - `input`: respuesta para un proceso en `waiting_input` (máx. 1000 caracteres, solo junto a `pid`).
  - `timeoutSec`: 1 a 300 s (default `30`; valores configurables en `jarvis-config.json` con `runCommandDefaultWaitSec` y `runCommandMaxWaitSec`). El plazo efectivo de la herramienta es `(runCommandMaxWaitSec + 15) s` (`315 s` por defecto).
  - `cwd`: directorio absoluto inicial para un comando nuevo (default: carpeta personal del usuario).
- **Ejecución (`powershell.ts`)**: invoca `powershell.exe -NoProfile -NonInteractive -Command` con prólogo UTF-8, ayudas en `%TEMP%\jarvis-terminal\helpers-*.ps1` (`Read-Host`/`pause` respondibles y envoltorios de utilidades del sistema como `ipconfig`, `ping`, `netsh`) y el comando codificado en base64. Si el antivirus bloquea las ayudas, relanza sin ellas y registra aviso en consola.
- **Decodificación**: salida UTF-8 con respaldo línea por línea OEM (850) / ANSI (1252), sin escapes ANSI ni barras de progreso intermedias. Límite de buffer por llamada: 500 000 caracteres de cabeza y cola; `text` al modelo respeta `BUDGET.summaryMax` (2500 chars).
- **Estados (`data.state`)**:
  - `finished`: terminó con `exitCode` real (`-1` si se mató externamente). Si la tarea vuelve a consultar un `pid` ya terminado, devuelve `finished` con `data.alreadyReported: true`.
  - `running`: superó `timeoutSec`; el proceso sigue vivo y puede continuarse con `{ pid }`.
  - `waiting_input`: la última línea parece un prompt interactivo tras inactividad (`1.5 s` en prompts como `[S/N]` o `Nombre: `; `5 s` en texto sin salto de línea; nunca en indicadores de progreso). El motor llama a `askUser` sin modelo y el usuario responde; si el modelo reenvía exactamente esa respuesta a ese `pid`, no pide nueva confirmación ni pasa por D3 (límite: `maxProcessPromptsPerStep = 3`).
  - `cancelled`: tarea cancelada; corta el árbol del proceso (`taskkill /PID n /T /F`, plazo `5 s`).
- **Ciclo de procesos y entorno**:
  - Tope de **8 procesos vivos** simultáneos; al completarse una tarea los procesos vivos quedan marcados como huérfanos y se recicla el huérfano más antiguo si hace falta lugar. Si la tarea falla o se cancela, `onTaskEnd` corta todos sus árboles de procesos.
  - No hereda variables cargadas desde `.env` ni `TELEGRAM_*`/`HF_TOKEN`; fija `PYTHONIOENCODING=utf-8` y `PYTHONUNBUFFERED=1` si no existen.

## 2. Procesos de otras tareas y del sistema

`run_command` solo sigue los procesos que lanzó (para continuarlos con `pid` e `input`). Ver el estado de los procesos de la PC y cortarlos es del grupo `system` (`system_info` con `section: processes` y `stop_process`; ver [`../arquitectura/TOOLS.md`](../arquitectura/TOOLS.md)).

## 3. Seguridad y políticas asociadas

Las reglas de pre-chequeo sintáctico PowerShell (`precheck.ts`), comandos de solo lectura (`policy/readOnly.ts`), repetición tras cambios (`policy/rerun.ts`) y lista negra (`policy/commandRules.ts`) se describen en [`../arquitectura/CORE_FLOW.md`](../arquitectura/CORE_FLOW.md).
