# Plan de pulido del código (backend)

> Documento vivo. Alcance: `src/` y `server.tsx`. Fuera de alcance: `eval/` (se trabaja aparte), `ui/` (no tiene tests: se aborda después con otra red de seguridad) y todo lo que dependa de mejorar prompts.
> Seguridad queda fuera de este enfoque (etapa de desarrollo). Prioridad: lo técnico.
> Estado al 2026-11-22: las fases A a E están hechas; lo que queda está en «Pendiente» y en la tabla de la auditoría.

## Resultado

| | Antes | Después |
|---|---|---|
| `tsc` estricto | 0 errores | 0 errores |
| Biome (`npm run lint`) | sin linter | 0 errores; 1 aviso en el backend (en `prompts2.ts`, que es de prompts) |
| Ciclos de importación en `src/` | 0 | 0 |
| Funciones de `src/` sobre 150 líneas | 12 | 0 |
| Bloques repetidos de 10 líneas (`src/`) | 3 pares de archivos | 1 par (`readFile`/`editFile`: el comienzo de «resolver el archivo») |
| Tests (ejecutados) | 799 de 800 (el chequeo de `Host`) | 839 de 841; los 2 que fallan son de `eval/auto` por los datasets que se editan aparte |

## Principios (cómo se decidió cada cambio)

1. **Sin cambio de comportamiento.** Es refactor: mismas entradas, mismas salidas. Cada paso terminó con `tsc`, Biome y la suite. Lo que sí cambia está marcado como «Corregido» en `CHANGELOG.md`.
2. **Se parte por responsabilidad, no por tamaño.** Una función larga se divide solo si cada pieza tiene un nombre que dice qué hace y puede probarse sola. Si partirla obliga a pasar diez parámetros o a compartir estado, el cuerpo se ordena por secciones y se deja.
3. **Una sola definición.** Lo duplicado se extrae a un módulo que ya tenga dueño (`core/tools/`, `core/utils.ts`). No se crean capas para una sola función; y no se unifica lo que solo se parece (los mensajes de cada herramienta difieren a propósito).
4. **Las firmas públicas no cambian** salvo que el paso lo diga.
5. **No se toca lo que funciona sin motivo medible.**

## Decisiones tomadas (y por qué no se hacen)

| Tema | Decisión | Motivo |
|---|---|---|
| Des-exportar los 103 valores usados solo en su módulo | No | Son constantes de contrato de cada proveedor y factorías `createDefault*`; quitar el `export` suma cambios sin ganancia. No hay ninguna declaración sin uso en ningún archivo. |
| `Guard` y `ConfigManager` (clases de estáticos) a funciones | No | Los usan motor, tests y rutas; es de estilo. La regla `noStaticOnlyClass` queda apagada con ese motivo en `biome.jsonc`. |
| `process.cwd()` como raíz de datos | No | Es una convención que los tests usan (`chdir` para aislar la configuración). Si se quiere desacoplar: una variable `JARVIS_HOME` con `cwd` por defecto (decisión de diseño). |
| Separar los defaults de `jarvis-config.json` del estado local | No ahora | Cambia dónde viven los datos del usuario y toca la persistencia y sus tests. |
| `src/core/models/prompts2.ts` (copia que nadie importa de `prompts.ts`) | Sin tocar | Es trabajo de prompts. Hay que decidir si es una variante en curso o un resto. |
| Registro vacío de extractores (`result/extractors/index.ts`) | Se deja | Es un punto de extensión declarado en `manifest.ts`; no es código muerto. |
| `speechExcerpt`: cortar una primera frase larga | No | El test fija lo contrario a propósito («siempre devuelve algo»): la primera frase se lee entera aunque pase de `max`. |
| `start` distinto de `dev` en `package.json` | No | El servidor ya distingue `NODE_ENV`, pero ponerlo en el script no es portable a PowerShell sin `cross-env`. |

## Fases

