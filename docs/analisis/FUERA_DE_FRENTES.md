# Hallazgos fuera de los tres frentes

> 2026-11-13. Detectados al revisar trazas, prompts y código para los frentes 1 a 3. Ordenados por impacto.

## Estado (2026-11-14)

Leyenda: ✅ hecho · ⚠ parcial · ⏸ pendiente · ❌ descartado o revertido.

| Punto | Estado |
|---|---|
| 1. Cadena que produce los bucles | ⏸. La causa de las trazas del 12 de noviembre (`pending` perdía «en la terminal») está atenuada por D0 «una acción». Sigue abierto `list_directory` con `depth: 0` («Directorio vacío.»: lo devuelve el servidor de Desktop Commander, no está en nuestro código) |
| 2. Regla de `shell` en argumentos | ✅ (DN-2.3) |
| 3. Información desactualizada presentada como actual | ⏸ (visto otra vez el 14/11 con «Gemini 4 Carbon») |
| 4. D5 cierra tareas incompletas | ⏸ |
| 4a. D3 aprueba rutas inventadas; el pre-chequeo solo mira lecturas | ⏸ (el punto de seguridad más claro que queda) |
| 4b. Ninguna pregunta de hechos abre un paso | ⚠ D0 «una acción» las manda a búsqueda; DN-2.5 sigue apagada |
| 5. Relleno de la respuesta final | ✅ por código (`finalClean.ts`) |
| 6. Laboratorio (thinking `auto`, carpetas vacías, latencias, sin etapa D5, dos corridas a la vez) | ⚠ etapa `d0` agregada; el resto ⏸ |
| 7. Archivos dejados en el repositorio | actualizado abajo |
| 8. Menores | ⏸. El comentario de `buildResultVerification` ya no es falso: D4 dejó de recibir `Previous approved calls` |

**Hallazgo nuevo (2026-11-14), de la VRAM:** los dos modelos traen un proyector de visión (676 y 671 MB) que no se usa; con ellos no caben residentes a la vez en 8 GB y cada cambio de modelo costaba ~1 s. Variantes sin proyector: tarea simulada de 4 659 a 1 071 ms. Ver `docs/OLLAMA_MODELOS_TEXTO.md`.

## 1. La cadena que produce las tareas en bucle

Traza «ejecutá en la terminal: Get-ChildItem C:\Windows | Select-Object -First 5 | Format-Table Name,FullName» (30 consultas, 28,7 s, `failed`):

1. `pending` reescribió el pedido como un objetivo y perdió «en la terminal» y el comando.
2. D1 eligió `files` (0,83).
3. `list_directory` con `depth: 0` devolvió «Directorio vacío.» para `C:\Windows`. El resultado es engañoso: la carpeta no está vacía.
4. Con `depth: 2` devolvió 1 436 entradas y D4 lo rechazó por «sin datos utilizables» (`ok` 0,55). Falso rechazo.
5. El generador repitió los mismos argumentos 6 veces; cada repetición quedó `loop_blocked`.
6. `pending` reescribió el ítem con el mismo texto 3 veces.

Cada eslabón tiene propuesta en otro documento (literal directo al argumento, quitar la ruta fallida, verificación por código, cortes de repetición). Falta uno: **el resultado de `list_directory` con `depth: 0`**. Conviene revisar el extractor o fijar una profundidad mínima de 1.

## 2. Una regla del prompt de argumentos induce argumentos inválidos

La línea «If the tool has a shell parameter, set it to "powershell"» va para todas las herramientas. En la misma traza el modelo agregó `shell` a `list_directory` y la salida fue inválida («parámetro no definido en el schema: shell»). La variante `ctx_args_by_tool` del Frente 2 la deja solo para herramientas con comando.

## 3. Información desactualizada presentada como actual

En «Busca el ultimo modelo de GPT y gemini», `web_search` devolvió para Gemini un pasaje sobre 2.5 Pro con fecha de publicación 2023 y estado `partial`. D4 lo aprobó con 0,91 y la respuesta final lo dio como «último modelo». Otra traza del mismo día respondió «Gemini 4 Carbon». Ni D4 ni la respuesta final usan la fecha de la fuente contra la fecha de hoy. Mínimo sin modelos: cuando el pedido dice «último» o «actual», que el código agregue a la respuesta la fecha de la fuente más reciente.

## 4. D5 cierra tareas incompletas en casos sintéticos

