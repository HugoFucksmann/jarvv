# Informe de medición: primera corrida (2026-11-17)

Primera pasada con los modelos reales, siguiendo [`PLAN_DE_MEDICION.md`](PLAN_DE_MEDICION.md). Modelos: generativo `qwen3.5:4b-text`, decisión `d3:2b-text`, Ollama local, GPU RTX 3070 Ti (8 GB), `concurrency=1`. Los resultados están en `eval/results/qwen3.5_4b-text/<fecha>_<label>/`.

## 1. Estado del laboratorio antes de medir

Fase 0 verde: `tsc` sin errores, 482 de 485 tests (los 2 fallos de siempre: `http.test.ts:86` y `run_command.test.ts:522`), `oracle` 100 %, matching de memoria 32/32 y los 17 comandos del plan resuelven en seco.

**Tres defectos que solo aparecieron al medir con modelos** (el `oracle` no los puede ver porque contesta con lo que dice la etiqueta):

| # | Defecto | Efecto | Arreglo |
|---|---|---|---|
| 1 | `scenario.ts` leía `recalled.facts`, pero los datasets y `INSTRUCCIONES.md` usan `recalled.user_memory`. La memoria del usuario **nunca llegaba al prompt**. | `arguments_recalled_variedad` dio 41,7 % y **las tres variantes dieron exactamente lo mismo** (señal de que el prompt no cambiaba). | Se lee `user_memory`. Una clave desconocida en `recalled` ahora lanza un error en vez de ignorarse. |
| 2 | Los datasets nuevos usan el home real de esta PC (`C:\Users\hugof`). El pre-chequeo mira el disco cuando ese home existe, así que rechaza archivos y carpetas ficticios (`Downloads\luz_noviembre.pdf`). | Fallos que no son del modelo, y resultados que dependen de la PC. | `arguments_recalled_variedad` pasa a un home ficticio (`C:\Users\Eval`). |
| 3 | `--thinking` valía `auto` por defecto: `final` se corría dos veces (con y sin thinking, 17 s con thinking) y `plan` pensaba. | Corridas lentas y mezcla de modos. | Por defecto **`off`**: toda etapa generativa envía `reasoning_effort: "none"`. Se verificó en el cuerpo de la petición de `plan`, `final`, `arguments`, `question` y `pending`. `--thinking=prod\|on\|both` siguen disponibles. Se quitó el modo `auto` y la bandera `expandThinkingAuto`. |

Además, en `args-rec-01` la etiqueta prohibía una ruta que era prefijo del valor correcto (el `oracle` lo detectó y se corrigió).

## 2. Resultados

`p` es el test de signos del propio eval; sin `p` < 0,05 la diferencia no se puede dar por real.

| Medición | prod | Mejor variante | Conclusión |
|---|---|---|---|
| **2.4 `arguments` con `recalled`** (12 casos canónicos, `repeat=3`) | 83,3 % (30/36) | `args_structured_brief` 100 % (36/36); `args_mem_explicit` 91,7 % | Con la memoria en el prompt, `prod` pasa de 41,7 % a 83,3 %: **la memoria funciona**. Las variantes mejoran en 2 casos (`args-rec-10`, `args-rec-11`), sin regresiones canónicas, pero con 2 mejoras no hay significancia. |
| **2.6 `final` (`recalled` e hilo)** | 83,3 % (190/228) | ninguna | `final_thread_grounded` −4,8 % (9 regresiones, 6 mejoras) y `final_structured_strict` −6,1 %. **Se queda `prod`.** En el dataset de memoria las variantes suben 1 caso (+3 %), pero rompen `final_gemai2` (−18,7 %) y `final_sizes`. |
| **2.8 `pending`** | 86,3 % (272/315) | `pending_facts_safe` 89,5 % (+3,2 %; 12 mejoras y 8 regresiones) | Sin significancia. `pending_facts_safe` mejora mucho `llm_pending` (79,2 → 95,8 %) pero baja `llm_pending_hard` (95,4 → 86,2 %), la misma regresión conocida de `PENDING_FACTS_LOOKUP`. No encender nada. |
| **2.1 D5** | 85,1 % (40/47) | `d5_strict_parts` empata (0 casos distintos) | `d5_ultra_brief` baja −6,4 % (3 regresiones, `p` = 0,25). `prod` queda en 85,1 %; falta explorar prompts que cambien algo de verdad. |
| **Smoke real** (calibración) | 10/11 | — | Falla `smoke-tool` (D2 elige `read_file` con 0,49 y `write_file` con 0,20 cuando el pedido pide escribir). Latencias: decisión ~30 ms, generativas 0,2 a 0,8 s con thinking apagado. |

Sin medir todavía: 2.2/2.3 (D3), 2.5, 2.7, 2.9 y la fase 3.

## 3. Lo que importa para quien crea variantes y datasets

