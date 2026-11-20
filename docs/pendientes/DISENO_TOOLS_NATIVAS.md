# Diseño y mapa de herramientas de JARVIS (por etapas de complejidad)

Documento de trabajo para diseñar **el catálogo completo de herramientas** que debería tener JARVIS, ordenado por etapas según su complejidad técnica, riesgo operativo e impacto en el enrutado de `D1` y `D2`.

> **Principio rector:** en JARVIS la decisión la toman modelos locales chicos (`2B` para `D1`/`D2` y `4B` para argumentos). Cada herramienta nueva compite por atención en `D2` y por espacio en las rutas de `D1`, así que **solo se agrega una tool cuando reemplaza un desvío frecuente por `run_command`, elimina ambigüedad o habilita una capacidad que hoy no existe**, nunca duplicando herramientas vecinas.

---

## 1. Punto de partida (qué existe hoy)

### 1.1 Proveedores nativos ya activos o implementados

| Proveedor | Herramientas | Estado | Qué cubren |
|---|---|---|---|
| `jarvis_terminal` (nativo) | `run_command`, `list_processes`, `stop_process` | Visibles (`terminal`) | Ejecución PowerShell y procesos en Windows. Hoy absorbe también tareas cotidianas (~63/101 en uso real medido en `JARVIS_EVALUACION.md` T5). |
| `jarvis_web` (nativo) | `web_search` | Visible (`web`) | Búsqueda y lectura web; usa `free_search` (`search`, `fetch`, `read_doc`) como internas. |
| `jarvis_files` (nativo, Etapa 1) | `find_files`, `list_folder`, `system_info` | Implementadas (`internal: true`) | Búsqueda de archivos/carpetas por nombre, listado con tamaño/fecha/orden y diagnóstico fijo del sistema. |

### 1.2 Qué sigue provisto por `desktop_commander` (a retirar por etapas)

Mientras se completan las etapas nativas, `desktop_commander` cubre temporalmente:
- **Búsqueda y listado viejos:** `start_search`, `get_more_search_results` y `list_directory` *(salen primero, en Etapa 2)*.
- **Manipulación básica de rutas:** `create_directory`, `move_file` *(salen en Etapa 3)*.
- **Lectura y escritura de archivos (incluye PDF y Excel):** `read_file`, `read_multiple_files`, `write_file` *(salen en Etapa 5 al completar la paridad de formatos)*.

---

## 2. Reglas de diseño para cualquier tool nueva

Antes de bajar a código, cada herramienta del roadmap debe definir explícitamente:

1. **Separación en `D1` y `D2`:** qué señal observable del pedido del usuario la distingue de sus vecinas (ej. buscar *nombre* vs buscar *texto dentro*; listar *carpeta* vs pesar *árbol*; abrir *app* vs ejecutar *comando*).
2. **Contrato de argumentos cerrado:** priorizar enums, booleanos, límites numéricos y alias conocidos (`home`, `desktop`, `documents`, `downloads`) antes que strings libres o sintaxis de shell.
3. **Contrato de resultado (`toolResult`):** distinguir explícitamente «buscó todo y no encontró» (`no_results`) de «se cortó antes de terminar» (`incomplete` / `partial`).
4. **Seguridad y política en el núcleo:**
   - Lecturas sin confirmación (`FILE_READ` / `READ`), respetando `allowedDirectories` y `sensitivePaths`.
   - Toda mutación visible exige fila en `TIER_RULES` (`src/core/policy/tiers.ts`), `POSTCONDITIONS` (`src/core/engine/postcondition.ts`) y, si escribe ruta destino, en `WRITE_TARGETS` (`src/core/tools/toolTargets.ts`).
   - Todo acceso HTTP/URL pasa por `policy/egress.ts`.
5. **Testeabilidad sin Windows:** cualquier lectura o acción acoplada a APIs de Windows (PowerShell, WinRT, Shell, Registro) debe entrar por una dependencia inyectable en el proveedor para poder probar toda la lógica en Linux/CI.

---

## 3. Mapa completo por etapas de complejidad

Resumen visual del roadmap completo:

