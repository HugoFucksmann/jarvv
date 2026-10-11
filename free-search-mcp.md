# Free Search MCP — Documentación de referencia

## 1. Identificación

- **Proyecto:** `sweetcornna/free-search-mcp`
- **Repositorio oficial:** https://github.com/sweetcornna/free-search-mcp
- **Licencia:** MIT
- **Python:** versión mínima 3.11.
- **Propósito:** servidor MCP para búsquedas web, recuperación de páginas, lectura de documentos, extracción de datos estructurados y consulta de contenido almacenado en caché.

La versión `0.13.1` se publicó como una actualización de documentación; su registro de cambios indica que el servidor es el mismo que en `0.13.0`.

## 2. Transporte

Admite comunicación mediante:

- **stdio:** comunicación a través de la entrada y salida estándar.
- **Streamable HTTP:** servidor HTTP con endpoint predeterminado `http://127.0.0.1:8000/mcp`.

El endpoint y el puerto pueden variar según la configuración. El servidor HTTP no incorpora autenticación por defecto.

## 3. Herramientas

El proyecto documenta las siguientes herramientas principales:

| Herramienta | Función |
|---|---|
| `search` | Busca información en la web mediante motores configurados. |
| `research` | Realiza búsquedas orientadas a investigación. |
| `paper_graph` | Consulta información y relaciones relacionadas con publicaciones académicas. |
| `compare` | Compara información recuperada de distintas fuentes. |
| `fetch` | Recupera el contenido de una URL. |
| `fetch_batch` | Recupera contenido de varias URL. |
| `read_doc` | Lee documentos compatibles. |
| `extract_structured` | Extrae metadatos y datos estructurados de páginas. |
| `cache_search` | Busca en el contenido previamente almacenado en caché. |
| `engines` | Enumera motores de búsqueda disponibles. |
| `download` | Descarga archivos a la ubicación de descargas de la caché. |
| `ask` | Disponible únicamente cuando se configura un backend de respuestas. |

La lista efectiva puede depender de la configuración y de la versión instalada.

## 4. Parámetros de búsqueda

Las herramientas `search` y `research` admiten filtros documentados como:

- `freshness`: limita la antigüedad de los resultados. Valores: `day`, `week`, `month` y `year`.
- `include_domains`: restringe los resultados a dominios especificados.
- `exclude_domains`: excluye dominios.
- `category`: selecciona una categoría de búsqueda compatible.
- `include_text`: incluye términos de texto en el filtrado.
- `exclude_text`: excluye resultados según el texto indicado.
- `max_age_hours`: establece un límite de antigüedad expresado en horas.

Los parámetros obligatorios, tipos, valores permitidos y valores predeterminados dependen del esquema de cada herramienta. La definición publicada por la versión instalada es la referencia para determinar el formato exacto de los argumentos.

## 5. Formatos y resultados

- Las herramientas devuelven resultados estructurados mediante el protocolo MCP.
- Algunas herramientas admiten formatos de salida como Markdown o JSON, según su esquema.
- `fetch` permite recuperar el contenido de páginas.
- `extract_structured` obtiene metadatos como JSON-LD, OpenGraph, Twitter Cards y microdatos. Los campos de texto extensos pueden truncarse; el resultado puede indicar los campos afectados mediante `trimmed`.
- `engines` devuelve información sobre los motores disponibles.
- `download` guarda archivos en el directorio de descargas de la caché configurada.
- Los resultados de búsqueda y las páginas recuperadas pueden almacenarse en caché.

## 6. Recursos y prompts MCP

La documentación publica recursos de caché con estas plantillas:

- `cache://page/{url}`
- `cache://search/{query_hash}`

También documenta cinco prompts MCP. La disponibilidad efectiva de recursos, prompts y enlaces a recursos puede depender de la versión del protocolo MCP y del cliente.

## 7. Motores y configuración

El servidor incluye motores que pueden funcionar sin claves de API y admite motores adicionales que requieren credenciales propias.

Entre las variables de configuración documentadas se encuentran:

- `SEARCH_MCP_DEFAULT_ENGINES`: motores predeterminados.
- `SEARCH_MCP_REGION`: región o configuración regional de búsqueda.
- `SEARCH_MCP_CACHE_DIR`: directorio de caché.
- `SEARCH_MCP_TOOLS`: selección de herramientas que se registran.
- `SEARCH_MCP_PROXY`: configuración de proxy.
- `SEARCH_MCP_DOWNLOAD_ENABLED`: habilita o deshabilita las descargas.

La configuración completa y los valores predeterminados deben consultarse en la documentación de la versión instalada.

## 8. Limitaciones y seguridad

- La cobertura y calidad de los resultados dependen de los motores seleccionados y de la disponibilidad de las páginas.
- El contenido de páginas web puede ser incompleto, estar protegido o requerir renderizado JavaScript.
- Las funciones que dependen de navegadores pueden requerir la instalación adicional de Chromium.
- Las herramientas de recuperación y descarga acceden a URL externas.
- El servidor HTTP predeterminado no proporciona autenticación; su exposición debe considerarse según el entorno de ejecución.
- Los motores que requieren credenciales solo están disponibles cuando se configura la clave correspondiente.

## 9. Documentación oficial

- Repositorio y README: https://github.com/sweetcornna/free-search-mcp
- Registro de cambios: https://github.com/sweetcornna/free-search-mcp/blob/main/CHANGELOG.md
- Configuración: https://github.com/sweetcornna/free-search-mcp/blob/main/docs/CONFIGURATION.md
- Claves de API: https://github.com/sweetcornna/free-search-mcp/blob/main/docs/API_KEYS.md