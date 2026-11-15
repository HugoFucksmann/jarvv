# Diagnóstico Técnico de Pendientes de Arquitectura y Comportamiento

Este documento consolida el análisis en código de los siete frentes pendientes identificados en la auditoría. **No aplica cambios funcionales**: documenta el estado actual, la causa raíz, los archivos y símbolos implicados, y las opciones de solución viables para abordarlos de forma controlada y medible.

## Índice

1. [D3 (`reviewArgs`) con modelo 2B y sin lecturas](#1-d3-reviewargs-con-modelo-2b-y-sin-lecturas)
2. [`approvalTiers` incompleto](#2-approvaltiers-incompleto)
3. [`allowedDirectories` estático, sin realpath y fuera de `jarvis_terminal`](#3-alloweddirectories-estático-sin-realpath-y-fuera-de-jarvis_terminal)
4. [`web_search`: consultas multiparte y recencia](#4-web_search-consultas-multiparte-y-recencia)
5. [Deep Research](#5-deep-research)
6. [Memoria manual (`data/memory.json`)](#6-memoria-manual-datamemoryjson)
7. [`PENDING_FACTS_LOOKUP = false`](#7-pending_facts_lookup--false)

---

## 1. D3 (`reviewArgs`) con modelo 2B y sin lecturas

### Estado actual
- En `src/core/engine/callRunner.ts` (líneas 366-419):
  - Las lecturas (`kind === "read"`, incluyendo `isReadOnlyCall`) nunca pasan por D3 (`callRunner.ts:403-405`).
  - Con `approvalTiers: true` (activo en `jarvis-config.json:48`), las llamadas verdes (`tier === "green"`) omiten D3, las rojas (`tier === "red"` o herramientas no catalogadas) van directo a confirmación del usuario (`askUser`), y **solo las amarillas** (`tier === "yellow"`) pasan por D3. Con `approvalTiers: false`, D3 solo actúa si `autoMode === true`.
- En `src/core/models/prompts.ts` (líneas 519-551, `buildArgsReview`):
  - El prompt de producción corresponde a la variante compacta (`args_review_compact_history`), que únicamente incluye:
    - `Target` (`input.step.instruction`),
    - `User Input`,
    - `Previous Errors` (`input.stepFailures`),
    - `Call` (`route/tool`),
    - `Args`.
  - Los campos `stepsDone`, `done`, `lastReads`, `env`, `description` y `schema` de `ReviewDecisionInput` (`src/core/contracts.ts:112-125`) sí se calculan en `src/core/engine/adapters.ts:197-208`, pero **`buildArgsReview` los ignora** por diseño de la variante ganadora en `eval/`.
- Según las mediciones documentadas en `docs/analisis/FRENTE_1_MEMORIA.md` (§159-169) y `docs/analisis/FUERA_DE_FRENTES.md` (§49-51), al someter a `d3:2b` a 5 rutas inventadas en escritura, aprobó las 5 con confianza `0.93–0.95`, por lo que hoy la contención real recae en `src/core/engine/precheck.ts` (`writeDestinationHasSource`, `checkParentFolder`) y `src/core/policy/commandRules.ts`.

### Causa raíz
1. **Prompt sin anclaje fáctico (`lastReads` / `env`)**: al omitir `lastReads` y `env` para reducir tokens y evitar falsos rechazos en 2B, D3 no puede distinguir una ruta existente/leída de una ruta alucinada si esa ruta logra pasar `precheck.ts`.
2. **Limitación estructural del clasificador 2B**: el modelo `d3:2b` está calibrado para coherencia superficial entre `Target` y `Args`, no para validar invariantes de sistema de archivos ni efectos laterales de comandos complejos.
3. **Asimetría entre `ReviewDecisionInput` y el prompt real**: el contrato y `reviewInput()` siguen generando contexto de lecturas que no se usa en producción.

### Archivos y símbolos implicados
- `src/core/engine/callRunner.ts`: flujo de aprobación (`tiered`, `tier`, `needsReview`, llamada a `env.decision.reviewArgs`, líneas 366-419).
- `src/core/models/prompts.ts`: `buildArgsReview` (líneas 519-551).
- `src/core/models/decision.ts`: `OllamaDecisionProvider.reviewArgs` (líneas 244-273).
- `src/core/engine/adapters.ts`: `reviewInput` y `candidateOf` (líneas 188-208).
- `src/core/ctx/views/review.ts`: construcción de `ReviewView` (`lastReads`, `stepsDone`, `env`).
- `src/core/engine/precheck.ts`: barrera determinista previa a D3 (`writeDestinationHasSource`, `checkParentFolder`).
- `docs/limitaciones/d3-2b.md`, `docs/analisis/FRENTE_1_MEMORIA.md`, `docs/analisis/FUERA_DE_FRENTES.md`.

### Opciones de solución
1. **Endurecer reglas deterministas en `precheck.ts` y `tiers.ts`, reduciendo el peso de D3**:
   - *Pros*: determinista, 0 ms de inferencia extra, no depende de capacidad 2B ni consume VRAM.
   - *Contras*: menos flexible ante casos semánticos sutiles entre instrucción y argumentos.
2. **Reintroducir señales compactas en `buildArgsReview` (p. ej. resumen de rutas conocidas/leídas + `env`) y recalibrar en `eval/datasets/args_review_D3/`**:
   - *Pros*: permite a D3 detectar rutas no vistas ni mencionadas por el usuario.
   - *Contras*: requiere re-evaluar falsos positivos en `eval/` (especialmente cuando el archivo destino aún no existe porque se va a crear).
3. **Promover acciones amarillas ambiguas a `red` cuando las rutas de destino no procedan de `request`, `userInput`, `memory` o `lastReads`**:
   - *Pros*: mantiene D3 liviano para coherencia de parámetros y delega la duda al usuario.
   - *Contras*: aumenta confirmaciones interactivas en tareas multipaso si el usuario no tolera interrupciones.

---

## 2. `approvalTiers` incompleto

### Estado actual
- El motor soporta niveles en `src/core/policy/tiers.ts` (`approvalTierOf`) y `src/core/engine/callRunner.ts:366-418`, controlado por `config.approvalTiers` (`src/core/config.ts:75,158` con default `false`, pero activado en `jarvis-config.json:48` como `true`).
- Sin embargo, la funcionalidad está incompleta en cuatro frentes documentados (`docs/CORE_FLOW.md:173`, `docs/JARVIS_EVALUACION.md:26`):
  1. **Sin exposición ni explicación en UI ni en Telegram**:
     - `ui/components/SettingsModal/SettingsModal.tsx:495-522` solo muestra el toggle y texto explicativo de `autoMode` («no pedirá confirmación para escribir, mover o ejecutar comandos»), lo cual es **falso cuando `approvalTiers: true`**, porque las operaciones `red` (p. ej. sobrescribir archivo existente, `run_command` fuera de la lista blanca) siguen pidiendo confirmación incluso con `autoMode: true`.
     - `src/telegram/bot.ts` (`/auto`) alterna `autoMode` sin advertir ni gestionar `approvalTiers`.
  2. **Sin allowlist persistente de usuario**: no existe opción «aprobar siempre este comando/herramienta» en el flujo de `ask_user` / confirmación de aprobación ni almacenamiento de reglas aprobadas.
  3. **Sin deduplicación tras rechazo (`user_rejected`)**: si el usuario rechaza una llamada sin añadir instrucciones nuevas, no hay registro específico que impida volver a proponer exactamente la misma acción dentro del paso/tarea más allá del historial general de `attempts` (`callRunner.ts`).
  4. **Cobertura limitada de herramientas y rutas en `tiers.ts`**:
     - Solo clasifica explícitamente `create_directory`, `write_file`, `move_file`, `run_command` y `stop_process`.
     - Cualquier otra herramienta no catalogada como `read` cae en `red` por defecto (`tiers.ts`).
     - En `write_file`, rutas relativas o sin resolver quedan en `yellow` en lugar de evaluarse respecto a existencia real tras resolver contra `cwd`/directorio base.

### Causa raíz
`approvalTiers` se implementó como opt-in en el motor (`callRunner.ts` + `tiers.ts`) sin cerrar su integración con la UI (`SettingsModal`), el diálogo de aprobación (`ask.ts` / SSE / UI chat), y la persistencia de preferencias de usuario.

### Archivos y símbolos implicados
- `src/core/policy/tiers.ts`: `approvalTierOf`, `safeCommandMatches` / clasificación de `write_file`, `move_file`, `create_directory`, `run_command`, `stop_process`.
- `src/core/engine/callRunner.ts`: líneas 366-419 (`tiered`, `tier`, `askUser`, `needsReview`).
- `src/core/engine/services.ts`: línea 71 (`approvalTiers: () => getConfig().approvalTiers`).
- `src/core/config.ts`: líneas 75, 158, 267 (`approvalTiers` default `false`).
- `jarvis-config.json`: línea 48 (`"approvalTiers": true`).
- `ui/components/SettingsModal/SettingsModal.tsx`: líneas 495-522 (sección `autoMode`, sin `approvalTiers`).
- `src/telegram/bot.ts`: comando `/auto`.

### Opciones de solución
1. **Completar visibilidad y coherencia UI/Telegram (bajo riesgo)**:
   - Añadir toggle de `approvalTiers` en `SettingsModal.tsx` y ajustar el copy de `autoMode` para reflejar cuándo aplican niveles vs modo binario.
   - *Pros*: elimina confusión inmediata del usuario sin cambiar reglas de seguridad.
   - *Contras*: no añade aún allowlist ni deduplicación.
2. **Allowlist de usuario + deduplicación de `user_rejected` (alcance completo)**:
   - Persistir comandos/patrones aprobados por el usuario (por sesión o en `jarvis-config.json` / archivo dedicado) y marcar rechazos por firma (`sig`) en `TaskContext` o en `precheck` para no re-preguntar sin cambios.
   - *Pros*: cumple lo especificado en `CORE_FLOW.md` y `JARVIS_EVALUACION.md`.
   - *Contras*: exige diseño de UX para gestionar/revocar la allowlist y evitar aprobaciones excesivamente amplias.
3. **Ampliar cobertura de `tiers.ts`**:
   - Resolver rutas relativas antes de comprobar `fs.existsSync` y alinear herramientas adicionales del catálogo (p. ej. `edit_block`).
   - *Pros*: clasifica `write_file`/`edit_block` de forma consistente con rutas absolutas y relativas.
   - *Contras*: depende del `cwd` efectivo de Desktop Commander si difiere del servidor Node.

---

## 3. `allowedDirectories` estático, sin realpath y fuera de `jarvis_terminal`

### Estado actual
- En `jarvis-config.json:24`, `desktopCommanderMcp.allowedDirectories` está vacío (`[]`, sin restricciones).
- En `src/core/mcp/desktopCommanderMcp.ts`:
  - `this.allowedDirectories` se fija una sola vez en el constructor (`líneas 39-44`).
  - `isPathAllowed` (`líneas 54-75`) resuelve con `path.resolve(targetPath)` contra `process.cwd()` del proceso Node principal y comprueba prefijo sobre `path.resolve(dir)`.
  - `callTool` (`líneas 78-94`) solo inspecciona los campos `path`, `directory`, `file`, `source`, `destination` y `paths[]` (saltando `read_file` si `isUrl: true`).
- Problemas detectados:
  1. **Snapshot estático frente a `POST /config`**: aunque `POST /api/jarvis/config` permite actualizar `desktopCommanderMcp.allowedDirectories` en caliente (`src/server/jarvisRouter.ts` / `config.ts:224-225`), `DesktopCommanderMCPServer` nunca vuelve a leer `getConfig()`, por lo que los cambios no surten efecto hasta reiniciar el servidor.
  2. **Bypass por symlinks / junctions y desfase de `cwd`**: al no usar `fs.realpathSync` (cuando la ruta o su ancestro existente existe), un symlink dentro de un directorio permitido que apunte fuera pasa la validación. Además, rutas relativas se resuelven con el `cwd` del backend Node, que puede no coincidir con el de Desktop Commander.
  3. **`jarvis_terminal:run_command` ignora `allowedDirectories`**: `TerminalProvider` (`server.ts:77`, `src/core/tools/terminal.ts`) y `Guard` (`src/core/policy/commandRules.ts`) no validan `allowedDirectories`, por lo que un comando de shell puede leer/escribir fuera de las carpetas permitidas si el usuario lo aprueba.
  4. **Invisibilidad en UI y riesgo con `refsDir`**: `SettingsModal.tsx` no tiene control para ver o editar `allowedDirectories`. Por otro lado, `src/core/engine/services.ts:39-47` emite un único `console.warn` al inicio si `refsDir` queda fuera de `allowedDirectories` (`coherenceWarned`), lo que bloquea al modelo cuando intenta leer refs grandes con `read_file`.

### Causa raíz
La restricción se implementó únicamente como un filtro léxico puntual en el wrapper MCP de `desktopCommanderMcp.ts` al iniciar el proceso, sin integrarla con recarga dinámica de configuración, resolución real de filesystem, UI ni política de terminal.

### Archivos y símbolos implicados
- `src/core/mcp/desktopCommanderMcp.ts`: `allowedDirectories`, `isPathAllowed`, `callTool` (líneas 39-94).
- `src/core/config.ts`: líneas 18, 141, 224-225 (`allowedDirectories`).
- `src/core/engine/services.ts`: `warnIfRefsOutsideAllowed` (líneas 39-60).
- `src/core/engine/precheck.ts`: `READ_REFS_NOTE` y validación de rutas / `refsDir`.
- `src/core/tools/terminal.ts` / `src/core/policy/commandRules.ts`: ejecución de `run_command` y validación de comandos.
- `ui/components/SettingsModal/SettingsModal.tsx`: ausencia de campo para `allowedDirectories`.

### Opciones de solución
1. **Lectura dinámica + `realpathSync` en `DesktopCommanderMCPServer` + campo en `SettingsModal`**:
   - Leer `getConfig().mcp.desktopCommanderMcp.allowedDirectories` en cada `callTool` (o suscribirse a `POST /config`), normalizar con `fs.realpathSync` sobre la ruta o el primer directorio padre existente, e incluir automáticamente `refsDir` (o advertir claramente en la UI si falta).
   - *Pros*: corrige cambios en caliente y bloquea escapes por symlink en herramientas de archivos.
   - *Contras*: no cubre comandos arbitrarios ejecutados por `run_command`.
2. **Extender validación a `run_command` (`cwd` y rutas detectables en `TerminalProvider` / `precheck`)**:
   - Exigir que `args.cwd` en `run_command` pertenezca a `allowedDirectories` cuando la lista no esté vacía y elevar a `red` o denegar comandos que referencien rutas absolutas externas.
   - *Pros*: cierra la brecha principal en PowerShell sin bloquear scripts dentro del workspace.
   - *Contras*: analizar rutas arbitrarias dentro de un string de PowerShell es heurístico (variables, aliases, pipes), por lo que el límite fuerte real en shell sigue requiriendo confirmación `red` o sandbox del SO.

---

## 4. `web_search`: consultas multiparte y recencia

### Estado actual
- **Multiparte**:
  - En `src/tools/web/webSearchProvider.ts` (líneas 471-472, 493, 507, 551), el flujo termina en estado `"found"` en cuanto **un solo** snippet (`snippets.filter(c => c.p >= JUDGE_FOUND)`) o **un solo** chunk de página (`scored[0].p >= JUDGE_FOUND`, con `JUDGE_FOUND = 0.6`) supera el umbral.
  - No existe descomposición de la consulta en sub-preguntas o facetas, ni verificación de cobertura conjunta (p. ej. si el usuario pide *A y B*, basta con que un fragmento responda bien a *A* para cortar la búsqueda y devolver `"found"` sin *B*).
  - Casos observados en `scripts/validate/web_eval/deep_probe.ts`: preguntas comparativas o multi-atributo como diferencias de rendimiento y compatibilidad entre Node 22 y 24, PostgreSQL 17 vs 16 en seguridad/rendimiento, o múltiples entidades/fechas en una consulta.
- **Recencia**:
  - `src/tools/web/args.ts` define `freshness`, `DEFAULT_MAX_AGE_HOURS = 24` (`webSearchProvider.ts:41`), `guardVersions` (`línea 164`) verifica versiones exactas `X.Y.Z`, `judgeNeed` inyecta `TODAY: YYYY-MM-DD`, y `dated()` antepone `[source date: ...]`.
  - Tres brechas permanecen abiertas:
    1. Muchas fuentes devueltas por Free Search no traen fecha (`source.date === undefined`), por lo que `dated()` no puede marcar antigüedad y `maxAgeHours` no las filtra.
    2. Cuando la pregunta pregunta por «último / actual / hoy» **sin** versión exacta `X.Y.Z` en el texto, `guardVersions` no actúa y el juez 2B suele dar `p >= 0.6` a resultados desactualizados de meses/años anteriores.
    3. Como registra `docs/analisis/FRENTE_2_CONTEXTO.md:88`, **`buildResultVerification` (D4) en `src/core/models/prompts.ts:558-592` no recibe `TODAY`**, por lo que D4 no tiene referencia temporal para rechazar una búsqueda web con datos viejos frente a la fecha actual.

### Causa raíz
El pipeline actual de `WebSearchProvider` está optimizado como búsqueda rápida de pasaje único (*first-hit stop* con presupuesto fijo `PASSAGES_BUDGET = 1700`, `RETURN_MAX = 4`), y la validación temporal descansa en metadatos opcionales del MCP más un juez 2B sin referencia temporal en D4.

### Archivos y símbolos implicados
- `src/tools/web/webSearchProvider.ts`: `JUDGE_FOUND`, `DEFAULT_MAX_AGE_HOURS`, `guardVersions`, `judgeNeed`, `dated`, bucles de corte temprano (`líneas 41, 47, 164, 471-551`).
- `src/tools/web/args.ts` y `src/tools/web/bm25.ts` y `src/tools/web/chunks.ts`.
- `src/core/models/prompts.ts`: `buildResultVerification` (líneas 558-592, ausencia de fecha actual `TODAY`), `FINAL_VIEW`.
- `scripts/validate/web_eval/deep_probe.ts`, `docs/web_search/README.md`, `docs/analisis/FRENTE_2_CONTEXTO.md`.

### Opciones de solución
1. **Para recencia (impacto acotado y medible)**:
   - Inyectar `TODAY: YYYY-MM-DD` (y opcionalmente marcar año actual esperado cuando `freshness` está activo) en `buildResultVerification` (D4) o desde `VerifyDecisionInput`, y exigir año/fecha reciente en `guardVersions` / reglas deterministas cuando `freshness` está presente y la fuente sí tiene fecha antigua explícita.
   - *Pros*: reduce respuestas viejas aceptadas como válidas sin cambiar todo el buscador.
   - *Contras*: si la página no reporta fecha (`source.date === undefined`), sigue siendo necesario extraer fechas dentro del texto del snippet/chunk.
2. **Para multiparte (búsqueda por facetas)**:
   - Detectar conectores o cláusulas múltiples en `query` (o usar una mini descomposición en 2–3 subconsultas), puntuar cobertura por faceta antes de cortar en `"found"`, y repartir `RETURN_MAX` / `PASSAGES_BUDGET` entre facetas en lugar de tomar los top-N globales de un solo aspecto.
   - *Pros*: evita que un solo fragmento fuerte oculte partes faltantes de la respuesta.
   - *Contras*: aumenta llamadas al juez 2B y latencia si no se limita a consultas detectadas como compuestas.

---

## 5. Deep Research

### Estado actual
- Documentado extensamente en `docs/web_search/DEEP_RESEARCH.md` (estado explícito: **EN PAUSA — 2026-11-13**) y explorado en `scripts/validate/web_eval/deep_probe.ts` y `scripts/validate/web_eval/research.ts`.
- **No está implementado en `src/`**. En `src/core/tools/manifest.ts:243` existe un resto de definición `free_search:research` que **no forma parte de `WEB_DEPENDENCIES`** (`src/core/tools/web.ts` / `jarvisRouter.ts`) y solo se conserva por cobertura de políticas en tests (`tests/repeat.test.ts:179`, `tests/sensitive.test.ts:95`).
- Hoy toda consulta web pasa por `WebSearchProvider` en modo rápido con topes fijos: `SEARCH_RESULTS = 8`, `DEFAULT_PAGES = 3`, `PASSAGES_BUDGET = 1700`, `maxCallsPerStep = 6` (`src/core/engine/limits.ts`), `timeoutMs = 150_000`.
- Además, los probes de `deep_probe.ts` registraron fallos reales del MCP `free_search` al leer páginas completas (`read_doc`/`fetch` con `RecursionError` en sitios como `redis.io` y páginas renderizadas por JS vacías).

### Causa raíz
Un modo de investigación profunda requiere múltiples rondas de búsqueda, seguimiento de fuentes autoritativas, verificación cruzada de citas literales y mayor presupuesto de lectura/síntesis, lo cual choca con los presupuestos estrictos del paso reactivo estándar (`6` llamadas por paso, `1700` caracteres de salida web, modelo 4B de contexto acotado) y con la fragilidad de extracción HTML de `free_search` en ciertos sitios.

### Archivos y símbolos implicados
- `docs/web_search/DEEP_RESEARCH.md`: especificación y hallazgos de pausa.
- `scripts/validate/web_eval/deep_probe.ts` y `scripts/validate/web_eval/research.ts`.
- `src/tools/web/webSearchProvider.ts`: proveedor actual (`WebSearchProvider`, límites fijos).
- `src/core/tools/manifest.ts`: línea 243 (`free_search:research`).
- `src/core/engine/limits.ts`: `maxCallsPerStep = 6`.
- `tests/repeat.test.ts:179`, `tests/sensitive.test.ts:95`.

### Opciones de solución
1. **Mantener pausa y alinear contratos mínimos**:
   - Dejar `deep_research` fuera del motor reactivo hasta resolver multiparte y recencia en `web_search` base; documentar claramente el rol de `free_search:research` en `manifest.ts`.
   - *Pros*: evita complejidad prematura sobre un MCP (`free_search`) que aún falla en páginas JS/recursivas.
   - *Contras*: preguntas de investigación abierta siguen limitadas a 1 búsqueda rápida con `PASSAGES_BUDGET = 1700`.
2. **Implementar herramienta dedicada (`web_research` / `deep_research`) aislada del paso corto**:
   - Ejecutar un sub-flujo con descomposición en sub-consultas, filtrado de dominios, descarga acotada por sección (evitando `RecursionError` o con fallback a otro extractor), almacenamiento del reporte en `ref` (`refsDir`) y verificación extractiva de citas antes de devolver el resumen al paso principal.
   - *Pros*: no infla el presupuesto ni los prompts de tareas normales y aprovecha el mecanismo de `refs` ya existente en `src/core/refs/`.
   - *Contras*: latencia alta (decenas de segundos) y requiere corregir o sustituir el scraper de `free_search` para sitios con JS / HTML complejo.

---

## 6. Memoria manual (`data/memory.json`)

### Estado actual
- De la arquitectura planteada en `docs/analisis/FRENTE_1_MEMORIA.md` (3 capas), solo existen parcialmente la Capa 1 y la Capa 2:
  - **Capa 1 (`src/core/memory.ts`)**: `createMemoryReader` lee `data/memory.json` (con caché por `mtimeMs`), y devuelve `{ key, value }` cuya clave coincida con la consulta mediante `selectFacts`.
  - **Capa 2 (`src/core/engine/thread.ts`)**: memoria en RAM de 10 minutos para continuaciones de hilo (`previous request` / `previous answer`).
  - **Capa 3 (recetas aprendidas)**: no implementada.
- Limitaciones operativas de la memoria manual actual:
  1. **Sin interfaz ni API ni captura por conversación**: el archivo `data/memory.json` solo puede crearse o editarse a mano en disco. No existen endpoints HTTP (`/api/jarvis/memory`), pestaña/modal en `ui/`, comando de Telegram ni herramienta/intención para «recordá que… / olvidá…». Si el archivo no existe, `createMemoryReader` devuelve `[]` silenciosamente.
  2. **Coincidencia estricta por stems (`selectFacts`, `src/core/memory.ts:60-71`)**: exige que **todos** los tokens no-stopword (`stemsOf`) de `fact.key` aparezcan en `request + step.instruction` (con truncado fijo a 5 caracteres). Sinónimos, plurales que difieran en los primeros 5 caracteres, errores tipográficos o menciones implícitas hacen que el hecho no se recupere; además, tiene tope duro `MAX_FACTS_PER_PROMPT = 3`.
  3. **Alcance reducido en el pipeline**: los hechos de `memory` solo se inyectan en `ARGUMENTS_VIEW` (`callRunner.ts:318` vía `argsInput`) y en `precheck.ts` (`collectSources`). Ni `pending` (`PENDING_VIEW`), ni `plan`, ni `D3` (`reviewArgs`), ni `final` los reciben. En particular, si `pending` necesita un dato personal guardado en `memory.json` para formular el paso correcto o evitar una búsqueda innecesaria, no lo ve.
  4. **Sin persistencia de descubrimientos**: respuestas útiles de `ask_user` (`facts.answer_*`) o rutas frecuentes descubiertas durante tareas no se promueven a memoria persistente.

### Causa raíz
La Capa 1 se construyó como un almacén mínimo de lectura pasiva para ayudar al generador de argumentos (`ARGUMENTS_VIEW` + `precheck`), dejando fuera la gestión por parte del usuario y la recuperación flexible entre etapas.

### Archivos y símbolos implicados
- `src/core/memory.ts`: `createMemoryReader`, `selectFacts`, `stemsOf`, `MAX_FACTS_PER_PROMPT`.
- `src/core/engine/callRunner.ts`: línea 318 (inyección en `argsInput`).
- `src/core/engine/adapters.ts`: línea 112 (`argsInput` con parámetro `memory`), resto de adaptadores (`pendingInput`, `planInput`, `reviewInput`) sin `memory`.
- `src/core/engine/precheck.ts`: `collectSources` (validación de rutas contra `facts`).
- `src/core/engine/services.ts`: instanciación de `createMemoryReader`.
- `docs/analisis/FRENTE_1_MEMORIA.md`, `docs/CONTEXT_AND_MEMORY.md`.

### Opciones de solución
1. **CRUD mínimo de memoria en API + UI (recomendado como primer paso)**:
   - Añadir rutas `GET/POST/PUT/DELETE /api/jarvis/memory` en `jarvisRouter.ts` y un panel ligero en `SettingsModal` (o barra superior) para listar, agregar y borrar `{ key, value }` en `data/memory.json`.
   - *Pros*: hace usable la memoria ya existente sin tocar prompts ni modelos.
   - *Contras*: mantiene las limitaciones de matching exacto de `selectFacts`.
2. **Mejorar recuperación y visibilidad en etapas tempranas**:
   - Permitir tags/alias opcionales en cada entrada de `memory.json` o puntuación por solapamiento parcial (en lugar de exigir 100 % de los stems de `key`), e inyectar hechos relevantes en `pendingInput` y `planInput`.
   - *Pros*: evita pasos mal formulados cuando la preferencia del usuario condiciona el plan (p. ej. carpeta de proyectos por defecto).
   - *Contras*: exige medir en `eval/` que la inyección en `pending`/`plan` no introduzca ruido.
3. **Captura explícita desde chat/Telegram («recordá que…»)**:
   - Añadir herramienta/intención dedicada o comando `/recordar` que escriba en `data/memory.json` previa confirmación o regla explícita.
   - *Pros*: flujo natural sin abrir configuración.
   - *Contras*: requiere cuidar cuándo un comentario casual debe persistirse o no.

---

## 7. `PENDING_FACTS_LOOKUP = false`

### Estado actual
- En `src/core/models/prompts.ts:78`, está fija la bandera:
  ```ts
  export const PENDING_FACTS_LOOKUP = false;
  ```
- Cuando es `false`, `PENDING_VIEW.SYSTEM` (`prompts.ts:231`) indica a Qwen devolver una lista vacía `[]` ante preguntas de conocimiento general, sin la excepción para hechos recientes o cambiantes (`news, releases, dates, prices, versions`).
- Interacción con D0 (`src/core/engine/classify.ts`, `src/core/engine/firstQuery.ts`, `src/core/engine/runTask.ts:93-101`):
  - En solicitudes iniciales simples, si D0 clasifica como `"single"` (recordando que `FIRST_QUERY_CHAT_APPROVE = 0.7`, por lo que preguntas fácticas que rondan `0.51–0.65` de `chat` caen en `"single"`), `runReactive` ejecuta un paso directo sin entrar a `pending`, sorteando temporalmente la regla restrictiva de `PENDING_VIEW`.
  - **Sin embargo, `PENDING_FACTS_LOOKUP = false` sigue rompiendo búsquedas de hechos actuales o cambiantes en cuatro escenarios reales**:
    1. **Tareas compuestas (`first === "multi"`)**: p. ej. *«buscá el último modelo de X y guardalo en notas.txt»*; entran a `pending` y la regla puede descartar el subpaso de búsqueda si lo interpreta como pregunta general o no cambiante.
    2. **Continuaciones de hilo (`env.follow.thread !== null`)**: p. ej. *«¿y el precio actual del otro?»*; toda continuación entra a `pending` (`runTask.ts`), donde vuelve a aplicar `PENDING_VIEW`.
    3. **Fallback cuando D0 falla o no está disponible (`classifyRequest` devuelve `null`)**: la tarea cae al flujo reactivo estándar pasando por `pending`.
    4. **Revisión de pendientes tras un fallo**: si una acción falla dentro de `runReactive` y vuelve a evaluarse `pending`, Qwen relee `PENDING_VIEW` con la regla restrictiva.
- Por otro lado, según las pruebas históricas documentadas (`docs/JARVIS_EVALUACION.md:140`, `docs/analisis/FRENTE_3_DECISION.md` y variantes en `eval/variants/Pending/`), activar `PENDING_FACTS_LOOKUP = true` subió de `0/12` a `11/12` en consultas de hechos cambiantes, **pero** provocó 2 regresiones (`-5.2%`) en `eval/datasets/pending/llm_pending_hard.jsonl` (`pending-hard-008` perdió una URL literal del pedido y `pending-hard-026` se clasificó mal).

### Causa raíz
Se dejó desactivada la cláusula de búsqueda web en `PENDING_VIEW` tras descubrir regresiones en `llm_pending_hard.jsonl`, confiando en D0 (`first === "single"`) como atajo para preguntas sueltas, lo cual deja desprotegidos los casos `multi`, continuaciones con hilo y fallbacks sin D0.

### Archivos y símbolos implicados
- `src/core/models/prompts.ts`: `PENDING_FACTS_LOOKUP` (línea 78), `PENDING_VIEW.SYSTEM` (línea 231).
- `src/core/engine/firstQuery.ts`: `FIRST_QUERY_CHAT_APPROVE = 0.7`, `firstQueryKind` (líneas 13-22).
- `src/core/engine/classify.ts`: `classifyRequest`, `detectContinuation`.
- `src/core/engine/runTask.ts`: enrutado por `first` y `follow.thread` (líneas 93-101 y flujo reactivo).
- `eval/datasets/pending/llm_pending_hard.jsonl` y `eval/variants/Pending/conclusiones_pending.md`.

### Opciones de solución
1. **Calibrar el wording en `PENDING_VIEW.SYSTEM` y validar en `eval/` (PC Windows + Ollama)**:
   - Ajustar la excepción para distinguir claramente: (a) conocimiento estático sin necesidad de PC -> `[]`, (b) dato cambiante/reciente sin URL dada -> item de búsqueda web preservando nombres/fechas exactas, (c) pedido con URL explícita -> preservar URL literal en el ítem (atacando la regresión `pending-hard-008`).
   - *Pros*: unifica comportamiento en `single`, `multi`, hilos y fallback sin D0.
   - *Contras*: requiere ejecutar el suite de `eval/` (`pending` + `hard`) con el modelo 4B para garantizar 0 regresiones.
2. **Clasificación explícita en D0 / `Pending` separando `chat` / `web_fact` / `task`**:
   - En lugar de delegar la frontera en una oración condicional dentro del prompt generativo 4B, detectar si la solicitud requiere consulta web actual en la etapa de clasificación (`D0` o regla previa en continuaciones) o inyectar esa pista solo cuando aplique.
   - *Pros*: evita que la regla de hechos cambiantes contamine pedidos con URLs o tareas locales en `llm_pending_hard`.
   - *Contras*: añade diseño/evaluación de dataset en D0 para continuaciones y tareas `multi`.