| Etapa | Foco | Complejidad | Estado |
|---|---|---|---|
| **Etapa 1** | Lectura básica de archivos y diagnóstico fijo del sistema | Baja | **Hecha (interna)** |
| **Etapa 2** | Completar búsqueda/peso/procesos, reagrupar rutas y exponer Etapa 1+2 | Baja–Media | **Siguiente (diseñar)** |
| **Etapa 3** | Acciones cotidianas reversibles, abrir rutas, portapapeles, duplicados y copias seguras sin PowerShell | Media | Pendiente de diseño |
| **Etapa 4** | Escrituras dirigidas, borrado seguro, descargas, ZIP y conversión de imágenes | Media–Alta | Pendiente de diseño |
| **Etapa 5** | Paridad de texto/PDF/Excel y retiro definitivo de `desktop_commander` | Alta | Pendiente de diseño |
| **Etapa 6** | Control de PC acotado, automatización temporal y conectores externos | Muy alta | Horizonte JARVIS 2.0 |

---

### Etapa 1 — Lectura básica y diagnóstico del sistema *(Implementada, interna — Complejidad Baja)*

Solo lectura, sin efectos colaterales, sin tocar rutas ni `tiers.ts`.

| Herramienta | Proveedor | Rol | Estado |
|---|---|---|---|
| `find_files` | `jarvis_files` | Buscar archivos y carpetas por nombre o comodín en una sola llamada. | Hecha (`internal: true`) |
| `list_folder` | `jarvis_files` | Listar carpeta conocida con tamaño, fecha, orden, profundidad y extensiones. | Hecha (`internal: true`) |
| `system_info` | `jarvis_files` | Hardware, SO, discos, servicios y `dev_tools` sin scripts libres del modelo. | Hecha (`internal: true`) |

---

### Etapa 2 — Completar lectura local, consolidar existentes y activar rutas *(Complejidad Baja–Media)*

**Objetivo:** cubrir los huecos de solo lectura necesarios para **apagar `start_search`, `get_more_search_results` y `list_directory`**, absorber los pedidos más frecuentes de terminal de solo lectura (procesos por memoria/CPU, peso de carpetas, IP local) y validar el nuevo mapa de rutas en `eval/`.

| Herramienta | Proveedor | Tipo | Qué resuelve / diseño base |
|---|---|---|---|
| `search_content` *(nueva)* | `jarvis_files` | Solo lectura | Busca texto dentro de archivos en una sola llamada (reemplaza `start_search` con `searchType: "content"`). Parámetros: `pattern`, `path` (con alias), `extensions`, `ignoreCase`, `maxResults`. Ignora binarios y archivos grandes; usa el mismo contrato honesto (`found`, `partial`, `no_results`, `incomplete`). |
| `disk_usage` *(nueva o evaluar fusión con `list_folder`)* | `jarvis_files` | Solo lectura | Calcula el tamaño total de una carpeta y devuelve los N archivos o subcarpetas más pesados recursivamente (`path`, `kind`: `files \| folders \| any`, `count`). Resuelve «cuánto pesa Descargas» y «qué archivos ocupan más espacio» sin PowerShell. *Decisión abierta:* ver si conviene tool separada o parámetro en `list_folder` para no confundir a `D2`. |
| `file_info` *(nueva o evaluar fusión con `list_folder`)* | `jarvis_files` | Solo lectura | Metadatos de **un** archivo o carpeta puntual (`path`, `hash?: none \| sha256`): tamaño, fechas de creación/modificación, extensión, tipo, atributos (oculto / solo lectura) y hash opcional. Resuelve «¿cuándo modifiqué esto?», «¿es el mismo archivo que el otro?» (comparar hashes) y verificar descargas. *Decisión abierta:* igual que `disk_usage`, evaluar si es un `mode: "single"` de `list_folder` para no sumar una tool vecina que confunda a `D2`. |
| `list_processes` *(mejora)* | `jarvis_terminal` | Solo lectura | Ya existe, pero hoy compite conceptualmente con `top_processes` (`JARVIS_EVALUACION.md` T5). Agregar `sortBy` (`memory \| cpu \| name`), `count`, filtro `name` (además de `all`) y filtro `port` (qué proceso escucha en un puerto) para resolver «qué proceso consume más RAM/CPU» y «qué está usando el puerto 3000» en una sola tool sin duplicar catálogo. Combinado con `stop_process` reemplaza a un eventual `kill_by_port`. |
| `system_info` *(mejora menor)* | `jarvis_files` | Solo lectura | Añadir subsección `network` (IP local, adaptadores activos, puerta de enlace, Wi-Fi conectado y señal, puertos en escucha y chequeo de conectividad opcional con `check_host`: ping/DNS/latencia a un host fijo o de una lista corta) y fecha/hora local en `overview` para cubrir consultas de red e info básica que hoy caen en `run_command` («qué IP tengo», «¿tengo internet?»). Reemplaza a una tool `network_check` aparte. |

