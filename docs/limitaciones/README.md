# Limitaciones de los modelos de Jarvis

Una ficha por modelo, porque intervienen dos y no responden lo mismo:

| Ficha | Modelo | Qué hace en el flujo |
|---|---|---|
| [qwen-3.5-4b.md](./qwen-3.5-4b.md) | Qwen 3.5 4B (`qwen3.5:4b`), generativo | La lista de pendientes (`pending`), los argumentos, la pregunta al usuario y la respuesta final |
| [d3-2b.md](./d3-2b.md) | d3:2b, decisión | D1 (ruta), D2 (herramienta), D3 (revisión de argumentos), D4 (verificación) y la Decisión 5 (cierre) |

La selección de herramientas (D1 y D2) depende de **d3:2b**, no de Qwen.

## Qué no es una limitación (causa nuestra, ya medida)

Un caso no entra en las fichas si se explicaba por nuestras instrucciones, configuración o flujo. Esto es lo que se descartó:

1. **«ejecutá en la terminal: robocopy …» terminaba en `files`.** Dos causas del flujo, no del modelo:
   - `pending` borraba la pista: su regla «what to obtain or change, never how (no commands, tools or code)» dejaba la meta en «Copiar archivos …», sin «terminal» ni el comando, y D1 y D2 solo veían esa meta (la meta conservaba la pista en 4 a 5 de 16 solicitudes).
   - La pregunta de D1 («Which route should handle the next action?») acertaba 10/16 de las solicitudes con terminal explícita.
   - **Qué se cambió en `src`:** D1 recibe la línea `Request:` y la pregunta «Where should this step run?» con la regla de seguir lo que el paso diga sobre dónde o cómo hacerlo. A/B con el eval: 81,6 % → 91,3 % sobre 196 casos (p = 0,002); terminal explícita 80,5 % → 91,5 % y, con la meta que escribe `pending`, 75,6 % → 92,7 %. Costo: 4 casos de los datasets previos de D1.
2. **D2 elegía `list_directory` o `move_file`.** No era un error de D2: D1 había mandado a `files` una meta que no tiene herramienta, y D2 elige entre lo que hay (22/22 dentro de la ruta correcta).
3. **`pending` no devolvía lista vacía en saludos** (3 de 6 casos). Se resolvió con una línea en el prompt (6/6).
4. **Copiar tomado por mover en D4.** Se resolvió con una frase condicionada a pasos de mover o renombrar (de 2/8 a 5/8). El resto del problema sí es del modelo: ver [d3-2b.md](./d3-2b.md).

## Cómo se midió

- `eval/exp/first_query.ts` (primera consulta de `pending`), `eval/exp/select_tools.ts` (D1, D2 y la cadena solicitud → `pending` → D1) y `eval/exp/close_check.ts` (cierre de la tarea). Resultados en `eval/results/_exp/` (no versionados).
- Datasets nuevos para vigilar el comportamiento: `eval/datasets/route_D1/route_terminal_explicit.jsonl` y `route_terminal_goals.jsonl` (D1), `eval/datasets/d4/verify_copy_move.jsonl` y `verify_expected_request_done.jsonl` (D4).
- Los casos de los experimentos los escribió una sola persona (yo) y las variantes se eligieron mirando un conjunto de desarrollo. Las diferencias de 2 casos entre corridas idénticas son ruido.
