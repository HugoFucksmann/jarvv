# Pendientes que dependen de código

Todo lo que se cierra **programando** o con una **decisión de producto o de seguridad**, sin necesidad de correr `eval/`. Lo que se cierra midiendo está en [`PENDIENTES_EVAL.md`](PENDIENTES_EVAL.md). Actualizado el 2026-11-16; lo ya resuelto se quitó (el historial está en git).

**Alcance de plataforma:** JARVIS apunta solo a Windows y PowerShell. Linux/WSL no es objetivo de la versión actual (`listTools()` de terminal devuelve `[]` fuera de Windows).

## Resumen

| # | Tema | Tipo |
|---|---|---|
| 1 | Guard de `Host` (DNS rebinding) y tests que fallan | Decisión de seguridad |
| 2 | Memoria del usuario (CRUD, captura, matching) | Función nueva |
| 3 | Herramientas nativas de archivos (D-15 a D-17) | Función nueva |
| 4 | Allowlist persistente de aprobaciones | Función nueva |
| 5 | Terminal Windows | Código y producto |
| 6 | Seguridad y API HTTP | Decisiones y límites conocidos |
| 7 | Deuda técnica | Código |
| 8 | Horizonte JARVIS 2.0 | Sin empezar |
| 9 | Revisión de código del 2026-11-18 (flujo, contexto y memoria) | Código |

---

## 1. Guard de `Host` y tests que fallan

- **Guard de `Host` desactivado.** En [`src/server/localOnly.ts`](../../src/server/localOnly.ts) el chequeo de `Host` está comentado por compatibilidad con el proxy de AI Studio Build. Mientras esté así, un sitio web puede llegar a la API local con un dominio que resuelve a `127.0.0.1` (DNS rebinding), y esa API ejecuta comandos en la PC sin autenticación. El servidor ya no arranca si `HOST` no es loopback, pero eso no frena el rebinding. **Decisión:** restaurar el guard (y perder esa compatibilidad) o dejarlo así y cambiar el test para que lo refleje.
- **Tests que ya fallaban antes del refactor de refs:**
  - `tests/http.test.ts:86` («Host local… DNS rebinding»): responde 200 en vez de 403. Es la consecuencia de lo anterior.
  - `tests/run_command.test.ts:522`: el test espera `data.exitCode` al continuar un proceso ya terminado, pero el código no lo incluye a propósito (el código de salida queda en el texto, para no registrar un segundo `tool_error`). El test está desactualizado; se decidió dejarlo.

## 2. Memoria del usuario

Estado (v1 implementada según [`MEMORIA_CONTEXTO_DISENO.md`](MEMORIA_CONTEXTO_DISENO.md)): `data/memory.json` se edita **a mano** (formato `[{ "key", "value", "aliases"? }]` o `{ "facts": [...] }`; topes: 200 entradas, clave ≤ 80 caracteres, valor ≤ 300) y vive en el paquete independiente `src/memory/` (`MemoryProvider.recall`, con alias, plurales regulares y prioridad por cantidad de stems). Los hechos y el hilo de la tarea anterior entran al contexto por `apply` en la sección `recalled` (con el log de eventos de cada tarea en `data/tasks/`) y se muestran solo en las vistas de argumentos y de respuesta final; también son fuente del pre-chequeo.

**Límites conocidos:**
1. Sin API, pantalla ni comando de Telegram para crear, ver o borrar hechos; sin captura por conversación («recordá que…»).
2. El matching sigue siendo léxico: sinónimos y plurales irregulares no coinciden (los alias son los que escribe el usuario). **El matching nuevo (alias, plurales, prioridad) no está re-medido en `eval/`** (criterio: no empeorar 14/14 de selección ni la contaminación de pedidos ajenos, hoy 0/8).
3. Los hechos no llegan a `pending`, `plan` ni D3 (decisión: habilitarlos de a una vista, con eval).
4. Nada se aprende solo (a propósito: solo entra lo que escribió el usuario).