Al quitar la última llamada de 6 cierres reales de dos o más llamadas, D5 siguió aprobando 2 de 6 con el umbral de 0,75. Son pocos casos, pero es un falso cierre silencioso. Refuerza medir D5 con un dataset propio antes de ampliarlo.

## 4a. D3 aprueba rutas inventadas, y el pre-chequeo solo mira lecturas

Medido sobre el formato de producción de D3 con 5 escrituras cuya ruta no sale de ningún lado (`D:\proyectos\facturacion\backup`, `C:\Users\Juan\Documents\Fotos`, `E:\datos\reportes\Reportes`…): `approved` entre 0,93 y 0,95 en todas (0/5 rechazadas). El pre-chequeo sí rechaza rutas sin origen, pero `checkSources` (`precheck.ts`) solo comprueba las URLs, las rutas de herramientas de **lectura** y las claves de origen (`source`); el destino de una escritura no se comprueba. Con `autoMode` encendido, la única barrera de una escritura con una ruta inventada es D3, que no la detecta. Con `autoMode` apagado la salva la confirmación del usuario. Propuesta de código, sin modelos: extender la comprobación de «ruta con origen» a las escrituras cuyo destino esté fuera de las carpetas conocidas (se relaciona con la aprobación por niveles, idea 5 de `JARVIS_EVALUACION.md`).

## 4b. Con la regla de hoy, ninguna pregunta de hechos abre un paso de búsqueda

Medido con 12 preguntas («cuál es el último modelo de Claude», «quién ganó el mundial 2022», «cuánto está el dólar hoy», «cuál es la capital de Australia»…): `pending` devolvió lista vacía en las 12 (0/12 abren un paso), porque su regla manda a lista vacía «questions about general knowledge». Un 4B no tiene conocimiento fiable ni actual: responde de memoria. Propuesta y medición en `FRENTE_2_CONTEXTO.md` (DN-2.5).

## 5. La respuesta final abre con una frase de relleno

«No changes were made to the system» aparece al principio de respuestas a simples preguntas. La causa es la regla «Clearly report any changes … or specify that no changes were made» junto con la línea `EFFECTS: none`. Ver DN-2.10.

## 6. Laboratorio de evaluación

- **Corre con pensamiento encendido si no se le indica lo contrario.** `--thinking` vale `auto` por defecto. Para corridas rápidas: `--thinking=off`.
- **Crea una carpeta por cada dataset aunque el filtro de etapa lo deje en 0 casos.** Una corrida de una etapa deja unas 50 carpetas vacías en `eval/results/`.
- **Sus latencias no representan producción** (ya anotado en `JARVIS_EVALUACION.md`): mide con concurrencia y sin alternar modelos.
- **No hay etapa para D5 ni para D0.** Los casos de cierre viven en `eval/exp/close_check.ts`, fuera de los datasets.
- **Dos corridas a la vez se estorban.** Una corrida de la respuesta final que quedó viva en segundo plano llevó cada llamada de la siguiente de 1,5 s a 20 s. Si una corrida se interrumpe, hay que comprobar que el proceso terminó.

## 7. Archivos que dejé en el repositorio

- `eval/variants/ctx/ctx_args_by_tool.ts`, `ctx_d4_norecent.ts`, `ctx_final_clean.ts` y `ctx_pending_facts.ts`: variantes del laboratorio usadas en el Frente 2. No tocan `src`.
- Carpetas de resultados en `eval/results/qwen3.5_4b/2026-11-13_*` y `2026-11-14_*` (están ignoradas por git).
- `docs/analisis/`: estos cuatro documentos y `d0_casos_ejemplo.jsonl`.
- Pruebas nuevas: `tests/memory.test.ts`, `tests/thread.test.ts`, `tests/decision_memo.test.ts`, `tests/final_clean.test.ts`, `tests/warmup.test.ts`.
- Laboratorio: `eval/datasets/D0/` (de otro agente), `eval/datasets/arguments/args_blocked_repeat.jsonl` y `eval/variants/ctx/ctx_final_nofiller.ts`.
- En Ollama: `d3:2b-text-cpu` (solo sirvió para una prueba; `ollama rm d3:2b-text-cpu`).

## 8. Menores

- `ERROR_PREVIO: tu respuesta anterior fue inválida…` está en español dentro de prompts en inglés (`retryNote`).
- El comentario de `buildResultVerification` dice «sin contexto de llamadas previas», pero el código agrega `Previous approved calls`.
- Durante las pruebas había un servidor de JARVIS corriendo (`npm run dev`); no lo toqué. Comparte la GPU con cualquier corrida del laboratorio.
