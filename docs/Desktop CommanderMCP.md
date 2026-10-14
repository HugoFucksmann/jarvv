# Desktop Commander MCP — Documentación de referencia

## 1. Identificación

- **Proyecto:** `wonderwhy-er/DesktopCommanderMCP`
- **Repositorio oficial:** https://github.com/wonderwhy-er/DesktopCommanderMCP
- **Licencia:** MIT
- **Propósito:** servidor MCP que permite ejecutar comandos de terminal, gestionar procesos, operar con archivos y directorios, buscar contenido y realizar ediciones de texto.

## 2. Capacidades principales

### Terminal y procesos

Permite iniciar comandos y procesos, recuperar sus resultados, interactuar con procesos en ejecución y finalizar procesos.

Entre las herramientas documentadas se encuentran:

- `start_process`
- `interact_with_process`
- `read_process_output`
- `list_processes`
- `kill_process`
- `force_terminate`
- `list_sessions`

Los argumentos concretos dependen de cada herramienta y de su esquema MCP.

### Archivos y directorios

Incluye operaciones para leer, escribir, editar, crear, enumerar y mover archivos o directorios.

Entre las herramientas documentadas se encuentran:

- `read_file`
- `read_multiple_files`
- `write_file`
- `edit_block`
- `write_pdf`
- `list_directory`
- `create_directory`
- `move_file`

El proyecto también documenta lectura de archivos en formatos compatibles, incluidos documentos y hojas de cálculo, según la herramienta y la implementación.

### Búsqueda

Ofrece búsqueda de archivos y de contenido dentro de directorios, incluida búsqueda recursiva.

Entre las herramientas documentadas se encuentran:

- `start_search`
- `get_more_search_results`
- `list_searches`
- `stop_search`

### Configuración e historial

- `get_config`: permite consultar la configuración expuesta por el servidor.
- `get_recent_tool_calls`: permite consultar llamadas recientes a herramientas y vistas previas acotadas de sus resultados.

La disponibilidad exacta de herramientas depende de la versión instalada.

## 3. Argumentos y esquemas

Cada herramienta MCP declara su propio esquema de entrada, incluidos nombres de parámetros, tipos, campos obligatorios y restricciones.

No existe un único formato de argumentos válido para todas las herramientas. El esquema publicado por la instancia en ejecución es la referencia para conocer los argumentos aceptados.

Algunas operaciones de lectura admiten parámetros como `offset` y `length` para seleccionar partes de un archivo. En las herramientas compatibles, los desplazamientos negativos permiten leer desde el final del contenido.

## 4. Resultados y manejo de contenido

Las herramientas devuelven contenido y resultados a través del protocolo MCP. El formato específico depende de la operación.

- Las lecturas pueden devolver el contenido solicitado o un fragmento de este.
- Las búsquedas pueden devolver resultados parciales y ofrecer herramientas para recuperar más resultados.
- Las operaciones sobre procesos permiten recuperar salida y consultar su estado.
- Las herramientas de edición y escritura devuelven información sobre el resultado de la operación.
- Los errores pueden indicar que una ruta no existe, que no hay permisos suficientes o que una operación no se pudo completar.

Las cadenas como `[NOT_FOUND]` o `[DENIED]` no deben interpretarse como un formato universal de error para todas las herramientas: su significado depende de la operación y de la implementación.

## 5. Gestión de procesos y sesiones

El servidor permite gestionar procesos de terminal y recuperar sus salidas. Las herramientas disponibles permiten consultar procesos, interactuar con ellos y finalizarlos.

Las operaciones de inicio, interacción, lectura y terminación tienen esquemas diferentes. No debe suponerse que todas las herramientas comparten un mismo identificador de proceso o sesión sin comprobar sus definiciones.

## 6. Configuración

La configuración documentada incluye controles como:

- `allowedDirectories`: directorios autorizados para determinadas operaciones de archivos.
- `blockedCommands`: lista de comandos bloqueados.
- Configuración del shell.
- Límites de lectura y escritura.
- Configuración de telemetría y otras opciones disponibles en la versión.

Los nombres, tipos, valores predeterminados y opciones admitidas deben comprobarse en la documentación correspondiente a la versión instalada.

## 7. Seguridad y límites

Desktop Commander es una herramienta de automatización local con acceso a archivos y ejecución de comandos bajo los permisos de la cuenta que la ejecuta.

La documentación oficial advierte que:

- Las restricciones de directorios son medidas de protección, no una frontera de seguridad completa.
- La lista de comandos bloqueados puede eludirse mediante determinadas formas de ejecución de comandos.
- La prevención del recorrido mediante enlaces simbólicos no constituye aislamiento completo.
- La ejecución de comandos puede acceder a recursos disponibles para el usuario del sistema operativo.
- El aislamiento mediante Docker o una máquina virtual proporciona una frontera de aislamiento más sólida que las restricciones internas del servidor.

El alcance efectivo depende de los permisos del sistema operativo, la configuración y el entorno de ejecución.

## 8. Registro local y telemetría

El proyecto documenta un historial local de llamadas a herramientas y vistas previas limitadas de resultados. También documenta telemetría opcional y una configuración para desactivarla.

El historial local y la telemetría son mecanismos diferentes. Para conocer los datos recogidos, almacenados o enviados, deben consultarse la política de privacidad y la configuración de la versión instalada.

## 9. Documentación oficial

- Repositorio y README: https://github.com/wonderwhy-er/DesktopCommanderMCP
- Política de seguridad: https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/SECURITY.md
- Preguntas frecuentes: https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/FAQ.md

## 10. Mapeo en JARVIS Core (PolicyRegistry)

En el orquestador JARVIS Core (`src/core/policy/policyRegistry.ts`), las herramientas expuestas se gestionan bajo las siguientes claves canónicas:

| Nombre Upstream | Clave en JARVIS Core | Capacidad | Requiere Aprobación |
|-----------------|----------------------|-----------|---------------------|
| `list_directory` | `desktop_commander:list_directory` | `FILE_READ` | No (ALLOW) |
| `read_file` | `desktop_commander:read_file` | `FILE_READ` | No (ALLOW) |
| `start_search` / búsqueda | `desktop_commander:search_files` | `FILE_READ` | No (ALLOW) |
| `read_process_output` | `desktop_commander:read_process_output` | `READ` | No (ALLOW, exenta de anti-loop) |
| Consola del sistema | `desktop_commander:run_command` | `COMMAND_EXECUTION` | Dinámica (Guard: ALLOW solo lectura, APPROVAL mutaciones) |
| `write_file` | `desktop_commander:write_file` | `FILE_WRITE` | Sí (APPROVAL) |
| `edit_block` | `desktop_commander:edit_file` | `FILE_WRITE` | Sí (APPROVAL) |
| Eliminación | `desktop_commander:delete_file` | `FILE_DELETE` | Sí (APPROVAL) |
| `start_process` | `desktop_commander:start_process` | `PROCESS_CONTROL` | Sí (APPROVAL) |
| `kill_process` | `desktop_commander:kill_process` | `PROCESS_CONTROL` | Sí (APPROVAL) |
| `interact_with_process` | `desktop_commander:interact_process` | `PROCESS_CONTROL` | Sí (APPROVAL) |
| `get_config` / ajustes | `desktop_commander:set_config` | `CONFIGURATION` | Sí (APPROVAL) |