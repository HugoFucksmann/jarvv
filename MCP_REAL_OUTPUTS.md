# Salidas Reales de Herramientas MCP (`MCP_REAL_OUTPUTS.md`)

Este documento constituye el registro empírico y exhaustivo de las respuestas crudas originales obtenidas de la ejecución real de todas las herramientas expuestas por los servidores MCP integrados en Jarvis (`desktop_commander` y `free_search`).

> **Reglas metodológicas aplicadas:**
> 1. Todas las salidas provienen de invocaciones reales mediante transporte stdio JSON-RPC 2.0.
> 2. No se alteran ni sintetizan las estructuras de respuesta.
> 3. Se diferencian los argumentos de entrada de los esquemas y las respuestas emitidas.
> 4. Se documentan secuencias completas de ciclo de vida (procesos interactivos, paginación de búsquedas) y errores observados.

---

## 1. Servidor `desktop_commander`

### 1.1 `desktop_commander.start_process`

#### Caso A: Proceso de corta duración que finaliza correctamente
- **Argumentos de entrada:**
```json
{
  "command": "echo hello from MCP",
  "timeout_ms": 10000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Process started with PID 31776 (shell: powershell.exe)\nInitial output:\nhello\r\nfrom\r\nMCP\r\n\n✅ Process 31776 has finished execution"
    }
  ]
}
```

#### Caso B: Proceso que finaliza con código de error controlado
- **Argumentos de entrada:**
```json
{
  "command": "node -e \"process.exit(1)\"",
  "timeout_ms": 10000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Process started with PID 26796 (shell: powershell.exe)\nInitial output:\n\n✅ Process 26796 has finished execution"
    }
  ]
}
```
> **Observación:** El servidor MCP no marca el flag `isError: true` en la envoltura JSON-RPC ante salidas con exit code distinto de cero; en su lugar, la terminación se reporta en el texto descriptivo del bloque `content`.

#### Caso C: Proceso que arroja una excepción no controlada / stack trace multilínea
- **Argumentos de entrada:**
```json
{
  "command": "node -e \"throw new Error('x')\"",
  "timeout_ms": 10000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Process started with PID 17612 (shell: powershell.exe)\nInitial output:\n[eval]:1\r\nthrow new Error('x')\r\n^\r\n\r\nError: x\r\n    at [eval]:1:7\r\n    at runScriptInThisContext (node:internal/vm:219:10)\r\n    at node:internal/process/execution:451:12\r\n    at [eval]-wrapper:6:24\r\n    at runScriptInContext (node:internal/process/execution:449:60)\r\n    at evalFunction (node:internal/process/execution:283:30)\r\n    at evalTypeScript (node:internal/process/execution:295:3)\r\n    at node:internal/main/eval_string:71:3\r\n\r\nNode.js v24.12.0\r\n\n✅ Process 17612 has finished execution"
    }
  ]
}
```
> **Observación:** El stack trace completo multilínea de stderr/stdout es capturado e incrustado textualmente dentro de `Initial output:`, seguido por el aviso de terminación con el PID.

#### Caso D: Proceso que permanece en ejecución al expirar el timeout (background / en curso)
- **Argumentos de entrada:**
```json
{
  "command": "powershell -Command \"Start-Sleep -Seconds 20\"",
  "timeout_ms": 1000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Process started with PID 20636 (shell: powershell.exe)\nInitial output:\n\n⏳ Process is running. Use read_process_output to get more output."
    }
  ]
}
```
> **Observación:** Cuando la espera inicial agota `timeout_ms` mientras el subproceso sigue activo, el servidor emite el marcador `⏳ Process is running. Use read_process_output to get more output.` omitiendo cualquier aviso de finalización o código de salida.

---

### 1.2 Secuencia Interactiva de Procesos: `start_process` -> `interact_with_process` -> `read_process_output`

Esta secuencia muestra el ciclo de vida completo de un proceso interactivo (REPL de Node.js) que permanece en espera de entrada.

#### Paso 1: Iniciar proceso interactivo con `start_process`
- **Argumentos de entrada:**
```json
{
  "command": "node -i",
  "timeout_ms": 10000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Process started with PID 16588 (shell: powershell.exe)\nInitial output:\nWelcome to Node.js v24.12.0.\nType \".help\" for more information.\n> \n🔄 Process 16588 is waiting for input (detected: \">\")"
    }
  ]
}
```

#### Paso 2: Enviar entrada mediante `interact_with_process`
- **Argumentos de entrada:**
```json
{
  "pid": 16588,
  "input": "console.log('INTERACTIVE_OK_' + (20+22))\n",
  "timeout_ms": 5000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "✅ Input executed in process 16588:\n\n📤 Output:\nINTERACTIVE_OK_42\nundefined\n\n\n🔄 Process 16588 is waiting for input (detected: \">\")"
    }
  ]
}
```

#### Paso 3: Leer acumulado con `read_process_output` (proceso activo)
- **Argumentos de entrada:**
```json
{
  "pid": 16588,
  "timeout_ms": 5000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "[Reading 5 new lines (total: 5 lines)]\n\nWelcome to Node.js v24.12.0.\nType \".help\" for more information.\n> INTERACTIVE_OK_42\nundefined\n> \n🔄 Process 16588 is waiting for input (detected: \">\")"
    }
  ]
}
```

#### Paso 3b: `read_process_output` de un proceso que ya terminó
- **Contexto:** Se inició un proceso con PID 22292 que ejecutó `console.log('done_proc'); process.exit(0);`.
- **Argumentos de entrada:**
```json
{
  "pid": 22292,
  "timeout_ms": 5000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "[Reading 1 new lines (total: 1 lines)]\n\ndone_proc\n✅ Process completed with exit code 0 (runtime: 0.21s)"
    }
  ]
}
```
> **Observación:** Al leer un proceso finalizado, el servidor MCP retorna el buffer residual pendiente junto con la línea `✅ Process completed with exit code <código> (runtime: <tiempo>s)`. No arroja `isError: true`.

#### Error observado en `interact_with_process` (proceso ya terminado)
- **Argumentos de entrada:**
```json
{
  "pid": 27028,
  "input": "test_input_stage2\n",
  "timeout_ms": 5000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Failed to send input to process 27028. The process may have exited or doesn't accept input."
    }
  ],
  "isError": true
}
```

---

### 1.3 `desktop_commander.create_directory`

- **Argumentos de entrada:**
```json
{
  "path": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\nested_folder"
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Successfully created directory C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\nested_folder"
    }
  ]
}
```

---

### 1.4 `desktop_commander.write_file`

- **Argumentos de entrada:**
```json
{
  "path": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file1.txt",
  "content": "Línea 1: Contenido inicial de prueba MCP.\nLínea 2: Segunda línea."
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Successfully wrote to C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file1.txt (2 lines) "
    }
  ]
}
```

---

### 1.5 `desktop_commander.read_file`

#### Caso A: Archivo con Contenido (Lectura Exitosa)
- **Argumentos de entrada:**
```json
{
  "path": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file1.txt",
  "offset": 0,
  "length": 1000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "[Reading 2 lines from start (total: 2 lines, 0 remaining)]\n\nLínea 1: Contenido inicial de prueba MCP.\nLínea 2: Segunda línea."
    }
  ]
}
```

#### Caso B: Archivo Vacío (0 bytes)
- **Argumentos de entrada:**
```json
{
  "path": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\empty_file.txt",
  "offset": 0,
  "length": 1000
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "[Reading 0 lines from start (total: 0 lines, 0 remaining)]\n\n"
    }
  ]
}
```
> **Observación:** La lectura de un archivo con 0 bytes no retorna error (`isError: false` o indefinido); devuelve exitosamente el banner informativo indicando 0 líneas leídas y 0 líneas totales restantes (`[Reading 0 lines from start (total: 0 lines, 0 remaining)]`).

#### Caso C: Archivo Inexistente (Error Controlado)
- **Argumentos de entrada:**
```json
{
  "path": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\non_existent_file_xyz123.txt"
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: ENOENT: no such file or directory, stat 'C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\non_existent_file_xyz123.txt'"
    }
  ],
  "isError": true
}
```

---

### 1.6 `desktop_commander.read_multiple_files`

- **Argumentos de entrada:**
```json
{
  "paths": [
    "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file1.txt",
    "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file2.txt"
  ]
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file1.txt: text/plain (text)\nC:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file2.txt: text/plain (text)"
    },
    {
      "type": "text",
      "text": "\n--- C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file1.txt contents: ---\n[Reading 2 lines from start (total: 2 lines, 0 remaining)]\n\nLínea 1: Contenido inicial de prueba MCP.\nLínea 2: Segunda línea."
    },
    {
      "type": "text",
      "text": "\n--- C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file2.txt contents: ---\n[Reading 1 lines from start (total: 1 lines, 0 remaining)]\n\nContenido del archivo 2 para lectura múltiple."
    }
  ]
}
```

---

### 1.7 `desktop_commander.list_directory`

- **Argumentos de entrada:**
```json
{
  "path": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox",
  "depth": 2
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "[FILE] file1.txt\n[FILE] file2.txt\n[DIR] nested_folder"
    }
  ]
}
```