**Cambios de integración propios de Etapa 2:**
- Exponer `find_files`, `list_folder`, `system_info`, `search_content` (y `disk_usage` si queda separada) pasando de `internalDef` a `def`.
- Reagrupar `EXECUTABLE_ROUTES` (`P4`): dejar las rutas limpias (`files`, `system`, `terminal`, `web`), moviendo `find_files` y `search_content` a `files` y concentrando `system_info`, `list_processes`/`stop_process` (y luego `open_app`) en `system` según lo que valide `eval/`.
- Corregir `eval/core/stages/tool_choice.ts` (`d.internal !== true`), actualizar datasets y re-medir D1/D2 antes de retirar `start_search`, `get_more_search_results` y `list_directory`.

---

### Etapa 3 — Acciones cotidianas reversibles y copias seguras *(Complejidad Media)*

**Objetivo:** bajar drásticamente el uso de `run_command` en pedidos diarios del escritorio (abrir apps, abrir páginas, copiar archivos/carpetas) con confirmación baja o nula donde la acción sea reversible.

| Herramienta | Proveedor | Tipo / Tier | Qué resuelve / diseño base |
|---|---|---|---|
| `open_app` *(combinada)* | `jarvis_system` (o `jarvis_files`) | Acción reversible (`green`) | **Enfoca si ya corre o abre si no está:** detecta procesos/ventanas abiertas para traerlas al frente sin duplicar instancias; si no corre, resuelve contra Menú Inicio, `App Paths`, `shell:AppsFolder` y ejecutables conocidos sin PowerShell. Si hay ambigüedad, devuelve candidatos. |
| `open_url` *(nueva)* | `jarvis_web` (o `jarvis_system`) | Acción reversible (`green`) | Abre una URL `http://` o `https://` en el navegador predeterminado del usuario (`url`). Validada por `policy/egress.ts` (bloquea esquemas locales/peligrosos o URLs malformadas). |
| `open_path` *(nueva)* | `jarvis_system` (o `jarvis_files`) | Acción reversible (`green`) | Abre un archivo con su app predeterminada o una carpeta en el Explorador (`path` con alias, `reveal?: false`; con `reveal: true` muestra el archivo seleccionado en su carpeta). Cubre «abrime el PDF de la factura» y «abrí Descargas en el explorador», que hoy caen en `run_command` (`Start-Process` / `explorer`). Se distingue de `open_app` (el objeto es una **ruta**, no el nombre de una app) y de `open_url` (no es `http(s)`). Valida contra `allowedDirectories` y `sensitivePaths`; **no** ejecuta `.exe`, `.bat`, `.ps1`, `.lnk` ni otras extensiones ejecutables (las rechaza con mensaje claro). Ver decisión abierta sobre unificar `open_*` en §7. |
| `get_clipboard` / `set_clipboard` *(nuevas, adelantadas desde Etapa 6)* | `jarvis_system` | Lectura (`get`) / acción reversible (`set`, `green`) | «Resumí lo que copié» y «copiame esto al portapapeles» sin `Get-Clipboard` / `Set-Clipboard` por `run_command`. `get_clipboard` solo devuelve **texto** (límite de caracteres, sin imágenes ni archivos) y pasa por un **filtro de secretos** en el proveedor antes de llegar al modelo (tokens/API keys, claves privadas, patrones de tarjeta, contraseñas con formato conocido): si detecta uno, lo enmascara e informa que lo hizo. `set_clipboard` recibe `text` y devuelve cuántos caracteres copió. **Requiere levantar el veto de `manifest.ts`** («sin herramientas de portapapeles») y declarar la excepción acotada. Ver §7 para evaluar si se exponen como una sola tool con `action: get \| set`. Dependencia inyectable para tests. |
| `find_duplicates` *(nueva, combinada)* | `jarvis_files` | Solo lectura | Detecta archivos duplicados en una carpeta (`path`, `recursive?: true`, `minSize?`, `extensions?`, `maxGroups`). Pipeline interno: agrupa por tamaño → hash parcial → hash completo solo de los candidatos; devuelve grupos con ruta, tamaño y fecha, y el espacio recuperable. Cubre «liberá espacio» y «tengo fotos repetidas», que hoy no tienen camino sin scripts largos. **No borra nada:** se encadena con `delete_file` (Papelera) y `organize_files` por pasos separados con confirmación propia. Contrato honesto: `found` / `no_results` / `partial` / `incomplete` (tope de archivos y de tiempo). |
| `copy_file` *(nueva, P2)* | `jarvis_files` | Escritura (`green` / `yellow` / `red`) | Copia archivo o carpeta (`source`, `destination`, `overwrite?: false`). Tier `green` si destino no existe dentro de carpetas de usuario; `yellow` fuera de ellas o copias recursivas grandes; `red` si `overwrite: true` o destino existente. Tope de tamaño/entradas, sin seguir symlinks fuera de alcance. |
| `create_folder` y `move_path` *(reemplazo nativo)* | `jarvis_files` | Escritura (`green` / `yellow` / `red`) | Reemplazan a `create_directory` y `move_file` de `desktop_commander` con soporte nativo de alias (`desktop`, `documents`, `downloads`), rutas Win32/OneDrive, `tiers.ts`, `POSTCONDITIONS` y `WRITE_TARGETS` homogéneos. |
| `inspect_project` *(combinada)* | `jarvis_files` | Solo lectura | Resume una carpeta o proyecto en **1 llamada** (estructura nivel 1–2 + lectura acotada de `README` y manifiestos como `package.json`, `pyproject.toml`, `Cargo.toml`, `*.csproj`), ahorrando 4–5 pasos del modelo. |

