# Windows MCP 1.3.27 — Documentación de referencia

## 1. Identificación

- **Proyecto:** `sbroenne/mcp-windows`
- **Repositorio oficial:** https://github.com/sbroenne/mcp-windows
- **Versión de referencia:** `1.3.27`
- **Licencia:** MIT
- **Plataforma:** Windows
- **Tecnología de automatización:** Windows UI Automation (UIA)

Windows MCP permite automatizar aplicaciones de Windows mediante controles accesibles, lectura de texto y tablas, gestión de ventanas, entrada de teclado y ratón, y capturas de pantalla.

## 2. Protocolo MCP

El servidor expone herramientas mediante el protocolo Model Context Protocol (MCP).

### Descubrimiento de herramientas

La operación `tools/list` devuelve las herramientas disponibles y sus definiciones.

Una definición MCP puede contener:

- `name`: nombre de la herramienta.
- `description`: descripción de su función.
- `inputSchema`: esquema de los argumentos admitidos.

El esquema especifica los tipos de datos, los parámetros obligatorios y las restricciones de entrada.

### Ejecución

La operación `tools/call` ejecuta una herramienta identificada por su nombre y recibe los argumentos correspondientes.

La respuesta sigue el formato MCP. Puede contener varios bloques en `content[]`, un indicador `isError` y, según la herramienta y la implementación, contenido estructurado adicional.

Los campos específicos de cada resultado pertenecen al contrato de la herramienta correspondiente; no todas las herramientas devuelven la misma estructura.

## 3. Herramientas disponibles

La siguiente lista resume las principales herramientas documentadas. La disponibilidad efectiva debe comprobarse mediante el descubrimiento MCP de la versión instalada.

| Herramienta | Función |
|---|---|
| `app` | Inicia una aplicación y permite observar la ventana resultante. |
| `ui_snapshot` | Obtiene una representación de los controles de una ventana y, cuando corresponde, sus cambios. |
| `ui_find` | Busca controles por nombre, tipo, identificador de automatización u otros criterios admitidos. |
| `ui_click` | Hace clic en un control identificado. |
| `ui_type` | Introduce texto en un control editable. |
| `ui_select` | Selecciona una opción en un control compatible. |
| `ui_read` | Lee texto de controles o ventanas mediante UIA y mecanismos OCR compatibles. |
| `ui_read_table` | Extrae tablas o cuadrículas en filas y encabezados estructurados. |
| `ui_wait` | Espera a que aparezca, desaparezca o alcance un estado determinado un control. |
| `ui_batch` | Ejecuta una secuencia de pasos de automatización de interfaz. |
| `file_save` | Automatiza operaciones compatibles de guardado mediante el diálogo correspondiente. |
| `file_open` | Automatiza operaciones compatibles de apertura mediante el diálogo correspondiente. |
| `clipboard` | Lee, escribe o limpia el portapapeles de texto de Windows. |
| `process` | Enumera o finaliza procesos compatibles con la herramienta. |
| `screenshot_control` | Obtiene capturas anotadas para observar controles y facilitar la automatización visual. |
| `keyboard_control` | Envía entradas de teclado y combinaciones de teclas. |
| `mouse_control` | Realiza operaciones de ratón, como clics, movimientos o desplazamientos. |
| `window_management` | Busca, activa, mueve, redimensiona y gestiona ventanas. |

La lista no sustituye los esquemas de las herramientas. Los nombres, argumentos y operaciones admitidas pueden variar según la versión.

## 4. Automatización mediante UI Automation

Windows MCP prioriza la identificación semántica de los controles mediante Windows UI Automation, en lugar de depender exclusivamente de coordenadas o capturas de pantalla.

Entre las capacidades documentadas se encuentran:

- Identificar controles por nombre, tipo o identificador de automatización.
- Leer el texto y el estado de controles.
- Hacer clic en botones, pestañas y otros elementos interactivos.
- Introducir texto en campos editables.
- Seleccionar opciones en listas y cuadros combinados compatibles.
- Esperar a que aparezcan controles o cambien de estado.
- Consultar los cambios producidos en la interfaz después de una observación inicial.

La cobertura depende de la información de accesibilidad que exponga cada aplicación.

## 5. Identificación de controles

Las herramientas de descubrimiento pueden devolver identificadores de controles y datos sobre su ubicación, tipo, nombre y estado.

Los identificadores de elementos son valores opacos generados durante la interacción. No deben interpretarse como identificadores globales, permanentes o independientes de la sesión.

Un elemento puede dejar de ser válido si la interfaz cambia, el control se reemplaza o la ventana cambia de estado. En estos casos, la herramienta puede rechazar el identificador obsoleto.

Las búsquedas por nombre parcial, expresión regular o profundidad pueden tener límites de exploración. Cuando una búsqueda no examina todos los candidatos, el resultado puede incluir `search_incomplete`. En ese caso, no puede concluirse que el elemento no exista.

## 6. Snapshots y cambios

`ui_snapshot` permite obtener una representación de los controles observados de una ventana. También puede devolver cambios respecto de una observación anterior.

En las respuestas que utilizan el campo `kind`:

- `full`: representa una vista completa según el resultado generado.
- `diff`: representa cambios respecto de una baseline previa.

Una respuesta `full` no garantiza que todos los controles de la aplicación hayan sido examinados.

Los snapshots pueden incluir indicadores de información incompleta o advertencias. Si aparecen, la representación debe interpretarse teniendo en cuenta esas limitaciones.

Los nombres exactos de los campos y el formato del árbol dependen de la versión y del contrato de la herramienta.