---

### 1.8 `desktop_commander.move_file`

- **Argumentos de entrada:**
```json
{
  "source": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file1.txt",
  "destination": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\nested_folder\\file1_moved.txt"
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Successfully moved C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\file1.txt to C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\nested_folder\\file1_moved.txt"
    }
  ]
}
```

---

### 1.9 Secuencia de Búsqueda y Paginación: `start_search` -> `get_more_search_results`

#### Paso 1: Inicio de búsqueda con `start_search`
- **Argumentos de entrada:**
```json
{
  "path": "C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox",
  "pattern": "*.*",
  "searchType": "files",
  "maxResults": 1
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Started file search session: search_1_1792925875940\nPattern: \"*.*\"\nPath: C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\nStatus: RUNNING\nRuntime: 17ms\nTotal results: 1 match\n\nInitial results:\n📁 C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\nested_folder\\file1_moved.txt\n\n🔄 Search in progress. Use get_more_search_results to get more results."
    }
  ]
}
```

#### Paso 2: Paginación de resultados con `get_more_search_results`
- **Argumentos de entrada:**
```json
{
  "sessionId": "search_1_1792925875940",
  "offset": 0,
  "length": 10
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Search session: search_1_1792925875940\nStatus: IN PROGRESS\nRuntime: 0s\nTotal results: 1 match\nShowing results 0-0\n\nResults:\n📁 C:\\Users\\hugof\\.gemini\\antigravity-ide\\brain\\abfc6296-c667-4a1b-a61f-b9ba02068eae\\scratch\\stage2_sandbox\\nested_folder\\file1_moved.txt\n\nStill running: more may come."
    }
  ]
}
```

---

## 2. Servidor `free_search`

### 2.1 `free_search.search`

#### Caso A: Formato por defecto (sin parámetro `format`, emite Markdown directamente)
*Muestra extraída directamente del registro histórico de traza real de ejecución de Jarvis (`jarvis-refs/task_1792465090963_v57g.json`)*.

- **Argumentos de entrada:**
```json
{
  "query": "ultimo modelo de gemini",
  "max_results": 10
}
```
- **Respuesta cruda real (`content[0].text`):**
```markdown
# Search: ultimo modelo de gemini

_engines: bing, duckduckgo, anysearch_  _results: 10_  _dated: 5/10_
_(requested but contributed nothing: mojeek)_
_(cached 2 days ago · retrieved 2026-10-17T15:08:17Z)_

> **Lead:** According to cotizaciones.bolsamania.com: Google lanza Gemini 4 Argon, su modelo de IA para desarrolladores y empresas BBVA inicia el segundo tramo de su recompra de acciones por 1.000 millones de euros Iberdrola y dos valores más que han perforado resistencias este martes El Ibex 35 salva los 19.200 tras unos resultados mixtos de los bancos americanos

## 1. All Gemini Models - Pro, Ultra, Flash (2026) | LM Market Cap
<https://lmmarketcap.com/google-gemini-models>

> Every Google Gemini model ranked: Pro, Ultra, and Flash compared by scores, pricing, and capabilities. Find the best Gemini for your use case.

_bing, duckduckgo_ · score 0.03279 · 1 day ago (from snippet text)

## 2. Listado de noticias para la categoría Ultimas noticias - 2026-10-13 ...
<https://cotizaciones.bolsamania.com/periodistadigital/noticias/ultimas/2026-10-13>

> Google lanza Gemini 4 Argon, su modelo de IA para desarrolladores y empresas BBVA inicia el segundo tramo de su recompra de acciones por 1.000 millones de euros Iberdrola y dos valores más que han perforado resistencias este martes El Ibex 35 salva los 19.200 tras unos resultados mixtos de los bancos americanos

_bing, duckduckgo_ · score 0.03126 · 2026-10-13 (from snippet text)

## 3. BetBrothers AI — Pronósticos de Fútbol con IA Gratis
<https://betbrothers.ai/es>

> Gratis Pronósticos de fútbol con IA de 6 Modelos ChatGPT, Claude, Gemini y otros 4 modelos de IA, contrastados con cuotas en vivo de 40+ casas de apuestas. Les damos a los seis los mismos datos del partido y comparamos sus picks — consenso con edge % incorporado, calculado en segundos.

_bing, duckduckgo_ · score 0.02963 · 15 hours ago (from snippet text)

## 4. Modelos | Gemini API | Google AI for Developers
<https://ai.google.dev/gemini-api/docs/models?hl=es-419>

> Gemini 2.5 Flash-Lite, Es el modelo multimodal más rápido y económico de la familia 2.5. gemini-2.5-flash-lite ...

_anysearch_ · score 0.01639 · undated

## 5. Google apresenta Gemini 4 Argon, uma IA capaz de resolver problemas que ...
<https://www.gizmodo.com.br/google-apresenta-gemini-4-argon-uma-ia-capaz-de-resolver-problemas-que-outros-modelos-nao-conseguem-71661>

> A cibersegurança é uma das áreas em que o Gemini 4 Argon apresentou resultados mais expressivos. O modelo foi treinado para identificar, verificar e corrigir vulnerabilidades em programas de computador. Em um dos testes divulgados pelo Google, a tecnologia encontrou uma falha crítica em um software utilizado por hospitais de diferentes países.

_duckduckgo_ · score 0.01613 · undated

## 6. Gemini Pro + Gemini 3 Pro + Google Ai Pro + Veo 3.1 +… | GGMAX
<https://ggmax.com.br/anuncio/gemini-pro-gemini-3-pro-google-ai-pro-veo-3-1-flow-omni-flash-brinde?item=2388840>

> 1 day ago · Garanta seu acesso ao Gemini Pro + Gemini 3.1 Pro + Google AI Pro Premium e utilize uma das plataformas de …

_bing_ · score 0.01613 · 1 day ago (from snippet text)

## 7. accede a Gemini 3.1 Pro y más funciones
<https://gemini.google/es/subscriptions/?hl=es>

> Gemini 3.1 Pro, €4,99 EUR/mes ・ €21,99 EUR/mes ・ con los modelos de Gemini más recientes y empieza a crear con la API de Gemini. El modelo Gemini 3 Pro,

_anysearch_ · score 0.01613 · undated

## 8. Geely, anuncia la incorporación de Google Gemini y Maps en sus …
<https://www.starnewskorea.com/es/business-life/2026/10/17/2026101700332182400>

> 15 hours ago · Shen Yuan, director de tecnología (CTO) del Grupo Geely Holding, anunció oficialmente su plan de establecer un …

_bing_ · score 0.01587 · 15 hours ago (from snippet text)

## 9. ‎Google Gemini
<https://gemini.google.com/?hl=es>

> Descubre Gemini, el asistente de IA de Google. Puedes pedirle que te ayude a escribir, a hacer planes o a explorar ideas, entre otras cosas.

_anysearch_ · score 0.01587 · undated

## 10. Ranking de IA 2026: Benchmark de +850 LLMs | SWEN.AI
<https://swen.ia.br/benchmark>

> Ranking de IA 2026: compare +850 modelos por inteligência, preço e velocidade. GPT, Claude, Gemini e Llama. Atualizado a cada 6h →

_duckduckgo_ · score 0.01562 · undated


⚠️ **Gated engines:** mojeek was captcha-gated (no results). Configure a proxy (admin UI / SEARCH_MCP_PROXY) to route through a non-blocked IP, or rely on the keyless default engines.

_Snippets locate sources; they are not the source. Read dates, amounts, rules and other details from the page itself with fetch or research before relying on them._
```

---

