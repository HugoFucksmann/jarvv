# Diagnóstico Técnico de Pendientes de Arquitectura y Comportamiento

Este documento consolida el análisis en código de los frentes pendientes identificados en la auditoría. Documenta el estado, la causa raíz, los archivos y símbolos implicados y las opciones de solución. **Actualizado el 2026-11-15**: las secciones 2 y 3 llevan un bloque «Actualización» con lo que ya se resolvió; el texto de «Estado actual» que sigue a ese bloque es el diagnóstico original (histórico). Las secciones 7 a 11 resumen lo menor, D5, el anti-bucle, el terminal y `refsDir`.

## Índice

1. [D3 (`reviewArgs`) con modelo 2B y sin lecturas](#1-d3-reviewargs-con-modelo-2b-y-sin-lecturas)
2. [`approvalTiers`](#2-approvaltiers-incompleto)
3. [`allowedDirectories`](#3-alloweddirectories-estático-sin-realpath-y-fuera-de-jarvis_terminal)
4. [`web_search`: consultas multiparte y recencia](#4-web_search-consultas-multiparte-y-recencia)
5. [Memoria manual (`data/memory.json`)](#5-memoria-manual-datamemoryjson)
6. [`PENDING_FACTS_LOOKUP = false`](#6-pending_facts_lookup--false)
7. [Pendientes técnicos menores (revisión 2026-11-15)](#7-pendientes-técnicos-menores-revisión-2026-11-15)
8. [Falsos cierres de Decisión 5](#8-falsos-cierres-de-decisión-5)
9. [Anti-bucle con llamadas rechazadas sin ejecución](#9-anti-bucle-con-llamadas-rechazadas-sin-ejecución)
10. [Terminal Windows](#10-terminal-windows-srctoolsterminal)
11. [`refsDir`: cómo se leen los refs](#11-refsdir-cómo-se-leen-los-refs-investigación-sin-implementar)

---

## 1. D3 (`reviewArgs`) con modelo 2B y sin lecturas

> **Investigación y flags (2026-11-15).**
>
> **Causa en el código.** `callRunner.ts` solo pasa por D3 las escrituras que el usuario no aprobó y que no son verdes (`reviewApplies`); las lecturas nunca (D3 rechazaba lecturas correctas, medido). `prompts.ts#buildArgsReview` arma el estado solo con `Target`, `User Input`, `Previous Errors`, `Call` y `Args`, aunque `adapters.ts#reviewInput` y `ctx/views/review.ts` ya calculan `lastReads`, `env`, `done` y `stepsDone` (trabajo que se descarta). Medido en `eval/` (variante `args_review_compact_history`, 72,9 % frente a 62,5 %): agregar las lecturas no cambió el resultado y agregar el schema lo bajó a 70,8 %. Medido en `FRENTE_1_MEMORIA.md`: D3 aprobó 5 de 5 rutas inventadas con 0,93 a 0,95; la barrera real contra valores fabricados es `precheck.ts`, no D3.
>
> **Opciones.**
> | Opción | Pros | Contras / latencia |
> |---|---|---|
> | A. Vista completa (lecturas recientes + entorno en el prompt de D3) | Permite contrastar rutas y nombres con lo leído | En el eval no mejoró; más tokens por consulta (D3 ronda 255 tokens y ~42 ms en el eval; la latencia sube con los tokens, estimación no medida); riesgo de falsos rechazos nuevos |
> | B. Que D3 valide lecturas | Frena lecturas con argumentos absurdos | Doble de consultas a D3 (una por lectura, hoy cero); ya rechazaba lecturas correctas; el pre-chequeo de código ya cubre las rutas inventadas |
> | C. Endurecer `precheck.ts` (determinista) | 0 ms, sin riesgo de modelo | Solo cubre lo comprobable (ruta, URL, marcadores) |
>
> **Recomendación.** Priorizar C (hecho en parte: el pre-chequeo es ahora un registro de reglas con validaciones nuevas de ruta, URL y tipo en disco; ver `CORE_FLOW.md` 6b) y no encender A ni B hasta medirlas: D3 2B no discrimina valores inventados ni con más contexto (el contexto no era el límite, lo era el clasificador). Si se prueba, A primero (menor costo) y solo en escrituras.
>
> **Implementado, apagado por defecto** (en `jarvis-config.json`, claves de primer nivel; se leen en cada llamada): `reviewFullView` (A: suma `Recent reads` y `Environment` al prompt de D3) y `reviewReads` (B: las lecturas también pasan por D3, con el umbral normal). Sin flags el prompt y el flujo son idénticos a antes (el eval no se modificó: `buildArgsReview` solo recibió un segundo parámetro opcional).
>
> **Qué medir tú.** Dataset `args_review_D3` con y sin `reviewFullView` (aciertos y falsos rechazos, sobre todo en rutas inventadas); latencia p50/p95 de D3; con `reviewReads`, la tasa de lecturas legítimas rechazadas (`args_invalid` en lecturas) en tareas reales y los `maxReviewRejectionsPerStep` que cortan pasos.

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
- Según las mediciones documentadas en [`FRENTE_1_MEMORIA.md`](../evaluacion/analisis/FRENTE_1_MEMORIA.md) (§159-169), al someter a `d3:2b` a 5 rutas inventadas en escritura, aprobó las 5 con confianza `0.93–0.95`, por lo que hoy la contención real recae en `src/core/engine/precheck.ts` (`writeDestinationHasSource`, `checkParentFolder`) y `src/core/policy/commandRules.ts`.

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
- `docs/evaluacion/limitaciones/d3-2b.md`, `docs/evaluacion/analisis/FRENTE_1_MEMORIA.md`.

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

> **Actualización (2026-11-15).**
> - **Hecho:** `approvalTiers` es `true` por defecto (`config.ts`) y los niveles funcionan con `autoMode` activo (`callRunner.ts`, `askUser`/paso 8): verde no pide al usuario ni pasa por D3; amarillo no pide al usuario y pasa por D3 con umbral estricto (si D3 no aprueba, rechazo o `args_invalid` como siempre); rojo siempre pide al usuario. Guard (`DENY` y `mandatory`), la lista negra y el pre-chequeo no cambian. `SettingsModal.tsx` tiene el toggle de `approvalTiers` y el copy de `autoMode` ya explica que lo rojo se sigue confirmando.
> - **Sin `autoMode` (definido):** verde pasa sin pedir; amarillo y rojo piden al usuario, y esa aprobación sustituye a D3 (`callRunner.ts`, `askUser`).
> - **Aprobar una vez / siempre en esta tarea (hecho):** el diálogo de aprobación (UI y Telegram) ofrece «Aprobar una vez» y «Aprobar siempre en esta tarea». «Siempre» vive solo en la RAM de la tarea (`TaskRuntime`), con clave herramienta + comando normalizado o ruta normalizada (`policy/approvalKey.ts`), y no sobrevive a la tarea. No se ofrece (solo «una vez») para lo obligatorio de Guard, la lista negra ni lo que `allowedDirectories` no pudo resolver. Quien aprueba «siempre» sustituye a D3 en esas llamadas, igual que una aprobación puntual. No hay allowlist persistente.
> - **Deduplicación tras `user_rejected` (hecho):** tras un rechazo del usuario, la misma clave no se vuelve a preguntar en esa tarea; la llamada queda `user_rejected` con una nota y cuenta contra `maxUserRejectionsPerStep`.
> - **Aviso de niveles en Telegram (hecho):** la confirmación de `/auto on` explica los tres niveles y cuándo se pregunta.
> - **Rutas relativas (hecho):** `tiers.ts` resuelve una ruta relativa contra la carpeta de trabajo de la herramienta (`toolBaseDir`: `desktopCommanderMcp.cwd` o la del proceso; es la misma base que usa `allowedDirectories`) antes de comprobar si existe; sin base absoluta sigue en amarillo. `edit_block` (en pausa) queda en rojo.
> - **Pendiente a propósito:** allowlist persistente entre tareas.

### Estado actual
- El motor soporta niveles en `src/core/policy/tiers.ts` (`approvalTierOf`) y `src/core/engine/callRunner.ts:366-418`, controlado por `config.approvalTiers` (`src/core/config.ts:75,158` con default `false`, pero activado en `jarvis-config.json:48` como `true`).
- Sin embargo, la funcionalidad está incompleta en cuatro frentes documentados (`docs/arquitectura/CORE_FLOW.md`, `docs/evaluacion/JARVIS_EVALUACION.md:26`):
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

> **Actualización (2026-11-15).**
> - **Hecho:** `src/core/policy/allowedDirs.ts` (`checkAllowedDirectory`, `canonicalPath`) compara con `realpathSync` (desciende al ancestro existente si la hoja no existe; quita `\\?\`). `callRunner.ts` paso 6c lo aplica a **todas** las herramientas con ruta y a `run_command` (su `cwd` y las rutas detectadas por el AST de PowerShell, `detectedPaths`/`unresolvablePaths`). Lo fuera de alcance se rechaza (`tool_rejected`); lo que no se puede resolver (variables, rutas relativas sin base, comando no analizable) pide confirmación al usuario. La configuración se lee en vivo (`deps.allowedDirectories`, y el wrapper de Desktop Commander y `TerminalProvider` reciben una función, no un snapshot). `SettingsModal.tsx` permite ver, agregar y quitar carpetas.
> - **Pendiente:** el análisis de PowerShell sigue siendo heurístico; en plataformas distintas de Windows `run_command` no se analiza y cae en «pide confirmación». Sin pruebas automáticas del flujo completo (solo `tests/hardening.test.ts` cubre `checkAllowedDirectory`).

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

> **Investigación ampliada (2026-11-15, solo análisis: NO implementado).** Todo lo siguiente está verificado en `src/tools/web/webSearchProvider.ts`, `args.ts` y `models/prompts.ts`.
>
> ### Multiparte
> **Mecanismo.** `lookup` (etapa 1) puntúa cada extracto contra el `need` **completo** (una probabilidad por fragmento, lotes de 5). Si **algún** extracto llega a `JUDGE_FOUND` (0,6) devuelve `found` con hasta `SNIPPET_RETURN_MAX = 3` extractos de fuentes distintas y corta; la etapa 2 (leer páginas de a una, hasta `DEFAULT_PAGES = 3`) solo corre si ningún extracto responde. No hay facetas: un extracto que responde bien a la parte A de «A y B» basta. Después, D4 (`buildResultVerification`) juzga el resultado contra la instrucción del paso, pero ve solo el texto devuelto (topado por `PASSAGES_BUDGET`) y no sabe qué faceta falta.
>
> **Causa raíz.** Se optimizó para «un pasaje que responde» (primer acierto corta), y el criterio de cobertura es por fragmento, no por pregunta. Además `RETURN_MAX = 4` y el presupuesto fijo reparten el espacio por puntuación global, no por faceta.
>
> | Opción | Pros | Contras / latencia |
> |---|---|---|
> | A. Dividir `need` en facetas (conectores `y/and/vs/compar/diferencia`, `;`, comas) y exigir un extracto fuerte por faceta antes de `found` | Ataca la causa | +1 consulta al juez por faceta (≈ decenas de ms cada una, estimación); la división léxica falla («blanco y negro»); más código |
> | B. Chequeo determinista de cobertura de términos: los términos que distinguen del `need` (sin palabras vacías, con `stemsOf`) deben aparecer en el conjunto de pasajes devueltos; si faltan, `found` pasa a `partial` y se nota qué faltó | 0 ms de modelo; reutiliza el mecanismo de `COVERAGE_PARTIAL`; `partial` ya empuja a leer páginas y le dice al modelo qué falta | Cuando falta cobertura agrega lecturas de página (segundos, hasta 3); falsos «falta» con sinónimos |
> | C. Que el planificador (`pending`) parta el pedido en un paso por faceta | Sin cambios en el proveedor; cada `web_search` tiene una sola necesidad | Depende del 4B; no controla el caso «una frase, dos preguntas» dentro de un solo paso |
> | D. Subir `RETURN_MAX`/`PASSAGES_BUDGET` | Más espacio para varias facetas | Más tokens para D4 y el generador final; no cambia el corte temprano |
>
> **Recomendación.** B (determinista y barata; solo degrada `found` a `partial` cuando falta un término fuerte) combinada con C (ya existe: D0 `multi` + `pending`); A solo si B muestra muchos falsos «falta». Descartar D.
>
> ### Recencia
> **Mecanismo.** `freshness` (`day|week|month|year`) es un argumento opcional que elige el modelo generativo; sin él no se filtra por fecha. `DEFAULT_MAX_AGE_HOURS = 24` solo limita la caché de Free Search. El juez recibe `TODAY: AAAA-MM-DD` (`judgeNeed`) y cada fragmento con `[source date: X|unknown]` (`dated`); su criterio de `true` exige «el más reciente a la fecha de HOY» si la pregunta lo pide. `guardVersions` solo actúa con versiones exactas (`X.Y.Z`) en la pregunta. Si hay filtros y no hay resultados, reintenta sin filtros y lo avisa (`relaxed`).
>
> **Brechas.** (1) Muchas fuentes no traen fecha (`source.date === undefined` → `unknown`): el juez no puede distinguir. (2) Sin versión exacta, «¿cuál es la última…?» no tiene guarda: el 2B da `p ≥ 0,6` a resultados de meses o años atrás. (3) `buildResultVerification` (D4) **no recibe `TODAY`**: el único verificador que decide si el paso se cumplió no puede rechazar datos viejos (`FRENTE_2_CONTEXTO.md:88`). Ojo: se midió que dar `TODAY` a `pending` **empeoró** el resultado (79,2 %), así que no debe replicarse allí.
>
> | Opción | Pros | Contras / latencia |
> |---|---|---|
> | A. Poner `TODAY` en el estado de D4 solo para pasos de `web_search` | ~15 tokens; permite rechazar lo viejo | Cambia lo que ve D4: hay que medir en `eval/` (no verificado que no regrese) |
> | B. Guarda determinista de fecha en el proveedor: si el `need` tiene palabras de recencia (`último/actual/latest/current/hoy/today`) y la fuente tiene fecha con más de N meses, limitar `p` por debajo de `JUDGE_FOUND` (como `guardVersions`) | 0 ms; no depende del modelo; parcial en vez de `found` empuja a leer más | Sin fecha no actúa; el umbral N es una decisión de producto |
> | C. Extraer fechas del texto del fragmento (años y meses con regex) cuando `source.date` falta | Cubre la brecha 1 | Heurística; falsos positivos con fechas históricas citadas |
> | D. `freshness: "year"` por defecto ante palabras de recencia | Filtra en origen | Ya hay reintento sin filtros, pero si Free Search desconoce la fecha de la fuente la descarta |
>
> **Recomendación.** B + C (deterministas, comparten la tabla de fechas) y A solo si la medición lo aprueba; D después de ver cuántas fuentes llegan con fecha.
>
> ### Qué medir tú
> - Multiparte: un conjunto de preguntas A+B (p. ej. «diferencias Node 22 y 24», «PostgreSQL 17 vs 16») → fracción con ambas facetas cubiertas en lo devuelto; tasa de `found` que pasa a `partial` con B; páginas leídas y latencia extra.
> - Recencia: preguntas «última/actual» con respuesta conocida y fuentes viejas → fracción de respuestas desactualizadas aceptadas (`found` con fuente vieja); proporción de fuentes con `source.date`; con A, regresiones de D4 en el eval.

### Estado actual
- **Multiparte**:
  - En `src/tools/web/webSearchProvider.ts` (líneas 471-472, 493, 507, 551), el flujo termina en estado `"found"` en cuanto **un solo** snippet (`snippets.filter(c => c.p >= JUDGE_FOUND)`) o **un solo** chunk de página (`scored[0].p >= JUDGE_FOUND`, con `JUDGE_FOUND = 0.6`) supera el umbral.
  - No existe descomposición de la consulta en sub-preguntas o facetas, ni verificación de cobertura conjunta (p. ej. si el usuario pide *A y B*, basta con que un fragmento responda bien a *A* para cortar la búsqueda y devolver `"found"` sin *B*).
  - Casos observados en sondeos anteriores (script retirado): preguntas comparativas o multi-atributo como diferencias de rendimiento y compatibilidad entre Node 22 y 24, PostgreSQL 17 vs 16 en seguridad/rendimiento, o múltiples entidades/fechas en una consulta.
- **Recencia**:
  - `src/tools/web/args.ts` define `freshness`, `DEFAULT_MAX_AGE_HOURS = 24` (`webSearchProvider.ts:41`), `guardVersions` (`línea 164`) verifica versiones exactas `X.Y.Z`, `judgeNeed` inyecta `TODAY: YYYY-MM-DD`, y `dated()` antepone `[source date: ...]`.
  - Tres brechas permanecen abiertas:
    1. Muchas fuentes devueltas por Free Search no traen fecha (`source.date === undefined`), por lo que `dated()` no puede marcar antigüedad y `maxAgeHours` no las filtra.
    2. Cuando la pregunta pregunta por «último / actual / hoy» **sin** versión exacta `X.Y.Z` en el texto, `guardVersions` no actúa y el juez 2B suele dar `p >= 0.6` a resultados desactualizados de meses/años anteriores.
    3. Como registra `docs/evaluacion/analisis/FRENTE_2_CONTEXTO.md:88`, **`buildResultVerification` (D4) en `src/core/models/prompts.ts:558-592` no recibe `TODAY`**, por lo que D4 no tiene referencia temporal para rechazar una búsqueda web con datos viejos frente a la fecha actual.

### Causa raíz
El pipeline actual de `WebSearchProvider` está optimizado como búsqueda rápida de pasaje único (*first-hit stop* con presupuesto fijo `PASSAGES_BUDGET = 1700`, `RETURN_MAX = 4`), y la validación temporal descansa en metadatos opcionales del MCP más un juez 2B sin referencia temporal en D4.

### Archivos y símbolos implicados
- `src/tools/web/webSearchProvider.ts`: `JUDGE_FOUND`, `DEFAULT_MAX_AGE_HOURS`, `guardVersions`, `judgeNeed`, `dated`, bucles de corte temprano (`líneas 41, 47, 164, 471-551`).
- `src/tools/web/args.ts` y `src/tools/web/bm25.ts` y `src/tools/web/chunks.ts`.
- `src/core/models/prompts.ts`: `buildResultVerification` (líneas 558-592, ausencia de fecha actual `TODAY`), `FINAL_VIEW`.
- `docs/arquitectura/TOOLS.md`, `docs/evaluacion/analisis/FRENTE_2_CONTEXTO.md`.

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

## 5. Memoria manual (`data/memory.json`)

> Plan de diseño (sin implementar): [`MEMORIA_PLAN.md`](MEMORIA_PLAN.md).

### Estado actual
- De la arquitectura planteada en `docs/evaluacion/analisis/FRENTE_1_MEMORIA.md` (3 capas), solo existen parcialmente la Capa 1 y la Capa 2:
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
- `docs/evaluacion/analisis/FRENTE_1_MEMORIA.md`, `docs/arquitectura/CONTEXT_AND_MEMORY.md`.

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

## 6. `PENDING_FACTS_LOOKUP = false`

> **Investigación ampliada (2026-11-15, solo análisis: NO implementado).**
>
> **Qué hace cada camino hoy** (`runTask.ts:93-175`):
> - `first === "single"` y sin hilo: `pending = [request]` y `askModel = false`; **`pending` no se consulta** y D1 elige la ruta (una pregunta de hechos va a `web`). Es el camino que hoy salva a las preguntas sueltas.
> - `chat` (D0 ≥ 0,7): cierra sin herramientas.
> - `multi`, continuación de hilo y D0 caído (`classifyRequest` devuelve `null`): entran a `generatePending` con `PENDING_VIEW.SYSTEM`, cuya regla «charla o conocimiento general → lista vacía» no tiene la excepción de hechos cambiantes.
> - Tras cada ítem completado, `confirmCompletion` (D5) y, si no cierra, `generatePending` otra vez: la misma regla.
>
> **Dónde falla realmente.** Solo cuando `pending` devuelve `[]` o descarta el ítem de búsqueda. En `multi` el modelo puede omitir el subpaso de búsqueda; en continuaciones («¿y el precio actual del otro?») puede tomarlo por conocimiento general. La cláusula (`PENDING_FACTS_LOOKUP = true`) llevó los hechos que abren un paso de 0/12 a 11/12 (charla vacía 8/8) pero costó 2 casos ajenos en `llm_pending_hard` (−5,2): `pending-hard-008` (perdió una URL literal) y `pending-hard-026`. Es decir, el problema de la cláusula es que está en el prompt de **todos** los pedidos y mueve ítems que no tienen que ver.
>
> **Conteo estático (sin modelos) sobre los datasets de `pending` (77 casos).** Una compuerta léxica con palabras de recencia (`último`, `actual`, `hoy`, `ahora`, `precio`, `versión`, `latest`, `current`, `news`…) y sin URL coincide con 12 pedidos; **6 son búsquedas reales** (`pending-006`, `pending-020`, `pending-hard-006`, `pending-hard-029`, `pending-hard-034`, `pending-hard-042`) y **6 son locales** (`pending-014` «uso de CPU actual», `pending-027/028` «qué versión tiene package.json», `pending-hard-005`, `pending-hard-012` «ahora leé notas.txt», `pending-hard-018` «modifiqué hoy»). Precisión 50 %: una compuerta léxica sola reintroduciría la regresión.
>
> **Opciones.**
> | Opción | Pros | Contras / latencia |
> |---|---|---|
> | A. Cláusula en el prompt (la original), con redacción afinada (URL literal intacta) | Unifica todos los caminos | Requiere re-medir `llm_pending_hard`; el 4B es sensible a cualquier cambio de redacción |
> | B. Cláusula solo si compuerta léxica **y** D0 con `chat` entre 0,5 y 0,7 (las preguntas de hechos rondan 0,51–0,65) | Limita el cambio de prompt a pedidos probables | No cubre continuaciones ni D0 caído; la compuerta léxica falla el 50 % |
> | C. Sin tocar el prompt: si `pending` devuelve `[]` y la compuerta (léxica + D0) dice «hecho cambiante», forzar `pending = [request]` | Solo actúa donde hoy se cerraría vacío (charla/conocimiento): **no mueve ítems de otros pedidos**; 0 ms de modelo | Una pregunta de conocimiento con «actual/hoy» gasta una búsqueda web (segundos); no cubre el subpaso omitido en `multi` |
> | D. Que D0 distinga `web_fact` (cuarta clase) | Separa el concepto del resto | Dataset nuevo en `eval/D0/` y recalibrar umbrales; más latencia solo si agrega preguntas |
>
> **Recomendación.** C primero (es la única que no puede mover los casos de `llm_pending_hard`, porque no toca ítems no vacíos), con la compuerta léxica restringida a pedidos sin ruta/URL y una lista corta de verbos de búsqueda; después, si hace falta cubrir `multi`, A medida en `eval/`. Descartar B como única medida (precisión 50 % y sin cobertura de hilos).
>
> **Qué medir tú.** (1) 12 preguntas de hechos + 8 de charla (`FRENTE_2_CONTEXTO.md`) → hechos que abren un paso y charla que sigue vacía; (2) `llm_pending_hard`, `llm_pending` y `llm_gemai` completos → regresiones (se espera 0 con C); (3) tasa de búsquedas innecesarias en pedidos de conocimiento con «actual/hoy»; (4) latencia añadida por tarea.

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
- Por otro lado, según las pruebas históricas documentadas (`docs/evaluacion/JARVIS_EVALUACION.md:140`, `docs/evaluacion/analisis/FRENTE_3_DECISION.md` y variantes en `eval/variants/Pending/`), activar `PENDING_FACTS_LOOKUP = true` subió de `0/12` a `11/12` en consultas de hechos cambiantes, **pero** provocó 2 regresiones (`-5.2%`) en `eval/datasets/pending/llm_pending_hard.jsonl` (`pending-hard-008` perdió una URL literal del pedido y `pending-hard-026` se clasificó mal).

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

---

## 7. Pendientes técnicos menores (revisión 2026-11-15)

Cada uno se validó en el código antes de tocarlo.

| Pendiente | Resultado | Detalle |
|---|---|---|
| `list_directory` con `depth: 0` | **Hecho** | `precheck.ts` rechaza `depth` que no sea entero ≥ 1 con una razón escrita; el manifest lo declara en `notes.depth`. |
| `shortDesc` duplicado | **Descartado** | `manifest.ts` solo valida (y rechaza al arrancar) las descripciones de sus propias definiciones. `shortDesc` también recorta las descripciones de herramientas que no vienen del manifest (servidores MCP de terceros), así que quitarlo dejaría pasar descripciones largas al prompt. |
| `switch` exhaustivo en `validateAnswer` | **Hecho** | `decision.ts`: `switch (question.type)` con rama `never`. |
| Salida cruda en `DecisionValidationError` | **Hecho** | El error lleva `raw` (`rawInput`, `rawOutput`, `timing`); `withRaw` lo adjunta en cada decisión y `engine/capture.ts` ya lo lee (`error.raw`) para la traza. Verificar en una traza real. |
| `egress.ts`: SHAs no son claves | **Hecho** | Un token hex de 40, 64 o 128 caracteres ya no dispara `long-blob`; una cadena alfanumérica larga que no sea hex sí. Cubierto en `tests/hardening.test.ts`. |
| `sensitivePaths.ts`: symlinks, 8.3, `\\?\`, UNC | **Hecho (parcial)** | Se normalizan prefijos extendidos y UNC, se resuelve `realpathSync` en argumentos de ruta y en tokens con forma de ruta dentro de comandos, y las reglas incluyen variantes 8.3 comunes (`PROGRA~1`, etc.). Un nombre 8.3 no listado en las reglas no se expande con `GetShortPathName`. |
| MCP: `notifications/cancelled` | **Hecho** | `mcp/transport.ts` envía la notificación al abortar por `signal` y al vencer el tiempo; `callTool` recibe `options.signal`. Cubierto solo por tipos: probar contra Desktop Commander real. |
| Patrones simples en `commandRules.ts` | **Hecho** | `.Delete()`, `.MoveTo()` y `.CopyTo()` sobre cualquier objeto → `sensitive` (`dotnet-file`). Las variables dinámicas, rutas en tuberías y concatenación de strings siguen sin analizarse. |

---

## 8. Falsos cierres de Decisión 5

### Estado actual
- `engine/completion.ts` (`confirmCompletion`): con el reactivo sin ítems pendientes, una pregunta `noul` a `d3:2b` («Using only what DONE shows, is every part of REQUEST already done?»). Si `request_complete >= COMPLETION_APPROVE (0,75)` la tarea cierra `completed` sin consultar al LLM de pendientes (~50 ms contra ~900 ms). Si no, `runTask.ts` vuelve a `generatePending`.
- Medido (`docs/evaluacion/limitaciones/d3-2b.md`): 31/36 a 0,75 (el LLM antiguo, 26/36). Falsos «sí» conocidos: copiar por mover (0,99 en todas las formulaciones) y, en pruebas sintéticas quitando el último paso, 2/6 falsos cierres a 0,75. Falsos «no» en pedidos condicionales (0,09–0,19), que solo cuestan el LLM.

### Causa raíz
D5 juzga solo con el texto de `DONE` y es un clasificador 2B: no distingue «hecho algo parecido» de «hecho todo». Un falso «sí» cierra en silencio una tarea incompleta; el único contrapeso es el umbral. No existe ninguna comprobación determinista de cobertura del pedido.

### Opciones
| Opción | Pros | Contras / latencia |
|---|---|---|
| A. Subir el umbral (0,9) | Menos falsos «sí» | Los falsos «no» se multiplican (medido); cada uno cuesta ~900 ms de LLM |
| B. Guarda determinista de cobertura: si el pedido nombra un archivo (lista cerrada de extensiones) que ninguna llamada menciona, no se cierra por D5 | 0 ms; solo hace el cierre más estricto; cubre el caso típico (se creó la carpeta pero no `gpt_info.md`) | Cobertura parcial: solo archivos nombrados; un falso bloqueo cuesta lo mismo que un falso «no» (cae al LLM de pendientes, que además es una segunda opinión) |
| C. Segunda pregunta a D5 con otra redacción (acuerdo de dos) | Reduce falsos «sí» no correlacionados | +50 ms; en el eval una pregunta más detallada subió los falsos «sí» |
| D. Dejar siempre la confirmación al LLM | Sin falsos cierres de D5 | +~850 ms en cada tarea que hoy cierra rápido |

### Recomendación
B (barata y determinista) detrás de flag, y validar con datos reales antes de tocar el umbral. A y C solo si B no alcanza.

### Implementado (apagado por defecto)
`completionCoverageGuard` en `jarvis-config.json`: `completion.ts#uncoveredArtifacts` extrae los nombres de archivo del pedido (extensiones: txt, md, json, csv, ps1, py, js, ts, pdf, docx, xlsx, png, jpg, zip, html, css, log, xml, yml, ini, bat, cmd, exe, mp3, mp4…) y, si alguno no aparece (sin mayúsculas, sin separadores) en los argumentos ni en el resumen de ninguna llamada, `confirmCompletion` devuelve `false` sin consultar a D5. Probado con `tests/hardening.test.ts`.

### Qué medir tú
Con el flag apagado y encendido, sobre el conjunto de D5 y trazas reales: falsos cierres (tarea `completed` con partes sin hacer), cierres que pasan al LLM por la guarda (falsos bloqueos) y latencia media por tarea. Un dataset formal de D5 en `eval/` sigue pendiente (no se tocó `eval/`).

---

## 9. Anti-bucle con llamadas rechazadas sin ejecución

### Estado actual (`ctx/derive.ts#isRepeat`, `engine/limits.ts`, `callRunner.ts`)
- `isRepeat` compara solo llamadas **ejecutadas** (`isExecuted`). Las rechazadas antes de ejecutar (`args_invalid`, `tool_rejected`, `user_rejected`, `info_missing`) llevan su `sig` pero no cuentan.
- Aun así están acotadas por paso: `maxReviewRejectionsPerStep` (2) para `args_invalid`, `maxDeniedPerStep` (2) para `tool_rejected`/`denied`, `maxUserRejectionsPerStep` (2) para `user_rejected`, y `maxAttemptsPerStep` (10) para todo. El modelo ve el motivo y sube la temperatura (`priorAttempts`).

### Causa raíz
El `sig` se calcula con los argumentos resueltos, o sea después de generarlos con el LLM: reconocer una repetición idéntica no ahorra esa generación. Lo que sí ahorra es la consulta a D3 y, sobre todo, **la pregunta al usuario**: un rechazo del usuario (`user_rejected`) no se recordaba, y el modelo podía volver a proponer lo mismo (por ejemplo tras un rechazo por `egress.ts` en `web_search`).

### Opciones
| Opción | Pros | Contras / latencia |
|---|---|---|
| A. No repetir la pregunta tras `user_rejected` (clave herramienta + comando o ruta normalizada) | Determinista; elimina una interrupción al usuario; 0 ms | Un rechazo con argumentos reformulados no se detecta (la clave cambia) |
| B. Contar como repetición las rechazadas idénticas sin ejecutar (`loop_blocked`) | Corta antes el paso | Sin ahorro de latencia (la generación ya ocurrió); la cota actual ya es de 2 intentos; riesgo de bloquear un reintento válido tras una lectura intermedia |
| C. Pasar al generador los argumentos ya rechazados («do not repeat») | Evita la repetición en origen | Cambia lo que ve el modelo: requiere medir; hoy `Previous Errors` ya muestra el motivo |

### Recomendación
A (hecho). B no aporta latencia y las cotas existentes ya cortan en 2 intentos: no implementar salvo que las trazas muestren pasos agotados por identidad de argumentos. C, solo medido.

### Implementado
- **A** (ver §2): `callRunner.ts` registra en la RAM de la tarea (`TaskRuntime`, `policy/approvalKey.ts`) la clave de lo que el usuario rechazó y devuelve `user_rejected` con una nota («do not ask again…») sin volver a preguntar. Cuenta contra `maxUserRejectionsPerStep` (2), así que el paso falla igual que antes si el modelo insiste. Sin flag: no cambia lo que ve el usuario salvo que se le ahorra la pregunta repetida, y el modelo ve una razón escrita.

### Qué medir tú
En trazas reales, cuántos pasos terminan por `repeat_blocked`/`denied`/`review_rejected` con la misma `sig` repetida (si es casi cero, B no hace falta) y cuántas preguntas repetidas se ahorran por tarea.

---

## 10. Terminal Windows (`src/tools/terminal/`)

| Pendiente | Resultado | Detalle |
|---|---|---|
| Codepages 852 y 857 sin tabla | **Hecho** | `output.ts` tiene ahora las mitades altas de 852 (centroeuropea) y 857 (turca), generadas con `Encoding.GetEncoding` de .NET (los bytes sin carácter en 857 quedan como U+FFFD). `accentScore` y el filtro de `powershell.ts` cuentan también Latin Extended-A (U+0100–U+017F: ł, ę, ş, ğ…), que es lo que da una página 852/857 bien decodificada. Probar en una PC con esa OEM (no hay una acá). |
| Envoltorios con extensión (`ipconfig.exe \| ...`) | **Ya resuelto (RC-40); documentación corregida** | `powershell.ts` registra funciones `nombre`, `nombre.exe` y `nombre.com` (`tests/run_command.test.ts` cubre `ipconfig.exe` y `chcp.com`). Por ruta completa (`C:\Windows\System32\ipconfig.exe`) no se envuelve: es la única parte abierta y requiere interceptar `Application` con `PostCommandLookupAction`. |
| Procesos que leen stdin sin prompt (`findstr`, `node`) | **No resuelto** | Saber si un proceso está bloqueado leyendo su entrada exige código nativo (`NtQueryInformationFile`) o un PTY (ConPTY, Horizonte 2.0). Cerrar `stdin` tras un silencio rompería los programas que responden por `{ pid, input }` y los que terminan al cerrarse la entrada. Hoy: quedan `running` hasta el plazo y `{ pid, input }` los destraba. |
| Procesos huérfanos desde la UI (RC-25) | **No resuelto (producto + seguridad)** | `list_processes` y `stop_process` ya existen para el modelo. Mostrar y cortar procesos desde la interfaz exige un endpoint que corte procesos en la API local, que no tiene autenticación (decisión explícita de esta etapa: sin token), y definir dónde vive en la UI. |
| ConPTY y Job Objects | Horizonte JARVIS 2.0 | Sin tocar. |

---

## 11. `refsDir`: cómo se leen los refs (investigación, sin implementar)

### Dónde y cómo se leen
- **Escritura:** `callRunner.ts` (paso 11) guarda en `refsDir/<tarea>/<uuid>.txt` (UTF-8, `wx`) el texto completo de una llamada cuyo resumen no lo contiene (`processed.truncated`). `refsDir` por defecto es `data/refs` (se resuelve con `path.resolve` al crear los servicios; solo editable en el archivo de configuración, `FILE_ONLY_KEYS`). Cada ref lleva etiqueta (`read_file /ruta (N líneas)`), tamaño en caracteres y ruta (`where`).
- **El modelo la ve** en la sección `REFS` de la vista de argumentos: `ref:rN (tamaño, ruta) etiqueta — read: offset=… length=…` (`render/shared.ts#availableRefLine`), con lo que ya se leyó de ella.
- **Quién la lee:** (1) el modelo, con `read_file` sobre `where` (lectura normal); (2) el motor, con `vault.readAll` (solo dentro de `refsDir`): sustitución de `{{ref:rN}}` en argumentos (`refs/refResolver.ts`, el archivo entero a memoria) y el endpoint de la interfaz `GET /tasks/:id/refs/:refId` (`tasks.readRef`); (3) el pre-chequeo, con `readRefText` (primeros 400 000 bytes, como fuente de «esto aparece en lo que la tarea sabe»).

### ¿`read_file` lee por partes?
Declara `offset` y `length` (el manifest anota que cuentan líneas en texto; en PDF y Excel no se verificó) y el extractor entiende la cabecera `[Reading N lines … (total: T lines, R remaining)]`. Los prompts guían con `ARGUMENTS_VIEW.READ_REFS_NOTE` (solo para `read_file`) y con la línea `read:` de cada ref (tramos ya leídos) y su etiqueta con el número de líneas. **Pero en la práctica no sirve para refs grandes:** cada lectura muestra solo 15 líneas del inicio y 15 del final (resumen de 2500 caracteres como máximo) y guarda el resto en otra ref (ver «Solución propuesta»). **El pre-chequeo no guía, y hoy lo estorba** (hallazgo 1).

### Hallazgos
1. **Bug confirmado (reproducido con un contexto de prueba): el pre-chequeo rechaza leer una ref.** `collectSources` agrega a las fuentes el *texto* de cada ref, pero no su ruta (`where`). `read_file` sobre `where` falla la regla `read-path-source` («The path … does not appear in the request or in earlier results») cuando todas las refs son legibles (`complete = true`). El modelo recibe un rechazo (`args_invalid`) justo al hacer lo que `READ_REFS_NOTE` le indica; solo se salva si la ruta aparece en otra fuente. Es un candidato claro a corregir.
2. **Una ref muy grande:** `vault.put` no tiene tope (guarda todo; la retención por tamaño `retentionMaxMb` la borra después, pero una ref aislada de cientos de MB entra entera). `{{ref:rN}}` carga el archivo entero en memoria y lo inserta en los argumentos (el registro de la llamada sí se recorta). `GET …/refs/:refId` devuelve el texto completo sin tope. El pre-chequeo lee solo los primeros 400 000 bytes: con una ref mayor, una URL o ruta que aparezca solo después de ese punto se rechaza como inventada porque `complete` sigue en `true` (falso rechazo; hoy `complete` solo baja si la ref no se puede abrir).
3. **`allowedDirectories` no cubre `refsDir` con la lógica actual.** `callRunner.ts` 6c y el wrapper de Desktop Commander comparan toda ruta con `allowedDirectories` sin exceptuar `refsDir`: con una lista no vacía que no lo incluya, `read_file` sobre una ref se rechaza (`outside`) aunque `READ_REFS_NOTE` diga que esa ruta vale tal cual. `services.ts#warnIfRefsOutsideAllowed` solo avisa una vez al arrancar, con la lista de ese momento (no ve cambios en vivo) y solo escribe en consola. Con lista vacía (el valor por defecto) no hay problema.
4. **Guard:** la regla B protege `refsDir` de escrituras (`FILE_WRITE`); las lecturas pasan.

### Solución propuesta: una herramienta nativa para leer refs por partes (sin implementar)

**Qué no sirve hoy (verificado en el código).** `read_file` sobre una ref pasa por el extractor general: el resumen muestra solo 15 líneas del inicio y 15 del final (`BUDGET.extract.readFileHeadLines/TailLines`) con tope de 2500 caracteres (`summaryMax`); lo demás **se guarda en otra ref** (ref de una ref). Es decir, pedir `offset`/`length` de 100 líneas no entrega 100 líneas: entrega 30 y un enlace a la siguiente ref. Con ventanas de ≤30 líneas, una ref de 5 000 líneas exige unas 170 llamadas (el tope es `maxCallsPerStep = 6`), y nada se lo explica al modelo (`READ_REFS_NOTE` solo dice «usa offset y length»). Leer una ref grande por `read_file` no es viable aunque el pre-chequeo y `allowedDirectories` se arreglen.

**Lo que ya hace bien la tool web.** `web_search` nunca le entrega la página entera al modelo: la lee por ventanas (`read_doc` con `start`/`length`, 50 000 caracteres, hasta 12 ventanas), la **parte en fragmentos** de ≤800 caracteres (`chunks.ts`, literales, con el último título repetido), **ordena por relevancia con BM25** contra la necesidad (`bm25.ts`: `rank`, `pickCandidates`, sin modelos, milisegundos) y devuelve solo los mejores pasajes bajo un presupuesto fijo (`PASSAGES_BUDGET = 1700`), con su posición. Un resultado nativo separa lo que ve el modelo (`text`) del texto completo (`raw`); si `text` y `raw` coinciden y caben, **no se crea una ref nueva** (`extractors/structured.ts`).

**Propuesta: `read_ref`, proveedor nativo `jarvis_refs` (`src/tools/refs/`), una herramienta de lectura (`READ`).**
- **Entrada:** `ref` (el id `rN`, no una ruta), y uno de estos modos: sin nada → **mapa**; `part: k` → **parte k**; `need: "texto"` → **mejores pasajes** para esa necesidad (opcional `limit`).
  - *Mapa:* tamaño y líneas totales, número de partes y, por parte, su rango de líneas y su primera línea (o el último título). Determinista, ~300 caracteres por 10 partes. Sirve para navegar sin leer.
  - *Parte k:* texto literal de la parte, alineado a líneas, de ≤ ~1 800 caracteres (por debajo de `summaryMax`), con «parte k de N · líneas a–b · siguiente: k+1». Para leer en orden (resumir, buscar por posición).
  - *Necesidad:* BM25 sobre las partes de esa ref (la misma `rank` de la tool web), devuelve las 2–3 partes mejor puntuadas con su número y su rango de líneas (≤ ~1 800 caracteres en total) y avisa si la cobertura es baja (`MIN_COVERAGE`). Sin modelo ni red.
- **Salida:** `text` = `raw` y siempre bajo el tope: **nunca genera una ref de la ref**. Las partes salen de un índice de offsets que se calcula una vez por ref, recorriendo el archivo en streaming y guardado en la RAM del proveedor (clave tarea + ref): una ref de cientos de MB no se carga entera.
- **Acceso:** el proveedor recibe un lector inyectado (`readRef(taskId, refId)` por rangos, sobre el almacén y su carpeta), igual que `TaskManager.readRef` hoy. Sin rutas: **no pasa por `allowedDirectories`, por `sensitivePaths` ni por la regla «la ruta no aparece en nada»** (hallazgos 1 y 3 desaparecen para este camino) y solo lee dentro de `refsDir`.
- **Cuándo se ofrece:** `requires: "refs"` en el catálogo (el mecanismo ya existe con `requires: "search"` para `get_more_search_results`, `callRunner.ts` ~156): la herramienta solo aparece si la tarea tiene alguna ref, así no engorda el catálogo de D2 en las demás tareas. Ruta propia o dentro de `files`: se decide al medir D1.
- **Pre-chequeo:** una regla nueva en el registro (`ref-exists`: el `ref` debe ser el id de una ref de esta tarea; `part` entero entre 1 y N; `need` no vacío) con razón escrita. Las lecturas repetidas las frena el anti-bucle de siempre (parte distinta = llamada distinta).
- **Reutilización:** `bm25.ts` y la partición por líneas de `chunks.ts` hoy viven en `src/tools/web/`; conviene moverlas a un módulo compartido puro (por ejemplo `src/core/retrieval/`) para que ambas herramientas las importen sin dependerse entre sí (el núcleo no importa `src/tools/`, y `architecture.test.ts` lo vigila).
- **Cambios de modelo (se miden, no se hacen ahora):** descripción en inglés de la herramienta y su nota de parámetros (≤80 y ≤240 caracteres, `manifest.ts`), y reemplazar `READ_REFS_NOTE` por una pista que mande a `read_ref`. Es lo único que toca prompts.

**Complementos pequeños (deterministas):**
- **A (bug 1):** `collectSources` agrega la ruta `where` de cada ref de la tarea; sigue haciendo falta mientras `read_file` pueda leer rutas de refs (p. ej. el usuario las pega).
- **D (hallazgo 2):** si una ref supera los 400 000 bytes que lee el pre-chequeo, `complete = false` (sin falsos rechazos por URLs o rutas que están más adelante).
- **Tope en el almacén:** un máximo de caracteres por ref (`vault.put`) con marca explícita, o rechazo, para acotar disco y memoria; el valor es decisión de producto.

**Alternativas descartadas.** (1) Dejar `read_file` y mejorar la nota: no resuelve el tope de 30 líneas por lectura. (2) Subir `summaryMax` o las líneas del extractor para refs: más tokens en cada vista (todas las vistas lo pagan) y sigue sin haber navegación. (3) Resumir la ref con un LLM: latencia (~1 s por pasada), riesgo de inventar y consume VRAM; la tool web demuestra que el orden léxico alcanza para ubicar. (4) Eximir `refsDir` de `allowedDirectories` y seguir con `read_file`: arregla el acceso, no el tamaño.

**Fases (cada una se prueba sola).** (1) Índice por partes + modos mapa y parte (determinista, sin BM25) y la regla `ref-exists`. (2) Modo necesidad, con BM25 extraído a `retrieval/`. (3) Catálogo (`requires: "refs"`, descripción) y la pista que sustituye a `READ_REFS_NOTE`. (4) Opcional: aceptar también una ruta de archivo de texto grande bajo `allowedDirectories` (`path` en lugar de `ref`) para que `read_file` deje de ser la única vía de lectura de archivos largos.

**Cómo se probaría.** *Tests sin modelos ni Windows:* límites de las partes (ni cortan una línea ni pasan de 1 800 caracteres, cubren el archivo sin huecos ni solapes), el índice con un archivo de 200 MB generado por streaming, `need` contra un texto con la respuesta en una posición conocida (¿cae entre los mejores pasajes?), `ref-exists`, y que ninguna salida crea una ref. *En `eval/` (lo corres tú):* tareas con una ref grande (listado de 5 000 archivos, un log largo, una página larga) y preguntas con la respuesta en posición conocida (inicio, medio, final y repartida); métricas: acierto, llamadas hasta la respuesta, tokens y latencia del paso, contra la línea base con `read_file`.

**Qué medir tú primero (sin implementar).** En trazas reales: cuántas tareas terminan con refs sin leer o con cadenas de `read_file` sobre una ref (`read: offset=… length=…` repetido); el tamaño de las refs de `data/refs`; y la distribución de llamadas por paso en esas tareas.
