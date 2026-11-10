# Conclusiones · Variantes Question

## 1. Lo que no funciona
- **Instrucciones ultra-resumidas que omiten el manejo de datos de opciones (`question_tiny`):** Provoca pérdida de las opciones presentadas en `DATA`, cayendo a 94.4% o 87.8% global frente al 90.5% - 98.1% de `prod`.
- **Falta de referencia explícita a qué hacer con `REJECTED`:** Si no se enfatiza preguntar por el argumento faltante que causó el rechazo, el modelo formula preguntas genéricas en lugar de puntuales.

## 2. Lo que sí funciona
- **Prompt `prod` y `question_short`:**
  - Mantienen entre 90.5% y 98.1% de pass rate según la dificultad del dataset.
  - Ofrecen opciones cuando `DATA` las lista y piden el valor exacto faltante si hubo llamada rechazada.
- **Variante `question_objective`:**
  - En escenarios complejos (`llm_question_hard`) alcanzó **96.2%** superando el 92.3% de prod.
  - Formulación concisa pero estructurada: prohíbe respuestas tentativas, acciones internas o filtración de IDs internos.

## 3. Lo que se puede probar
- Optimizar la vista de usuario (`buildUserPrompt`) reduciendo ruido de pasos previos o formateando `REJECTED` y `DATA` con mayor prominencia visual.


## Rondas 10 (2026-11-09) · question (thinking=off)
Datasets: `llm_question`, `llm_question_hard`, `llm_question_gemai` (74 casos). Base: `prod`.
- R1: `prod` 91,9 %; `question_clean_view` 89,2 %; `question_prod_dedup` 89,2 %; `question_prod_trailer` 91,9 %.
- R2: `prod` 90,5 %; `question_prod_trailer` 91,9 %; `question_short_trailer` 91,9 %; `question_prod_trailer2` **94,6 %** (4 mejoras, 1 regresión).
- Conclusión: recortar la vista (quitar `TASK` repetida) no ayuda; agregar al final de la entrada un recordatorio con el formato y lo prohibido sí (`trailer2`: "Write the single question now, in the language of GOAL. Ask only for the missing value; do not mention tools, ids or internal steps."). Mejor: `question_prod_trailer2` (+4,1 % sobre prod; p=0,38, a confirmar con más casos).