#### Caso B: Formato JSON explícito (`format: "json"`)
- **Argumentos de entrada:**
```json
{
  "query": "MCP protocol model context",
  "max_results": 3,
  "format": "json"
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "text": "{\n  \"query\": \"MCP protocol model context\",\n  \"engines\": [\n    \"duckduckgo\",\n    \"bing\",\n    \"anysearch\"\n  ],\n  \"cached\": false,\n  \"results\": [\n    {\n      \"title\": \"What is the Model Context Protocol (MCP)?\",\n      \"url\": \"https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro\",\n      \"snippet\": \"MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ...\",\n      \"engines\": [\n        \"anysearch\"\n      ],\n      \"score\": 0.01639,\n      \"date_source\": \"none\"\n    },\n    {\n      \"title\": \"MCP ( Model Context Protocol ),一篇就够了\",\n      \"url\": \"http://www.uml.org.cn/ai/202507144.asp\",\n      \"snippet\": \"MCP ( Model Context Protocol ,模型上下文协议)定义了应用程序和 AI 模型之间交换上下文信息的方式。这使得开发者能够以一致的方式将各种数据源、工具和功能连接到 AI 模型(...\",\n      \"engines\": [\n        \"so360\"\n      ],\n      \"score\": 0.01639,\n      \"date_source\": \"none\"\n    },\n    {\n      \"title\": \"Introducing the Model Context Protocol\",\n      \"url\": \"https://www.anthropic.com/news/model-context-protocol\",\n      \"snippet\": \"The Model Context Protocol is an open standard that enables developers to build secure, two-way connections between their data sources and AI- ...\",\n      \"engines\": [\n        \"anysearch\"\n      ],\n      \"score\": 0.01613,\n      \"date_source\": \"none\"\n    }\n  ],\n  \"lead_snippet\": \"According to modelcontextprotocol.io: MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ...\",\n  \"errors\": null,\n  \"retrieved_at\": \"2026-10-25T10:53:17Z\",\n  \"dated_results\": 0,\n  \"usage_note\": \"Snippets locate sources; they are not the source. Read dates, amounts, rules and other details from the page itself with fetch or research before relying on them.\",\n  \"cache_key\": \"d369b6ff6401984bcd8ce59296a3dc77ff212b484ae303783ecbbad5612cd9ae\",\n  \"rescued_via\": \"so360\",\n  \"benched_engines\": {\n    \"mojeek\": {\n      \"reason\": \"captcha\",\n      \"retry_in_seconds\": 3575,\n      \"substitute\": null\n    }\n  },\n  \"benched_hint\": \"mojeek is benched (captcha; retried in ~60 min). A benched engine failed recently and was not asked this time. Name it in `engines=` to force an attempt.\",\n  \"gated_engines\": {\n    \"bing\": {\n      \"reason\": \"browser_unavailable\",\n      \"fallback\": \"so360\"\n    },\n    \"duckduckgo\": {\n      \"reason\": \"browser_unavailable\",\n      \"fallback\": \"so360\"\n    }\n  },\n  \"gated_hint\": \"bing needed a browser render that is unavailable → served via so360; duckduckgo needed a browser render that is unavailable → served via so360. Install the browser with `uv run playwright install chromium` (source checkout) or `uvx --from free-search-mcp playwright install chromium` (uvx/PyPI install), then restart the server.\"\n}",
      "type": "text"
    }
  ],
  "isError": false,
  "structuredContent": {
    "query": "MCP protocol model context",
    "engines": [
      "duckduckgo",
      "bing",
      "anysearch"
    ],
    "cached": false,
    "results": [
      {
        "title": "What is the Model Context Protocol (MCP)?",
        "url": "https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro",
        "snippet": "MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ...",
        "engines": [
          "anysearch"
        ],
        "score": 0.01639,
        "date_source": "none"
      },
      {
        "title": "MCP ( Model Context Protocol ),一篇就够了",
        "url": "http://www.uml.org.cn/ai/202507144.asp",
        "snippet": "MCP ( Model Context Protocol ,模型上下文协议)定义了应用程序和 AI 模型之间交换上下文信息的方式。这使得开发者能够以一致的方式将各种数据源、工具和功能连接到 AI 模型(...",
        "engines": [
          "so360"
        ],
        "score": 0.01639,
        "date_source": "none"
      },
      {
        "title": "Introducing the Model Context Protocol",
        "url": "https://www.anthropic.com/news/model-context-protocol",
        "snippet": "The Model Context Protocol is an open standard that enables developers to build secure, two-way connections between their data sources and AI- ...",
        "engines": [
          "anysearch"
        ],
        "score": 0.01613,
        "date_source": "none"
      }
    ],
    "lead_snippet": "According to modelcontextprotocol.io: MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ...",
    "errors": null,
    "retrieved_at": "2026-10-25T10:53:17Z",
    "dated_results": 0,
    "usage_note": "Snippets locate sources; they are not the source. Read dates, amounts, rules and other details from the page itself with fetch or research before relying on them.",
    "cache_key": "d369b6ff6401984bcd8ce59296a3dc77ff212b484ae303783ecbbad5612cd9ae",
    "rescued_via": "so360",
    "benched_engines": {
      "mojeek": {
        "reason": "captcha",
        "retry_in_seconds": 3575,
        "substitute": null
      }
    },
    "benched_hint": "mojeek is benched (captcha; retried in ~60 min). A benched engine failed recently and was not asked this time. Name it in `engines=` to force an attempt.",
    "gated_engines": {
      "bing": {
        "reason": "browser_unavailable",
        "fallback": "so360"
      },
      "duckduckgo": {
        "reason": "browser_unavailable",
        "fallback": "so360"
      }
    },
    "gated_hint": "bing needed a browser render that is unavailable → served via so360; duckduckgo needed a browser render that is unavailable → served via so360. Install the browser with `uv run playwright install chromium` (source checkout) or `uvx --from free-search-mcp playwright install chromium` (uvx/PyPI install), then restart the server."
  }
}
```

---

#### Caso C: Búsqueda sin resultados (0 coincidencias)
- **Argumentos de entrada:**
```json
{
  "query": "nonexistentterm999xyz",
  "include_domains": [
    "example.com"
  ],
  "use_cache": false
}
```
- **Respuesta cruda real (`content[0].text`):**
```markdown
# Search: nonexistentterm999xyz

_engines: duckduckgo, bing, anysearch_  _results: 0_
_(retrieved 2026-10-25T11:18:06Z)_

**No results.** Try a broader query, different engines, or check `errors` if any engine failed.

⚠️ **Gated engines:** duckduckgo needed a browser render that is unavailable. Install the browser with `uv run playwright install chromium` (source checkout) or `uvx --from free-search-mcp playwright install chromium` (uvx/PyPI install), then restart the server.

ℹ️ **Benched engines:** mojeek is benched (captcha; retried in ~35 min). A benched engine failed recently and was not asked this time. Name it in `engines=` to force an attempt.

---
⚠️ **Filter diagnostics** (results were sparse)

Raw results: 17 across 3 engines → 0 after filters.
Top drops: include_domains (17).

Hint: Filters dropped 17 of 17 raw results (kept 0). Most were excluded by include_domains. Try widening or removing one filter.
```
> **Observación:** Cuando la búsqueda no arroja coincidencias, `free_search` genera explícitamente `_results: 0_` y el mensaje de texto principal `**No results.** Try a broader query, different engines...` junto con el diagnóstico de filtros (`Filter diagnostics`) si aplicaron reglas de inclusión/exclusión. El campo `isError` se mantiene en `false`.

---

### 2.2 `free_search.fetch`

#### Caso Exitoso (Markdown rendering)
- **Argumentos de entrada:**
```json
{
  "url": "https://httpbin.org/html",
  "format": "markdown",
  "render": "http"
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "text": "# Herman Melville - Moby-Dick\n<https://httpbin.org/html>\n_no publication date found_\n_fetched via http_ · ~891 tokens · retrieved 2026-10-25T10:57:58Z\n\nAvailing himself of the mild, summer-cool weather that now reigned in these latitudes, and in preparation for the peculiarly active pursuits shortly to be anticipated, Perth, the begrimed, blistered old blacksmith, had not removed his portable forge to the hold again, after concluding his contributory work for Ahab's leg, but still retained it on deck, fast lashed to ringbolts by the foremast; being now almost incessantly invoked by the headsmen, and harpooneers, and bowsmen to do some little job for them; altering, or repairing, or new shaping their various weapons and boat furniture. Often he would be surrounded by an eager circle, all waiting to be served; holding boat-spades, pike-heads, harpoons, and lances, and jealously watching his every sooty movement, as he toiled. Nevertheless, this old man's was a patient hammer wielded by a patient arm. No murmur, no impatience, no petulance did come from him. Silent, slow, and solemn; bowing over still further his chronically broken back, he toiled away, as if toil were life itself, and the heavy beating of his hammer the heavy beating of his heart. And so it was.—Most miserable! A peculiar walk in this old man, a certain slight but painful appearing yawing in his gait, had at an early period of the voyage excited the curiosity of the mariners. And to the importunity of their persisted questionings he had finally given in; and so it came to pass that every one now knew the shameful story of his wretched fate. Belated, and not innocently, one bitter winter's midnight, on the road running between two country towns, the blacksmith half-stupidly felt the deadly numbness stealing over him, and sought refuge in a leaning, dilapidated barn. The issue was, the loss of the extremities of both feet. Out of this revelation, part by part, at last came out the four acts of the gladness, and the one long, and as yet uncatastrophied fifth act of the grief of his life's drama. He was an old man, who, at the age of nearly sixty, had postponedly encountered that thing in sorrow's technicals called ruin. He had been an artisan of famed excellence, and with plenty to do; owned a house and garden; embraced a youthful, daughter-like, loving wife, and three blithe, ruddy children; every Sunday went to a cheerful-looking church, planted in a grove. But one night, under cover of darkness, and further concealed in a most cunning disguisement, a desperate burglar slid into his happy home, and robbed them all of everything. And darker yet to tell, the blacksmith himself did ignorantly conduct this burglar into his family's heart. It was the Bottle Conjuror! Upon the opening of that fatal cork, forth flew the fiend, and shrivelled up his home. Now, for prudent, most wise, and economic reasons, the blacksmith's shop was in the basement of his dwelling, but with a separate entrance to it; so that always had the young and loving healthy wife listened with no unhappy nervousness, but with vigorous pleasure, to the stout ringing of her young-armed old husband's hammer; whose reverberations, muffled by passing through the floors and walls, came up to her, not unsweetly, in her nursery; and so, to stout Labor's iron lullaby, the blacksmith's infants were rocked to slumber. Oh, woe on woe! Oh, Death, why canst thou not sometimes be timely? Hadst thou taken this old blacksmith to thyself ere his full ruin came upon him, then had the young widow had a delicious grief, and her orphans a truly venerable, legendary sire to dream of in their after years; and all of them a care-killing competency.\n",
      "type": "text"
    }
  ],
  "isError": false
}
```

