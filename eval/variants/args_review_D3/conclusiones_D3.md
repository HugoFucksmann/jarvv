# Conclusiones · Variantes Args Review (D3)

## 1. Lo que no funciona
- **Criterios excesivamente rígidos o con demasiadas reglas negativas (`args_review_strict`, `args_review_precise`):** Tienden a sobre-rechazar herramientas válidas o penalizar comandos administrativos válidos provocando falsos positivos en `args_invalid` (caída de hasta -37.5% en datasets como `args_review_gemaiL`).
- **Contextos sobrecargados de observaciones irrelevantes:** Incluir lecturas crudas largas del entorno sin estructurar confunde a d3:2b al evaluar si los argumentos son lógicos respecto a la intención del paso.

## 2. Lo que sí funciona
- **Variante `args_review_compact`:**
  - **72.9% de pass rate global (35/48)** frente a 62.5% de prod (**+10.4% de mejora neta**).
  - En `args_review_16_cases` alcanzó **87.5%** (+31.3% vs prod), registrando 11 mejoras y reduciendo la latencia p50 a 45ms.
  - Reglas clave:
    1. Criterios concisos y directos: `approved` para llamadas válidas, lógicas y seguras; `args_invalid` enfocado en sintaxis malformada, rutas rotas, comandos destructivos no solicitados o valores inventados; `info_missing` acotado a credenciales o datos indispensables del usuario.
    2. Filtrar el bloque de estado a la intención del paso (`Target`), `User Input` y los datos del candidato (`Call` y `Args`).

## 3. Lo que se puede probar
- Incorporar de manera compacta `Previous Failures` o `Candidate Explanation` para discernir reintentos sin saturar la ventana de contexto de d3.


## Rondas 10 (2026-11-09) · args_review
Datasets: `args_review_16_cases`, `args_review_gemai`, `args_review_gemaiL` (47 casos × 2 repeticiones). Base: `args_review_compact_history`.
- R1: `prod` 62,5 %; `compact_history` 72,9 %; `compact_reads` 72,9 % (idéntica: las lecturas no cambian nada); `compact_prodopts` 58,3 % (estado compacto con los criterios de prod).
- R2: `compact_schema` 70,8 %; `compact_grounded` 54,2 % (-8,3 % vs prod).
- Conclusión: lo que ayuda a d3:2b son los **criterios cortos** de `compact` (con los de prod cae a 58,3 %); el estado compacto solo no alcanza. Criterios centrados en "origen del valor" (`grounded`) empeoran mucho, y sumar `Expected`, lecturas o schema no mejora. Toda la ganancia está en `args_review_16_cases` (56,3 → 87,5 %); en `gemai` y `gemaiL` no cambia nada. Mejor: `args_review_compact_history`.

> **Nota (retiro P-14):** Al retirar los campos no usados de `ReviewView` / `ReviewDecisionInput` (`stepsDone`, `done`, `lastReads`, `env`, `candidate.description`, `candidate.schema`), se retiraron los archivos experimentales `args_review_{compact_desc,compact_schema,compact_reads,permissive}.ts` que solo servían para medir esos campos descartados. Sus métricas históricas registradas arriba permanecen intactas como evidencia.
