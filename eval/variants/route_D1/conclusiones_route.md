
## Rondas 10 (2026-11-09) · route
Dataset: `route_D1` (31 casos × 2 repeticiones). Base: `route_direct`.
- R1: `prod` 100 %, `route_direct` 100 %, `route_lean` 100 %, `route_lean_direct` 100 % (p50 46-50 ms).
- R2: `route_lean_direct` 100 %; `route_min` 93,8 % y `route_min_marks` 93,8 % (-6,2 %: 2 regresiones, 0 mejoras).
- Conclusión: la etapa está saturada, no hay margen de mejora en accuracy. Sacar `Expected` y `Environment` del estado no cuesta nada (`route_lean_direct`); sacar además `Done` sí cuesta (`route_min*`). Mejor: `route_lean_direct` (igual a prod en accuracy, estado más corto). Sin evidencia para cambiar `src` por precisión.
