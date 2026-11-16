# Documentación de JARVIS

Índice único de la documentación técnica del proyecto. Los documentos describen el estado vigente del código salvo los marcados como históricos.

## Arquitectura y flujo
- [`arquitectura/ARCHITECTURE.md`](arquitectura/ARCHITECTURE.md) — Componentes, dependencias entre capas, invariantes y archivos base del núcleo.
- [`arquitectura/CORE_FLOW.md`](arquitectura/CORE_FLOW.md) — Ciclo de vida de las tareas, modos reactivo/deliberativo, decisiones D0–D5, Guard, verificación y límites.
- [`arquitectura/CONTEXT_AND_MEMORY.md`](arquitectura/CONTEXT_AND_MEMORY.md) — `TaskContext`, derivaciones, vistas de prompts, refs en disco, trazas y memoria entre tareas.
- [`arquitectura/TOOLS.md`](arquitectura/TOOLS.md) — Catálogo cerrado (4 rutas, 12 herramientas), contrato de proveedores nativos/MCP y pipeline de `web_search`.

## API HTTP
- [`api/JARVIS_API.md`](api/JARVIS_API.md) — Contrato HTTP/SSE (`/api/jarvis/*` y `/api/mcp/*`), `TaskDto`, esperas y errores.

## Configuración
- [`configuracion/CONFIGURACION.md`](configuracion/CONFIGURACION.md) — `jarvis-config.json`, defaults del código, claves restringidas por HTTP, `.env` y `data/memory.json`.

## Operación y entorno
- [`operacion/OLLAMA_MODELOS_TEXTO.md`](operacion/OLLAMA_MODELOS_TEXTO.md) — Variantes sin proyector de visión (`-text`), `num_ctx`, `keep_alive` y precalentamiento en 8 GB de VRAM.
- [`operacion/TELEGRAM_Y_VOZ.md`](operacion/TELEGRAM_Y_VOZ.md) — Bot de Telegram y servidor local TTS (`phonon_server.py` + `ffmpeg`).
- [`operacion/WINDOWS_TERMINAL.md`](operacion/WINDOWS_TERMINAL.md) — Operación vigente de `run_command`, `list_processes` y `stop_process` en Windows/PowerShell.
- [`operacion/free_search_mcp.md`](operacion/free_search_mcp.md) — Referencia externa de `free-search-mcp 0.18.0` (herramientas, filtros, motores y variables).
- [`operacion/REVISION_run_command.md`](operacion/REVISION_run_command.md) — Bitácora histórica de la revisión de `run_command` (hallazgos `RC-01` a `RC-41`).

## Pendientes
- [`pendientes/PENDIENTES_EVAL.md`](pendientes/PENDIENTES_EVAL.md) — Todo lo pendiente que depende de eval, mediciones o pruebas en otro entorno (D3, `PENDING_FACTS_LOOKUP`, D5, `web_search`, calibración).
- [`pendientes/PENDIENTES_CODIGO.md`](pendientes/PENDIENTES_CODIGO.md) — Todo lo pendiente que depende de código o de decisiones de producto y seguridad (memoria, herramientas nativas, terminal, seguridad, 2.0).

## Evaluación y análisis histórico
- [`../eval/README.md`](../eval/README.md) — Guía de uso del laboratorio de evaluación (`eval/`).
- [`evaluacion/desalineaciones-eval.md`](evaluacion/desalineaciones-eval.md) — Desalineaciones detectadas entre `eval/` y `src/`.
- [`evaluacion/JARVIS_EVALUACION.md`](evaluacion/JARVIS_EVALUACION.md) — Evaluación de rendimiento/latencia, mediciones reales (2026-11-13) e ideas T1–T5 / N1–N9 *(histórico)*.
- [`evaluacion/limitaciones/README.md`](evaluacion/limitaciones/README.md) — Índice de fichas de limitaciones de modelos y casos descartados del flujo *(histórico)*.
- [`evaluacion/limitaciones/d3-2b.md`](evaluacion/limitaciones/d3-2b.md) — Limitaciones observadas en el modelo de decisión `d3:2b` *(histórico)*.
- [`evaluacion/limitaciones/qwen-3.5-4b.md`](evaluacion/limitaciones/qwen-3.5-4b.md) — Limitaciones observadas en el modelo generativo `qwen3.5:4b` *(histórico)*.
- [`evaluacion/analisis/FRENTE_1_MEMORIA.md`](evaluacion/analisis/FRENTE_1_MEMORIA.md) — Diseño y mediciones del Frente 1: memoria entre tareas *(histórico)*.
- [`evaluacion/analisis/FRENTE_2_CONTEXTO.md`](evaluacion/analisis/FRENTE_2_CONTEXTO.md) — Diseño y mediciones del Frente 2: vistas y contexto por consulta *(histórico)*.
- [`evaluacion/analisis/FRENTE_3_DECISION.md`](evaluacion/analisis/FRENTE_3_DECISION.md) — Diseño y mediciones del Frente 3: determinismo, reintentos y caché *(histórico)*.
- [`evaluacion/analisis/PREGUNTAS_DECISION.md`](evaluacion/analisis/PREGUNTAS_DECISION.md) — Mediciones de preguntas de decisión y diseño de las sondas por herramienta *(histórico)*.
