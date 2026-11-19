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

- **Guard de `Host` desactivado.** En [`src/server/localOnly.ts`](../../src/server/localOnly.ts) el chequeo de `Host` está comentado por compatibilidad con el proxy de AI Studio Build. Mientras esté así, un sitio web puede llegar a la API local con un dominio que resuelve a `127.0.0.1` (DNS rebinding), y esa API ejecuta comandos en la PC sin autenticación. Hoy tampoco rigen la validación de loopback del arranque ni el middleware `localOnly` (están comentados en `server.tsx` y `HOST` es `0.0.0.0` por defecto): el proyecto se corre así a propósito en otros entornos durante el desarrollo. **Decisión:** restaurar el guard (y perder esa compatibilidad) o dejarlo así y cambiar el test para que lo refleje.
- **Tests que ya fallaban antes del refactor de refs:**
  - `tests/http.test.ts:86` («Host local… DNS rebinding»): responde 200 en vez de 403. Es la consecuencia de lo anterior.
  - ~~`tests/run_command.test.ts:522`~~ **Resuelto:** el test ahora comprueba que `data.exitCode` no está (a propósito: el código de salida queda en el texto, para no registrar un segundo `tool_error`) y que el texto lo dice.

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
2. ~~**La salida parcial casi no tiene margen.**~~ **Resuelto:** se eliminó el abandono de ítems (`failHead()` y `applyModelDone()` cierran `no_alternatives` al segundo fallo del ítem, tras una reescritura idéntica o ante respuesta sin reemplazo tras fallo; `maxEscalations` subió a `6` en `budget.ts` como red de seguridad global sin tocar `escalationCount` ni el deliberativo). **Ajuste posterior (2026-11-18):** (1) se quitó `maxItemFailures`: una reescritura distinta del ítem es un intento nuevo y no hereda el conteo (Decisión trabaja con temperatura 0: el mismo texto da la misma respuesta, otro texto puede dar otra); la reescritura idéntica sigue cerrando la tarea. (2) `maxEscalations` (6) pasó a contar pasos fallidos SEGUIDOS (`consecutiveFailedSteps`, `ctx/derive.ts`): un paso completado reinicia la cuenta, así una tarea que se recupera de fallos sueltos no se cierra por acumularlos (antes con 7 ítems que fallaban una vez cada uno y se recuperaban, la tarea cerraba en el 7.º). (3) Parche de dependencias: si tras un fallo el modelo omite el ítem fallido y sigue con uno de los de atrás, cierra `no_alternatives` (`skips_failed_item`, por parecido de palabras con `sameItem`; ante la duda cierra).
3. ~~**`tool_error` y `exception` cuentan como rechazo de la verificación.**~~ **Resuelto el 2026-11-18 (opción A).** `countStep` ya no mete `tool_error` ni `exception` en `rejected`: tienen su contador (`toolFailed`), su tope (`maxToolErrorsPerStep` = 2, también en `GET /limits`, en la interfaz y en `BUDGET`) y su causa (`tool_failed`). Los dos contadores son independientes: un error de herramienta y un resultado rechazado en el mismo paso ya no se suman (antes fallaban el paso en la 2.ª llamada; ahora sigue hasta dos de cada tipo, acotado por `maxCallsPerStep` y `maxAttemptsPerStep`). Con un solo tipo de fallo nada cambia. Las trazas reales (89 + 10 tareas) tenían 4 errores de herramienta en 3 pasos y ningún caso mixto: el cambio ordena la contabilidad y el diagnóstico, no cambia lo observado. **Opciones B y C implementadas el mismo día.** B: `maxToolErrorsPerStep` pasó a 3, pero el tercer intento solo existe si el error cambió: el mismo error (mismo texto, sin `pid` ni duración, `toolErrorSignature`) dos veces seguidas (`maxSameToolErrorsPerStep` = 2) falla el paso. C: tras un paso fallido por `tool_failed`, si `pending` repite el ítem se acepta UN reintento idéntico por ítem (`identical_retry`; el generador de argumentos ve el error anterior en `LAST ERROR`); con cualquier otra causa, repetirlo sigue cerrando la tarea. **Sin datos reales que las respalden** (las trazas tenían 4 errores de herramienta en 3 pasos): se implementaron por decisión, con pruebas unitarias y de motor; conviene mirar en las próximas corridas cuántas veces se activan y si el tercer intento o el reintento idéntico terminan bien.
4. **`runCall` (~300 líneas, [`callRunner.ts:288`](../../src/core/engine/callRunner.ts)) y `precheck.ts` (680)** son lineales y funcionan, pero cuestan tocarlos. Candidatos a partir en fases con nombre (descubrir, argumentos, política, despacho, registro). **Red de seguridad lista (2026-11-18):** [`tests/approval_matrix.test.ts`](../../tests/approval_matrix.test.ts) fija con 54 casos la autorización de una llamada (`approvalTiers` × `autoMode` × nivel × lista negra × ruta sensible × umbral de D3 × `allowedDirectories` × rechazo del usuario); cuatro mutaciones deliberadas de `callRunner` la hicieron fallar. Ver `REFACTOR_CORE.md`, punto 1. **Avance (2026-11-18):** extraídos los pasos 9 a 12 (despacho, resultado, registro y verificación) a `engine/callExecute.ts` (`executeAndRecord`), y lo que comparten las fases (`PreparedCall`, `recordCall`, `registered`, `fromFailure`) a `engine/callRecord.ts`; `callRunner.ts` bajó de 595 a 238 líneas. **Confirmar y revisar extraídos** (pasos 7 y 8) a `engine/callConfirm.ts` (`confirmIfNeeded`, `reviewIfNeeded`); `PreparedCall` lleva ahora la herramienta entera (`tool`) en vez de su nombre. **`authorize` extraído** a `engine/callAuthorize.ts`: `evaluatePolicy` (Guard, nivel y lista negra; síncrona), `needsConfirmation` (la regla de `autoMode` y `approvalTiers`; pura, probada contra la fórmula original en las 2.304 combinaciones en `tests/authorize.test.ts`) y `checkCallArgs` (pre-chequeo y `allowedDirectories`; con disco), compuestas por `authorize`. Sin cambios de comportamiento: la matriz y la suite siguen igual. **Elegir herramienta y preparar argumentos extraídos** (pasos 1 a 5) a `engine/callPrepare.ts` (`selectTool`, `prepareArgs`) y el descubrimiento a `engine/callDiscovery.ts` (`availableRoutes`, `discoverTools`). **Punto 1 del refactor completo (2026-11-18):** `runCall` quedó como una secuencia de 76 líneas (`callRunner.ts` bajó de 595 a 76) que encadena `callPrepare` → anti-bucle → `callAuthorize` → `callConfirm` → `callExecute`; sin cambios de comportamiento (la matriz de 54 casos y la suite siguen igual). **Punto 2 hecho** (tablas por herramienta: `tools/toolTargets.ts`, `TIER_RULES`, `POSTCONDITIONS`, `PATH_KIND_CHECKS`, más `tests/tool_specs.test.ts` que exige su fila a cada herramienta que modifica el sistema; ver `REFACTOR_CORE.md`, «Estado»). **Punto 3 hecho** (`engine/state.ts`: `TaskExecutionState` en `env.state`, sin `WeakSet` global; `engine/reactiveList.ts`: la lista del reactivo como objeto con transiciones). **Punto 4 hecho** (`host.ts` recibe la captura, la memoria la elige `server.tsx`, el inicio del usuario entra por `guardScope.homeDirs`; pruebas de arquitectura nuevas). **El refactor de `REFACTOR_CORE.md` (puntos 1 a 4) está completo.**

