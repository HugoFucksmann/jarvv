# Revisión de los chequeos previos a la ejecución (v0, borrador)

> **Solo investigación y plan. No hay nada implementado.** Documento independiente: no depende de `MEMORIA_CONTEXTO_DISENO.md` ni de `PENDIENTES_*.md`, aunque toca los mismos archivos de política que el invariante 8 de la memoria (§7).

Lo que sigue sale de leer `callRunner.ts`, `guard.ts`, `precheck.ts`, `allowedDirs.ts`, `sensitivePaths.ts`, `tiers.ts`, el principio de `commandRules.ts`, `readOnly.ts`, `blacklist.ts`, `egress.ts` y `tools/manifest.ts`. Los **huecos de §4 son hipótesis de lectura, sin reproducir**: cada uno debe confirmarse con un caso que falle antes de escribir el chequeo.

## 1. Objetivo

1. Que un agente pueda **agregar chequeos que cubran huecos** sin adivinar dónde van, en qué orden ni qué devuelve cada uno.
2. Que "qué argumento es una ruta" y "cómo se compara una ruta" estén definidos **una sola vez**, para que un chequeo nuevo no quede incoherente con los demás.
3. Que cada chequeo nuevo traiga su caso de prueba y no rompa los anteriores.

No es objetivo rediseñar el flujo ni armar un marco genérico de «pipeline de chequeos».

## 2. Mapa actual (verificado)

Orden real en `runCall` (`src/core/engine/callRunner.ts`), antes de ejecutar una herramienta:

| Paso | Chequeo | Archivo | Qué devuelve |
|---|---|---|---|
| 5 | Anti-bucle (`isRepeat`) | `ctx/derive.ts` | rechazo `loop_blocked` |
| 6 | **Guard**: patrones destructivos, comandos catastróficos, regla B (carpetas protegidas, solo `FILE_WRITE`), rutas sensibles, datos sensibles a internet, herramienta no catalogada, aprobación por política | `policy/guard.ts` (+ `commandRules`, `sensitivePaths`, `egress`) | `DENY` (rechazo `tool_rejected`), `APPROVAL` (con `mandatory` obligatorio aun con `autoMode`) o `ALLOW` |
| 6a | Lista negra y niveles (verde/amarillo/rojo) | `policy/blacklist.ts`, `policy/tiers.ts` | rechazo en automático (`blocked`), o pregunta al usuario, o D3 estricto (`sensitive`/amarillo) |
| 6b | **Pre-chequeo** determinista (valores, fuentes, llamada, análisis de comando con AST de PowerShell) | `engine/precheck.ts` | hallazgo `args_invalid` / `info_missing` con razón en inglés para el LLM |
| 6c | `allowedDirectories` (rutas de argumentos, `cwd`, rutas del AST del comando) | `policy/allowedDirs.ts` + **bloque suelto en `runCall`** | rechazo `tool_rejected`, o «no resoluble» → pregunta al usuario |
| 7 | Confirmación del usuario | `callRunner.ts` | aprobar / rechazar |
| 8 | D3 `reviewArgs` (solo escrituras no aprobadas y no verdes) | `models/decision.ts` | aprobar / `args_invalid` / rechazo |

Catálogo actual de herramientas (`tools/manifest.ts`): `read_file`, `read_multiple_files`, `write_file`, `create_directory`, `list_directory`, `move_file`, `start_search`, `get_more_search_results`, `run_command`, `list_processes`, `stop_process`, `web_search` y las internas de `free_search`. **`start_process` ya no existe en el catálogo** (solo sigue nombrado en `guard.ts` y `blacklist.ts`).

## 3. Hallazgos de estructura

1. **La orquestación vive en línea.** El orden de los chequeos, el bloque de `allowedDirectories` (~45 líneas) y la caché del analizador de comandos están dentro de `runCall` (590 líneas). Un chequeo nuevo exige leer todo ese cuerpo para saber dónde insertarlo.
2. **Cuatro definiciones de «qué argumento es una ruta»:**
   - `precheck.ts`: `PATH_KEYS` (sin `paths`).
   - `sensitivePaths.ts`: `PATH_KEYS` más `paths`.
   - `callRunner.ts`: `ALLOWED_DIR_PATH_KEYS` + `toolPathArgs` (con `paths` como arreglo y la excepción `isUrl`).
   - `guard.ts` (regla B): cualquier argumento de texto salvo `content` y `mode`; **ignora los arreglos**.
