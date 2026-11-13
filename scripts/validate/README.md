# Scripts de validación de `run_command` y `web_search`

Sondas y un arnés con los que se validaron las dos herramientas propias (2026-11-10). **No son pruebas automáticas** (esas están en `tests/`): no afirman nada, ejecutan casos reales y muestran lo que ocurre, para mirarlo a ojo. Los hallazgos que salieron de ellas están en [`docs/REVISION_run_command.md`](../../docs/REVISION_run_command.md) y [`docs/REVISION_web_search.md`](../../docs/REVISION_web_search.md); cada sonda cita los números de hallazgo (`RC-xx`, `WS-xx`) que mira.

Se ejecutan desde la raíz del proyecto, con `tsx` (ya es dependencia). `npx tsc --noEmit` revisa los `.ts`.

| Script | Qué hace | Necesita |
| --- | --- | --- |
| `run_command_probe.ts` | Casos límite de `run_command` con PowerShell real: codificación (herramientas del sistema directo y por la tubería, Python), errores, prompts (`Read-Host`, `pause`, `python -i`, un avance que no es prompt), barras de progreso, entrada por `pid`, procesos en segundo plano, límites y entorno. `--big` suma 300 000 líneas de salida (~12 s). Actualizada el 2026-11-11 | Windows; Python para dos casos |
| `web_search_probe.ts` | Sin red: tokenización, lectura de una captura real de `search` y `fetch` (en `web_eval/captures2/`), rechazo de un formato distinto, limpieza y hosts internos. `--live` hace tres consultas reales y compara; `--judge` las repite con el 2B | `--live`: `uvx` y red. `--judge`: Ollama con el modelo de decisión |
| `tasks_e2e.ts` | Siete pedidos en lenguaje natural de punta a punta con los modelos reales (`autoMode` apagado, esperas contestadas por el propio script). El 7 (2026-11-11) es un proceso que pregunta dos veces. `--only=N`, `--judge` | Windows, Ollama (`qwen3.5:4b` y `d3:2b`), `uvx` y red |
| `powershell_launch_probe.mjs` | Cómo lanzar PowerShell sin que se rompan errores, código de salida ni tildes (`-EncodedCommand` frente a `-Command`, dónde calcular el código, página de códigos) y, desde el 2026-11-11, si el antivirus bloquea las ayudas metidas en base64 frente a leídas del archivo (parte 4: necesita haber usado `run_command` antes). Sin dependencias del proyecto | Windows |
| `web_eval/` | Evaluación de `web_search` con datos reales (41 casos): `capture.ts`/`capture2.ts` guardan respuestas de Free Search, `run.ts`/`run3.ts`/`ceiling.ts` comparan variantes sin red, `live.ts` prueba el proveedor real de punta a punta, `time.ts` mide latencia. Resultados y conclusiones: `web_eval/RESULTADOS.md` | capturas: `uvx` y red; `--judge`/`live.ts`: Ollama |

```bash
npx tsx scripts/validate/run_command_probe.ts
npx tsx scripts/validate/web_search_probe.ts
npx tsx scripts/validate/web_search_probe.ts --live --judge
npx tsx scripts/validate/web_eval/live.ts
npx tsx scripts/validate/tasks_e2e.ts --only=2 --judge
node scripts/validate/powershell_launch_probe.mjs
```

**Efectos secundarios.** `run_command_probe.ts` lanza procesos reales (`node`, `cmd /c pause`, `python -i`, `ping`, un servidor HTTP en el puerto 8765, `findstr`); los cierra al terminar. `run_command` (y por lo tanto la sonda y las pruebas) deja sus ayudas de PowerShell en `%TEMP%jarvis-terminalhelpers-*.ps1`: es a propósito, se reutilizan entre arranques. `tasks_e2e.ts` crea carpetas en `%TEMP%` (`jarvis_validacion*`) y una carpeta de refs temporal, y las borra al final. Ninguno toca `jarvis-config.json` (el arnés sobrescribe la configuración en memoria).

**Ruido.** Los modelos registran cada consulta en la consola (`[Qwen …]`, `[Decision …]`): en `tasks_e2e.ts` el resumen de cada tarea empieza en una línea de `====`.

**Si cambia Free Search.** Volver a capturar con `web_eval/capture2.ts --force` y correr `web_search_probe.ts` y `tests/web_search.test.ts`: `parseSearch` y `parseFetch` rechazan con la ruta del campo lo que no cumpla el contrato (`WS-05`).