5. ~~**Claves de ruta copiadas en 4 archivos.**~~ **Resuelto el 2026-11-18:** una sola definición en [`policy/pathArgs.ts`](../../src/core/policy/pathArgs.ts) (`PATH_ARG_KEYS`, `PATH_LIST_KEY`, `isPathArgKey`), usada por `callRunner`, `precheck`, `sensitivePaths` y `approvalKey`. Las 3 copias de `callRunner`, `precheck` y `sensitivePaths` eran idénticas; la de `approvalKey` omitía `cwd`, y ahora la incluye (solo cambia el caso de una llamada con `cwd` y sin `command`, que el catálogo no produce). **Resuelto también el 2026-11-18:** `precheck` ahora trata `paths` (el arreglo de `read_multiple_files`) como rutas (`roleOf` en `engine/precheck.ts`): cada una pasa por las reglas de marcador de posición, carpeta de otro usuario, caracteres inválidos de Windows y «tiene que salir del pedido o de resultados anteriores», igual que `path`. Una ruta inventada en `read_multiple_files` se rechaza antes de ejecutar (`args_invalid`) en vez de ejecutarse y fallar. Pruebas en `tests/precheck.test.ts`; el test de `allowedDirectories` de `flow_critical` ahora nombra la ruta en su pedido (antes el pre-chequeo no la miraba).

