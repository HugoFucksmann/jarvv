# Conclusiones · Variantes Pending

## 1. Lo que no funciona
- **Prompts extensos con múltiples ejemplos:** El modelo qwen3.5:4b tiende a sobreajustarse o repetir ejemplos cuando la instrucción contiene demasiadas restricciones secundarias.
- **Instrucciones que no marcan claramente qué hacer ante fallas (`FAIL`):** Hacen que el modelo repita el mismo paso fallido en lugar de formular un objetivo alternativo en lenguaje natural.

## 2. Lo que sí funciona
- **Variante `pending_focused_elite` (Nueva Ganadora Absoluta):**
  - **83.1% de pass rate global (64/77)** frente a 80.5% de prod (**+2.6% de mejora neta**).
  - En `llm_gemai` alcanzó un impresionante **87.5% (14/16 casos)** (+31.3% de mejora sobre el 56.3% de prod).
  - En `llm_pending_hard` obtuvo **89.7%** con 265ms p50 (-22ms más rápida).
  - Clave técnica: Unión de la supresión de `TODAY:` con el etiquetado visual explícito `### COMPLETED TASKS (DONE):` y `### FAILED TASKS (REPLACE IN PENDING):`.

- **Variante `pending_tiny_focused`:**
  - Logró 80.5% - 83.1% global con aceleración de latencia consistente.

## 3. Lo que se puede probar
- Ajustar la presentación de `DONE` y `FAIL` en el prompt de usuario para que qwen3.5 distinga con mayor nitidez entre acciones ya ejecutadas y tareas restantes.


## Rondas 10 (2026-11-09) · pending (thinking=off)
Datasets: `llm_pending`, `llm_pending_hard`, `llm_gemai` (77 casos). Base: `pending_focused_elite`.
- R1: `prod` 81,8 %; `pending_focused_elite` 80,5 %; `pending_elite_labels` 84,4 %; `pending_elite_prodsys` 79,2 %.
- R2: `prod` 79,2 %; `pending_elite_labels` 81,8 %; `pending_elite_labels_today` 79,2 %; `pending_elite_labels_full` 83,1 %.
- Conclusión: con las reglas de hoy, `pending_focused_elite` ya no supera a prod (80,5 vs 81,8 %). Rotular **todas** las secciones (PENDING, DONE, FAIL, USER) mejora en las dos rondas (+2,6 y +2,6) y rotular también REQUEST y STATE llega a +3,9; usar el SYSTEM de prod con los rótulos (`prodsys`) o volver a poner `TODAY` borra la ganancia. Mejor: `pending_elite_labels` (replicada) y `pending_elite_labels_full` (más alta, una medición).
