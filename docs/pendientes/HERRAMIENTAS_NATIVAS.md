# Plan: herramientas nativas de archivos (D-15 a D-17)

> **Solo planificación. Nada de esto está implementado.** Hoy los archivos los sirve Desktop Commander (`files`, `locate`); en `src/tools/` solo hay proveedores nativos de `terminal` y `web`.

## 1. Estado actual (verificado en `src/core/tools/manifest.ts`)

| Ruta | Herramientas | Servidor |
|---|---|---|
| `files` | `read_file`, `read_multiple_files`, `write_file`, `create_directory`, `list_directory`, `move_file` | `desktop_commander` |
| `locate` | `start_search`, `get_more_search_results` | `desktop_commander` |
| `terminal` | `run_command`, `list_processes`, `stop_process` | `jarvis_terminal` (nativo) |
| `web` | `web_search` | `jarvis_web` (nativo) |

No existe copiar, borrar ni búsqueda síncrona: copiar/borrar hoy solo se logra con `run_command` (nivel rojo en `tiers.ts`, pasa por `commandRules.ts`). `tiers.ts` solo clasifica `create_directory`, `write_file`, `move_file`, `run_command` y `stop_process`; cualquier otra escritura del catálogo cae en amarillo y una no catalogada en rojo. `allowedDirectories` aplica a todas las herramientas con ruta (`toolPathArgs`).

## 2. Propuestas

### P1. `find_files` (nativa, lectura)
- **Resuelve**: `start_search` es un flujo en dos etapas (arrancar + paginar con `get_more_search_results`), costoso para un modelo de 2B y fuente de bucles. Una llamada con `{ path, pattern, maxResults }` que devuelve una lista acotada.
- **Riesgos**: recorrer discos grandes (necesita tope de profundidad, entradas y tiempo, y abortar por `signal`); respetar `allowedDirectories` y `sensitivePaths` en cada entrada; no seguir symlinks fuera del alcance (`realpathSync`).
- **Dependencias**: proveedor nativo nuevo (`src/tools/files/`), extractor de resultados, entrada en el manifest, política de repetición (`retry_failed`), pruebas con un árbol temporal.

### P2. `copy_file` (nativa, escritura)
- **Resuelve**: copiar sin `run_command`; hoy pasa por el parser de PowerShell, con rutas que a veces no se pueden resolver.
- **Riesgos**: sobrescribir el destino (rojo si existe, igual que `move_file`); copiar carpetas enormes (tope de tamaño); symlinks y rutas `\\?\`/UNC/8.3.
- **Dependencias**: nivel en `tiers.ts` (verde si el destino no existe y ambos extremos están en carpetas del usuario), poscondición de disco, probes de lugar (`PLACE_PROBE`).

### P3. `delete_file` (nativa, escritura destructiva)
- **Resuelve**: borrar sin comandos abiertos; permite mandar a la **papelera de Windows** (reversible) en vez de borrado permanente.
- **Riesgos**: el más alto del conjunto. Borrado recursivo de carpetas; la papelera depende de la API de Windows (sin dependencia nueva requiere PowerShell/`Microsoft.VisualBasic.FileIO`); no es atómico.
- **Dependencias**: **rojo siempre** (confirmación obligatoria también con `autoMode`), confirmación reforzada para recursivo, `allowedDirectories` y `sensitivePaths` (nunca fuera de alcance, nunca una carpeta de usuario raíz), registro en la traza de lo borrado. Debe ir **después** de P2 y de la revisión de `tiers.ts`.

### P4. Reagrupar rutas `files`/`locate` en «consultar» y «modificar»
- **Resuelve**: menos opciones de ruta en D1 (el 2B elige peor con más rutas parecidas); `locate` y `list_directory` son lecturas del mismo tipo.
- **Riesgos**: cambia el flujo de D1/D2 y los datasets de `eval/` (requiere re-medir; fuera de este trabajo); `callRunner` filtra intentos por ruta (`routeViewOptions`).
- **Dependencias**: P1 (sin `locate`, la ruta «consultar» tendría `list_directory`, `read_*`, `find_files`), cambios en `manifest.ts`, prompts y `desalineaciones-eval.md`.

### P5. Lectura previa dirigida en `edit_block` (o herramienta equivalente)
- **Resuelve**: editar una parte de un archivo sin reescribirlo entero (hoy `write_file` en modo `rewrite` es rojo).
- **Riesgos**: coincidencia ambigua del bloque; dependencia de Desktop Commander.
- **Dependencias**: decidir si se expone `edit_block` (no está en el manifest) o se implementa nativa; nivel de riesgo propio.

### P6. `list_directory` con tamaño y fecha (opcional)
- **Resuelve**: el catálogo declara «names only» y obliga a sondas (`ATTRIBUTE_PROBE`) para ordenar por propiedades.
- **Riesgos**: más texto en el contexto; hay que limitarlo (`listDirEntries`).
- **Dependencias**: nativa (P1) o parche del extractor.

## 3. Orden sugerido

P1 → P2 → P3 → P4 (re-midiendo en `eval/`). P5 y P6 según uso real.

## 4. Decisiones que necesito del usuario

- ¿Papelera de Windows por defecto en `delete_file`, o también borrado permanente con confirmación?
- ¿`find_files` debe poder buscar fuera de las carpetas del usuario?
- ¿Se acepta tocar el flujo de rutas (P4) antes de tener las nativas?