**Criterios de diseño:** preferir diseños sin modelos extra (el presupuesto de 8 GB de VRAM ya lo ocupan `d3` y el generativo); cero tokens sin coincidencia; nunca texto generado por un modelo guardado como hecho sin confirmación explícita; compatible con los invariantes de [`CONTEXT_AND_MEMORY.md`](../arquitectura/CONTEXT_AND_MEMORY.md) §7 (la memoria entra por el motor, no por `apply`).

**Opciones, de menor a mayor riesgo:**

| Opción | Qué es | Pros | Contras |
|---|---|---|---|
| A. CRUD sobre el mismo archivo | `GET/PUT/DELETE /memory`, pantalla en la UI y comando de Telegram; el JSON sigue siendo la fuente | 0 ms; reversible; hace usable la memoria existente | Escritura concurrente con la edición manual; superficie nueva en una API sin autenticación (cualquier proceso local escribiría hechos que se usan como fuente del pre-chequeo) |
| D. Inyección en `pending` y `plan` | Pasar los hechos elegidos también a esas etapas | La ruta correcta se usa desde el primer paso | Más tokens en prompts de 2B, con regresiones previas en `pending` (**medir**) |
| B. Captura conversacional | Regla léxica que detecta «recordá que X es Y» y guarda tras confirmación | Natural para el usuario | Frágil con frases libres; con modelo añade una llamada y riesgo de inventar; define un tipo de pedido nuevo |
| E. Embeddings | Recuperación semántica | Tolera sinónimos | Modelo extra: **descartada** salvo que el matching léxico demuestre ser insuficiente |

**Primer paso recomendado:** CRUD mínimo en API y UI (A), con límite de tamaño y escritura atómica.

**Preguntas abiertas:** ¿el CRUD debe poder editar hechos desde Telegram o solo desde la UI? ¿Se acepta que un hecho de la memoria sea fuente válida del pre-chequeo si lo escribe otra entrada local sin autenticación? ¿«Recordá que…» debe pedir confirmación siempre?

## 3. Herramientas nativas de archivos (D-15 a D-17)

Estado: los archivos los sirve Desktop Commander (`files`, `locate`); en `src/tools/` solo hay proveedores nativos de `terminal` y `web`. No existe copiar, borrar ni búsqueda síncrona: copiar y borrar solo se logran con `run_command` (nivel rojo en `tiers.ts`, pasa por `commandRules.ts`). `tiers.ts` solo clasifica `create_directory`, `write_file`, `move_file`, `run_command` y `stop_process`.

