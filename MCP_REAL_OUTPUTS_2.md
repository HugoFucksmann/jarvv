# Respuestas Reales Sin Procesar de Servidores MCP — Casos Adicionales

> **Origen de los datos:** Respuestas directas devueltas por los servidores MCP en tiempo de ejecución (`tools/call` JSON-RPC sobre transporte stdio).
> No se aplicó ninguna transformación, normalización, resumen ni interpretación a las respuestas devueltas.

## Resumen de Ejecución

| # | Herramienta | Servidor MCP | Estado | Caso Probado |
| :--- | :--- | :--- | :---: | :--- |
| 1 | `get_more_search_results` | `desktop_commander` | Completada | get_more_search_results (con la búsqueda en curso / IN PROGRESS) |
| 2 | `get_more_search_results` | `desktop_commander` | Completada | get_more_search_results (con la búsqueda terminada / COMPLETED) |
| 3 | `start_process` | `desktop_commander` | Completada | start_process con un comando que falle |
| 4 | `fetch` | `free_search` | Completada | fetch de una URL inexistente |

---

## 1. Prueba: get_more_search_results (con la búsqueda en curso / IN PROGRESS)

- **Servidor MCP:** `desktop_commander`
- **Herramienta:** `get_more_search_results`
- **Contexto:** Sesión de búsqueda iniciada previamente con start_search (sessionId: "search_4_1792109223207"). Se consulta mientras el escaneo de archivos sigue activo.
- **Argumentos utilizados:**

```json
{
  "sessionId": "search_4_1792109223207",
  "offset": 5,
  "length": 5
}
```

- **Respuesta completa original (sin procesar):**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Search session: search_4_1792109223207\nStatus: IN PROGRESS\nRuntime: 0s\nTotal results: 1 match\n\nStill running: 1 result so far, none at offset 5 yet."
    }
  ]
}
```

---

## 2. Prueba: get_more_search_results (con la búsqueda terminada / COMPLETED)

- **Servidor MCP:** `desktop_commander`
- **Herramienta:** `get_more_search_results`
- **Contexto:** Misma sesión de búsqueda ("search_4_1792109223207"). Se consulta una vez que el estado pasó a COMPLETED.
- **Argumentos utilizados:**

```json
{
  "sessionId": "search_4_1792109223207",
  "offset": 0,
  "length": 5
}
```

- **Respuesta completa original (sin procesar):**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Search session: search_4_1792109223207\nStatus: COMPLETED\nRuntime: 0s\nTotal results: 1 match\nShowing results 0-0\n\nResults:\n📁 E:\\colo\\jarvv\\node_modules\\vite\\package.json\n\n✅ Search completed."
    }
  ]
}
```

---

## 3. Prueba: start_process con un comando que falle

- **Servidor MCP:** `desktop_commander`
- **Herramienta:** `start_process`
- **Contexto:** Ejecución de un comando o ejecutable inexistente que produce un fallo en la shell del sistema operativo.
- **Argumentos utilizados:**

```json
{
  "command": "comando_inexistente_para_prueba_mcp_xyz",
  "timeout_ms": 5000
}
```

- **Respuesta completa original (sin procesar):**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Process started with PID 31252 (shell: powershell.exe)\nInitial output:\ncomando_inexistente_para_prueba_mcp_xyz : El t�rmino 'comando_inexistente_para_prueba_mcp_xyz' no se reconoce como \r\nnombre de un cmdlet, funci�n, archivo de script o programa ejecutable. Compruebe si escribi� correctamente el nombre \r\no, si incluy� una ruta de acceso, compruebe que dicha ruta es correcta e int�ntelo de nuevo.\r\nEn l�nea: 1 Car�cter: 1\r\n+ comando_inexistente_para_prueba_mcp_xyz\r\n+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\r\n    + CategoryInfo          : ObjectNotFound: (comando_inexistente_para_prueba_mcp_xyz:String) [], CommandNotFoundExce \r\n   ption\r\n    + FullyQualifiedErrorId : CommandNotFoundException\r\n \r\n\n✅ Process 31252 has finished execution"
    }
  ]
}
```

---

## 4. Prueba: fetch de una URL inexistente

- **Servidor MCP:** `free_search`
- **Herramienta:** `fetch`
- **Contexto:** Intento de descarga de un dominio no existente en DNS (genera fallo en la resolución del host).
- **Argumentos utilizados:**

```json
{
  "url": "https://dominio-inexistente-para-prueba-mcp-123456.com/"
}
```

- **Respuesta completa original (sin procesar):**

```json
{
  "content": [
    {
      "text": "Error executing tool fetch: Could not resolve host 'dominio-inexistente-para-prueba-mcp-123456.com': [Errno 11001] getaddrinfo failed. Refusing to connect.",
      "type": "text"
    }
  ],
  "isError": true
}
```

---

