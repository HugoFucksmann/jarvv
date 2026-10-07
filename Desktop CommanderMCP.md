
# Desktop Commander MCP — Contrato de integración

## 1. Alcance

Desktop Commander MCP proporciona capacidades de automatización local sobre:

- procesos y terminal;
- archivos y filesystem;
- búsqueda de archivos/contenido;
- edición de archivos;
- gestión de sesiones/procesos;
- configuración y diagnóstico.

Para JARVIS se integra como un **servidor MCP dinámico**. La fuente de verdad de sus capacidades es el protocolo MCP y el discovery en tiempo de ejecución, no este documento ni un catálogo estático.

---

## 2. Discovery

JARVIS debe descubrir las capacidades mediante MCP:

```text
tools/list
```

Cada tool descubierta proporciona, como mínimo:

```json
{
  "name": "...",
  "description": "...",
  "inputSchema": {}
}
```

JARVIS debe utilizar el `inputSchema` descubierto para construir y validar las llamadas.

**No asumir:**

- nombres concretos de tools;
- cantidad de tools;
- parámetros;
- estructura fija de resultados;
- versión concreta del servidor.

La documentación propia de Desktop Commander confirma que las descripciones MCP contienen los parámetros y formatos de retorno de cada tool.

---

## 3. Ejecución

Las operaciones se ejecutan mediante:

```text
tools/call
```

con:

```json
{
  "name": "<tool>",
  "arguments": {}
}
```

Los `arguments` deben cumplir el `inputSchema` obtenido mediante discovery.

JARVIS no debe reconstruir ni modificar arbitrariamente los argumentos para intentar superar restricciones del servidor.

---

## 4. Respuesta MCP

JARVIS debe procesar la respuesta MCP como un resultado potencialmente compuesto por múltiples elementos `content`.

No debe asumir que una llamada devuelve únicamente texto.

Debe preservar el tipo de contenido cuando exista y delegar el procesamiento posterior al `Result Processor`.

Los resultados pueden contener:

- texto;
- resultados estructurados;
- salidas de procesos;
- contenido de archivos;
- resultados de búsqueda;
- información de estado;
- errores o marcadores operativos.

---

## 5. Resultados grandes y paginación

Desktop Commander implementa paginación para resultados potencialmente grandes mediante:

```text
offset
length
```

Esto aplica, entre otros casos, a lectura de archivos, salida de procesos y resultados de búsqueda. También admite offsets negativos para obtener contenido desde el final.

JARVIS debe:

1. evitar introducir resultados completos y grandes automáticamente en el contexto de Qwen;
2. conservar referencias al resultado cuando sea posible;
3. solicitar únicamente el rango necesario;
4. utilizar paginación para continuar una lectura;
5. compactar resultados antes de devolverlos al modelo.

---

## 6. Archivos y rutas

Las rutas absolutas son la forma recomendada y más fiable. Las rutas relativas pueden depender del directorio de trabajo y las rutas `~` no necesariamente se expanden.

JARVIS debe preferir:

```text
C:\...
```

en Windows y rutas absolutas equivalentes en otros sistemas.

### Resultado de acceso

Desktop Commander distingue al menos:

```text
[NOT_FOUND]
[DENIED]
```

`[NOT_FOUND]` indica que el recurso no existe.

`[DENIED]` indica que el recurso no es accesible por permisos, restricciones u otras condiciones de acceso.

JARVIS no debe tratar ambos estados como equivalentes.

Una operación `[DENIED]` no debe provocar automáticamente reintentos modificando la ruta.

---

## 7. Procesos y sesiones

Desktop Commander puede mantener procesos de larga duración y sesiones interactivas.

Una ejecución no debe asumirse necesariamente como:

```text
call → ejecución completa → resultado final
```

Puede existir:

```text
start → process running → read output → interact → read output → finish
```

El estado del proceso puede indicar que:

- está ejecutándose;
- terminó;
- está esperando entrada;
- requiere lectura adicional de salida.

Las sesiones persistentes y la paginación de salida forman parte del modelo de ejecución del servidor.