#### Caso Error (Host Inexistente / DNS Failure)
- **Argumentos de entrada:**
```json
{
  "url": "https://this-domain-does-not-exist-at-all-xyz987.org",
  "format": "markdown",
  "render": "http"
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "text": "Error executing tool fetch: Could not resolve host 'this-domain-does-not-exist-at-all-xyz987.org': [Errno 11001] getaddrinfo failed. Refusing to connect.",
      "type": "text"
    }
  ],
  "isError": true
}
```

---

### 2.3 `free_search.fetch_batch`

- **Argumentos de entrada:**
```json
{
  "urls": [
    "https://httpbin.org/html",
    "https://httpbin.org/robots.txt"
  ],
  "format": "markdown",
  "render": "http"
}
```
- **Respuesta cruda real:**
```json
{
  "content": [
    {
      "text": "# Herman Melville - Moby-Dick\n<https://httpbin.org/html>\n_no publication date found_\n_fetched via cache_ · ~891 tokens · cached under a minute ago · retrieved 2026-10-25T10:57:58Z\n\nAvailing himself of the mild, summer-cool weather that now reigned in these latitudes, and in preparation for the peculiarly active pursuits shortly to be anticipated, Perth, the begrimed, blistered old blacksmith, had not removed his portable forge to the hold again, after concluding his contributory work for Ahab's leg, but still retained it on deck, fast lashed to ringbolts by the foremast; being now almost incessantly invoked by the headsmen, and harpooneers, and bowsmen to do some little job for them; altering, or repairing, or new shaping their various weapons and boat furniture. Often he would be surrounded by an eager circle, all waiting to be served; holding boat-spades, pike-heads, harpoons, and lances, and jealously watching his every sooty movement, as he toiled. Nevertheless, this old man's was a patient hammer wielded by a patient arm. No murmur, no impatience, no petulance did come from him. Silent, slow, and solemn; bowing over still further his chronically broken back, he toiled away, as if toil were life itself, and the heavy beating of his hammer the heavy beating of his heart. And so it was.—Most miserable! A peculiar walk in this old man, a certain slight but painful appearing yawing in his gait, had at an early period of the voyage excited the curiosity of the mariners. And to the importunity of their persisted questionings he had finally given in; and so it came to pass that every one now knew the shameful story of his wretched fate. Belated, and not innocently, one bitter winter's midnight, on the road running between two country towns, the blacksmith half-stupidly felt the deadly numbness stealing over him, and sought refuge in a leaning, dilapidated barn. The issue was, the loss of the extremities of both feet. Out of this revelation, part by part, at last came out the four acts of the gladness, and the one long, and as yet uncatastrophied fifth act of the grief of his life's drama. He was an old man, who, at the age of nearly sixty, had postponedly encountered that thing in sorrow's technicals called ruin. He had been an artisan of famed excellence, and with plenty to do; owned a house and garden; embraced a youthful, daughter-like, loving wife, and three blithe, ruddy children; every Sunday went to a cheerful-looking church, planted in a grove. But one night, under cover of darkness, and further concealed in a most cunning disguisement, a desperate burglar slid into his happy home, and robbed them all of everything. And darker yet to tell, the blacksmith himself did ignorantly conduct this burglar into his family's heart. It was the Bottle Conjuror! Upon the opening of that fatal cork, forth flew the fiend, and shrivelled up his home. Now, for prudent, most wise, and economic reasons, the blacksmith's shop was in the basement of his dwelling, but with a separate entrance to it; so that always had the young and loving healthy wife listened with no unhappy nervousness, but with vigorous pleasure, to the stout ringing of her young-armed old husband's hammer; whose reverberations, muffled by passing through the floors and walls, came up to her, not unsweetly, in her nursery; and so, to stout Labor's iron lullaby, the blacksmith's infants were rocked to slumber. Oh, woe on woe! Oh, Death, why canst thou not sometimes be timely? Hadst thou taken this old blacksmith to thyself ere his full ruin came upon him, then had the young widow had a delicious grief, and her orphans a truly venerable, legendary sire to dream of in their after years; and all of them a care-killing competency.\n\n---\n\n# (untitled)\n<https://httpbin.org/robots.txt>\n_no publication date found_\n_fetched via http_ · ~7 tokens · retrieved 2026-10-25T10:57:59Z\n\nUser-agent: *\nDisallow: /deny\n",
      "type": "text"
    }
  ],
  "isError": false
}
```

---

## 3. Matriz de Cobertura y Estado de Herramientas

| Servidor | Herramienta | Probada | Estado / Secuencia Documentada |
| :--- | :--- | :---: | :--- |
| `desktop_commander` | `start_process` | ✅ | Éxito simple, exit code controlado y proceso interactivo persistente. |
| `desktop_commander` | `read_process_output` | ✅ | Lectura acumulativa de proceso interactivo (`node -i`) e informe de finalización. |
| `desktop_commander` | `interact_with_process` | ✅ | Entrada stdin exitosa a REPL y error controlado cuando el PID no acepta entrada. |
| `desktop_commander` | `start_search` | ✅ | Búsqueda real de archivos y generación de `sessionId` para streaming. |
| `desktop_commander` | `get_more_search_results`| ✅ | Paginación secuencial con `sessionId` de búsqueda activa. |
| `desktop_commander` | `read_file` | ✅ | Lectura con offset/length y error `ENOENT` en archivo inexistente. |
| `desktop_commander` | `read_multiple_files` | ✅ | Lectura en lote de múltiples archivos con reporte de MIME y contenido individual. |
| `desktop_commander` | `write_file` | ✅ | Creación y escritura de archivo con reporte de líneas. |
| `desktop_commander` | `create_directory` | ✅ | Creación de directorios anidados. |
| `desktop_commander` | `list_directory` | ✅ | Listado estructurado con prefijos `[FILE]` y `[DIR]`. |
| `desktop_commander` | `move_file` | ✅ | Reubicación/renombrado exitoso de archivo entre carpetas. |
| `free_search` | `search` | ✅ | Consulta multi-motor con resultados, snippets y `structuredContent`. |
| `free_search` | `fetch` | ✅ | Descarga y conversión HTML a Markdown y error de DNS en dominio inválido. |
| `free_search` | `fetch_batch` | ✅ | Descarga en paralelo de múltiples URLs con concatenación estructurada (`---`). |

*Total de herramientas catalogadas: 14 (11 de `desktop_commander` + 3 de `free_search`). Cobertura real probada: 100% (14/14).*

---

## 4. Validaciones Técnicas y Catálogos `tools/list`

### 4.1 Verificación de Integridad TypeScript (`tsc --noEmit`)

- **Comando ejecutado:** `npx tsc --noEmit` en `e:\colo\jarvv`
- **Código de salida:** `0`
- **Salida estándar (`stdout`):** *(vacía, 0 errores de compilación)*
- **Salida de error (`stderr`):** *(vacía)*
- **Estado:** ✅ Todo el código TypeScript compila de forma limpia y estricta sin discrepancias de tipos.

---

### 4.2 Catálogo Completo Expuesto por `desktop_commander` (`tools/list`)

Llamada directa JSON-RPC al método `tools/list` del servidor `desktop_commander`:
- **Total herramientas expuestas:** 25 herramientas.
- **Herramientas activas e integradas en el Manifest de Jarvis (11):** `read_file`, `read_multiple_files`, `write_file`, `create_directory`, `list_directory`, `move_file`, `start_search`, `get_more_search_results`, `start_process`, `read_process_output`, `interact_with_process`.
- **Herramientas adicionales disponibles en el servidor (14):**
  1. `get_config`: Consulta la configuración del servidor (bloqueos, shell, telemetría, límites).
  2. `set_config_value`: Establece claves de configuración en caliente.
  3. `write_pdf`: Creación/modificación de archivos PDF.
  4. `stop_search`: Cancela una sesión de búsqueda activa.
  5. `list_searches`: Lista búsquedas en progreso.
  6. `get_file_info`: Metadata detallada de archivo o carpeta.
  7. `edit_block`: Edición quirúrgica de bloques en archivos.
  8. `force_terminate`: Terminación forzada de una sesión de terminal.
  9. `list_sessions`: Lista sesiones de terminal activas.
  10. `list_processes`: Lista procesos del sistema.
  11. `kill_process`: Finaliza un proceso por su PID.
  12. `get_usage_stats`: Estadísticas de uso y telemetría.
  13. `get_recent_tool_calls`: Historial reciente de llamadas locales a herramientas.
  14. `give_feedback_to_desktop_commander`: Formulario de feedback en navegador.

---

### 4.3 Catálogo Completo Expuesto por `free_search` (`tools/list`)