---

### Etapa 4 — Escrituras dirigidas, destructivas, descargas, compresión y combinadas de acción *(Complejidad Media–Alta)*

**Objetivo:** cubrir operaciones de mayor riesgo o lógica compuesta que hoy están pausadas (`edit_block`), obligan a comandos riesgosos (`rm`, `curl`, `Compress-Archive`) o fallan al encadenar varios pasos (`play_media`, `organize_files`).

| Herramienta | Proveedor | Tipo / Tier | Qué resuelve / diseño base |
|---|---|---|---|
| `edit_file` *(nueva, P5)* | `jarvis_files` | Escritura dirigida (`yellow` / `green` en proyecto) | Reemplazo dirigido de texto en archivos UTF-8 sin reescribir el archivo entero con `write_file`. Parámetros: `path`, `oldText`, `newText`, `expectedReplacements` (por omisión `1`). Falla **sin tocar el disco** si hay 0 o distinta cantidad de coincidencias. Reemplaza de raíz la pausada `edit_block`. |
| `delete_file` *(nueva, P3)* | `jarvis_files` | Escritura destructiva (**`red` siempre**) | Borra archivo o carpeta (`path`, `recursive?: false`, `permanent?: false`). **Por defecto envía a la Papelera de Windows** (`Microsoft.VisualBasic.FileIO` / Shell) para mantener reversibilidad; `permanent: true` solo explícito y con advertencia reforzada. Bloqueo estricto contra discos raíz, carpetas raíz del usuario (`home`, `desktop`, `documents`, `downloads`) y `ProtectedPaths`. |
| `download_file` *(nueva)* | `jarvis_web` (o `jarvis_files`) | Descarga (`yellow` / `red` si sobrescribe) | Descarga un recurso HTTP/HTTPS directo a disco (`url`, `destination?` en `downloads` por defecto, `overwrite?: false`). Valida URL con `egress.ts`, límite de tamaño, redirecciones y nombre seguro; evita que el modelo confunda descargar con `copy_file` o arme `Invoke-WebRequest` en `run_command`. |
| `compress_files` / `extract_archive` *(o `archive_files`)* | `jarvis_files` | Escritura (`green`/`yellow`/`red`) | Comprimir carpetas/archivos a `.zip` y extraer `.zip` (`action`, `source`, `destination`, `overwrite?`). Previene **Zip Slip**, bombas de descompresión y detecta si el `.zip` trae archivos sueltos para envolverlos en una subcarpeta limpia. |
| `play_media` *(combinada)* | `jarvis_media` | Acción reversible (`green`) | Busca y reproduce música/video por **YouTube (por defecto)** o **Spotify**, detecta si ya hay reproducción activa (vía SMTC + sesión propia) para cambiar de tema o controlar la reproducción sin reabrir apps/pestañas ni superponer audios (ver §4.1). |
| `organize_files` *(combinada)* | `jarvis_files` | Escritura en lote (`yellow` / `red`) | Clasifica o renombra múltiples archivos de una carpeta según regla determinista (`by_type`, `by_date`, `rename_pattern`) con vista previa (`dryRun`) y **una sola confirmación** sobre el resumen del lote (ver §4.2). |
| `convert_file` *(combinada, alcance acotado)* | `jarvis_files` | Escritura (`green` / `yellow` / `red`) | Conversión determinista y local, **fase 1 solo imágenes** (`source`, `action: convert \| resize`, `format: png \| jpg \| webp`, `maxWidth?`, `maxHeight?`, `quality?`, `destination?`). Nunca sobrescribe el original: escribe al lado con sufijo o en `destination`; `red` si el destino existe y `overwrite: true`. Sin binarios externos si es posible (librería de imágenes embebida) o con dependencia inyectable. Fase 2 (opcional, evaluar en `eval/`): `csv` ↔ `xlsx`, Markdown → HTML y PDF → texto, una vez cerrada la paridad de formatos de Etapa 5 (comparte parsers). Reemplaza el `run_command` improvisado del modelo con ImageMagick/PowerShell. |