JARVIS debe conservar los identificadores de sesión/proceso mientras sean necesarios y no asumir que un proceso terminó simplemente porque una llamada individual finalizó.

---

## 8. Estado y verificación

La existencia de una respuesta exitosa de MCP no implica por sí misma que el objetivo final de JARVIS haya sido alcanzado.

Para operaciones sobre procesos, archivos o sistema:

```text
acción ejecutada ≠ objetivo verificado
```

Cuando el objetivo requiera confirmación, JARVIS debe realizar una observación posterior utilizando una tool apropiada.

Esto es especialmente importante para:

- procesos;
- escritura/edición de archivos;
- comandos;
- operaciones que modifican estado.

---

## 9. Errores y estados especiales

JARVIS debe distinguir, como mínimo:

- error MCP/protocolo;
- tool inexistente;
- argumentos inválidos;
- ejecución rechazada;
- `[NOT_FOUND]`;
- `[DENIED]`;
- proceso en ejecución;
- proceso esperando entrada;
- proceso terminado;
- timeout;
- resultado parcial;
- resultado truncado;
- recurso inaccesible.

Un error de una operación no debe interpretarse automáticamente como fallo de todo el servidor MCP.

Los errores de filesystem deben conservar la diferencia entre inexistencia y falta de acceso.

---

## 10. Configuración y restricciones

Desktop Commander dispone de mecanismos como:

- `allowedDirectories`;
- restricciones/bloqueos de comandos;
- configuración del shell;
- límites de lectura;
- configuración de red.

Estas configuraciones pueden afectar directamente el resultado de una operación.

JARVIS debe considerar la configuración efectiva descubierta/obtenida del servidor antes de asumir que una capacidad está disponible.

---

## 11. Seguridad

Desktop Commander tiene capacidad privilegiada para:

- leer y escribir archivos;
- ejecutar comandos de terminal;
- iniciar programas;
- administrar procesos.

Su propia documentación de seguridad establece explícitamente que sus restricciones son **guardrails y no un sandbox de seguridad**. Las restricciones de directorios y comandos pueden ser evitadas mediante determinadas operaciones de terminal.

Por lo tanto:

### JARVIS no debe delegar la seguridad exclusivamente en Desktop Commander.

La arquitectura debe mantener:

```text
Usuario
   ↓
JARVIS Policy
   ↓
Desktop Commander
   ↓
Sistema operativo
```

La Policy de JARVIS debe decidir:

```text
allow
deny
approval
```

antes de ejecutar operaciones sensibles.

Para aislamiento real, la documentación oficial recomienda aislamiento a nivel de sistema operativo, Docker, VM o entorno dedicado.

---

## 12. Operaciones destructivas

Las operaciones de:

- ejecución de comandos;
- eliminación/modificación de archivos;
- terminación de procesos;
- cambios de configuración;

deben considerarse potencialmente destructivas.

JARVIS no debe interpretar las restricciones internas del MCP como autorización del usuario.

La autorización pertenece a la Policy de JARVIS.

---

## 13. Compatibilidad

La integración de JARVIS debe depender únicamente de:

1. protocolo MCP;
2. `tools/list`;
3. `inputSchema`;
4. `tools/call`;
5. estructura real de la respuesta MCP;
6. estados y resultados realmente proporcionados por la tool.

No depender de:

- número fijo de tools;
- nombres hardcodeados;
- parámetros específicos;
- estructura fija de resultados;
- versión concreta;
- rutas predeterminadas;
- IDs persistentes;
- mensajes textuales exactos.

El servidor declara compatibilidad con Windows, Linux y macOS y requiere Node.js ≥18.

---

## 14. Regla de integración para JARVIS

La integración debe seguir:

```text
Discovery
    ↓
Tool selection
    ↓
Policy
    ↓
tools/call
    ↓
MCP result
    ↓
Result Processor
    ↓
Evidence / State
    ↓
Qwen re-evaluation
```

Desktop Commander ejecuta la operación.

**JARVIS decide qué hacer, si está permitido, cómo interpretar el resultado y si el objetivo realmente fue cumplido.**