Llamada directa JSON-RPC al método `tools/list` del servidor `free_search`:
- **Total herramientas expuestas:** 11 herramientas.
- **Herramientas activas e integradas en el Manifest de Jarvis (3):** `search`, `fetch`, `fetch_batch`.
- **Herramientas adicionales disponibles en el servidor (8):**
  1. `read_doc`: Lectura de documentos locales o HTTP (PDF, DOCX) a Markdown.
  2. `research`: Investigación one-shot que combina búsqueda y descarga de las principales fuentes.
  3. `paper_graph`: Análisis y rastreo de citaciones de papers académicos.
  4. `cache_search`: Búsqueda de texto completo sobre páginas indexadas en SQLite FTS5 local.
  5. `engines`: Lista los motores de búsqueda soportados y su clasificación.
  6. `compare`: Descarga concurrente y comparación cruzada de 2 a 5 URLs.
  7. `extract_structured`: Extracción de metadatos enriquecidos (JSON-LD, OpenGraph, microdatos).
  8. `download`: Descarga persistente de archivos binarios/instaladores a disco.


---

## 5. Definiciones Reales de las 14 Herramientas Catalogadas (`tools/list`)

A continuación se documentan las definiciones oficiales extraídas directamente mediante `tools/list` de cada servidor MCP (incluyendo `description` e `inputSchema` completos originales sin resumir).

### 5.1 Análisis Técnico del Parámetro `write_file.content` y Hallazgo D-08

> **Hallazgo D-08 (Discrepancia de tipo en `write_file.content`):**
> - **Esquema de Entrada (`inputSchema`):** Declara estrictamente:
>   ```json
>   "content": {
>     "type": "string"
>   }
>   ```
> - **Documentación de la Herramienta (`description`):** Especifica para hojas de cálculo Excel (`.xlsx`, `.xls`, `.xlsm`):
>   ```text
>   FORMAT HANDLING (by extension):
>   - Text files: String content
>   - Excel (.xlsx, .xls, .xlsm): JSON 2D array or {"SheetName": [[...]]}
>     Example: '[["Name","Age"],["Alice",30]]'
>   ```
> - **Causa Raíz e Impacto:** El servidor MCP espera siempre un `string`. Si el modelo LLM intenta emitir una estructura o array nativo de JSON (p. ej. `"content": [["A", 1]]`), la llamada es rechazada inmediatamente por el validador JSON Schema (`type: string`). A la inversa, si el modelo simplemente escribe texto plano en un archivo `.xlsx`, el backend de Desktop Commander falla al parsear el contenido.
> - **Resolución en Jarvis:** En `src/core/tools/manifest.ts`, el manifest inyecta la nota obligatoria para guiar al modelo:
>   ```typescript
>   notes: {
>     content: 'Text of the file. For .xlsx/.xls/.xlsm: a JSON string of a 2D array of rows, e.g. [["Name","Age"],["Alice",30]], or of an object {"SheetName": [[...]]}.'
>   }
>   ```

### 5.2 `desktop_commander.read_file`

```json
{
  "name": "read_file",
  "description": "\n                        Read contents from files and URLs.\n                        Read PDF files and extract content as markdown and images.\n                        \n                        Suitable for reading authorized local files directly without starting a shell command.\n                        \n                        Supports partial file reading with:\n                        - 'offset' (start line, default: 0)\n                          * Positive: Start from line N (0-based indexing)\n                          * Negative: Read last N lines from end (tail behavior)\n                        - 'length' (max lines to read, default: configurable via 'fileReadLineLimit' setting, initially 1000)\n                          * Used with positive offsets for range reading\n                          * Ignored when offset is negative (reads all requested tail lines)\n                        \n                        Examples:\n                        - offset: 0, length: 10     → First 10 lines\n                        - offset: 100, length: 5    → Lines 100-104\n                        - offset: -20               → Last 20 lines  \n                        - offset: -5, length: 10    → Last 5 lines (length ignored)\n                        \n                        Performance optimizations:\n                        - Large files with negative offsets use reverse reading for efficiency\n                        - Large files with deep positive offsets use byte estimation\n                        - Small files use fast readline streaming\n                        \n                        When reading from the file system, only works within allowed directories.\n                        Can fetch content from URLs when isUrl parameter is set to true\n                        (URLs are always read in full regardless of offset/length).\n                        \n                        FORMAT HANDLING (by extension):\n                        - Text: Uses offset/length for line-based pagination\n                        - Excel (.xlsx, .xls, .xlsm): Returns JSON 2D array\n                          * sheet: \"Sheet1\" (name) or \"0\" (index as string, 0-based)\n                          * range uses FROM:TO format (e.g., \"A1:D100\", \"C1:C1\", \"B2:B50\")\n                          * offset/length work as row pagination (optional fallback)\n                        - Images (PNG, JPEG, GIF, WebP): Base64 encoded viewable content\n                        - PDF: Extracts text content as markdown with page structure\n                          * offset/length work as page pagination (0-based)\n                          * Includes embedded images when available\n                        - DOCX (.docx): Two modes depending on parameters:\n                          * DEFAULT (no offset/length): Returns a text-bearing outline — shows paragraphs with text,\n                            tables with cell content, styles, image refs. Skips shapes/drawings/SVG noise.\n                            Each element shows its body index [0], [1], etc.\n                          * WITH offset/length: Returns raw pretty-printed XML with line pagination.\n                            Use this to drill into specific sections or see the actual XML for editing.\n                          * Raw DOCX XML output is compatible with edit_block's XML find/replace mode using\n                            XML fragments copied from the read output.\n                          * Raw XML mode requires a non-zero offset (offset=1 starts from line 1).\n                            offset=0 returns the outline regardless of length.\n                          * Bulk transformations can be performed programmatically against the DOCX archive\n                            when the task requires changes across many XML text nodes.\n\n                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      },
      "isUrl": {
        "type": "boolean",
        "default": false
      },
      "offset": {
        "type": "number",
        "default": 0
      },
      "length": {
        "type": "number",
        "default": 1000
      },
      "sheet": {
        "type": "string"
      },
      "range": {
        "type": "string"
      },
      "options": {
        "type": "object",
        "additionalProperties": {}
      },
      "origin": {
        "type": "string",
        "enum": [
          "ui",
          "llm"
        ]
      }
    },
    "required": [
      "path"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.read_multiple_files`

```json
{
  "name": "read_multiple_files",
  "description": "\n                        Read the contents of multiple files simultaneously.\n                        \n                        Each file's content is returned with its path as a reference.\n                        Handles text files normally and renders images as viewable content.\n                        Recognized image types: PNG, JPEG, GIF, WebP.\n                        \n                        Failed reads for individual files won't stop the entire operation.\n                        Only works within allowed directories.\n                        \n                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "paths": {
        "type": "array",
        "items": {
          "type": "string"
        }
      }
    },
    "required": [
      "paths"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.write_file`

```json
{
  "name": "write_file",
  "description": "\n                        Write or append to file contents.\n\n                        PDF creation is handled by the dedicated write_pdf tool.\n                        Existing DOCX content can be edited with edit_block. New DOCX files can be created here; markdown headings (#, ##, ###) are converted to styled DOCX paragraphs.\n\n                        CHUNKED WRITES:\n                        - Repeated calls with mode='rewrite' followed by mode='append' are supported for longer files.\n                        - Chunks of roughly 25-30 lines minimize latency when writing long text, multiple files, documentation, code, or configuration files.\n                        - Files over 50 lines are still written successfully but may generate performance notes.\n                        - For continuation after a partial write, the existing file state can be inspected before appending the remaining content.\n\n                        FORMAT HANDLING (by extension):\n                        - Text files: String content\n                        - Excel (.xlsx, .xls, .xlsm): JSON 2D array or {\"SheetName\": [[...]]}\n                          Example: '[[\"Name\",\"Age\"],[\"Alice\",30]]'\n\n                        Only works within allowed directories.\n\n                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      },
      "content": {
        "type": "string"
      },
      "mode": {
        "type": "string",
        "enum": [
          "rewrite",
          "append"
        ],
        "default": "rewrite"
      },
      "origin": {
        "type": "string",
        "enum": [
          "ui",
          "llm"
        ]
      }
    },
    "required": [
      "path",
      "content"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.create_directory`

```json
{
  "name": "create_directory",
  "description": "\n                        Create a new directory or ensure a directory exists.\n                        \n                        Can create multiple nested directories in one operation.\n                        Only works within allowed directories.\n                        \n                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      }
    },
    "required": [
      "path"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.list_directory`

```json
{
  "name": "list_directory",
  "description": "\n                        Get a detailed listing of all files and directories in a specified path.\n                        \n                        Returns a structured directory listing without starting a shell command.\n                        Results distinguish between files and directories with [FILE] and [DIR] prefixes.\n                        \n                        Supports recursive listing with the 'depth' parameter (default: 2):\n                        - depth=1: Only direct contents of the directory\n                        - depth=2: Contents plus one level of subdirectories\n                        - depth=3+: Multiple levels deep\n                        \n                        CONTEXT OVERFLOW PROTECTION:\n                        - Top-level directory shows ALL items\n                        - Nested directories are limited to 100 items maximum per directory\n                        - When a nested directory has more than 100 items, you'll see a warning like:\n                          [WARNING] node_modules: 500 items hidden (showing first 100 of 600 total)\n                        - This prevents overwhelming the context with large directories like node_modules\n                        \n                        Results show full relative paths from the root directory being listed.\n                        Example output with depth=2:\n                        [DIR] src\n                        [FILE] src/index.ts\n                        [DIR] src/tools\n                        [FILE] src/tools/filesystem.ts\n                        \n                        If a directory cannot be accessed, it will show [DENIED] instead.\n                        If a path does not exist, it will show [NOT_FOUND] instead.\n                        Only works within allowed directories.\n                        \n                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      },
      "depth": {
        "type": "number",
        "default": 2
      },
      "origin": {
        "type": "string",
        "enum": [
          "ui",
          "llm"
        ]
      }
    },
    "required": [
      "path"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.move_file`