### Fase A — Restos y autocorrecciones seguras ✅
- `core/mcp/transport.ts`: mensajes JSON-RPC tipados (`JsonRpcMessage`), sin `any`; el `catch` vacío tiene su motivo.
- Autocorrecciones de Biome en `src/`: plantillas, cadena opcional, `node:`, `String.raw` innecesario; `this` en estáticos; `!` no nulos sustituidos por variables locales o por `bind`; `forEach` que devolvían valor; `hasOwnProperty.call` por `Object.hasOwn`.
- Finales de línea: el árbol de trabajo pasó a LF (los archivos que Biome tocó estaban en LF y el resto en CRLF).

### Fase B — Recorrido compartido de carpetas ✅
- `core/tools/walkFolder.ts` (+ `settle`): el recorrido por anchura que estaba escrito dos veces. Pruebas propias en `tests/walk_folder.test.ts` (orden, topes, plazo, cancelación, excluidas, ocultas, enlaces).
- `pathFailureData` reemplaza el mismo mapeo `denied`/`not_found` copiado en 7 herramientas.
- Cambio de comportamiento menor: una carpeta enlazada desde dentro de la raíz se visita una sola vez en `find_files` (antes dos), y un enlace a una carpeta excluida (`node_modules`…) se omite también en `find_files`.

### Fase C — Funciones largas ✅
Hechas: `parseSnapshot`, `runDownloadFile`, `moveSingleItem` (con `OverwriteBackup`), `runListFolder`, `runConvertFile`, `runArchiveFiles`, `runSearchContent`, `runSystemInfo` (tabla `SECTION_RUNNERS`), `createJarvisRouter` (rutas por recurso), `main` de `server.tsx`.
`startTelegram`: de 433 líneas a una clase `TelegramBridge` de métodos cortos (lo que se envía al chat, los eventos de la API, los comandos, botones y mensajes). Antes se pinó el comportamiento con `tests/telegram_bot.test.ts` (11 pruebas de punta a punta, sin red: un servidor HTTP local hace de API de JARVIS y un transformador de grammY anota las llamadas a Telegram) y se sacaron `waitingPrompt.ts`, `switches.ts` y `statusMessage.ts`, los tres con pruebas. `startTelegram` acepta `bot` y `polling: false` para probarlo.

### Fase D — Scripts, documentos y herramientas ✅
- `package.json`: `clean` multiplataforma, `engines`.
- `auditoria-src-2026-11-22.md` y `JARVIS_TOOLS_Y_GRUPOS_revisado.md` pasaron a `docs/` (con índice). `AUDITORIA_EVAL.md` queda en la raíz: es de `eval/`.
- `vite.config.ts`: comentarios neutros sobre `DISABLE_HMR`.

### Fase E — Verificación ✅
`npm run lint` (tsc + Biome) en 0 errores; `npm test` igual que la línea base más las pruebas nuevas; el servidor arranca y responde (`/api/jarvis/limits`, 403 con `Host` ajeno, 404 en rutas API inexistentes).

## Auditoría de `src/` (`docs/auditorias/auditoria-src-2026-11-22.md`)

