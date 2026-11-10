# Conclusiones · Variantes Arguments

## 1. Lo que no funciona
- **Uso de expresiones hashtable `@{...}` en pipelines:** En PowerShell provoca errores sintácticos inmediatos (`Falta el operador '='`) detectados por el pre-chequeo estático. Intentar crear expresiones calculadas complejas o asignar variables inline (`@{PSVariable...}`) rompe el parser.
- **Operador de encadenamiento `&&`:** Windows PowerShell 5.1 no soporta `&&`. Reemplazarlo por punto y coma `;` o banderas de herramienta resolvió 3 fallas inmediatas.
- **Comas en FilterHashtables:** En hashtables de PowerShell (`@{LogName='System',Level=2}`) usar coma `,` en lugar de punto y coma `;` genera error de sintaxis `Falta una expresión después de ','`.
- **Concatenación compleja de strings con llamadas a cmdlets sin paréntesis:** Expresiones tipo `... + Split-Path $_.Name` en vez de `+ (Split-Path $_.Name)` o usar `Rename-Item` provocan errores de parsing con el operador `+`.
- **Falta de ruta completa en la instrucción del paso:** Cuando el paso solo dice `reemplazar el contenido de todo.txt` sin especificar la carpeta, el modelo inventa `C:\Users\hugof\Documents\todo.txt` y el pre-chequeo rechaza la palabra `todo` como placeholder.

## 2. Lo que sí funciona
- **Variantes `args_ps_perfect` y `args_ps_elite` (Validadas con 2 repeticiones completas):**
  - **98.8% de pass rate global (162/164 ejecuciones pasadas)** frente a 81.7% de prod (**+17.1% de mejora neta, p < 0.001**).
  - **100% de efectividad en comandos de terminal (`llm_arguments_cmd`): 100/100 ejecuciones pasadas** vs 74.0% de prod (**+26.0% de mejora directa**).
  - **96.9% en casos difíciles (`llm_arguments_hard`): 62/64 ejecuciones pasadas**, logrando el techo teórico del dataset (el único caso que falla es `args-hard-007` por defecto del dataset).
  - **0 regresiones** y **16 mejoras netas**.
  - Reglas clave:
    1. Prohibición tajante de `&&` (usar siempre `;`).
    2. Prohibición de script blocks y tablas hash `@{...}` dentro de pipelines de `Measure-Object`, `Sort-Object` y `Select-Object`.
    3. Uso de `-Property` directo para ordenar (`Sort-Object -Property ... -Descending`) y medir (`Measure-Object -Property ... -Sum`).
    4. Separación con `;` en hashtables nativos (como `-FilterHashtable`).

## 3. Lo que se puede probar
- **Promover a producción:** Aplicar las reglas de `args_ps_perfect` / `args_ps_elite` directamente en `src/core/models/prompts.ts` (`ARGUMENTS_VIEW.SYSTEM`), ya que se alcanzó el 100% de efectividad en comandos de PowerShell y 98.8% global comprobado con múltiples repeticiones.