```json
{
  "name": "move_file",
  "description": "\n                        Move or rename files and directories.\n                        \n                        Can move files between directories and rename them in a single operation.\n                        Both source and destination must be within allowed directories.\n                        \n                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "source": {
        "type": "string"
      },
      "destination": {
        "type": "string"
      }
    },
    "required": [
      "source",
      "destination"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.start_search`

```json
{
  "name": "start_search",
  "description": "\n                        Start a streaming search that can return results progressively.\n                        \n                        SEARCH STRATEGY GUIDE:\n                        Choose the right search type based on what the user is looking for:\n                        \n                        USE searchType=\"files\" WHEN:\n                        - User asks for specific files: \"find package.json\", \"locate config files\"\n                        - Pattern looks like a filename: \"*.js\", \"README.md\", \"test-*.tsx\" \n                        - User wants to find files by name/extension: \"all TypeScript files\", \"Python scripts\"\n                        - Looking for configuration/setup files: \".env\", \"dockerfile\", \"tsconfig.json\"\n                        \n                        USE searchType=\"content\" WHEN:\n                        - User asks about code/logic: \"authentication logic\", \"error handling\", \"API calls\"\n                        - Looking for functions/variables: \"getUserData function\", \"useState hook\"\n                        - Searching for text/comments: \"TODO items\", \"FIXME comments\", \"documentation\"\n                        - Finding patterns in code: \"console.log statements\", \"import statements\"\n                        - User describes functionality: \"components that handle login\", \"files with database queries\"\n                        \n                        AMBIGUOUS SEARCHES:\n                        Queries that could refer to either filenames or file contents can be covered with two\n                        searches: one with searchType=\"files\" and one with searchType=\"content\".\n                        Example: \"find authentication stuff\" can pair a filename search for \"auth\" with a\n                        content search for \"authentication\".\n                        \n                        SEARCH TYPES:\n                        - searchType=\"files\": Find files by name (pattern matches file names)\n                        - searchType=\"content\": Search inside files for text patterns\n                        \n                        PATTERN MATCHING MODES:\n                        - Default (literalSearch=false): Patterns are treated as regular expressions\n                        - Literal (literalSearch=true): Patterns are treated as exact strings\n                        \n                        literalSearch=true is useful for code patterns with special characters:\n                        - Function calls with parentheses and quotes\n                        - Array access with brackets\n                        - Object methods with dots and parentheses\n                        - File paths with backslashes\n                        - Any pattern containing: . * + ? ^ $ { } [ ] | \\ ( )\n                        \n                        IMPORTANT PARAMETERS:\n                        - pattern: What to search for (file names OR content text)\n                        - literalSearch: Use exact string matching instead of regex (default: false)\n                        - filePattern: Optional filter to limit search to specific file types (e.g., \"*.js\", \"package.json\")\n                        - ignoreCase: Case-insensitive search (default: true). Works for both file names and content.\n                        - earlyTermination: Stop search early when exact filename match is found (optional: defaults to true for file searches, false for content searches)\n                        \n                        DECISION EXAMPLES:\n                        - \"find package.json\" → searchType=\"files\", pattern=\"package.json\" (specific file)\n                        - \"find authentication components\" → searchType=\"content\", pattern=\"authentication\" (looking for functionality)\n                        - \"locate all React components\" → searchType=\"files\", pattern=\"*.tsx\" or \"*.jsx\" (file pattern)\n                        - \"find TODO comments\" → searchType=\"content\", pattern=\"TODO\" (text in files)\n                        - \"show me login files\" → AMBIGUOUS → run both: files with \"login\" AND content with \"login\"\n                        - \"find config\" → AMBIGUOUS → run both: config files AND files containing config code\n                        \n                        COMPREHENSIVE SEARCH EXAMPLES:\n                        - Find package.json files: searchType=\"files\", pattern=\"package.json\"\n                        - Find all JS files: searchType=\"files\", pattern=\"*.js\"\n                        - Search for TODO in code: searchType=\"content\", pattern=\"TODO\", filePattern=\"*.js|*.ts\"\n                        - Search for exact code: searchType=\"content\", pattern=\"toast.error('test')\", literalSearch=true\n                        - Ambiguous request \"find auth stuff\": Run two searches:\n                          1. searchType=\"files\", pattern=\"auth\"\n                          2. searchType=\"content\", pattern=\"authentication\"\n                        \n                        Ambiguous requests can combine file-name and content searches for broader coverage.\n                        \n                        This tool starts a background search process and returns immediately with a session ID.\n                        Results are available through get_more_search_results, and stop_search can end the search early.\n                        \n                        Perfect for large directories where you want to see results immediately and\n                        have the option to cancel if the search takes too long or you find what you need.\n                        \n                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      },
      "pattern": {
        "type": "string"
      },
      "searchType": {
        "type": "string",
        "enum": [
          "files",
          "content"
        ],
        "default": "files"
      },
      "filePattern": {
        "type": "string"
      },
      "ignoreCase": {
        "type": "boolean",
        "default": true
      },
      "maxResults": {
        "type": "integer",
        "minimum": 0
      },
      "includeHidden": {
        "type": "boolean",
        "default": false
      },
      "contextLines": {
        "type": "integer",
        "minimum": 0,
        "default": 5
      },
      "timeout_ms": {
        "type": "integer",
        "minimum": 0
      },
      "earlyTermination": {
        "type": "boolean"
      },
      "literalSearch": {
        "type": "boolean",
        "default": false
      },
      "origin": {
        "type": "string",
        "enum": [
          "ui",
          "llm"
        ]
      }
    },
    "required": [
      "path",
      "pattern"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.get_more_search_results`

```json
{
  "name": "get_more_search_results",
  "description": "\n                        Get more results from an active search with offset-based pagination.\n                        \n                        Supports partial result reading with:\n                        - 'offset' (start result index, default: 0)\n                          * Positive: Start from result N (0-based indexing)\n                          * Negative: Read last N results from end (tail behavior)\n                        - 'length' (max results to read, default: 100)\n                          * Used with positive offsets for range reading\n                          * Ignored when offset is negative (reads all requested tail results)\n                        \n                        Examples:\n                        - offset: 0, length: 100     → First 100 results\n                        - offset: 200, length: 50    → Results 200-249\n                        - offset: -20                → Last 20 results\n                        - offset: -5, length: 10     → Last 5 results (length ignored)\n                        \n                        Returns only results in the specified range, along with search status.\n                        Works like read_process_output - call this repeatedly to get progressive\n                        results from a search started with start_search.\n                        \n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sessionId": {
        "type": "string"
      },
      "offset": {
        "type": "integer",
        "default": 0
      },
      "length": {
        "type": "integer",
        "minimum": 1,
        "default": 100
      }
    },
    "required": [
      "sessionId"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.start_process`

```json
{
  "name": "start_process",
  "description": "\n                        Start a terminal process on the authorized device with intelligent state detection.\n                        \n                        Suitable for shell commands, interactive REPL sessions, data-processing scripts,\n                        programmatic file analysis, and other long-running terminal work.\n                        \n                        Running on Windows. Default shell: powershell.exe.\n        \nWINDOWS-SPECIFIC TROUBLESHOOTING:\n- If Node.js/Python commands fail with \"not recognized\" errors:\n  * Alternative shells include \"cmd\" and \"powershell.exe\"\n  * PowerShell may have execution policy restrictions for some tools\n  * CMD typically has better compatibility with development tools\n  * defaultShell can be changed with set_config_value if needed\n- Windows services and processes use different commands (Get-Process vs ps)\n- Package managers: choco, winget, scoop instead of apt/brew\n- Environment variables: $env:VAR instead of $VAR\n- File permissions work differently than Unix systems\n                        \n                        Examples:\n                        • start_process(\"python3 -i\") → Start an interactive Python REPL\n                        • start_process(\"node -i\") → Start an interactive Node.js REPL\n                        • start_process(\"node:local\") → Run stateless Node.js code on the MCP server\n                        • start_process(\"wc -l /path/file.csv\") → Run a one-shot shell command\n\n                        Interactive process sessions support follow-up input after they are started.\n                        Long-running process sessions expose newly available output while they remain active.\n                        Binary files can be processed with appropriate command-line tools or libraries available\n                        in the selected process environment.\n\n                        SMART DETECTION:\n                        - Detects REPL prompts (>>>, >, $, etc.)\n                        - Identifies when a process is waiting for input\n                        - Recognizes process completion vs timeout\n                        - Early exit prevents unnecessary waiting\n                        \n                        STATES DETECTED:\n                        Process waiting for input (shows prompt)\n                        Process finished execution\n                        Process running (use read_process_output)\n\n                        PERFORMANCE DEBUGGING (verbose_timing parameter):\n                        Set verbose_timing: true to get detailed timing information including:\n                        - Exit reason (early_exit_quick_pattern, early_exit_periodic_check, process_exit, timeout)\n                        - Total duration and time to first output\n                        - Complete timeline of all output events with timestamps\n                        - Which detection mechanism triggered early exit\n\n                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string"
      },
      "timeout_ms": {
        "type": "number"
      },
      "shell": {
        "type": "string"
      },
      "verbose_timing": {
        "type": "boolean"
      },
      "origin": {
        "type": "string",
        "enum": [
          "ui",
          "llm"
        ]
      }
    },
    "required": [
      "command",
      "timeout_ms"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.read_process_output`

