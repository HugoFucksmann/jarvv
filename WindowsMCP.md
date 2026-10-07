# Windows MCP — Contrato de integración

## 1. Alcance

Windows MCP expone capacidades de automatización de Windows mediante MCP.

La integración de JARVIS debe ser dinámica. No debe hardcodear nombres, parámetros ni schemas de herramientas.

Fuente de verdad:

```text
tools/list
```

Este contrato describe cómo interpretar lo que el servidor devuelve. Levantar o configurar el servidor no es responsabilidad del código de JARVIS.

## 2. Descubrimiento

Usar MCP `tools/list`.

Definición de cada tool:

```json
{
  "name": "tool_name",
  "description": "...",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

JARVIS utiliza directamente:

- `name`
- `description`
- `inputSchema`

No mantener un catálogo estático de tools.

## 3. Ejecución

Usar MCP `tools/call`:

```json
{
  "name": "tool_name",
  "arguments": {}
}
```

`arguments` debe ajustarse al `inputSchema` descubierto.

## 4. Respuesta MCP

La respuesta MCP puede contener múltiples bloques en `content[]`.

JARVIS debe:

- procesar todos los elementos de `content`;
- respetar el `type` de cada bloque;
- no asumir que existe un único bloque;
- no asumir que todo contenido es texto;
- no convertir indiscriminadamente contenido multimedia o estructurado a texto.

El payload específico de cada tool tiene su propio formato, además del envelope MCP.

## 5. Resultados Windows

Ejemplos de payload:

```json
{
  "success": true,
  "kind": "full",
  "tree": []
}
```

```json
{
  "success": true,
  "kind": "diff",
  "changes": []
}
```

Campos relevantes cuando aparecen:

```text
success
kind
tree
changes
snapshotIncomplete
snapshotWarning
postActionSnapshotIncomplete
postActionWarning
search_incomplete
truncated
actionDispatched
outcomeVerified
postActionState
postActionElement
postActionElementWarning
```

No asumir que todos aparecen en todas las tools.

## 6. Significado de resultados

### `success`

Indica que la operación tuvo éxito según el contrato de la propia tool.

No significa necesariamente que el efecto final de una acción haya sido verificado.

Un `success: false` dentro del payload es un **resultado de la tool**, no necesariamente un error MCP (ver sección 12).

### `actionDispatched`

Indica que una acción fue enviada al sistema.

### `outcomeVerified`

Indica si la propia operación verificó el efecto posterior de la acción.

Para acciones como clicks:

```text
success=true
actionDispatched=true
outcomeVerified=false
```

significa que la acción fue enviada, pero **no constituye evidencia de que el resultado final haya ocurrido**.

JARVIS debe obtener evidencia posterior cuando la tarea requiera confirmar el efecto: una snapshot posterior, `ui_wait`, `ui_read` u otra lectura.

No repetir automáticamente una acción solamente porque `outcomeVerified=false`.

El mapeo de estos campos hacia la evidencia del núcleo (`evidence[].ok`) pertenece al núcleo de JARVIS, no a este contrato.

## 7. Snapshots y resultados incompletos

`kind`:

- `full`: snapshot completo según la respuesta generada.
- `diff`: cambios respecto de la baseline correspondiente.

`kind="full"` **no garantiza que todos los controles hayan sido examinados**.

Si aparece:

```text
snapshotIncomplete=true
snapshotWarning
```

el árbol es parcial.

Si aparece:

```text
search_incomplete
```

la búsqueda no pudo comprobar todos los candidatos.

Un resultado incompleto no demuestra la ausencia del elemento. Realizar una búsqueda más específica o un nuevo discovery.

## 8. IDs y conexión

`windowHandle`, `elementId` y cualquier token de snapshot o baseline que devuelva el servidor son identificadores dinámicos.

Reglas:

- no inventarlos;
- no asumir persistencia;
- no reutilizarlos después de que el elemento haya sido reemplazado;
- realizar nuevo discovery cuando un ID quede obsoleto;
- **mantener una conexión MCP persistente durante la sesión**: reconectar en cada llamada invalida los IDs;
- los IDs pertenecen al estado de la conexión MCP que los generó;
- no reutilizar IDs entre conexiones MCP diferentes.

Una reconexión requiere considerar los IDs y baselines anteriores como inválidos y realizar nuevo discovery.

## 9. UI Automation

Regla general:

```text
discovery → action → verification
```

Descubrir un elemento no garantiza que siga existiendo cuando se ejecuta la acción.

Enviar una acción correctamente tampoco garantiza que el efecto final haya terminado.

Para operaciones que requieren confirmación, utilizar una observación posterior.

## 10. Resultados grandes

Los resultados pueden incluir:

- UI trees;
- diffs;
- tablas;
- texto;
- screenshots;
- contenido multimedia;
- logs.

No introducir automáticamente contenido grande en el contexto del modelo.

Este contrato no garantiza que el servidor proporcione referencias, handles o recursos para resultados grandes. JARVIS debe cubrir ambos casos:

- si la respuesta proporciona una referencia, handle o recurso, conservarlo como referencia;
- si no la proporciona, aplicar las reglas generales de manejo de resultados grandes de JARVIS.

`truncated=true` indica que el resultado entregado está limitado y no debe interpretarse como contenido completo.

Los contenidos multimedia conservan su tipo MCP (ver sección 4).

## 11. Batch

Si una tool batch está disponible mediante discovery, utilizar exclusivamente el `inputSchema` descubierto.

Los resultados pueden contener un resultado por paso.

Un batch parcialmente ejecutado no debe interpretarse como completamente exitoso.

## 12. Errores

Envelope de error de una tool:

```json
{
  "content": [
    {
      "type": "text",
      "text": "..."
    }
  ],
  "isError": true
}
```

Distinguir al menos:

```text
MCP/protocol error
Tool error (isError: true)
Invalid arguments
Timeout
Stale element
Unavailable window
search_incomplete
Incomplete snapshot
Truncated result
Action dispatched but outcome unverified
```

Un `success: false` dentro del payload de una tool es resultado de la tool, no necesariamente un error MCP.

Un fallo de un elemento, búsqueda o snapshot no implica necesariamente que Windows MCP completo esté inutilizable.

## 13. Seguridad

Windows MCP puede proporcionar control real sobre Windows.

Las operaciones sensibles deben pasar por las reglas de autorización de JARVIS.

Deshabilitar una tool no constituye un sandbox de seguridad.

Aplicaciones ejecutándose con privilegios superiores pueden requerir privilegios equivalentes para ser automatizadas.

## 14. Limitaciones

- La cobertura depende de lo que la aplicación exponga mediante Windows UI Automation.
- Los IDs son dinámicos.
- Los snapshots y búsquedas pueden ser incompletos.
- Las coordenadas dependen del entorno de pantalla/DPI.
- Algunas capacidades dependen de la aplicación, configuración o idioma de Windows.
- El escritorio es compartido: todas las conexiones operan sobre el mismo escritorio físico.
- Aplicaciones elevadas pueden requerir privilegios equivalentes.
- La automatización visual es un fallback, no una garantía de éxito.

## 15. Regla de compatibilidad

JARVIS depende únicamente de:

1. el contrato MCP;
2. las capacidades descubiertas mediante `tools/list`;
3. el `inputSchema` de cada tool;
4. la respuesta real de cada ejecución.

No depender de:

- nombres de tools conocidos;
- parámetros hardcodeados;
- cantidad fija de tools;
- IDs persistentes;
- estructura fija de respuestas de todas las tools;
- una versión concreta del servidor.

`tools/list` determina las capacidades disponibles e `inputSchema` determina cómo ejecutarlas.

## 16. Referencia

```text
Repositorio: sbroenne/mcp-windows
Versión de referencia: 1.3.27
Licencia: MIT
```