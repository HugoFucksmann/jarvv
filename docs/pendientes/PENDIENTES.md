# Pendientes y Limitaciones Conocidas

Consolidado único del trabajo abierto, limitaciones conocidas y deuda técnica de JARVIS. Los 7 frentes prioritarios de arquitectura cuentan con análisis detallado en código y opciones de solución en [`DIAGNOSTICO_PENDIENTES.md`](DIAGNOSTICO_PENDIENTES.md).

**Alcance de plataforma:** JARVIS apunta solo a Windows y PowerShell. Linux/WSL no es objetivo de la versión actual (`listTools()` de terminal devuelve `[]` fuera de Windows).

---

## 1. Frentes prioritarios (detalle en `DIAGNOSTICO_PENDIENTES.md`)

1. **D3 (`reviewArgs`) con modelo 2B y sin lecturas**: las lecturas nunca pasan por D3 y `buildArgsReview` omite `lastReads`/`env`, dependiendo de `precheck.ts` para frenar rutas inventadas en escritura → [ver §1](DIAGNOSTICO_PENDIENTES.md#1-d3-reviewargs-con-modelo-2b-y-sin-lecturas).
2. **`approvalTiers` incompleto**: falta UI/Telegram explicando niveles frente a `autoMode`, allowlist persistente («aprobar siempre») y deduplicación tras `user_rejected` → [ver §2](DIAGNOSTICO_PENDIENTES.md#2-approvaltiers-incompleto).
3. **`allowedDirectories` estático y fuera de terminal**: snapshot fijo al arrancar (no ve cambios de `POST /config`), sin `realpathSync` ante symlinks, invisible en UI y sin efecto sobre `run_command` → [ver §3](DIAGNOSTICO_PENDIENTES.md#3-alloweddirectories-estático-sin-realpath-y-fuera-de-jarvis_terminal).
4. **`web_search` multiparte y recencia**: corte temprano al responder una sola faceta y falta de `TODAY` en D4 (`buildResultVerification`) para rechazar datos viejos → [ver §4](DIAGNOSTICO_PENDIENTES.md#4-web_search-consultas-multiparte-y-recencia).
5. **Deep Research en pausa**: no implementado en `src/`; queda `free_search:research` sin uso en `manifest.ts` y `free_search` falla en páginas JS o con `RecursionError` → [ver §5](DIAGNOSTICO_PENDIENTES.md#5-deep-research).
6. **Memoria manual (`data/memory.json`)**: sin CRUD en HTTP/UI/Telegram, matching estricto por stems y sin inyección en `pending`/`plan` → [ver §6](DIAGNOSTICO_PENDIENTES.md#6-memoria-manual-datamemoryjson).
7. **`PENDING_FACTS_LOOKUP = false`**: sigue apagada por regresiones en `llm_pending_hard`, afectando tareas `multi`, continuaciones con hilo y fallbacks sin D0 → [ver §7](DIAGNOSTICO_PENDIENTES.md#7-pending_facts_lookup--false).

---

## 2. Flujo, motor y modelos

- **Calibración con uso real**: los umbrales iniciales (`REVIEW_APPROVE = 0.6`, `NOUL_APPROVE = 0.6`, `BUDGET.sensitiveApprove = 0.65`) y los topes del motor (`maxSteps`, `maxCallsPerStep`, `maxItemFailures`, `availableRoutes`) requieren medición en tareas reales.
- **Contexto real de Ollama vs configurado**: si el entorno fija `OLLAMA_CONTEXT_LENGTH=8192` o el Modelfile de `d3` fija `num_ctx 4096`, la guarda que calcula contra `16384` no protege; ajustar en PC o alinear en `jarvis-config.json` ([`../operacion/OLLAMA_MODELOS_TEXTO.md`](../operacion/OLLAMA_MODELOS_TEXTO.md)).
- **`list_directory` con `depth: 0`**: Desktop Commander devuelve `"Directorio vacío."` sobre carpetas no vacías (p. ej. `C:\Windows`), induciendo bucles; pendiente revisar extractor o exigir profundidad mínima `1`.
- **Falsos cierres sintéticos de D5**: en pruebas quitando el último paso (2/6 falsos cierres a `0.75`); falta un dataset formal de D5 en `eval/`.
- **Repetición de llamadas rechazadas sin ejecución**: el anti-bucle solo compara llamadas ejecutadas; un `args_invalid` repetido depende de `maxReviewRejectionsPerStep` (2), y tras un rechazo en `web_search` por `egress.ts` el modelo puede reformular y re-preguntar hasta agotar el paso.
- **Idioma y texto de reintento (`prompts.ts`)**: `retryNote` sigue en español (`ERROR_PREVIO: ...`) dentro de prompts en inglés; también falta modularizar `prompts.ts` en partes con nombre para variantes del eval y derivar `ReviewView` con `Omit` sobre `ArgsView`.
- **Heurística `sameItem` (`pendingList.ts`)**: sensible a pares parecidos con distinta entidad (p. ej. «10 tareas» vs «10 procesos»); ampliar solo con casos medidos.
- **Decision (`models/decision.ts` / `transport.ts`)**: `validateAnswer` asume `noul` para todo tipo distinto de `choice` (falta `switch` exhaustivo si se añade `score`); `DecisionValidationError` no adjunta salida cruda en traza.
- **`shortDesc` duplicado**: `shortDesc` recorta descripciones cuando `manifest.ts` ya rechaza descripciones > `MAX_TOOL_DESC_CHARS` al arrancar.
- **Salida de escape `wrong_group`**: diferida mientras baste agotar ruta tras 2 `not_accomplished`; reabrir solo si las trazas muestran exceso de llamadas en ruta equivocada.

## 3. Seguridad y API HTTP

- **Sin autenticación local**: `localOnly.ts` frena orígenes web, no otros procesos locales; `HOST=0.0.0.0` expone la API. `POST /config` permite editar `autoMode`, `approvalTiers`, `blacklist` y `retentionDays` sin autenticación adicional.
- **Sin rate limiting por segundo ni cifrado en reposo**: `refs` y trazas (`full.json.gz`) se guardan en texto plano durante `retentionDays`; `retention.ts` solo limpia por antigüedad y no tiene tope de tamaño en disco.
- **Límites léxicos de políticas**:
  - `policy/commandRules.ts`: no analiza llamadas .NET no estáticas (`(Get-Item x).Delete()`), variables dinámicas, rutas en tuberías ni concatenación de strings.
  - `policy/readOnly.ts`: lista cerrada conservadora; comandos seguros con paréntesis o `ForEach-Object` siguen pidiendo confirmación.
  - `policy/sensitivePaths.ts`: no resuelve symlinks, nombres cortos 8.3 (`PROGRA~1`), prefijos `\\?\` ni rutas UNC.
  - `policy/egress.ts`: cadenas alfanuméricas ≥ 40 caracteres (p. ej. SHAs de git) disparan confirmación como posibles claves.
- **API menor (`src/server/`)**: `ALL /refresh-discovery` acepta `GET` aun teniendo efecto; falta validar `GET /tasks/:id/refs/:refId` en Windows con una ref real generada en vivo; no se exponen en vivo la lista completa de pendientes ni decisiones intermedias por SSE.

## 4. Herramientas, Windows y MCP

- **Archivos nativos y reagrupación (D-15 a D-17)**: pendiente reagrupar `files`/`locate` en consultar y modificar, añadir herramientas nativas `find_files`, `copy_file`, `delete_file` (papelera de Windows + confirmación obligatoria en borrado recursivo) y lectura previa dirigida en `edit_block`.
- **`web_search`**: falta ampliar set de pruebas (recencia y multiparte), calibrar umbrales (0.6 / 0.3 / 0.34), preferir documentación oficial frente a blogs (`category`/`include_domains`/`source_type`) y cubrir `H-21` (fallo parcial de lote del juez) + errores de `free_search` (`RecursionError` / páginas vacías por JS).
- **Terminal Windows**: procesos que leen `stdin` sin escribir prompt (`findstr`, `node` leyendo stdin) quedan `running` hasta timeout; envoltorios OEM fallan con extensión explícita (`ipconfig.exe | ...`) o codepages sin tabla (852/857); sin gestión de procesos huérfanos desde la UI (`RC-25`); falta probar apps de Tienda Windows en uso real.
- **MCP terceros**: enviar `notifications/cancelled` por stdio al abortar una llamada MCP; confirmar si `mcpTimeoutMs` (60 s) requiere ajuste por herramienta.

## 5. Evaluación (`eval/` y `scripts/validate/`)

- Desalineaciones detalladas entre `eval/` y `src/` en [`../evaluacion/desalineaciones-eval.md`](../evaluacion/desalineaciones-eval.md).
- Actualizar datasets/prompts del laboratorio que aún citan `start_process`, `research` y `fetch`; unificar `facts.answer_<n>` de `scenario.ts` con `answer_<paso>_<n>` de producción; agregar etapas D0/D5 formales y script conversor de carpetas `jarvis-traces/` a escenarios.
- Sin tests automáticos para adaptadores `mcp/` reales, parser real de PowerShell en `precheck.ts` ni componentes `ui/`.

## 6. Horizonte JARVIS 2.0

- Consola pseudo-terminal (**ConPTY**) y **Job Objects** para REPLs completos, `isatty`, `-Confirm` y seguimiento de procesos fuera del árbol (`Start-Process`).
- Lecturas preparatorias de apoyo dentro del mismo paso (`role: support`, varias rutas por tool) y ejecución paralela de lecturas/procesos independientes.
- Recetas parametrizadas para comandos frecuentes y respuestas finales por plantilla cuando solo hubo escrituras.
- Captura conversacional de memoria («recordá que…») y recetas aprendidas (Capa 3 de `FRENTE_1_MEMORIA.md`).