```json
{
  "name": "read_process_output",
  "description": "\n                        Read output from a running process with file-like pagination support.\n                        \n                        Supports partial output reading with offset and length parameters (like read_file):\n                        - 'offset' (start line, default: 0)\n                          * offset=0: Read NEW output since last read (default, like old behavior)\n                          * Positive: Read from absolute line position\n                          * Negative: Read last N lines from end (tail behavior)\n                        - 'length' (max lines to read, default: configurable via 'fileReadLineLimit' setting)\n                        \n                        Examples:\n                        - offset: 0, length: 100     → First 100 NEW lines since last read\n                        - offset: 0                  → All new lines (respects config limit)\n                        - offset: 500, length: 50    → Lines 500-549 (absolute position)\n                        - offset: -20                → Last 20 lines (tail)\n                        - offset: -50, length: 10    → Start 50 from end, read 10 lines\n                        \n                        OUTPUT PROTECTION:\n                        - Uses same fileReadLineLimit as read_file (default: 1000 lines)\n                        - Returns status like: [Reading 100 lines from line 0 (total: 5000 lines, 4900 remaining)]\n                        - Prevents context overflow from verbose processes\n                        \n                        SMART FEATURES:\n                        - For offset=0, waits up to timeout_ms for new output to arrive\n                        - Detects REPL prompts and process completion\n                        - Shows process state (waiting for input, finished, etc.)\n                        \n                        DETECTION STATES:\n                        Process waiting for input (ready for interact_with_process)\n                        Process finished execution\n                        Timeout reached (may still be running)\n\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pid": {
        "type": "number"
      },
      "timeout_ms": {
        "type": "number"
      },
      "offset": {
        "type": "number"
      },
      "length": {
        "type": "number"
      },
      "verbose_timing": {
        "type": "boolean"
      }
    },
    "required": [
      "pid"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `desktop_commander.interact_with_process`

```json
{
  "name": "interact_with_process",
  "description": "\n                        Send input to an existing terminal or REPL process and return newly available output.\n                        \n                        Useful for interactive shells, Python/Node/R/Julia REPLs, database consoles,\n                        and long-running commands started with start_process().\n                        \n                        Examples:\n                        - Interactive Python REPL sessions can be started with `python3 -i`.\n                        - Existing interactive sessions accept additional input such as imports or analysis commands.\n                        - Interactive sessions can return newly available output while they remain active.\n                        \n                        SMART DETECTION:\n                        - Automatically waits for a recognized prompt when requested\n                        - Detects errors and completion states\n                        - Early exit prevents unnecessary waiting\n                        - Cleans common REPL prompt text from returned output\n                        \n                        PARAMETERS:\n                        - pid: Process ID returned by start_process\n                        - input: Text or command to send to the process\n                        - timeout_ms: Maximum wait time (default: 8000ms)\n                        - wait_for_prompt: Whether to wait for a prompt before returning (default: true)\n                        - verbose_timing: Include detailed timing telemetry (default: false)\n\n                        Returns execution result with status indicators.\n\n                        PERFORMANCE DEBUGGING (verbose_timing parameter):\n                        When enabled, detailed timing includes:\n                        - Exit reason\n                        - Total duration and time to first output\n                        - Timeline of output events\n\n                        This command can be referenced as \"DC: ...\" or \"use Desktop Commander to ...\" in your instructions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pid": {
        "type": "number"
      },
      "input": {
        "type": "string"
      },
      "timeout_ms": {
        "type": "number"
      },
      "wait_for_prompt": {
        "type": "boolean"
      },
      "verbose_timing": {
        "type": "boolean"
      }
    },
    "required": [
      "pid",
      "input"
    ],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

### 5.2 `free_search.search`