3. **Resultados heterogéneos.** `DENY/APPROVAL/ALLOW`, hallazgo con razón, rechazo con nota, «no resoluble». No hay un contrato que diga qué significa cada uno ni cuál prevalece.
4. **Dos formas de comparar rutas.** `guard.ts` usa `isPathInside` sin seguir enlaces (lo dice su cabecera); `allowedDirs`, `sensitivePaths` y `tiers` usan `isPathInsideCanonical` (resuelve enlaces y uniones). Un chequeo nuevo puede elegir la equivocada.
5. **`precheck.ts` (677 líneas) mezcla cuatro cosas:** recolección de fuentes y lectura de refs, el analizador de PowerShell (lanza un proceso), normalización de texto y las tablas de reglas.
6. **Lo que ya está bien:** las reglas de `precheck` son una tabla (`VALUE_RULES`, `SOURCE_RULES`, `CALL_RULES`, interfaz `PrecheckRule<C>`, `precheckRuleNames()`) con convenciones escritas (§6). Es el punto natural para chequeos nuevos.

## 4. Candidatos a huecos (hipótesis a verificar)

Cada fila: qué se sospecha, dónde, y el caso que lo confirmaría o lo descarta.

| # | Sospecha | Dónde | Caso para confirmar |
|---|---|---|---|
| H1 | **Enlaces en la regla B de Guard.** Compara sin resolver enlaces ni uniones; una unión dentro de una carpeta permitida que apunte a `data/refs` (o, tras la memoria, a `data/memory.json`, al log o al proyecto) esquiva la protección. Los otros chequeos sí resuelven enlaces. | `guard.ts` `touchesProtectedPath` | `write_file` a `<carpeta permitida>\atajo\x` con `atajo` → `data/refs` |
| H2 | **`paths` (arreglo).** En `precheck` el rol de `paths` es `text`: no se aplican `other-user-folder`, `windows-invalid-path` ni `read-path-source`. La regla B de Guard tampoco mira arreglos. `read_multiple_files` además no declara `params` en el catálogo. | `precheck.ts` `roleOf`; `guard.ts` | `read_multiple_files` con una ruta de otro usuario o inventada |
| H3 | **Comandos por texto vs. AST.** `commandRules` y `sensitivePaths` leen el comando como texto (límites ya documentados: variables definidas por el propio comando, tuberías, concatenación). Ya existe un AST real (`analyzePowerShell`, con `commands` y `detectedPaths`) que solo usan `precheck` y `allowedDirs`. | `commandRules.ts`, `sensitivePaths.ts` | `$p='C:\Users\x\.ssh'; gc $p\id_rsa`; `gci C:\ \| ri -r` |
| H4 | **Contenido que se escribe.** El `content` de `write_file` no se escanea (ni por Guard ni por `egress`); `egress` solo vigila `web_search`. Un secreto leído puede terminar en un archivo fuera de las carpetas del usuario. | `guard.ts`, `egress.ts` | `write_file` con un token leído antes, a una carpeta compartida |
| H5 | **Casos solo de Windows.** El análisis de comandos corre solo en Windows; en otros sistemas, `precheck` calla y `allowedDirs` pregunta. Si Jarvis corre en otro SO, el nivel de cobertura baja sin aviso. | `precheck.ts`, `callRunner.ts` | Correr el corpus con `platform` distinta |
| H6 | **`analyzer` que falla o expira** → `precheck` no rechaza (principio «ante la duda, silencio»). Combinado con un comando largo, es una forma de saltarse `command-analysis`. | `precheck.ts` | Comando que haga expirar el analizador |
| H7 | **URLs.** `url-syntax` valida esquema y credenciales; las redes privadas (`localhost`, `169.254.x.x`, rangos privados) dependen de «la propia herramienta» (`egress.ts` lo dice). | `precheck.ts`, `tools/web` | `web_search` con `urls: ["http://169.254.169.254/..."]` |
| H8 | **Herramienta conocida sin clasificar.** `approvalTierOf` devuelve amarillo por defecto para una escritura del catálogo que no está en su `switch`: con `autoMode`, solo D3 la frena. Hoy no aplica (todas las escrituras están cubiertas), pero una herramienta nueva nace amarilla. | `tiers.ts` | Agregar una escritura al catálogo y mirar su nivel |
| H9 | **Orden con la memoria.** La protección del proyecto y de `data/memory.json` (diseño de memoria §9.8) debe correr **antes** de `allowedDirectories` (que además puede quedar guardada por el usuario) y no ser aprobable. | `callRunner.ts`, `guard.ts` | Aprobar una carpeta que contenga al proyecto y escribir en él |

