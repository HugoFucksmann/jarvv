# Pendientes que dependen de código

Todo lo que se cierra **programando** o con una **decisión de producto o de seguridad**, sin necesidad de correr `eval/`. Lo que se cierra midiendo está en [`PENDIENTES_EVAL.md`](PENDIENTES_EVAL.md). Actualizado el 2026-11-19; lo ya resuelto se quitó (el historial está en git).

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
- **Test que falla por lo anterior:**
  - `tests/http.test.ts:86` («Host local… DNS rebinding»): responde 200 en vez de 403 mientras el guard esté desactivado.

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

Estado: los archivos visibles para D1/D2 los sirve Desktop Commander (`files`, `locate`); en `src/tools/` hay proveedores nativos para `files` (`jarvis_files`, interno en etapa 1: `find_files`, `list_folder`, `system_info`), `terminal` y `web`. No existe copiar ni borrar nativos: copiar y borrar solo se logran con `run_command` (nivel rojo en `tiers.ts`, pasa por `commandRules.ts`). `tiers.ts` solo clasifica `create_directory`, `write_file`, `move_file`, `run_command` y `stop_process`.

| # | Propuesta | Qué resuelve | Riesgos y dependencias |
|---|---|---|---|
| P1 | **Hecho en etapa 1 (interno):** `find_files` (`jarvis_files`, `src/tools/files/`): `{ pattern, path, type, maxResults }` | `start_search` son dos etapas (arrancar y paginar), no encuentra carpetas y falla con comodines/listas | Queda como `internal: true` hasta la etapa 2 (ver P4 y [`TOOLS_NATIVAS_ETAPA_1.md`](TOOLS_NATIVAS_ETAPA_1.md)) |
| P2 | `copy_file` (nativa, escritura) | Copiar sin pasar por el parser de PowerShell | Sobrescribir (rojo si el destino existe, como `move_file`); carpetas enormes (tope de tamaño); symlinks y rutas `\\?\`/UNC/8.3. Nivel en `tiers.ts`, poscondición de disco, sondas de lugar |
| P3 | `delete_file` (nativa, escritura destructiva) | Borrar sin comandos abiertos; permite mandar a la **papelera de Windows** (reversible) | El riesgo más alto: borrado recursivo, papelera según API de Windows (PowerShell o `Microsoft.VisualBasic.FileIO`), no atómico. **Rojo siempre**, confirmación reforzada para recursivo, nunca fuera de alcance ni una carpeta de usuario raíz, registro en la traza. Va **después** de P2 y de revisar `tiers.ts` |
| P4 | Reagrupar rutas `files`/`locate` en «consultar» y «modificar» | Menos opciones de ruta para D1 (el 2B elige peor con más rutas parecidas) | Cambia el flujo de D1/D2 y los datasets de `eval/` (**requiere re-medir**); depende de P1 |
| P5 | Edición dirigida (`edit_block` o equivalente) | Editar una parte sin reescribir el archivo (hoy `write_file` en `rewrite` es rojo) | Coincidencia ambigua; dependencia de Desktop Commander; decidir si se expone `edit_block` o se hace nativa |
| P6 | **Hecho en etapa 1 (interno):** `list_folder` y `system_info` (`jarvis_files`, `src/tools/files/`) | `list_folder` da tipo, tamaño, fecha, orden y filtro por extensión sin sondas; `system_info` cubre hardware, SO, discos, servicios y dev tools | Quedan como `internal: true` hasta la etapa 2 (ver [`TOOLS_NATIVAS_ETAPA_1.md`](TOOLS_NATIVAS_ETAPA_1.md)) |

**Orden sugerido:** P1, P2, P3, P4 (re-midiendo en `eval/`). P5 y P6 según uso real.

**Plan en dos etapas (decidido el 2026-11-19).** Etapa 1 (**implementada en código**; falta prueba manual en Windows): agregar solo las nativas de lectura (`find_files`, `list_folder`, `system_info`; P1, P6 y las «recetas» de §8), registradas como internas y sin exponer a D1 ni D2; la ficha está en [`TOOLS_NATIVAS_ETAPA_1.md`](TOOLS_NATIVAS_ETAPA_1.md) (incluye lo que se midió de `start_search`: no encuentra carpetas, no entiende regex ni listas de extensiones y confunde «no terminé» con «no está»). Etapa 2: redistribuir rutas y opciones de D1 y D2, actualizar los datasets de `eval/` y recién entonces apagar `locate` y la búsqueda de Desktop Commander.

**Decisiones pendientes:** ¿papelera por defecto en `delete_file`, o también borrado permanente con confirmación? ¿`find_files` puede buscar fuera de las carpetas del usuario? ¿Se acepta tocar el flujo de rutas (P4) antes de tener las nativas?

## 4. Allowlist persistente de aprobaciones

«Aprobar siempre en esta tarea» vive solo en la RAM de la tarea (`TaskRuntime`, clave herramienta + comando o ruta normalizada, `policy/approvalKey.ts`). Una allowlist **entre tareas** está aplazada a propósito: exige diseñar cómo se gestiona y se revoca desde la UI y cómo evitar aprobaciones demasiado amplias. `edit_block` (en pausa) sigue en rojo.

## 5. Terminal Windows (`src/tools/terminal/`)

- **Ruta completa de un `.exe`** (`C:\Windows\System32\ipconfig.exe | ...`): `nombre`, `nombre.exe` y `nombre.com` ya se envuelven, la ruta completa no; requiere interceptar `Application` con `PostCommandLookupAction`.
- **Procesos que leen `stdin` sin prompt** (`findstr`, `node`): saber si un proceso está bloqueado leyendo su entrada exige código nativo (`NtQueryInformationFile`) o un PTY (ConPTY). Hoy quedan `running` hasta el plazo y `{ pid, input }` los destraba. Cerrar `stdin` tras un silencio rompería los programas que responden por `{ pid, input }`.
- **Procesos huérfanos desde la UI (RC-25):** `list_processes` y `stop_process` ya existen para el modelo. Mostrar y cortar procesos desde la interfaz exige un endpoint que corte procesos en la API local, que no tiene autenticación (decisión de esta etapa: sin token), y definir dónde vive en la UI.
- **Descripción de `run_command` para el modelo:** sigue diciendo 30 s y 300 s aunque se configuren otros tiempos.
- **Hallazgos abiertos de `run_command` y políticas (`Revisión de la tool run_command (Jarvis).md`):** siguen vigentes `H-01` (`accentScore`/`__jvDecode` con caracteres `tree`), `H-02` (`\r\r\n` en `LineAssembler.push`), `H-03` (prompts sin salto retenidos en `__jvRun`), `H-04` (`...` de REPL bloqueado por `PROGRESS_END`), `H-05` (`[n/a]`/`(n/a)` como `CHOICE_OR_KEY`), `H-06` (`stderr` descartado sin diagnóstico en errores de `systemProcesses`; el bloqueo por tubería ya está resuelto), `H-08` (`lastCompleted` sin `seq`), `H-09`/`H-10`/`H-11`/`H-12` (idiomas mezclados, procesos huérfanos listados pero no continuables y textos duplicados), `H-14` (alta: comillas tipográficas `‘’“”` en `readOnly.ts`/`commandRules.ts`), `H-16` (`rerun.ts` acepta `--watch`), `H-17` (`stop_process` con `error` da de baja el hecho `process`), `H-18` (`-Path:C:\` y `*.*`), `H-19` (`shutdown -c`), `H-20` (`KILL_NAMES` sin `CRITICAL_PROCESSES`), `H-21` (`/system32\/drivers/` en `DENY_PATTERNS` bloquea lecturas de `hosts`) y `H-24` (`$env:windir` en `sensitivePaths.ts`). *(Ya resueltos y quitados de pendientes: `H-13`, `H-15`, `H-22` y `H-23`.)*

## 6. Seguridad y API HTTP

- **Sin autenticación local:** `localOnly.ts` frena orígenes web, no otros procesos locales. `POST /config` permite editar `autoMode`, `approvalTiers`, `blacklist`, `retentionDays` y `retentionMaxMb` sin autenticación adicional (token y cifrado quedan fuera por decisión). Ver también §1.
- **Sin rate limiting por segundo ni cifrado en reposo:** las refs y las trazas (`full.json.gz`) se guardan en texto plano; `retention.ts` borra por antigüedad y por tamaño (`retentionMaxMb`, 250 MB por defecto).
- **Límites léxicos de las políticas:**
  - `policy/commandRules.ts`: no analiza variables dinámicas, rutas en tuberías ni concatenación de strings.
  - `policy/readOnly.ts`: lista cerrada conservadora; comandos seguros con paréntesis o `ForEach-Object` siguen pidiendo confirmación.
  - `policy/sensitivePaths.ts`: un nombre 8.3 que no esté en las reglas no se expande con `GetShortPathName`.
- **`allowedDirectories`:** el análisis de PowerShell es heurístico (variables, alias, tuberías): lo que no se puede resolver pide confirmación, y esa confirmación es el límite fuerte real en shell (o un sandbox del sistema). Fuera de Windows `run_command` no se analiza y cae en «pide confirmación».
- **API (`src/server/`):** no se exponen en vivo la lista completa de pendientes ni las decisiones intermedias por SSE.

## 7. Deuda técnica

- **Idioma del reintento:** `retryNote` (`prompts.ts`) sigue en español (`ERROR_PREVIO: ...`) dentro de prompts en inglés.
- **`prompts.ts`:** ya exporta helpers y tablas reutilizables para `eval/`, pero falta modularizar los textos `SYSTEM` en partes con nombre para las variantes del eval.
- **Tests sin cubrir:** los componentes de `ui/` y el flujo de aprobación de extremo a extremo.

## 8. Horizonte JARVIS 2.0

- **Consola:** pseudo-terminal (ConPTY) para REPLs completos, `isatty` y `-Confirm`, y Job Objects para seguir procesos fuera del árbol (`Start-Process`).
- Lecturas preparatorias de apoyo dentro del mismo paso (`role: support`, varias rutas por herramienta) y ejecución paralela de lecturas y procesos independientes.
- Recetas parametrizadas para comandos frecuentes y respuestas finales por plantilla cuando solo hubo escrituras.
- Captura conversacional de memoria y recetas aprendidas (Capa 3 de [`FRENTE_1_MEMORIA.md`](../evaluacion/analisis/FRENTE_1_MEMORIA.md)).

## 9. Revisión de código (flujo, contexto y memoria — pendiente restante)

### 9.1 Flujo

1. **Dependencias entre ítems (`recovery`) y reescritura de un solo ítem:** el modo sombra ya está conectado con las tres acciones finales (`close`, `rewrite_item`, `replan` en `recoveryRules.ts` + `recoveryShadow.ts` + `DECISION_PROMPTS.buildRecovery`, `recoveryShadow: true` por defecto; se descartó `skip_continue`).

   **Qué queda pendiente en `recovery`:**
   - Juntar trazas reales con el modo sombra activo y medir contra lo ocurrido antes de activar `close` por regla y `rewrite_item` / `replan` (ver `eval/GUIA_DECISION.md`, §5; revisar además en trazas reales el tercer intento y el reintento idéntico de `toolFailed`).
   - **Solución estructural de fondo:** hoy tras un fallo el generativo regenera la lista completa (`reconcileList`) y el parche `skips_failed_item` depende de similitud léxica. Falta pasar a que el generativo reescriba **solo** el ítem fallido (`{"item": "..."}` con prompts cortos por causa) y el código conserve orden y contenido del resto, haciendo imposible omitir ítems por construcción.
   - **Conducta con confianza baja:** definir si ante duda de `recovery` se mantiene `replan` o se cierra (`close`).
   - **Desalineación menor:** `eval/` y producción cuentan distinto los intentos de `recovery` (pasos fallidos seguidos contra llamadas del paso).
   - *(Contexto de diseño mantenido en `eval/GUIA_DECISION.md` §5: no sobrecargar al 2B con lo que resuelve una tabla de código por causa —`user_rejected`, `denied`, `info_missing`, `tool_failed` transitorio— y recordar que `ollama ps` mostró `d3:2b-text` cargado con contexto 4096 frente a 16384 en config.)*

### 9.2 Contexto

1. **`recalled` no se puede retirar.** Un hecho recordado dura toda la tarea (`apply` rechaza duplicados de `(source, key)` y no hay baja). La vista conserva solo los `cap` más recientes por fuente (`recalledViewsOf`), así que un hecho relevante temprano puede quedar fuera cuando entran otros después.
2. **`facts` solo tiene dos usos** (`answer_*` y `process`): es un mecanismo genérico sin uso general; no urge, pero conviene tenerlo presente antes de agregarle más claves.

### 9.3 Memoria e hilo

1. **Emparejamiento frágil con claves cortas** ([`memory/index.ts:105`](../../src/memory/index.ts)): prefijos de 5 letras, así que una clave de un solo término coincide con palabras no relacionadas (`proyecto` y `proyección` comparten `proye`). Sin sinónimos. Sigue sin re-medirse en `eval/` (ver §2).
2. **La memoria llega solo a argumentos y respuesta final** (`RECALLED_SOURCE_POLICY`, [`recalledPolicy.ts`](../../src/core/recalledPolicy.ts)): no a `pending`, `plan`, D3 ni D4. En deliberativo el plan no ve los hechos; solo la generación de argumentos (con `request` y paso).
3. **Hilo de un solo slot, en RAM** ([`tasks.ts:218`](../../src/core/tasks.ts)): se pierde al reiniciar, vence a los 10 minutos y solo lo actualiza una tarea `completed` con respuesta del modelo (una parcial o con respuesta de respaldo no encadena). Solo funciona en reactivo.
4. **Tope inconsistente:** la respuesta anterior se recorta a 500 caracteres (`THREAD_ANSWER_CHARS`), pero `threadValueMax` del contexto es 8000.

### 9.4 Otros bugs y tests pendientes

- `src/core/engine/reactiveList.ts:105`: el filtro de reapertura usa `!this.done.includes(item)` exacto en vez de comparación normalizada.
- `src/telegram/bot.ts:70,128`: `waitKey` usa `` `q${w.question.stepId}` ``; si en un mismo paso hay más de una pregunta (p. ej. prompts de proceso con `maxProcessPromptsPerStep = 3`), la segunda colisiona en `t.shown`.
- `ui/components/SettingsModal/sections/SecuritySection.tsx:179-244`: el formulario de `blacklist` no expone el campo `level` (`blocked` | `sensitive`) y el texto explicativo de la lista negra no distingue ambos niveles.
- `src/tools/web/webSearchProvider.ts:227`: `AbortSignal.timeout(...)` puede dejar timers colgados en pruebas (`tests/web_search.test.ts:751`).
- `http.test.ts:86`: sigue fallando mientras el guard de `Host` / `localOnly` esté desactivado (§1).
- `tsc --noEmit` (`npm run lint`) compila limpio con 0 errores.