| Hallazgo | Estado |
|---|---|
| CRIT-01 contrato de las reglas del pre-chequeo | ✅ `PrecheckRule` es sincrónica; `CallRule` puede ser asincrónica |
| CRIT-02 pérdida del destino al mover un enlace entre volúmenes | ✅ el enlace se crea aparte y reemplaza al destino con `rename` *(sin prueba automática: requiere dos volúmenes)* |
| CRIT-03 recursión sin tope en `TerminalProvider.start` | ✅ el relanzamiento es de una sola vez; si vuelve a fallar se apagan las ayudas |
| CRIT-04 `not_found` de las herramientas nativas llega como `tool_error` | ✅ para las **escrituras** nativas (`reason: "not_found"` → `not_found`: lleva `WRITE_NOT_FOUND_NOTE`, se rechaza sin modelo, cuenta como error de la herramienta en los topes y no es «posible cambio»). Las lecturas se dejan como `tool_error` a propósito: su mensaje ya dice qué falta y así se rechazan sin consultar al 2B. *Conviene confirmarlo con una corrida de eval* |
| IMP-01 E/S síncrona en rutas periódicas | ✅ lo que pesaba: `isTaskLogTerminal` reproducía cada log completo en cada pasada de retención; ahora usa el resumen (cabecera y dos últimos registros) y reproduce solo si no alcanza. **Se deja** a propósito: `readRefText` del pre-chequeo (hasta 400 KB por ref y por llamada; hacerlo asíncrono cambia `collectSources` y a todos sus llamadores), `readHead`/`readGitSha` de la traza (unos KB al cerrar la tarea) y `ffmpegBin` (se llama una vez por nota de voz; una caché sumaría estado que se desactualiza) |
| IMP-02 buffers enteros en `archive_files` y `clipboard` | ✅ `clipboard`: la lectura tiene tope (`MAX_CLIPBOARD_READ_BYTES`, 4 MB) y lo que lo supera es un error. **Se deja** `archive_files`: descomprimir cada entrada ocupa su tamaño en memoria igual, así que leer el ZIP por offset no baja el pico; bajarlo exige un escritor y un lector de ZIP en flujo, mucha complejidad para un tope que ya existe (`maxInputBytes` 256 MB, `maxExtractBytes` 512 MB) |
| IMP-03 `shown` con `total: 0` en `system_info` | ✅ |
| IMP-04 `stderr` de `ffmpeg` | ✅ |
| IMP-05 `pc_settings` wifi duplica el plazo | ✅ el respaldo usa solo el tiempo que sobró y no corre si se canceló *(sin prueba automática: el driver real usa PowerShell)* |
| IMP-06 `write_file` crea carpetas antes de validar | ✅ el formato se valida antes |
| IMP-07 ciclo de vida de `StdioMcpTransport` (`taskkill`, `error`) | ✅ `close()` espera la salida del hijo (hasta 2 s), `taskkill` tiene su `error` con respaldo `SIGKILL`, y un `spawn` fallido limpia `childProcess` *(sin prueba automática de `taskkill`)* |
| IMP-08 symlinks rotos distintos entre herramientas; regex sin tope por línea | ⏳ la primera es una decisión de producto (¿se muestran?) |
| IMP-09 `speechExcerpt` | ✅ el espacio cuenta; lo de la primera frase se mantiene a propósito |
| IMP-10 `prune()` de tareas, `getUserEnvironment` fuera de Windows, límites de `move_file`, `Rendered.overflow` | ✅ las tres primeras (`prune` cubre todo el excedente, sin PowerShell fuera de Windows, `move_file` usa los topes de `copy_file`). ⏳ `Rendered.overflow`: unificar la convención de `render/*` |
| MIN-01 código muerto | ✅ salvo el registro de extractores (ver decisiones) |
| MIN-02 duplicados | ✅ `fitLines`, plazo de `find`/`list`, sonda de binarios, JSON canónico. Quedan: plazo de `terminalProvider` (semántica distinta) y `stemsOf` de `memory/` (el paquete es independiente a propósito) |
| MIN-03 patrones frágiles | ✅ casi todo: índice del catálogo, NUL en `mdToHtml`, cierre idempotente de SSE. Los sufijos de archivos temporales ya no pueden chocar (`tempSuffix`). Queda la doble apertura de archivos en `read_file`/`search_content` |
| Oportunidades 3 (helper PowerShell común en `tools/system/`) | ⏳ |

## Aislamiento de capas (2026-11-22)

Medido sobre los imports reales: `core/ctx` no importa nada de fuera; los modelos no ven el contexto ni el motor; los proveedores de `tools/*` solo ven `core/tools` y `core/policy`; Telegram habla con el núcleo por HTTP. Se agregaron 4 pruebas de arquitectura y se cortaron tres acoplamientos (`mcp`→`models`, `trace`→`engine`, `engine`→`models`; ver `CHANGELOG.md`).

Quedan a propósito, por no justificar el cambio: `core/tools` ↔ `core/policy` se importan entre sí por zona (no hay ciclo entre archivos) y `core/` raíz mezcla utilidades con el orquestador `tasks.ts`. Separar esas zonas obliga a mover muchos archivos sin quitar complejidad real.

## Pendiente

1. Los ⏳ de la tabla anterior, de a uno, cada uno con su prueba.
2. `AUDITORIA_EVAL.md` y todo lo de `eval/`: del trabajo aparte.
3. `ui/`: `useJarvis` (528 líneas) y los avisos de accesibilidad y dependencias de efectos que Biome deja como aviso.
