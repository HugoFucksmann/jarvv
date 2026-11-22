# Traza: lista las 5 tareas que mas ram esten consumiendo

- Tarea `task_1795377656186_t5nd` · modo **reactive** · estado **completed** · 5.0 s
- 1 pasos · 1 llamadas · 8 consultas a modelos (qwen3.5:4b-text y d3:2b-text)
- Código 9262375d3f · formato v3 · `trace.json` (liviana) y `full.json.gz` (completa, con entradas crudas)

## Alertas

- la tarea figura `completed` sin ninguna escritura aprobada (solo lecturas)

## Pasos y llamadas

### s1 · completed · lista las 5 tareas que mas ram esten consumiendo

- `c1` terminal/run_command (read) **ok** · approved · 1.0 s · D1 terminal 63% · D4 ok 1.00 · cumple 0.89
  - args: `{"command":"Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 Name, Id, WorkingSet64"}`
  - status: finished · exit code: 0 · duration: 1.0s · pid: 24448 · cwd: C:\Users\hugof The command finished successfully. Name Id WorkingSet64 ---- -- ------------ llama-server 11432…

## Consultas por etapa

- continuation: 1 · 0.0 s
- first_query: 1 · 0.1 s
- route: 1 · 0.1 s
- tool: 1 · 0.0 s
- args: 1 · 0.6 s
- verify: 1 · 0.1 s
- completion: 1 · 0.0 s
- final: 1 · 1.8 s

## Respuesta final

> Las 5 tareas que más RAM están consumiendo son:
> 1.
> **llama-server** (ID: 11432) con 2883948544 unidades de WorkingSet64.
> 2.
> **Memory Compression** (ID: 3344) con 1430183936 unidades de WorkingSet64.
> 3.
> **node** (ID: 29432) con 902774784 unidades de WorkingSet64.
> 4.
> **Antigravity IDE** (ID: 21328) con 754098176 unidades de WorkingSet64.
> 5.
> **llama-server** (ID: 9608) con 589320192 unidades de WorkingSet64.