---

### Etapa 5 — Paridad de formatos y retiro definitivo de `desktop_commander` *(Complejidad Alta)*

Cierra el reemplazo del servidor MCP externo `desktop_commander` para que todo JARVIS corra 100 % con proveedores nativos.

| Herramienta | Proveedor | Por qué es Etapa 5 (alta complejidad) |
|---|---|---|
| `read_file` *(nativa)* | `jarvis_files` | No es difícil en texto plano (`offset`, `length`), pero el `read_file` actual también lee **PDF** y **Excel (`.xlsx`/`.xls`/`.xlsm`)** por hoja y rango. Reemplazarlo exige parsers de PDF/hojas de cálculo estables, detección de encoding/binarios y pruebas de regresión sobre el formato que espera `D4` y las sondas (`ITEM_PROBE`). |
| `write_file` *(nativa)* | `jarvis_files` | Además de `rewrite`/`append` en texto con escritura atómica, el actual genera **Excel (`.xlsx`)** desde JSON 2D. |
| `read_multiple_files` | `jarvis_files` | Evaluar si sigue haciendo falta como tool separada o si alcanza con múltiples pasos / lecturas de apoyo (`role: support` en JARVIS 2.0). |

---

### Etapa 6 — Control de PC acotado, automatización y conectores *(Complejidad Muy Alta — JARVIS 2.0)*

Capacidades nuevas hoy fuera del catálogo base que requieren decisiones de producto, permisos nuevos o infraestructura más allá de un `ToolProvider` simple:

| Capacidad / Tool candidata | Proveedor / Módulo | Qué implica diseñarla |
|---|---|---|
| **Control básico del sistema (`system_control`)** | `jarvis_system` | Acciones cerradas y seguras sin UI ciega, con `setting` y `value` como enums: volumen/silencio, brillo, **dispositivo de audio de salida**, **Wi-Fi y Bluetooth on/off**, **modo oscuro/claro**, **asistente de concentración / no molestar**, bloquear sesión y suspender/apagar/reiniciar (con `red` obligatorio para energía). No hace clics ni escribe teclas arbitrarias. *Candidatos a adelantar a Etapa 4:* volumen, dispositivo de audio de salida, Wi-Fi/Bluetooth y modo oscuro, por ser cotidianos y reversibles (`green`); resolución y energía quedan en Etapa 6. Incluir lectura del estado actual (`action: get`) para que la poscondición pueda verificar el cambio. |
| **Portapapeles (`get_clipboard` / `set_clipboard`)** | `jarvis_system` | **Adelantada a Etapa 3** (ver ficha allí); se deja acá solo como referencia del veto a levantar en `manifest.ts`. |
| **Vigilar carpeta (`watch_folder`)** | Nuevo módulo + motor (junto con `schedule_task`) | Reaccionar cuando aparece o cambia un archivo en una carpeta (típico: Descargas → organizar/avisar). Depende del scheduler persistente y de la política de ejecución autónoma de `schedule_task`: la acción disparada debe ser una tool ya existente (`organize_files`, `extract_archive`, aviso) con el mismo tier, **sin** `red` autónomo. Define también límites de frecuencia y de tiempo de vida de cada vigilancia. |
| **Captura de pantalla (`take_screenshot`)** | `jarvis_system` | Hoy **vetada por diseño** (`manifest.ts`) y dependiente de capacidad multimodal real en el modelo para leer la imagen sin inventar. |
| **Tareas programadas / recordatorios (`schedule_task`)** | Nuevo módulo + motor | Exige persistencia en disco, scheduler activo entre tareas y política de ejecución autónoma sin usuario delante. |
| **Conectores externos / apps** (Calendario, Correo, Notas, Media) | Nuevos proveedores | OAuth/tokens por servicio, ampliación de `egress.ts` y cuidado para no inflar `D1` más allá de lo que el `2B` discrimina bien. |
| **Delegación a agente (`agent`)** | Nuevo destino `D1` | Encargo acotado hacia otro agente o modelo superior (`JARVIS_EVALUACION.md` §Mejoras futuras #1) con presupuesto, cancelación y trazas. |

---

## 4. Herramientas combinadas (con lógica interna propia)

Igual que `web_search` (usa `free_search` vía `ToolHost` y ranquea fragmentos por código/juez) o `run_command` (maneja sesiones vivas por `pid`), una **tool combinada** encapsula en código una secuencia que de otro modo obligaría al `2B`/`4B` a encadenar 3–5 llamadas frágiles. Para `D1` y `D2` sigue siendo **una sola herramienta** con argumentos simples y estado determinista.

### 4.1 `play_media` (Multimedia: YouTube y Spotify — prioridad alta dentro de combinadas)

**Problema que resuelve:** ante *«poné música de Soda Stereo»*, *«reproducí Bohemian Rhapsody en Spotify»* o *«cambiá a otro tema de Cerati»*, sin una tool combinada el modelo tiene que buscar un link en `web_search`, abrir el navegador o app por `run_command`, y en cada cambio de canción termina abriendo **otra pestaña o ventana nueva** o dejando dos audios sonando a la vez.

- **Proveedor propuesto:** `jarvis_media` (con `dependencies` declaradas sobre `free_search:search` vía `ToolHost` si busca por web, y controlador de sesión multimedia inyectable).
- **Parámetros simples:**
  - `action`: `"play"` (por omisión) \| `"pause"` \| `"resume"` \| `"next"` \| `"previous"` \| `"stop"` \| `"status"`.
  - `query`: nombre de canción, artista o video (requerido cuando `action = "play"`).
  - `source`: `"youtube"` (por omisión) \| `"spotify"`.
- **Pipeline interno (lógica propia del proveedor):**
  1. **Detectar qué está sonando antes de abrir nada:**
     - Consulta las sesiones activas del sistema vía **Windows SMTC** (`Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager` en PowerShell/WinRT fijo, inyectable para tests) más el estado propio en RAM del proveedor (`activeSession`: `source`, `title`, `url`, `pid`).
     - Si el usuario pidió una acción de transporte (`pause`, `resume`, `next`, `previous`, `stop`, `status`), opera **directo sobre la sesión activa detectada por SMTC** (o la controlada por Jarvis) sin buscar nada ni lanzar navegador/Spotify.
  2. **Evitar duplicados y audios superpuestos al reproducir (`action = "play"`):**
     - Si ya hay una sesión activa **de otra fuente** (por ejemplo, Spotify estaba sonando y el usuario pide un tema en YouTube): envía `pause` vía SMTC a esa sesión antes de iniciar la nueva.
     - Si ya existe una **ventana controlada por Jarvis** (para YouTube: p. ej. ventana dedicada `--app=<url>` de Edge/Chrome o reproductor liviano embebido cuyo `pid` guarda el proveedor): **cierra o reemplaza esa instancia** con el nuevo tema en vez de abrir otra pestaña en el navegador principal.
     - Si eligió **Spotify** y `spotify.exe` ya está abierto: no relanza una segunda instancia; reutiliza la app existente enviando el URI resuelto (`spotify:track:...` / fallback `spotify:search:...`) o controlando la sesión activa.
  3. **Búsqueda y resolución del tema (sin abrir páginas de resultados que no reproducen):**
     - **YouTube (por defecto):** busca internamente el mejor video candidato (`youtube.com/watch?v=...`, evitando playlists rotas o páginas `/results?search_query=` que requieren clic humano), verifica título/canal y arma la URL directa (con autoplay cuando el reproductor/ventana dedicada lo soporte).
     - **Spotify:** resuelve el URI exacto del tema/artista/playlist cuando es posible (`open.spotify.com/track/...` → `spotify:track:...`) antes de despacharlo al cliente local o navegador.
- **Decisiones abiertas a cerrar antes de programar `play_media`:**
  - *Reproducción en YouTube:* elegir entre ventana dedicada del navegador (`msedge --app=...` / `chrome --app=...` cuyo `pid` controla Jarvis para reemplazarla al cambiar de tema) vs un reproductor liviano propio (`mpv` / embed en la UI web de JARVIS). La ventana `--app` no requiere binarios extra y no ensucia las pestañas del usuario.
  - *Auto-play en Spotify desktop:* el esquema `spotify:track:<id>` abre la pista en Spotify, pero disparar `Play` automático sin clic puede requerir tecla/SMTC `TryPlayAsync` tras abrir la pista (o Spotify Web API si algún día se agrega OAuth). Dejar definido el comportamiento exacto y el fallback honesto si quedó en pausa.
  - *Rutas D1 / Tier:* `green` (acción reversible de usuario). Validar cualquier URL resuelta con `policy/egress.ts` antes de abrirla.

---

### 4.2 Otras herramientas combinadas recomendadas

| Herramienta | Etapa | Qué combina por dentro | Por qué vale la pena frente a múltiples pasos |
|---|---|---|---|
| **`open_app` inteligente** *(evolución de `open_app`)* | Etapa 3 | Lista procesos y ventanas abiertas → si la app ya corre, la restaura y enfoca; si no, busca su acceso en Menú Inicio / `App Paths` / `shell:AppsFolder` y la lanza. | Evita que *«abrí Discord / VS Code / Chrome»* abra una segunda instancia o falle cuando la app ya estaba minimizada en bandeja. |
| **`inspect_project`** | Etapa 3 | Lista árbol nivel 1–2 (`list_folder`) + detecta y lee de forma acotada el `README` y el manifiesto del lenguaje (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `*.csproj`). | Responde *«¿de qué trata este proyecto, qué stack usa y cómo se corre?»* en **1 llamada** con presupuesto fijo de tokens en lugar de 4–5 lecturas seguidas del `4B`. |
| **`organize_files`** | Etapa 4 | Escanea carpeta → arma plan determinista de movimientos/renombres (`by_type`, `by_date`, `rename_pattern`) → valida colisiones y `ProtectedPaths` → pide **1 aprobación** viendo el resumen → ejecuta en lote y reporta éxitos/fallos. | Reemplaza tanto 20 llamadas seguidas a `move_file` (donde el modelo se pierde) como bucles PowerShell peligrosos en `run_command`. |
| **`find_duplicates`** | Etapa 3 | Agrupa archivos por tamaño → hash parcial → hash completo solo de candidatos, y arma grupos con espacio recuperable. | Responde *«¿tengo archivos repetidos? ¿cuánto espacio libero?»* en **1 llamada** sin que el modelo orqueste hashes; es la base de limpiezas seguras junto con `delete_file` (Papelera) y `organize_files`. |
| **`convert_file`** *(fase 1: imágenes)* | Etapa 4 | Detecta formato de origen → convierte/redimensiona con parámetros cerrados → escribe a un destino nuevo sin tocar el original → verifica que el resultado abre. | Evita que *«pasame esta foto a JPG y achicala»* termine en un comando de ImageMagick/PowerShell improvisado por el `2B`/`4B`. |
| **`extract_archive` inteligente** *(dentro de `archive_files`)* | Etapa 4 | Inspecciona la raíz del `.zip` antes de extraer: si trae archivos sueltos, crea automáticamente subcarpeta con el nombre del archivo; si ya trae una sola carpeta raíz, extrae directo (además de chequear Zip Slip y tamaño total). | Evita el clásico desorden en Descargas o carpetas duplicadas `archivo/archivo/`, todo dentro de la misma llamada de extracción. |

---

## 5. Qué NO debería ser una herramienta (límites del diseño)

1. **Comandos libres de desarrollo (`git`, `npm`, `python`, `docker`, compilación):** siguen siendo el dominio natural de `run_command`. No conviene crear wrappers `git_status` o `npm_test` que inflan el catálogo sin mejorar seguridad ni precisión.
2. **Automatización GUI ciega (clic por coordenadas, mover el mouse, tipear en ventanas):** frágil, imposible de verificar con `postcondition.ts` y con alto riesgo de operar en la ventana equivocada.
3. **Contexto vivo pasivo (ventana activa, carpeta abierta, archivos recientes):** en lugar de crear tools para que el modelo las llame a ciegas, conviene inyectarlas por código en el contexto (`JARVIS_EVALUACION.md` §Mejoras futuras #3).
4. **Herramientas redundantes:** evitar tener a la vez `list_directory` + `list_folder`, `start_search` + `find_files`, o `list_processes` + `top_processes`. Cuando una nativa madura, la vieja o duplicada se retira o se fusiona.
5. **Capacidades del propio modelo (`translate`, `summarize`, `calculate`):** no son herramientas del sistema; agregarlas solo consume espacio en `D1`/`D2`.
6. **Wrappers de lo que ya cubre otra tool con un parámetro:** `kill_by_port` (= `list_processes` con filtro `port` + `stop_process`), `network_check` (= `system_info` → `network`), `get_weather` / `get_time` (= `web_search` y `system_info` → `overview`).
7. **`recent_files`, `search_history`, eventos/calendario local básico:** igual que el punto 3, van como **contexto inyectado** por código, no como tools que el modelo deba decidir llamar.
8. **`send_email` / `send_message` sueltas:** solo dentro de conectores externos (Etapa 6), con OAuth, `egress.ts` y tier `red`.

---

## 6. Cómo trabajamos cada herramienta en este documento

Cuando diseñemos una herramienta específica antes de pasar a código, completamos esta ficha corta:

```markdown
### Nombre de la tool (`proveedor`, Etapa X)
- **Descripción D2 (≤ 80 chars):** ...
- **Ruta D1 y qué la distingue de sus vecinas:** ...
- **Parámetros (nombre, tipo, defecto, nota ≤ 240 chars):** ...
- **Tier de aprobación (`tiers.ts`) y guardas (`allowedDirs`, `ProtectedPaths`, `egress`):** ...
- **Contrato de salida (`data.state`, campos clave, formato de `text`):** ...
- **Poscondición (`postcondition.ts`) y sonda (`probes.ts`):** ...
- **Dependencia inyectable para pruebas sin Windows:** ...
```

---

## 7. Próximo paso sugerido para diseñar

Empezar bajando a ficha completa las herramientas de **Etapa 2** (en orden de menor incertidumbre a mayor):
1. **`search_content`**: definir algoritmo de lectura, lista de extensiones/binarios ignorados, tope por archivo, formato de coincidencias (archivo + línea + extracto) y empate de contrato con `find_files`.
2. **Mejora de `list_processes` y `system_info`**: cerrar qué parámetros absorbe `list_processes` (orden por RAM/CPU, filtro por nombre) y qué agrega `system_info` (red/IP, puertos en escucha, fecha/hora).
3. **Decisión `disk_usage` vs `list_folder` vs `file_info`**: definir si `disk_usage` y `file_info` son herramientas propias o parámetros/`mode` de `list_folder`, y diseñar el mapa de rutas `D1` resultante para validar en `eval/`.

### Decisiones abiertas de consolidación del catálogo (a medir en `eval/`)

Antes de bajar a código Etapa 3–4, validar si conviene **menos tools con `action`** (menos carga en `D1`, más en `D2`) o **tools más específicas** (al revés). Hipótesis a medir con el dataset de `D1`/`D2`:

| Familia | Tools hoy en el plan | Alternativa consolidada | Qué mirar al medir |
|---|---|---|---|
| **Abrir cosas** | `open_app`, `open_url`, `open_path` | Una sola `open` con `target` y `kind: app \| url \| path` | Mayor riesgo de ambigüedad del catálogo: el `2B` confunde «abrí Chrome», «abrí google.com» y «abrí Descargas». Si hay confusión, unificar o endurecer descripciones D2 con ejemplos de señal observable (nombre de app / esquema `http` / ruta o alias). |
| **Rutas** | `copy_file`, `move_path`, `create_folder`, `delete_file` | Una sola `manage_path` con `action: copy \| move \| create \| delete` | Menos tools en `D1`, pero tiers distintos por acción (`green` a `red`) y más carga en argumentos de `D2`. Mantener `delete_file` separada si el tier `red` fijo ayuda a la política. |
| **Portapapeles** | `get_clipboard`, `set_clipboard` | Una sola `clipboard` con `action: get \| set` | Probable ganadora por ser un par pequeño; cuidar que `get` (lectura + filtro de secretos) y `set` (acción) mantengan tiers distintos. |
| **Control del sistema** | `system_control` (volumen, audio, Wi-Fi, etc.) | Ya es una sola tool con `setting` y `value` | Verificar que el enum cerrado sea chico y claro para el `2B`; si crece, partir en `audio` y `connectivity`. |

### Orden sugerido de implementación para las tools agregadas

1. `open_path` (Etapa 3; baja complejidad, alto uso).
2. `get_clipboard` / `set_clipboard` con filtro de secretos (Etapa 3).
3. `find_duplicates` y `file_info` (Etapas 2–3; solo lectura).
4. `convert_file` fase 1, solo imágenes (Etapa 4).
5. Subconjunto cotidiano de `system_control`: audio, Wi-Fi/Bluetooth, modo oscuro (Etapa 4–6).
6. `watch_folder` junto con `schedule_task` (Etapa 6).