Fuera de esta lista queda lo que la propia documentación ya declara como límite aceptado («no es una barrera contra un atacante, sino contra el error de un modelo pequeño»). El agente puede proponer cubrir alguno, pero debe decirlo explícitamente.

## 5. Refactor propuesto (sin cambiar comportamiento)

En un cambio aparte y **antes** de agregar chequeos nuevos, verificado con los tests existentes. Tres pasos:

1. **Un módulo de «rutas de una llamada»** (en `policy/`): qué argumentos son rutas (incluidos arreglos y la excepción `isUrl`), cómo se normalizan y cómo se comparan (con o sin resolver enlaces, nombrado). Lo usan Guard (regla B), `allowedDirs`/`callRunner`, `sensitivePaths` y `precheck`.
2. **Sacar de `runCall` el bloque de `allowedDirectories` y la caché del analizador** a funciones con nombre. El orden de los chequeos queda visible en un solo lugar, con un comentario que dice qué significa cada resultado.
3. **Separar de `precheck.ts` el analizador de PowerShell** (y, si conviene, la recolección de fuentes) a su propio archivo. Las tablas de reglas se quedan.

No hacer: un marco genérico de chequeos con una interfaz común para los cinco; son resultados distintos y forzarlos agrega más código del que quita.

## 6. Cómo debe escribirse un chequeo nuevo

- **Determinista y sin modelos.** Ante la duda, silencio (no rechazar lo que no se pueda comprobar), salvo en lo que Guard marca como obligatorio.
- **Dónde:** una fila en la tabla de `precheck` (`VALUE_RULES`, `SOURCE_RULES` o `CALL_RULES`) si es un rechazo con razón para el LLM; una regla en `policy/` si es una política (denegar o exigir aprobación). No se agrega lógica nueva dentro de `runCall`.
- **La razón** va en inglés, dice qué hacer en su lugar (llega a la línea FAIL del LLM de argumentos; sin ella el modelo repite la misma llamada).
- **Falsos positivos cuestan:** un rechazo de más hace que el modelo insista y gaste pasos (`maxDeniedPerStep`). Cada chequeo debe incluir un caso válido cercano que **no** rechace.
- **Cada chequeo nuevo cita su hipótesis (H#) y trae su caso que falla** antes de arreglarlo.
- No aflojar chequeos existentes.

## 7. Orden de trabajo y coordinación

1. Esperar a que termine el paso de Guard del agente de memoria (invariante 8: `data/memory.json`, carpeta del log y proyecto, también para `run_command`). Ambos trabajos tocan `guard.ts`, `commandRules`/`blacklist` y quizá `allowedDirs`; hacerlos a la vez genera conflictos.
2. Refactor de §5 (un cambio, sin comportamiento nuevo).
3. Corpus de casos (§8) y verificación de H1 a H9: los que se confirmen se cierran con un chequeo; los que no, se descartan en el documento.
4. Revisión conjunta del resultado.

## 8. Corpus de casos (recomendado como primer entregable)

Una tabla de llamadas (`herramienta`, `args`, `plataforma`/entorno) con la decisión esperada (`ALLOW`, `APPROVAL`, `DENY`, rechazo por pre-chequeo con su `name`, o «pregunta por no resoluble») que recorra **todos los chequeos juntos**, en el orden real de §2. Sin ella no hay forma de saber que un chequeo nuevo no rompió uno viejo. Hoy los casos están repartidos en `tests/policy.test.ts`, `tests/precheck.test.ts`, `tests/sensitive.test.ts`, `tests/allowed_dirs.test.ts`, `tests/tiers.test.ts`, `tests/readonly.test.ts` y `tests/run_command.test.ts`. El corpus no reemplaza esos tests: los complementa con un recorrido de punta a punta.

## 9. A decidir por el usuario

- ¿Se hace el refactor de §5 antes de los chequeos nuevos (recomendado) o se agregan los chequeos sobre la estructura actual?
- ¿El corpus de §8 es parte de este trabajo o se deja para la etapa final de tests, como en el resto?
- ¿Se quiere cubrir alguno de los límites aceptados que hoy están documentados como tales (H3: usar el AST también en `commandRules`/`sensitivePaths`)?
- Corregir `start_process` en el diseño de memoria (§9, invariante 8 y §12.1): hoy el catálogo solo tiene `run_command`.