## 7. Resultados de acciones y verificación

Las acciones de interfaz pueden enviar una entrada al sistema sin demostrar que se haya producido el efecto final esperado.

La documentación distingue entre el envío de una acción y la observación de su resultado. Por ejemplo, un clic puede haberse enviado correctamente sin que eso demuestre que la operación de la aplicación haya terminado.

La confirmación del resultado puede requerir una lectura posterior, un nuevo snapshot o una espera de estado mediante `ui_wait`.

Los campos concretos que expresan el estado de una acción dependen del contrato de la versión instalada. No deben suponerse nombres universales como `success`, `actionDispatched` u `outcomeVerified` sin comprobar que la herramienta los devuelve.

## 8. Automatización por lotes

`ui_batch` permite agrupar varios pasos de automatización en una sola llamada.

Según los pasos admitidos, la secuencia puede incluir operaciones como buscar, hacer clic, introducir texto, seleccionar opciones, esperar, leer controles, obtener snapshots y utilizar entradas de teclado o ratón.

Los argumentos de cada paso deben respetar el esquema de `ui_batch`. Los resultados deben interpretarse según la estructura devuelta: el resultado de una secuencia no implica necesariamente que todos sus pasos hayan terminado con éxito.

La herramienta `ui_macro` fue retirada en la versión `1.3.26`; no debe asumirse que está disponible en la versión `1.3.27`.

## 9. Lectura de texto y tablas

### `ui_read`

Permite leer texto de un control específico o, cuando se solicita expresamente, de una ventana completa.

Puede utilizar UI Automation y mecanismos OCR compatibles. La lectura OCR depende de que la ventana y el contenido sean accesibles para el mecanismo correspondiente.

Un identificador de control inválido o un error de acceso no debe interpretarse como una lectura válida de otro elemento.

### `ui_read_table`

Extrae tablas o cuadrículas compatibles como datos estructurados, con encabezados y filas. La calidad del resultado depende de la estructura que la aplicación exponga mediante sus controles.

## 10. Ventanas, archivos y procesos

### Ventanas

`window_management` permite buscar ventanas y realizar operaciones de gestión como activarlas, moverlas o cambiar su tamaño. Las acciones disponibles dependen de los argumentos admitidos por la herramienta.

### Archivos

`file_open` y `file_save` automatizan determinados diálogos estándar de apertura y guardado. La documentación indica que estos ayudantes de diálogo dependen de las etiquetas en inglés de Windows.

### Procesos

`process` ofrece operaciones compatibles para enumerar y finalizar procesos. La posibilidad de controlar un proceso depende de los permisos y las restricciones del sistema operativo.

## 11. Capturas, teclado y ratón

Las herramientas visuales complementan la automatización semántica:

- `screenshot_control`: obtiene capturas anotadas para observar elementos.
- `keyboard_control`: envía entradas de teclado y atajos.
- `mouse_control`: permite interactuar mediante coordenadas.

Las capturas pueden utilizar compresión y escalado para reducir el tamaño de los resultados.

La automatización por coordenadas depende de la geometría de la pantalla, la posición de la ventana, la escala DPI y el estado actual de la interfaz. No proporciona las mismas garantías de identificación que un control semántico válido.

## 12. Errores y resultados incompletos

Los resultados deben distinguir entre errores de protocolo MCP y errores propios de una herramienta.

Entre las situaciones que pueden aparecer se encuentran:

- Argumentos inválidos.
- Ventana o control no disponible.
- Identificador de elemento obsoleto.
- Permisos insuficientes.
- Búsqueda incompleta.
- Snapshot incompleto.
- Resultado truncado.
- Acción enviada sin confirmación del efecto final.

Los campos de error y sus valores dependen de la herramienta. En la documentación de Windows MCP también se utilizan nombres compactos, como `ok`, para algunos resultados. No debe asumirse que todas las respuestas contienen un campo `success`.

## 13. Requisitos y limitaciones

- Requiere Windows y un escritorio disponible y desbloqueado para las operaciones de automatización de interfaz.
- La cobertura de UI Automation depende de la aplicación.
- Las aplicaciones WinForms, WinUI, Electron, Edge y Chrome cuentan con soporte específico, pero eso no garantiza que todos sus controles sean accesibles.
- La automatización de barras y elementos del navegador puede ser más limitada que la de los controles de las páginas web.
- Los diálogos estándar de apertura y guardado dependen de etiquetas en inglés.
- Una aplicación ejecutada como administrador puede no ser accesible desde un proceso sin privilegios equivalentes.
- Las solicitudes de seguridad de Windows pueden requerir aprobación humana.
- Todas las conexiones que operan sobre el mismo escritorio comparten el entorno de escritorio físico.

## 14. Seguridad

Windows MCP permite actuar sobre aplicaciones reales y sobre el escritorio del sistema.

La documentación advierte que deshabilitar herramientas MCP no constituye un sandbox de Windows ni restringe por sí solo otros mecanismos de ejecución, como comandos de la CLI.

El nivel de acceso efectivo depende de los permisos del proceso, las herramientas habilitadas y las protecciones del sistema operativo.

## 15. Referencias oficiales

- Repositorio: https://github.com/sbroenne/mcp-windows
- Referencia de herramientas y funcionalidades: https://github.com/sbroenne/mcp-windows/blob/main/FEATURES.md
- Versiones publicadas: https://github.com/sbroenne/mcp-windows/releases
- Instalación: https://windowsmcpserver.dev/installation/
- Limitaciones y evaluación: https://windowsmcpserver.dev/benchmark/