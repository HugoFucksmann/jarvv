# JARVIS: tools y grupos

## 1. Listado de tools

| Tool | Descripción |
|---|---|
| `run_command` | Terminal PowerShell. |
| `system_info` | Información del sistema: hardware, SO, servicios, herramientas de desarrollo, red, procesos, puertos y fecha/hora. |
| `stop_process` | Terminar procesos. |
| `pc_settings` | Ajustes de la PC: brillo, Wi-Fi, Bluetooth, modo oscuro y no molestar. |
| `power` | Bloquear, suspender, reiniciar y apagar. |
| `open_on_screen` | Abrir una app, URL o ruta en la pantalla del usuario. No devuelve contenido a Jarvis: para leer un archivo se usa `read_file`. |
| `clipboard` | Leer y escribir el portapapeles. |
| `play_media` | Buscar y reproducir música o video (YouTube, Spotify). |
| `media_control` | Controlar la reproducción en curso: pausar, reanudar, siguiente, anterior, adelantar/retroceder, volumen, silenciar y qué está sonando. |
| `find_files` | Buscar archivos y carpetas por nombre. |
| `list_folder` | Listar el contenido de una carpeta, con tamaños y metadatos. |
| `search_content` | Buscar texto dentro de archivos. |
| `read_file` | Leer el contenido de archivos: texto, PDF, Word, Excel, PowerPoint e imágenes. |
| `write_file` | Crear y escribir archivos: texto, Word, Excel, PDF y PowerPoint. |
| `edit_file` | Editar texto puntual en archivos de texto. |
| `convert_file` | Convertir y redimensionar imágenes, audio y video. |
| `create_folder` | Crear carpetas. |
| `copy_file` | Copiar archivos y carpetas. |
| `move_file` | Mover y renombrar archivos y carpetas, en lote. |
| `delete_file` | Borrar archivos y carpetas. |
| `archive_files` | Comprimir y extraer `.zip`. |
| `web_search` | Buscar en internet. |
| `download_file` | Descargar archivos desde una URL. |
| `email` | Leer, buscar y enviar correos. |
| `calendar` | Consultar y crear eventos del calendario. |

## 2. Propuesta de grupos

| Grupo | Descripción | Tools |
|---|---|---|
| **`terminal`** | Comandos de terminal y tareas que ninguna otra tool cubre. | `run_command` |
| **`files_read`** | Encontrar, listar y leer archivos. | `find_files`, `list_folder`, `search_content`, `read_file` |
| **`files_write`** | Crear, modificar, mover, borrar y convertir archivos y carpetas. | `write_file`, `edit_file`, `convert_file`, `create_folder`, `copy_file`, `move_file`, `delete_file`, `archive_files` |
| **`system`** | Estado, procesos y ajustes de la PC; abrir apps, URLs y rutas; portapapeles. | `system_info`, `stop_process`, `pc_settings`, `power`, `open_on_screen`, `clipboard` |
| **`multimedia`** | Música y video: reproducir y controlar la reproducción y el volumen. | `play_media`, `media_control` |
| **`web`** | Buscar en internet y descargar desde una URL. | `web_search`, `download_file` |
| **`personal`** | Correo y calendario. | `email`, `calendar` |

## 3. Cambios respecto del plan original

- `open_app`, `open_url` y `open_path` → una sola `open_on_screen`.
- `get_clipboard` y `set_clipboard` → una sola `clipboard`.
- `file_info` → absorbida por `list_folder`.
- `disk_usage` → descartada (demasiado específica; se resuelve con `run_command`).
- `find_duplicates` → descartada (misma razón que `disk_usage`).
- `organize_files` → descartada (se resuelve con `list_folder` y `move_file` en lote).
- `list_processes` → absorbida como sección `processes` de `system_info`.
- `inspect_project` y `read_multiple_files` → descartadas.
- `schedule` → fuera por ahora (recordatorios, temporizadores y tareas programadas no se incluyen).
- `system_control` → dividida en `pc_settings` y `power`.
- Control de reproducción y volumen → nueva `media_control`, separada de `play_media`.
- `files` → dividido en `files_read` y `files_write`.
- `desktop` → no se crea; sus tools pasan a `system`, salvo `play_media` y `media_control`, que pasan al grupo `multimedia`.

## 4. Fuera de alcance

- Jarvis no maneja la interfaz gráfica: sin captura de pantalla, control de ventanas, teclado ni mouse.