```json
{
  "name": "search",
  "description": "Run a multi-engine web search and return a ranked, deduplicated link list.\n\nBest for:\n- Discovery queries (\"what is X\", \"find me X\", \"who is X\").\n- Getting a list of URLs you can hand to `fetch` / `fetch_batch` next.\n- Topics likely to be after your knowledge cutoff (use `freshness=\"week\"`).\n- Filtering to specific domains (`include_domains=[\"python.org\"]`) or\n  a kind of source (`category=\"paper\"` / `\"finance\"`, or a sub-group like\n  `category=\"paper.biomed\"` / `\"finance.filings\"`; see `engines()` for the\n  full tree).\n- Looking a fact up at its registry, with no category needed: a current\n  version or support end date (\"latest fastapi version\"), a CVE\n  (\"CVE-2024-3094\": NVD record, OSV advisories, CISA exploited status),\n  a forecast (\"上海明天天气\"), an exchange rate (\"100 usd to cny\": ECB, and\n  the PBOC parity for 人民币), a coin price, a country indicator (\"china\n  gdp\", \"japan population\"), public holidays (\"2026年放假安排\"), the current\n  time in a city, a domain's expiry, a company's legal entity, an iOS\n  app's version, Wikidata facts (\"Shanghai population\"). The source that\n  fits the words joins the search and its record arrives as the first\n  result with the publisher's date in `dated …`, so it can be cited\n  without a fetch. Name the thing plainly. `category=` (\"software\",\n  \"security\", \"weather\", \"finance.fx\", \"stats\", \"calendar\", \"reference\",\n  \"docs\", \"gov\") asks the same sources explicitly.\n\nNot recommended for:\n- You already know the URL -> use `fetch` instead.\n- You want both links AND their full text in one call -> use `research`.\n- You want to query pages already in the local cache -> use `cache_search`.\n- Reading PDFs/DOCX from a known URL -> use `read_doc`.\n- Following one paper's references or citations -> use `paper_graph`.\n\nReturns:\n- markdown (default): numbered list of `n. title`, `<url>`, snippet. About 40%\n  fewer tokens than json.\n- json: dict with `results` (list of {title,url,snippet,engines,score}),\n  `engines`, `cached`, optional `errors` map, optional `hint` string.\n  `engines` is what was actually ASKED for this answer; each result's own\n  `engines` is what found it. A default engine that failed recently is not\n  asked and appears under `benched_engines` instead; a rescue pass that\n  substituted a source appears as `rescued_via`.\n\nCommon mistakes:\n- Answering from snippets. A snippet is an engine's summary of a page as it\n  looked when crawled: it drops qualifiers and is often years old. Use\n  `search` to find the URL, then read the page (`fetch`, `research`) for\n  any date, amount, rule, deadline or number you will state.\n- Treating a result as recent because `freshness=` was set. The filter keeps\n  undated results; the header says how many could be dated (`dated: 3/10`)\n  and each result is marked `dated …`, `… (from snippet text)` or `undated`.\n- Passing a URL as `query`: that is `fetch`'s job.\n- Cranking `max_results` up hoping for better recall; engines cap around\n  10-20 each, anything beyond is duplicate noise (and 50 is the ceiling).\n- Naming engines by default. The default pool is already the set that works\n  keylessly over plain HTTP, it benches an engine that starts failing and\n  seats a reserve when it gets thin, and naming engines switches all of\n  that, and `category=` routing, off. Name engines when you want a\n  specific index: `engines=[\"so360\",\"baidu\"]` for Chinese-language sites,\n  `engines=[\"brave\"]` or `[\"startpage\"]` (both need the browser) for a\n  second opinion.\n- Using `category=\"news\"` for breaking news without also setting\n  `freshness=\"day\"`: the index lags by days.\n\nArgs:\n    query: Natural-language query (the same string a human would type).\n    engines: Subset of `engines()`. None (recommended) = the health-aware\n        default pool: duckduckgo, bing, anysearch and mojeek, plus\n        googlenews when `freshness` is \"day\"/\"week\" and a Chinese index for\n        a Chinese query.\n    max_results: Merged result count after dedup, clamped to 1-50. It is\n        also the PER-ENGINE budget, so it multiplies across the fan-out;\n        5-20 is the useful range and anything past that is duplicate noise\n        bought with real latency. Omit it for the configured default.\n    use_cache: Reuse the last result for this exact (query, engines,\n        max_results, AND all active filters: freshness, include/exclude\n        domains, category, include/exclude text) within the cache TTL.\n        Changing any filter is a different cache entry. False forces a\n        re-fetch.\n    max_age_hours: Treat cached results older than this as a read miss; a\n        fresh result is ALWAYS written back to the cache regardless of this\n        value, so caching is never disabled. Use 0 to force-refresh while\n        keeping cache writes; None = use server default TTL (7 days).\n    freshness: \"day\"|\"week\"|\"month\"|\"year\". Restricts to recent results.\n        Best-effort: applied as an engine time-window param AND a client-side\n        date check, but most HTML-engine results carry no parseable date, so\n        undated results are kept rather than dropped (unknown != old). Treat\n        it as a strong hint, not a hard filter; googlenews dates are exact.\n    include_domains: List of domains to restrict to (e.g. [\"python.org\"]).\n    exclude_domains: List of domains to exclude.\n    category: Which KIND of source to search. The enum lists every value.\n        A bare group widens: \"paper\" adds one specialist per sub-group to the\n        default web pool. A dotted sub-group narrows to just the sources that\n        index it (\"paper.biomed\" => the biomedical indexes only). It also\n        RERANKS: engines that natively index the category count double in\n        the fusion, so the filing outranks the commentary about it, and a\n        record looked up by the query (a PyPI release, a CVE, an ECB rate,\n        a forecast) counts five times, so it leads the list. Call\n        `engines()` for the group -> sub-group -> engine tree with a line on\n        each source. Two behaviours worth knowing: \"image\"/\"dataset\" REPLACE\n        the web pool rather than augment it (a web engine cannot return an\n        image file), and \"news\"/\"paper\"/\"forum\"/\"github\"/\"blog\" also filter\n        general-web hits by hostname, so a strict category can thin those\n        engines out. The specialists it routes to are exempt.\n    include_text: Substring required in title or snippet (case-insensitive).\n    exclude_text: Substring forbidden in title or snippet.\n    format: \"markdown\" (default) or \"json\".\n",
  "inputSchema": {
    "properties": {
      "query": {
        "title": "Query",
        "type": "string"
      },
      "engines": {
        "anyOf": [
          {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Engines"
      },
      "max_results": {
        "default": 10,
        "title": "Max Results",
        "type": "integer"
      },
      "use_cache": {
        "default": true,
        "title": "Use Cache",
        "type": "boolean"
      },
      "max_age_hours": {
        "anyOf": [
          {
            "type": "number"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Max Age Hours"
      },
      "freshness": {
        "anyOf": [
          {
            "enum": [
              "day",
              "week",
              "month",
              "year"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Freshness"
      },
      "include_domains": {
        "anyOf": [
          {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Include Domains"
      },
      "exclude_domains": {
        "anyOf": [
          {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Exclude Domains"
      },
      "category": {
        "anyOf": [
          {
            "enum": [
              "news",
              "pdf",
              "github",
              "paper",
              "forum",
              "blog",
              "image",
              "dataset",
              "finance",
              "software",
              "security",
              "reference",
              "weather",
              "docs",
              "gov",
              "stats",
              "calendar",
              "news.world",
              "paper.index",
              "paper.preprint",
              "paper.biomed",
              "paper.cs",
              "paper.math",
              "paper.openaccess",
              "paper.trial",
              "dataset.repository",
              "dataset.ml",
              "dataset.gov",
              "finance.filings",
              "finance.market",
              "finance.macro",
              "finance.fx",
              "finance.entity",
              "finance.crypto",
              "software.lifecycle",
              "software.github",
              "software.python",
              "software.node",
              "software.rust",
              "software.registry",
              "software.app",
              "security.cve",
              "security.package",
              "security.exploited",
              "reference.domain",
              "docs.web",
              "docs.rfc",
              "gov.us",
              "gov.uk",
              "stats.indicator",
              "calendar.holidays",
              "calendar.clock"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Category"
      },
      "include_text": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Include Text"
      },
      "exclude_text": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Exclude Text"
      },
      "format": {
        "default": "markdown",
        "enum": [
          "markdown",
          "json"
        ],
        "title": "Format",
        "type": "string"
      }
    },
    "required": [
      "query"
    ],
    "type": "object",
    "title": "searchArguments"
  }
}
```

### 5.2 `free_search.fetch`

```json
{
  "name": "fetch",
  "description": "Fetch one URL: page text, or a description of a non-text resource.\n\nHandles any http(s) resource, not just HTML:\n- HTML pages -> reader-mode Markdown (nav/footer/scripts stripped).\n- PDF/DOCX/XLSX/PPTX/EPUB/CSV/code/archives -> parsed text (same engine as\n  `read_doc`, which you should prefer when you need pagination).\n- Images, video, audio, fonts, opaque binaries -> a description\n  (media type, byte size, dimensions, sha256), NOT the bytes.\n\nBest for:\n- You already have a URL (from `search`, the user, or your own knowledge)\n  and need the actual page text.\n- Verifying a single claim by reading the source.\n- Checking what a resource IS before deciding to spend tokens on it.\n\nNot recommended for:\n- Multiple URLs at once -> use `fetch_batch` (concurrent, one round-trip).\n- \"Search then read top N\" -> use `research` (one call, not two).\n- Long documents you need to page through -> use `read_doc` (start/length).\n- You don't have a URL yet -> use `search` first.\n\nReturns:\n- markdown (default): a small header (URL, render method, token count)\n  plus the cleaned page body.\n- json: {url, title, content, method, truncated, tokens_estimated,\n  author, published_date, sitename}, plus {media_type, bytes_size, sha256,\n  width, height} for non-text resources.\n- With `inline=True` on an image: the image itself, viewable by a\n  vision-capable model.\n\nCommon mistakes:\n- Passing a search query instead of a URL.\n- Using `render=\"http\"` on a JS-only SPA: it returns near-empty content;\n  use \"auto\" (default) or \"browser\".\n- Setting `inline=True` on a large image out of habit. A 1MB image costs\n  well over a thousand tokens; fetch it plainly first and inline only if\n  the description says it's worth looking at.\n- Forgetting that results are cached 7 days: use `force_refresh=True`\n  or `max_age_hours=0` for a fresh pull. The header says `cached N days ago`\n  when you are not looking at the live page; for deadlines, prices and\n  anything else that moves, that is the cue to refresh.\n- Reading `no publication date found` as \"recent\". It means unknown.\n\nArgs:\n    url: Absolute http(s) URL.\n    render: \"auto\" (try HTTP, fall back to stealth Chromium), \"http\"\n        (fast, fails on JS), \"browser\" (slow, robust).\n    force_refresh: Bypass the page cache entirely.\n    max_age_hours: Treat cached pages older than this as a miss. 0 = same\n        as force_refresh. None = server default TTL (7 days).\n    inline: For images only. Returns the image itself instead of a\n        description, so a vision-capable model can see it. Ignored for\n        text resources.\n    format: \"markdown\" or \"json\".\n",
  "inputSchema": {
    "properties": {
      "url": {
        "title": "Url",
        "type": "string"
      },
      "render": {
        "default": "auto",
        "enum": [
          "auto",
          "http",
          "browser"
        ],
        "title": "Render",
        "type": "string"
      },
      "force_refresh": {
        "default": false,
        "title": "Force Refresh",
        "type": "boolean"
      },
      "max_age_hours": {
        "anyOf": [
          {
            "type": "number"
          },
          {
            "type": "null"
          }
        ],
        "default": null,
        "title": "Max Age Hours"
      },
      "inline": {
        "default": false,
        "title": "Inline",
        "type": "boolean"
      },
      "format": {
        "default": "markdown",
        "enum": [
          "markdown",
          "json"
        ],
        "title": "Format",
        "type": "string"
      }
    },
    "required": [
      "url"
    ],
    "type": "object",
    "title": "fetchArguments"
  }
}
```

### 5.2 `free_search.fetch_batch`

```json
{
  "name": "fetch_batch",
  "description": "Fetch a list of URLs in parallel. Per-URL failures do not raise.\n\nBest for:\n- 2+ URLs you want to read in one round-trip.\n- Reading the top N results of a previous `search` call.\n\nNot recommended for:\n- A single URL -> `fetch` (no list-wrapping overhead).\n- \"Search and then read\" -> `research` collapses both into one tool call.\n- PDFs/DOCX -> `read_doc` per file.\n\nReturns:\n- markdown (default): each page rendered as a Markdown section, separated\n  by horizontal rules; failed URLs become inline error notes.\n- json: list[dict], one entry per URL, with `error` set on failures.\n\nCommon mistakes:\n- Passing a single URL inside a 1-element list: use `fetch` directly.\n- Assuming an exception means the whole batch failed; check each item's\n  `error` field instead.\n\nArgs:\n    urls: List of absolute http(s) URLs (max 20 per call).\n    render: Same as `fetch`.\n    format: \"markdown\" or \"json\".\n",
  "inputSchema": {
    "properties": {
      "urls": {
        "items": {
          "type": "string"
        },
        "title": "Urls",
        "type": "array"
      },
      "render": {
        "default": "auto",
        "enum": [
          "auto",
          "http",
          "browser"
        ],
        "title": "Render",
        "type": "string"
      },
      "format": {
        "default": "markdown",
        "enum": [
          "markdown",
          "json"
        ],
        "title": "Format",
        "type": "string"
      }
    },
    "required": [
      "urls"
    ],
    "type": "object",
    "title": "fetch_batchArguments"
  }
}
```

