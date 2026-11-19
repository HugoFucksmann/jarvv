# Variantes de `recovery` con cuatro opciones (archivo histórico)

Son las 26 variantes que se probaron cuando `recovery` tenía cuatro acciones (`close`, `skip_continue`, `rewrite_item`, `replan`) y la pregunta `independent`. **Ya no se pueden correr**: se quitó `skip_continue` (un ítem existe porque el pedido lo necesita; si no se puede hacer, se cierra), así que el modelo que las usa devuelve una acción que la etapa ya no acepta. Están acá y no en `eval/variants/recovery/` para que el eval no las tome, y porque su evidencia (qué redacciones ayudaron y cuáles empeoraron) sigue en `eval/GUIA_DECISION.md`, sección 4. Compilan (la constante `RECOVERY_INDEPENDENT_KEY` quedó definida dentro de cada archivo) pero no están mantenidas.

Las variantes vigentes están en `eval/variants/recovery/`: `recovery_three_options`, `recovery_three_options_nobehind`, `recovery_three_options_examples`, `recovery_two_axes` y `recovery_rewrite_or_close`.