6. **Dependencias entre ítems: la solución de fondo sigue pendiente.** Hoy tras un fallo el modelo devuelve la lista completa y el código la concilia (`reconcileList`); el parche `skips_failed_item` detecta que el ítem fallido desapareció comparando palabras, que es una heurística. Falta decidir una solución estructural, por ejemplo que tras un fallo el modelo solo reescriba el ítem fallido y que el código conserve el orden y el contenido del resto, o declarar dependencias entre ítems. Casos conocidos que la heurística no cubre: un ítem omitido cuya omisión coincide en palabras con el fallido, o un ítem nuevo no relacionado que reemplaza al fallido y deja detrás ítems que dependían de él.
   **Idea acordada (2026-11-18), pendiente de evaluar en `eval/` antes de tocar el motor: una consulta de Decisión tras un paso fallido que clasifique qué hacer (etapa nueva, `recovery`).** Separa *decidir* qué hacer de *redactar* el ítem: hoy el generativo hace las dos cosas a la vez (devuelve la lista completa), y de esa mezcla salen los huecos (omitir ítems, repetir el mismo).
   - **Opciones del decisor (≤ 4 y lejanas entre sí: el 2B elige peor con opciones parecidas, ver P4 de §3):**
     - `close`: cierra `no_alternatives`.
     - `skip_continue`: sigue con los ítems de atrás, solo si **todos** son independientes del fallido. Deja el ítem marcado como fallido (la tarea termina `partial`) y exige que Decisión 5 no apruebe `completed` mientras haya un ítem fallido (fue una fuente de errores antes).
     - `rewrite_item`: el generativo reescribe **solo** el ítem fallido (salida `{"item": "..."}`) y el código conserva el resto del orden: omitir ítems pasa a ser imposible por construcción. La variante de prompt la elige el **código** según la causa, no el decisor: `tool_failed` → corregir los argumentos con el mismo objetivo; `not_accomplished` → otro enfoque; «no encontrado» → buscarlo antes.
     - `replan`: el generativo regenera lo que falta (lo que hoy hace siempre). Solo se justifica cuando el fallo invalida el plan (p. ej. falta un prerrequisito: «la carpeta no existe, hay que crearla antes»). Conserva las reglas de hoy (idéntica, ya cumplido, ítem omitido).
   - **En capas, para no cargar al 2B con lo que el código ya sabe:** (1) una tabla de código por causa resuelve los casos claros sin modelo (`user_rejected`, `denied`, `info_missing` → preguntar, `tool_failed` transitorio → reintentar sin llamar al generativo; absorbería el reintento idéntico de §9.1.3, opción C); (2) el decisor solo ve lo ambiguo; (3) el generativo solo redacta.
   - **Prompts por opción** para el generativo: más cortos que el actual `PENDING_VIEW` (que cubre todos los casos con muchas reglas, para un 4B) y evaluables por separado con las variantes del eval. `PENDING_VIEW` queda para la lista inicial y la confirmación de D5.
   - **Entrada del decisor (corta):** pedido, ítem fallido, causa (nota fija) y último error recortado, **número de intentos del ítem**, ítems de atrás y lo hecho. El contador es necesario: con temperatura 0 y la memoización por tarea (`memoizeDecision`), la misma entrada da la misma respuesta; sin él podría elegir `rewrite_item` una y otra vez. Mantenerla chica: `ollama ps` mostró `d3:2b-text` cargado con contexto 4096 y no con los 16384 de la configuración (*sin investigar*).
   - **Dependencias:** una sola pregunta de grupo `noul`, «¿todos los ítems que quedan son independientes del que falló?», en lugar de una por par. Basta para `skip_continue`: si no todos lo son, no se continúa. Umbral estricto; ante la duda, cierra.
   - **Conducta con confianza baja:** decisión pendiente. Mantener la de hoy (`replan`) mientras no haya datos, o cerrar (`close`) si se prioriza no cometer errores.
   - **Despliegue:** *modo sombra* primero (el decisor corre tras cada fallo, registra su elección en la traza y **no actúa**), medir contra lo ocurrido y activar opción por opción, cada una detrás de configuración; `skip_continue` al final. Hace falta: etapa `recovery` en `types/stages.ts`, `chooseRecovery` opcional en `IActionDecision` (como `firstQuery` y `continuation`: el motor funciona sin él), captura en la traza y su prompt en `models/decision.ts`.
   - **Primer paso, independiente y de menor riesgo:** que el generativo reescriba solo el ítem fallido (`rewrite_item` sin decisor). Cierra el hueco de dependencias por construcción.
   - **Preguntas abiertas:** ¿se recupera la salida parcial o se mantiene «cerrar siempre»? (si es lo segundo, bastan `rewrite_item` y la tabla de código); latencia aceptable tras un fallo (decisor ~50 ms, generativo ~1 s); ¿puede el decisor elegir «preguntar al usuario»?
   - **Siguiente paso acordado:** probar la consulta de Decisión en `eval/` (casos con la acción esperada, armados con trazas reales y casos sintéticos) para ver cómo funciona **antes** de tocar el motor.
   - **Estado del eval (2026-11-18): listo para probar variantes.** Etapa `recovery` en `eval/core/stages/recovery.ts` (13 etapas), prompt base `DECISION_PROMPTS.buildRecovery` y entrada `recoveryInput` en `src/` (**sin conectar al motor**), dataset semilla de 30 casos en `eval/datasets/recovery/` con su regla de etiquetado (`README.md`), caso de humo y una variante plantilla (`recovery_neutral_labels`). Oracle: 100 %. **Primera lectura con `d3:2b-text` (indicativa: n = 30, un solo prompt):** `action` 17/29 (58,6 %): `replan` 5/5, `rewrite_item` 8/11, `skip_continue` 2/7, `close` 3/7; `independent` 12/17 (0 falsos «independiente», 5 falsos «dependiente»: el lado seguro). La probabilidad de la acción elegida no separa aciertos de errores (media 0,61 frente a 0,58): hoy no serviría para decidir cuándo dudar. Con dos intentos fallidos el modelo tiende a seguir eligiendo `rewrite_item` (3 de los 5 `skip_continue` con `attempts = 2`), así que conviene probar variantes que le den más peso al número de intentos y a la causa. Para correrlo: ver `eval/datasets/recovery/README.md`.
   - **Actualización (2026-11-18, tarde): modo sombra conectado; sin `skip_continue`.** Se quitó `skip_continue` (y `independent`): un ítem existe porque el pedido lo necesita; si no se puede hacer, se cierra. Quedan tres acciones (`close`, `rewrite_item`, `replan`) y el prompt de producción es una pregunta única de tres opciones (78 % sobre los 240 casos del eval). `src/core/engine/recoveryRules.ts` (función pura: prerrequisito faltante → `replan`; parada dura → `close`; si no, `null`) más `recoveryShadow.ts`, llamado desde `runTask.ts` antes de `list.failHead`, registran qué haría `recovery` en la traza (etapa `recovery`) **sin actuar**; config `recoveryShadow` (encendida por defecto). Detalle, números y cautelas en `eval/GUIA_DECISION.md`, sección 5. **Falta:** juntar trazas reales, medir `final` contra lo que pasó después y decidir (ver «Modo sombra» en la guía) si se activa `close` por regla (el más seguro) y después `rewrite_item`/`replan`; la solución de fondo (el generativo reescribe solo el ítem fallido) sigue pendiente. El eval y producción cuentan los «intentos» distinto (pasos fallidos seguidos contra llamadas del paso): ver la guía.

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
