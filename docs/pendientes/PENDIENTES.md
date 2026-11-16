# Pendientes y Limitaciones Conocidas

Consolidado único del trabajo abierto, limitaciones conocidas y deuda técnica de JARVIS. Los 9 frentes prioritarios de arquitectura cuentan con análisis detallado en código y opciones de solución en [`DIAGNOSTICO_PENDIENTES.md`](DIAGNOSTICO_PENDIENTES.md).

**Alcance de plataforma:** JARVIS apunta solo a Windows y PowerShell. Linux/WSL no es objetivo de la versión actual (`listTools()` de terminal devuelve `[]` fuera de Windows).

---

## 1. Frentes prioritarios (detalle en `DIAGNOSTICO_PENDIENTES.md`)

1. **D3 (`reviewArgs`) con modelo 2B y sin lecturas**: causa, opciones y flags experimentales (`reviewFullView`, `reviewReads`, apagados) → [ver §1](DIAGNOSTICO_PENDIENTES.md#1-d3-reviewargs-con-modelo-2b-y-sin-lecturas). Falta que midas su efecto.
2. **`approvalTiers`**: niveles con `autoMode`, «aprobar una vez / siempre en esta tarea» (UI y Telegram), deduplicación tras rechazo y aviso en Telegram → [ver §2](DIAGNOSTICO_PENDIENTES.md#2-approvaltiers-incompleto). Pendiente: allowlist persistente (aplazada a propósito).
3. **`allowedDirectories`** (aplicado a todas las herramientas, en vivo y con `realpathSync`; ver [§3](DIAGNOSTICO_PENDIENTES.md#3-alloweddirectories-estático-sin-realpath-y-fuera-de-jarvis_terminal)): queda pendiente probarlo en Windows con `run_command` real y symlinks/junctions, y que el análisis de PowerShell es heurístico.
4. **`web_search` multiparte y recencia**: investigado a fondo, **sin implementar**; recomendación B (cobertura de términos) y B+C (guarda de fecha) → [ver §4](DIAGNOSTICO_PENDIENTES.md#4-web_search-consultas-multiparte-y-recencia).
5. **Memoria manual (`data/memory.json`)**: en espera; plan en [`MEMORIA_PLAN.md`](MEMORIA_PLAN.md) → [ver §5](DIAGNOSTICO_PENDIENTES.md#5-memoria-manual-datamemoryjson).
6. **`PENDING_FACTS_LOOKUP = false`**: investigado a fondo, **sin implementar**; recomendación C (forzar el ítem solo si `pending` vuelve vacío y la compuerta léxica + D0 lo indican) → [ver §6](DIAGNOSTICO_PENDIENTES.md#6-pending_facts_lookup--false).
7. **Falsos cierres de D5**: guarda de cobertura detrás del flag `completionCoverageGuard` (apagado) → [ver §8](DIAGNOSTICO_PENDIENTES.md#8-falsos-cierres-de-decisión-5).
8. **Anti-bucle con llamadas rechazadas sin ejecución**: resuelta la parte del usuario (no repetir la pregunta); el resto, sin ahorro de latencia, no se implementó → [ver §9](DIAGNOSTICO_PENDIENTES.md#9-anti-bucle-con-llamadas-rechazadas-sin-ejecución).
9. **`refsDir` y refs grandes**: leer una ref por `read_file` no es viable (15+15 líneas por lectura, el resto va a otra ref; el pre-chequeo además la rechaza y `allowedDirectories` no exime `refsDir`). Propuesta, **sin implementar**: herramienta nativa `read_ref` (mapa, partes y mejores pasajes por BM25, sin refs nuevas), reutilizando la partición y el ranking de `web_search`, más dos arreglos pequeños en el pre-chequeo → [ver §11](DIAGNOSTICO_PENDIENTES.md#11-refsdir-cómo-se-leen-los-refs-investigación-sin-implementar). Falta que la pruebes en tests y `eval/`.

---

## 2. Flujo, motor y modelos

- **Calibración con uso real**: los umbrales iniciales (`REVIEW_APPROVE = 0.6`, `NOUL_APPROVE = 0.6`, `BUDGET.sensitiveApprove = 0.65`) y los topes del motor (`maxSteps`, `maxCallsPerStep`, `maxItemFailures`, `availableRoutes`) requieren medición en tareas reales.
- **Contexto real de Ollama vs configurado**: si el entorno fija `OLLAMA_CONTEXT_LENGTH=8192` o el Modelfile de `d3` fija `num_ctx 4096`, la guarda que calcula contra `16384` no protege; ajustar en PC o alinear en `jarvis-config.json` ([`../operacion/OLLAMA_MODELOS_TEXTO.md`](../operacion/OLLAMA_MODELOS_TEXTO.md)).
- **Falsos cierres sintéticos de D5**: en pruebas quitando el último paso (2/6 falsos cierres a `0.75`); falta un dataset formal de D5 en `eval/`.
- **Repetición de llamadas rechazadas sin ejecución**: el anti-bucle solo compara llamadas ejecutadas; un `args_invalid` repetido depende de `maxReviewRejectionsPerStep` (2), y tras un rechazo en `web_search` por `egress.ts` el modelo puede reformular y re-preguntar hasta agotar el paso.
- **Idioma y texto de reintento (`prompts.ts`)**: `retryNote` sigue en español (`ERROR_PREVIO: ...`) dentro de prompts en inglés; también falta modularizar `prompts.ts` en partes con nombre para variantes del eval y derivar `ReviewView` con `Omit` sobre `ArgsView`.
- **Heurística `sameItem` (`pendingList.ts`)**: sensible a pares parecidos con distinta entidad (p. ej. «10 tareas» vs «10 procesos»); ampliar solo con casos medidos.
- **`shortDesc`** (revisado y descartado como duplicado): sigue haciendo falta para las herramientas que no vienen del manifest (MCP de terceros).
- **Salida de escape `wrong_group`**: diferida mientras baste agotar ruta tras 2 `not_accomplished`; reabrir solo si las trazas muestran exceso de llamadas en ruta equivocada.

## 3. Seguridad y API HTTP

- **Sin autenticación local**: `localOnly.ts` frena orígenes web, no otros procesos locales. El servidor ya **no arranca** si `HOST` no es loopback. `POST /config` permite editar `autoMode`, `approvalTiers`, `blacklist`, `retentionDays` y `retentionMaxMb` sin autenticación adicional (token y cifrado quedan fuera por decisión).
- **Sin rate limiting por segundo ni cifrado en reposo**: `refs` y trazas (`full.json.gz`) se guardan en texto plano; `retention.ts` borra por antigüedad (`retentionDays`) y por tamaño (`retentionMaxMb`, 500 MB por defecto).
- **Límites léxicos de políticas**:
  - `policy/commandRules.ts`: ya cubre `.Delete()`/`.MoveTo()`/`.CopyTo()`; no analiza variables dinámicas, rutas en tuberías ni concatenación de strings.
  - `policy/readOnly.ts`: lista cerrada conservadora; comandos seguros con paréntesis o `ForEach-Object` siguen pidiendo confirmación.
  - `policy/sensitivePaths.ts`: resuelve symlinks, `\\?\` y UNC; los nombres 8.3 solo se reconocen si están en las reglas (no se expanden con `GetShortPathName`).
- **API menor (`src/server/`)**: `/refresh-discovery` ya es solo `POST`; falta validar `GET /tasks/:id/refs/:refId` en Windows con una ref real generada en vivo; no se exponen en vivo la lista completa de pendientes ni decisiones intermedias por SSE.

## 4. Herramientas, Windows y MCP

- **Archivos nativos y reagrupación (D-15 a D-17)**: sin implementar; propuestas, riesgos y dependencias en [`HERRAMIENTAS_NATIVAS.md`](HERRAMIENTAS_NATIVAS.md) (`find_files`, `copy_file`, `delete_file`, reagrupar rutas, `edit_block`).
- **`web_search`**: falta ampliar set de pruebas (recencia y multiparte), calibrar umbrales (0.6 / 0.3 / 0.34), preferir documentación oficial frente a blogs (`category`/`include_domains`/`source_type`) y cubrir `H-21` (fallo parcial de lote del juez) + errores de `free_search` (`RecursionError` / páginas vacías por JS).
- **Terminal Windows** (detalle en [§10](DIAGNOSTICO_PENDIENTES.md#10-terminal-windows-srctoolsterminal)): resueltas las tablas 852/857; `nombre.exe`/`.com` ya estaban resueltos (RC-40, solo falta la ruta completa). Quedan sin resolver los procesos que leen `stdin` sin prompt (necesitan código nativo o PTY), la gestión de huérfanos desde la UI (RC-25; producto y seguridad) y probar apps de Tienda Windows en uso real.
- **Tiempos de espera** (aplazado por decisión del usuario): ya hay una primera versión hecha y sin validar (centralizados en `src/core/timeouts.ts`, tabla en [`CONFIGURACION`](../configuracion/CONFIGURACION.md) §4, overrides `toolTimeoutsMs` y `modelTimeoutsMs`; los valores no cambiaron). Pendiente de revisar, calibrar con uso real y decidir si se conserva tal cual; la descripción de `run_command` para el modelo sigue diciendo 30 s y 300 s aunque se configuren otros.
- **MCP terceros**: `notifications/cancelled` ya se envía por stdio al abortar o vencer una llamada (probar contra Desktop Commander real); confirmar si `mcpTimeoutMs` (60 s) requiere ajuste por herramienta.

## 5. Evaluación (`eval/` y `scripts/validate/`)

- Desalineaciones detalladas entre `eval/` y `src/` en [`../evaluacion/desalineaciones-eval.md`](../evaluacion/desalineaciones-eval.md).
- Actualizar datasets/prompts del laboratorio que aún citan `start_process` y `fetch`; unificar `facts.answer_<n>` de `scenario.ts` con `answer_<paso>_<n>` de producción; agregar etapas D0/D5 formales y script conversor de carpetas `jarvis-traces/` a escenarios.
- Tests: el transporte MCP por stdio está cubierto con un servidor de mentira (`tests/mcp_transport.test.ts`), el motor con dobles (`tests/engine.test.ts`) y el JSON del analizador de PowerShell se convierte en una función pura probada; siguen sin pruebas el parser real de PowerShell (necesita Windows), los adaptadores `mcp/` contra Desktop Commander real y los componentes `ui/`.

## 6. Horizonte JARVIS 2.0

- **Consola (ConPTY y Job Objects)**: pseudo-terminal (**ConPTY**) para REPLs completos, `isatty` y `-Confirm`, y **Job Objects** para seguir procesos fuera del árbol (`Start-Process`). Sin implementar.
- Lecturas preparatorias de apoyo dentro del mismo paso (`role: support`, varias rutas por tool) y ejecución paralela de lecturas/procesos independientes.
- Recetas parametrizadas para comandos frecuentes y respuestas finales por plantilla cuando solo hubo escrituras.
- Captura conversacional de memoria («recordá que…») y recetas aprendidas (Capa 3 de `FRENTE_1_MEMORIA.md`).