| # | Propuesta | Qué resuelve | Riesgos y dependencias |
|---|---|---|---|
| P1 | `find_files` (nativa, lectura): `{ path, pattern, maxResults }` | `start_search` son dos etapas (arrancar y paginar): costoso para un 2B y fuente de bucles | Recorrer discos grandes (tope de profundidad, entradas y tiempo; abortar por `signal`); respetar `allowedDirectories` y `sensitivePaths`; no seguir symlinks fuera de alcance. Proveedor nuevo (`src/tools/files/`), extractor, manifest, política `retry_failed` |
| P2 | `copy_file` (nativa, escritura) | Copiar sin pasar por el parser de PowerShell | Sobrescribir (rojo si el destino existe, como `move_file`); carpetas enormes (tope de tamaño); symlinks y rutas `\\?\`/UNC/8.3. Nivel en `tiers.ts`, poscondición de disco, sondas de lugar |
| P3 | `delete_file` (nativa, escritura destructiva) | Borrar sin comandos abiertos; permite mandar a la **papelera de Windows** (reversible) | El riesgo más alto: borrado recursivo, papelera según API de Windows (PowerShell o `Microsoft.VisualBasic.FileIO`), no atómico. **Rojo siempre**, confirmación reforzada para recursivo, nunca fuera de alcance ni una carpeta de usuario raíz, registro en la traza. Va **después** de P2 y de revisar `tiers.ts` |
| P4 | Reagrupar rutas `files`/`locate` en «consultar» y «modificar» | Menos opciones de ruta para D1 (el 2B elige peor con más rutas parecidas) | Cambia el flujo de D1/D2 y los datasets de `eval/` (**requiere re-medir**); depende de P1 |
| P5 | Edición dirigida (`edit_block` o equivalente) | Editar una parte sin reescribir el archivo (hoy `write_file` en `rewrite` es rojo) | Coincidencia ambigua; dependencia de Desktop Commander; decidir si se expone `edit_block` o se hace nativa |
| P6 | `list_directory` con tamaño y fecha (opcional) | Evita sondas (`ATTRIBUTE_PROBE`) para ordenar por propiedades | Más texto en el contexto: hay que limitarlo (`listDirEntries`) |

**Orden sugerido:** P1, P2, P3, P4 (re-midiendo en `eval/`). P5 y P6 según uso real.

**Decisiones pendientes:** ¿papelera por defecto en `delete_file`, o también borrado permanente con confirmación? ¿`find_files` puede buscar fuera de las carpetas del usuario? ¿Se acepta tocar el flujo de rutas (P4) antes de tener las nativas?

## 4. Allowlist persistente de aprobaciones

«Aprobar siempre en esta tarea» vive solo en la RAM de la tarea (`TaskRuntime`, clave herramienta + comando o ruta normalizada, `policy/approvalKey.ts`). Una allowlist **entre tareas** está aplazada a propósito: exige diseñar cómo se gestiona y se revoca desde la UI y cómo evitar aprobaciones demasiado amplias. `edit_block` (en pausa) sigue en rojo.

## 5. Terminal Windows (`src/tools/terminal/`)

- **Ruta completa de un `.exe`** (`C:\Windows\System32\ipconfig.exe | ...`): `nombre`, `nombre.exe` y `nombre.com` ya se envuelven, la ruta completa no; requiere interceptar `Application` con `PostCommandLookupAction`.
- **Procesos que leen `stdin` sin prompt** (`findstr`, `node`): saber si un proceso está bloqueado leyendo su entrada exige código nativo (`NtQueryInformationFile`) o un PTY (ConPTY). Hoy quedan `running` hasta el plazo y `{ pid, input }` los destraba. Cerrar `stdin` tras un silencio rompería los programas que responden por `{ pid, input }`.
- **Procesos huérfanos desde la UI (RC-25):** `list_processes` y `stop_process` ya existen para el modelo. Mostrar y cortar procesos desde la interfaz exige un endpoint que corte procesos en la API local, que no tiene autenticación (decisión de esta etapa: sin token), y definir dónde vive en la UI.
- **Descripción de `run_command` para el modelo:** sigue diciendo 30 s y 300 s aunque se configuren otros tiempos.

## 6. Seguridad y API HTTP

- **Sin autenticación local:** `localOnly.ts` frena orígenes web, no otros procesos locales. `POST /config` permite editar `autoMode`, `approvalTiers`, `blacklist`, `retentionDays` y `retentionMaxMb` sin autenticación adicional (token y cifrado quedan fuera por decisión). Ver también §1.
- **Sin rate limiting por segundo ni cifrado en reposo:** las refs y las trazas (`full.json.gz`) se guardan en texto plano; `retention.ts` borra por antigüedad y por tamaño (`retentionMaxMb`, 500 MB por defecto).
- **Límites léxicos de las políticas:**
  - `policy/commandRules.ts`: no analiza variables dinámicas, rutas en tuberías ni concatenación de strings.
  - `policy/readOnly.ts`: lista cerrada conservadora; comandos seguros con paréntesis o `ForEach-Object` siguen pidiendo confirmación.
  - `policy/sensitivePaths.ts`: un nombre 8.3 que no esté en las reglas no se expande con `GetShortPathName`.
- **`allowedDirectories`:** el análisis de PowerShell es heurístico (variables, alias, tuberías): lo que no se puede resolver pide confirmación, y esa confirmación es el límite fuerte real en shell (o un sandbox del sistema). Fuera de Windows `run_command` no se analiza y cae en «pide confirmación».
- **API (`src/server/`):** no se exponen en vivo la lista completa de pendientes ni las decisiones intermedias por SSE.

## 7. Deuda técnica

- **Idioma del reintento:** `retryNote` (`prompts.ts`) sigue en español (`ERROR_PREVIO: ...`) dentro de prompts en inglés.
- **`prompts.ts`:** falta modularizarlo en partes con nombre para las variantes del eval, y derivar `ReviewView` con `Omit` sobre `ArgsView`.
- **Tests sin cubrir:** los componentes de `ui/` y el flujo de aprobación de extremo a extremo.

## 8. Horizonte JARVIS 2.0

- **Consola:** pseudo-terminal (ConPTY) para REPLs completos, `isatty` y `-Confirm`, y Job Objects para seguir procesos fuera del árbol (`Start-Process`).
- Lecturas preparatorias de apoyo dentro del mismo paso (`role: support`, varias rutas por herramienta) y ejecución paralela de lecturas y procesos independientes.
- Recetas parametrizadas para comandos frecuentes y respuestas finales por plantilla cuando solo hubo escrituras.
- Captura conversacional de memoria y recetas aprendidas (Capa 3 de [`FRENTE_1_MEMORIA.md`](../evaluacion/analisis/FRENTE_1_MEMORIA.md)).

## 9. Revisión de código del 2026-11-18 (flujo, contexto y memoria)

Hallazgos de leer el código (no la documentación). Estado de la suite al revisar: 528 de 535 tests pasan y `tsc --noEmit` está limpio. Se dejaron fuera seguridad y UI.

### 9.1 Flujo

1. ~~**La verificación de escrituras depende del disco real.**~~ **Resuelto el 2026-11-18.** `postconditionOf` miraba siempre el disco real, y una escritura con ruta absoluta que no existe en la PC se rechazaba como `not_accomplished` (`C:\Users\Ana\bien.txt` daba `unmet`). Ahora `EngineDeps.disk?: DiskView` (por defecto el disco real) llega a `verifyCall` (`verify.ts`), y los tests de flujo usan `FAKE_DISK` (`tests/fixtures.ts`). Los 4 tests de flujo pasan (el deliberativo también: la causa era la misma).
2. **La salida parcial casi no tiene margen.** Abandonar un ítem exige `maxItemFailures` (2) pasos fallidos seguidos sobre él, y esos dos fallos ya consumen `maxEscalations` (2): [`runTask.ts:173`](../../src/core/engine/runTask.ts) cierra `no_alternatives` en cuanto un paso más falla (`escalationsExceeded`, [`limits.ts:62`](../../src/core/engine/limits.ts)). «Abandonar y seguir con el resto» solo sirve si el resto sale perfecto. **Decidir:** subir el cupo de escalaciones o no contar contra él los pasos de un ítem ya abandonado; medir en `eval/`.
3. **`tool_error` y `exception` cuentan como rechazo de la verificación.** `countStep` ([`limits.ts:106`](../../src/core/engine/limits.ts)) incluye en `rejected` toda llamada con `verdict = rejected`, y las dos se rechazan sin modelo: dos errores de herramienta fallan el paso con `verify_rejected`, igual que dos resultados que «no cumplen». Conviene separar la causa (`tool_failed`) para la recuperación y el informe.
4. **`runCall` (~300 líneas, [`callRunner.ts:288`](../../src/core/engine/callRunner.ts)) y `precheck.ts` (680)** son lineales y funcionan, pero cuestan tocarlos. Candidatos a partir en fases con nombre (descubrir, argumentos, política, despacho, registro). **Red de seguridad lista (2026-11-18):** [`tests/approval_matrix.test.ts`](../../tests/approval_matrix.test.ts) fija con 54 casos la autorización de una llamada (`approvalTiers` × `autoMode` × nivel × lista negra × ruta sensible × umbral de D3 × `allowedDirectories` × rechazo del usuario); cuatro mutaciones deliberadas de `callRunner` la hicieron fallar. Ver `REFACTOR_CORE.md`, punto 1. **Avance (2026-11-18):** extraídos los pasos 9 a 12 (despacho, resultado, registro y verificación) a `engine/callExecute.ts` (`executeAndRecord`), y lo que comparten las fases (`PreparedCall`, `recordCall`, `registered`, `fromFailure`) a `engine/callRecord.ts`; `callRunner.ts` bajó de 595 a 238 líneas. **Confirmar y revisar extraídos** (pasos 7 y 8) a `engine/callConfirm.ts` (`confirmIfNeeded`, `reviewIfNeeded`); `PreparedCall` lleva ahora la herramienta entera (`tool`) en vez de su nombre. **`authorize` extraído** a `engine/callAuthorize.ts`: `evaluatePolicy` (Guard, nivel y lista negra; síncrona), `needsConfirmation` (la regla de `autoMode` y `approvalTiers`; pura, probada contra la fórmula original en las 2.304 combinaciones en `tests/authorize.test.ts`) y `checkCallArgs` (pre-chequeo y `allowedDirectories`; con disco), compuestas por `authorize`. Sin cambios de comportamiento: la matriz y la suite siguen igual. **Elegir herramienta y preparar argumentos extraídos** (pasos 1 a 5) a `engine/callPrepare.ts` (`selectTool`, `prepareArgs`) y el descubrimiento a `engine/callDiscovery.ts` (`availableRoutes`, `discoverTools`). **Punto 1 del refactor completo (2026-11-18):** `runCall` quedó como una secuencia de 76 líneas (`callRunner.ts` bajó de 595 a 76) que encadena `callPrepare` → anti-bucle → `callAuthorize` → `callConfirm` → `callExecute`; sin cambios de comportamiento (la matriz de 54 casos y la suite siguen igual). **Punto 2 hecho** (tablas por herramienta: `tools/toolTargets.ts`, `TIER_RULES`, `POSTCONDITIONS`, `PATH_KIND_CHECKS`, más `tests/tool_specs.test.ts` que exige su fila a cada herramienta que modifica el sistema; ver `REFACTOR_CORE.md`, «Estado»). **Punto 3 hecho** (`engine/state.ts`: `TaskExecutionState` en `env.state`, sin `WeakSet` global; `engine/reactiveList.ts`: la lista del reactivo como objeto con transiciones). **Punto 4 hecho** (`host.ts` recibe la captura, la memoria la elige `server.tsx`, el inicio del usuario entra por `guardScope.homeDirs`; pruebas de arquitectura nuevas). **El refactor de `REFACTOR_CORE.md` (puntos 1 a 4) está completo.**

5. ~~**Claves de ruta copiadas en 4 archivos.**~~ **Resuelto el 2026-11-18:** una sola definición en [`policy/pathArgs.ts`](../../src/core/policy/pathArgs.ts) (`PATH_ARG_KEYS`, `PATH_LIST_KEY`, `isPathArgKey`), usada por `callRunner`, `precheck`, `sensitivePaths` y `approvalKey`. Las 3 copias de `callRunner`, `precheck` y `sensitivePaths` eran idénticas; la de `approvalKey` omitía `cwd`, y ahora la incluye (solo cambia el caso de una llamada con `cwd` y sin `command`, que el catálogo no produce). **Resuelto también el 2026-11-18:** `precheck` ahora trata `paths` (el arreglo de `read_multiple_files`) como rutas (`roleOf` en `engine/precheck.ts`): cada una pasa por las reglas de marcador de posición, carpeta de otro usuario, caracteres inválidos de Windows y «tiene que salir del pedido o de resultados anteriores», igual que `path`. Una ruta inventada en `read_multiple_files` se rechaza antes de ejecutar (`args_invalid`) en vez de ejecutarse y fallar. Pruebas en `tests/precheck.test.ts`; el test de `allowedDirectories` de `flow_critical` ahora nombra la ruta en su pedido (antes el pre-chequeo no la miraba).

### 9.2 Contexto

1. ~~**Un fallo al escribir el log deja la tarea abierta.**~~ **Resuelto el 2026-11-18.** Reproducido con una prueba (el archivo del log pasa a ser una carpeta antes de la primera escritura): la tarea quedaba `running` y ocupaba un cupo. Ahora `guardedLogWriter` (`taskLog.ts`) propaga el fallo UNA vez, antes de que `apply` confirme el lote (el motor no sigue ejecutando herramientas cuyo efecto no quedaría en el log), y después deja de escribir y de lanzar; `closeOnDefect` reintenta el cierre una vez (el primer intento puede ser el que apague el escritor) y `closeOnRestart` hace lo mismo. La tarea cierra `unrecoverable` con respuesta de respaldo y libera su cupo; el log queda como un prefijo de lo ocurrido, así que tras un reinicio se cierra con `restart`. **Límite conocido:** si el fallo ocurre al registrar una llamada que ya se despachó, ese efecto no queda ni en el log ni en el contexto en memoria (el lote no se confirma). Pruebas en `tests/taskmanager.test.ts`.
2. **`recalled` no se puede retirar.** Un hecho recordado dura toda la tarea (`apply` rechaza duplicados de `(source, key)` y no hay baja). La vista conserva solo los `cap` más recientes por fuente (`recalledViewsOf`), así que un hecho relevante temprano puede quedar fuera cuando entran otros después.
3. **`facts` solo tiene dos usos** (`answer_*` y `process`): es un mecanismo genérico sin uso general; no urge, pero conviene tenerlo presente antes de agregarle más claves.

### 9.3 Memoria e hilo

1. **Emparejamiento frágil con claves cortas** ([`memory/index.ts:105`](../../src/memory/index.ts)): prefijos de 5 letras, así que una clave de un solo término coincide con palabras no relacionadas (`proyecto` y `proyección` comparten `proye`). Sin sinónimos. Sigue sin re-medirse en `eval/` (ver §2).
2. **La memoria llega solo a argumentos y respuesta final** (`RECALLED_SOURCE_POLICY`, [`recalledPolicy.ts`](../../src/core/recalledPolicy.ts)): no a `pending`, `plan`, D3 ni D4. En deliberativo el plan no ve los hechos; solo la generación de argumentos (con `request` y paso).
3. **Hilo de un solo slot, en RAM** ([`tasks.ts:218`](../../src/core/tasks.ts)): se pierde al reiniciar, vence a los 10 minutos y solo lo actualiza una tarea `completed` con respuesta del modelo (una parcial o con respuesta de respaldo no encadena). Solo funciona en reactivo.
4. **Tope inconsistente:** la respuesta anterior se recorta a 500 caracteres (`THREAD_ANSWER_CHARS`), pero `threadValueMax` del contexto es 8000.

### 9.4 Tests

De los 6 fallos de la suite, los 4 de flujo quedaron resueltos (§9.1, punto 1). Quedan 2, ya conocidos:
- `run_command.test.ts:522`: desactualizado, ya figura en §1.
- `http.test.ts:86`: consecuencia del guard de `Host` (§1).

Además, `tsc --noEmit` falla en variantes de eval nuevas sin versionar (`eval/variants/d5/d5_it*.ts` importan `DecisionInput` de `contracts.ts`, que no existe); el resto del proyecto compila limpio.
