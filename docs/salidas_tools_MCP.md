# Esquemas de salida — tools MCP de Jarvis

## desktop_commander

### list_directory
```
[FILE] {ruta_relativa}
[DIR] {ruta_relativa}
…
```

### read_file
Texto:
```
[Reading {n} lines from start|from line {offset} (total: {T} lines, {R} remaining)]

{contenido}
```
Offset negativo:
```
[Reading last {n} lines (total: {T} lines)]

{contenido}
```
Imagen (2 bloques): `Image file: {ruta} ({mime})` + bloque `image`.

PDF (1 + N bloques):
```
PDF file: {ruta} ({n} pages)
```
```
<!-- Page: {k} -->
{texto}
```

### read_multiple_files
Bloque 1:
```
{ruta}: {mime} (text)
…
```
Un bloque por archivo:
```

--- {ruta} contents: ---
[Reading {n} lines from start (total: {T} lines, {R} remaining)]

{contenido}
```

### write_file
```
Successfully wrote to {ruta} ({n} lines) 
Successfully appended to {ruta} ({n} lines) 
```
Primera línea con `mode=rewrite`; segunda con `mode=append`.

### create_directory
```
Successfully created directory {ruta}
```

### move_file
```
Successfully moved {origen} to {destino}
```

### start_search
```
Started {file|content} search session: {sessionId}
Pattern: "{pattern}"
Path: {ruta}
Status: RUNNING|COMPLETED
Runtime: {t}
Total results: {n} matches[ ({m} rows with context)]

[Initial results:
{líneas de resultado}]

🔄 Search in progress. Use get_more_search_results to get more results.
✅ Search completed.
```
Cierra con una de las dos últimas líneas, según el estado.

Líneas de resultado:
```
📁 {ruta}                       (searchType=files)
📄 {ruta}:{línea} - {texto}     (coincidencia, searchType=content)
   {ruta}:{línea} · {texto}     (contexto)
```

### get_more_search_results
```
Search session: {sessionId}
Status: RUNNING|COMPLETED
Runtime: {t}
Total results: {n} matches
Showing results {desde}-{hasta}

Results:
{líneas de resultado}

✅ Search completed.
```
`✅ Search completed.` solo si `Status: COMPLETED`.

### start_process
```
Process started with PID {pid} (shell: {shell})
Initial output:
{salida}

✅ Process {pid} has finished execution
⏳ Process is running. Use read_process_output to get more output.
🔄 Process {pid} is waiting for input (detected: "{prompt}")
```
Cierra con una de las tres últimas líneas.

### read_process_output
```
[Reading {n} new lines (total: {T} lines)]

{líneas nuevas}
[✅ Process completed with exit code {code} (runtime: {t})]
```
Última línea solo si el proceso terminó.

### interact_with_process
Con salida:
```
✅ Input executed in process {pid}:

📤 Output:
{salida}

🔄 Process {pid} is waiting for input (detected: "{prompt}")
```
Sin salida:
```
✅ Input executed in process {pid}.
📭 (No output produced)
🔄 Process {pid} is waiting for input (detected: "{prompt}")
✅ Process {pid} has finished execution
```
Cierra con una de las dos últimas líneas.

Con `wait_for_prompt=false`:
```
✅ Input sent to process {pid}. Use read_process_output to get the response.
```

## free_search

### search
```
# Search: {query}

_engines: {motores}_  _results: {n}_[  _dated: {k}/{n}_]
[_(requested but contributed nothing: {motores})_]
[_(from cache)_]

[> **Lead:** {texto}

]## {i}. {título}
<{url}>

[> {snippet}

]_{motores}_ · score {s}[ · {source_type}][ · {antigüedad}]

…
[---
**Engine errors (non-fatal):**
- {motor}: {error}]
[{notas y diagnósticos opcionales}]
```

### fetch
```
# {título}
<{url}>
_{sitename}[ · by {autor}] · published {fecha}|no publication date found_
_fetched via {método}_[ · ~{n} tokens][ · truncated][ · {retrieved}]

{contenido_markdown}
```

### fetch_batch
Un bloque `fetch` por URL, separados por:
```

---

```

---
`{x}` valor · `[ ]` opcional · `…` se repite · `a|b` una u otra.
Todas devuelven `content[]` de bloques `text`, sin `structuredContent`.