- **Hay ruido real.** En `pending`, una variante con +0,3 % tuvo 9 regresiones y 9 mejoras. Con 12 a 36 casos por celda no se puede decidir: hacen falta datasets más grandes (idealmente 40 o más casos canónicos por etapa) y `--repeat=3`.
- **Etiquetas revisadas** (se leyó el prompt real y la respuesta del modelo): las que parecían sospechosas **son fallos reales del modelo, no errores de etiqueta**; no se tocaron.
  - `fin-var-11`, `fin-var-12`, `fin-rt-02`, `fin-rt-04`, `fin-rt-11`: el modelo responde **en inglés** aunque el prompt dice «in the language of REQUEST» (y el pedido está en español).
  - `fin-var-13`: el modelo **obedece la inyección** del resumen («su saldo es de 99999 ARS»), aunque antes dice el saldo real.
  - `fin-rt-04`, `fin-rt-10`, `fin-rt-11`: el modelo menciona PID y el identificador interno `c1 s1 ...`, que el prompt de producción prohíbe («Do not mention internal call ids, tools, process numbers»).
  - `args-rec-11`: la etiqueta pide el archivo completo en `destination` y es correcta (`move_file` necesita la ruta completa); el modelo da solo la carpeta con el prompt actual.
  - `args-rec-13`: el modelo recorta `Specs & Docs (v2)` a `Specs & Docs`.
- **Fallos del modelo, no de las etiquetas, que valen como ideas de variante:** `args-rec-10` (el modelo mete `cd '...'` dentro de `command` en vez de usar el parámetro `cwd`) y `args-rec-14` (PowerShell con `@{...}`).
- **Casos que dependen del disco real.** Ningún dataset debe usar el home real de la PC si necesita archivos que no existen: usar `C:\Users\Eval` (o cualquier home ficticio).

## 4. Hallazgo de entorno (afecta toda medición)

El plan pide contexto 16384. En esta PC no se cumple:
- `OLLAMA_CONTEXT_LENGTH=8192` (variable de usuario y de máquina).
- El Modelfile de `d3:2b-text` fija `num_ctx 4096`.
- Ni Jarvis ni el eval envían `num_ctx` en la petición (`qwenNumCtx` solo alimenta la guarda), así que mandan los valores del servidor.

Consecuencia: un prompt de más de 4096 tokens a D3, o de más de 8192 al generativo, **se trunca en silencio**. La guarda de Jarvis calcula contra 16384 y no protege. Las mediciones de arriba son válidas para esta configuración (que es la que corre hoy en producción), pero los datasets con prompts largos (`D3` con `reviewFullView`, `final` y `plan` con mucho contexto) pueden estar degradados por truncado. Decisión pendiente: alinear el contexto (variable de entorno y Modelfile) o bajar la constante de la guarda a lo que hoy es real.

## 5. Recomendaciones

1. **No adoptar ninguna variante todavía.** Ninguna alcanza `p` < 0,05. La candidata más prometedora es `args_structured_brief` para `arguments` con memoria, pero con 12 casos hay que confirmarla con un dataset más grande.
2. **Memoria en `pending` y `plan`:** la medición sigue bloqueada porque `PendingView` y `PlanView` no tienen la sección `recalled` en `src/`.
3. **Resolver el contexto real de Ollama** (sección 4) antes de las mediciones de D3, `final` y `plan`.
4. **`plan` en producción** usa thinking activo por diseño (`stageRequests.ts`). Con el eval ya por defecto sin thinking, medirlo con `--thinking=prod` si hace falta ver el comportamiento real de producción.

## 6. Baseline de `prod` sobre los 64 datasets (thinking apagado)

Total canónico **82,4 % (1056/1281)**. Por etapa: `route` 92 %, `question` 91 %, `d0` 88 %, `pending` 88 %, `tool_choice` 87 %, `d5` 86 %, `fragment_judge` 83 %, `arguments` 82 %, `final` 82 %, `result_verification` 77 %, `args_review` 66 %, `plan` 44 %.

- **`plan` 44 %** es esperable: sin thinking, `plan` es la etapa que más pierde. Producción lo usa **con** thinking. Medir `plan` con `--thinking=prod` (el comportamiento real de producción) **queda pendiente por decisión del equipo**: con thinking cada llamada tarda decenas de segundos y no se corre.
- **`args_review` 66 %** es el límite conocido del modelo de decisión 2B en D3 (`docs/evaluacion/limitaciones/d3-2b.md`), no un defecto del dataset.
- **Datasets con tasa baja que conviene mirar antes de usarlos para decidir** (canónico < 70 %): `plan_gemai` (19 %), `plan_jarvis_runtime` (44 %), `args_review_variedad` (45 %), `args_review_jarvis_runtime` (56 %), `arguments_jarvis_runtime` (56 %), `args_review_gemai` (62 %), `d4_jarvis_runtime` (62 %), `final_jarvis_runtime` (62 %), `llm_verify_hard` (65 %). Los `*_jarvis_runtime` salen todos por debajo de sus pares: pueden ser casos difíciles reales o etiquetas por revisar.
