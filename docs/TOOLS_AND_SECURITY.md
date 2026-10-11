# Herramientas y seguridad

> Última revisión: **[COMPLETAR: AAAA-MM-DD]**

> **[COMPLETAR]** Resumen: qué herramientas existen y cómo se controla su uso.

## Catálogo de herramientas

> **[COMPLETAR]** Herramientas disponibles, su origen y nivel de riesgo.

| Tool | Origen | Descripción | Riesgo |
|------|--------|-------------|--------|
| *Ej: read_file* | *Local* | *Lee un archivo* | *Bajo* |
| *Ej: run_command* | *Local* | *Ejecuta un comando* | *Alto* |
| *Ej: search_web* | *MCP* | *Busca en internet* | *Medio* |

## Selección de herramientas

> **[COMPLETAR]** Cómo se decide qué tools se exponen y cuál se usa.

- **Exposición:** *Ej: se envían al modelo solo las tools relevantes al contexto.*
- **Elección:** *Ej: la decide el modelo vía function calling.*

## Ejecución

> **[COMPLETAR]** Ciclo de vida de una llamada: validación, ejecución, timeout, reintentos.

```
tool_call → validar schema → verificar permisos → ejecutar → capturar resultado/error
```

- **Timeout:** *Ej: 30 s* · **Reintentos:** *Ej: 2*

## MCP

> **[COMPLETAR]** Servidores MCP configurados y cómo se conectan.

| Servidor | Transporte | Tools expuestas | Config |
|----------|-----------|-----------------|--------|
| *Ej: filesystem* | *stdio* | *read, write, list* | `mcp.json` |

## Procesamiento de resultados

> **[COMPLETAR]** Qué se hace con la salida antes de devolverla al modelo.

- *Ej: truncado a X tokens, limpieza de secretos, formato uniforme `{status, data, error}`.*

## Permisos

> **[COMPLETAR]** Política por categoría de herramienta.

| Categoría | Política | Ejemplo |
|-----------|----------|---------|
| *Solo lectura* | *Automático* | `read_file` |
| *Escritura* | *Requiere aprobación* | `write_file` |
| *Comandos / red* | *Aprobación + allowlist* | `run_command` |
| *Destructivas* | *Bloqueadas por defecto* | `delete_*` |

## Aprobaciones

> **[COMPLETAR]** Cómo se solicita, concede y recuerda una aprobación.

- **Flujo:** *Ej: se muestra acción + parámetros → el usuario aprueba o rechaza.*
- **Alcance:** *Ej: una vez / sesión / siempre.*
- **Si se rechaza:** *Ej: se informa al modelo para que proponga alternativa.*

## Auditoría y logs

> **[COMPLETAR]** Qué se registra y dónde.

- *Ej: toda ejecución de tool se guarda con timestamp, parámetros (sin secretos) y resultado.*

## Archivos relacionados

> **[COMPLETAR]** Solo los 5-8 archivos clave (entry points, interfaces, config).

| Ruta | Rol |
|------|-----|
| *Ej: `src/tools/registry.ts`* | *Registro de tools* |
| *Ej: `src/tools/mcp-client.ts`* | *Cliente MCP* |
| *Ej: `src/security/permissions.ts`* | *Política de permisos* |