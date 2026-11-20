# Fuentes reales para armar datasets (extraídas de `jarvis-traces/`, 7 a 19 de noviembre de 2026)

`jarvis-traces/` no se versiona (contiene datos de ejecución), así que estos archivos son lo que un agente fuera de la PC del usuario puede leer. Todos son JSON UTF-8. **No traen el veredicto de la verificación ni la probabilidad de ningún modelo a propósito**: quien etiquete tiene que decidir lo correcto sin ver lo que pasó.

| Archivo | Contenido | Sirve para |
|---|---|---|
| `pedidos_reales.json` | 124 pedidos distintos del usuario (`pedido`, `veces`, `primer_dia`). Incluye charla, una acción, varias acciones y tipeos reales | `d0` (etiquetar `chat`/`single`/`multi`) |
| `pares_continuacion_reales.json` | 39 pares (`tarea_anterior`, `respuesta_anterior`, `pedido_nuevo`) tal como los vio la consulta de continuación. Casi todos son independientes | `continuation` |
| `pasos_reales.json` | 161 pasos distintos tal como los produjo `pending` (`paso`) con su `pedido` original | `route` (D1) |
| `llamadas_reales.json` | 290 llamadas (`pedido`, `paso`, `ruta`, `herramienta`, `tipo`, `estado`, `args`, `resumen` recortado a 1200 caracteres). El `estado` es el de la herramienta (`ok`, `tool_error`, `loop_blocked`…), no el veredicto | `tool_choice` (D2) y `result_verification` (D4) |

Notas: el `resumen` es lo que vio el motor, no el resultado completo. La ruta y la herramienta son lo que **eligió el sistema**, que muchas veces fue un error: no son la respuesta correcta. Los pedidos con rutas `C:\Users\hugof\…` son del equipo de desarrollo y los datasets existentes usan esas mismas rutas.
