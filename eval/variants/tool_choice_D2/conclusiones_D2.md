
## Rondas 10 (2026-11-09) · tool_choice
Dataset: `tool_choice_16_cases` (16 casos × 2 repeticiones). Base: `tool_choice_direct`.
- R1: `prod` 87,5 %; `tool_choice_direct` 100 %; `tool_choice_lean` 87,5 %; `tool_choice_lean_direct` 100 %.
- R2: `tool_choice_direct_nofail` 100 %; `tool_choice_lean_direct_expected` 100 %.
- Conclusión: la mejora (+12,5 %, casos `tool-004` y `tool-014`) viene de la **instrucción** ("Choose the tool that directly accomplishes the step instruction."), no del estado ni de las marcas de fallo: `tool_choice_lean`, que conserva la instrucción de prod, se queda en 87,5 %. Cuatro variantes empatan al 100 %; la más simple es `tool_choice_direct_nofail` (criterios planos). Con 16 casos el dataset ya no discrimina más.
