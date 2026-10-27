# Evaluación de dataset_v2: Prompts Originales vs Prompts v2 sobre D3 (GPU)

Este documento contiene los resultados obtenidos al ejecutar el nuevo dataset **`dataset_v2.jsonl`** (44 casos diseñados con trampas complejas de rutas relativas, inversión de argumentos, mensajes de éxito falsos y logs extensos) contra **`d3:2b` en GPU (RTX 3070 Ti)** evaluando:
1. **Prompts Originales** (`prompts.ts`): V0, V0b, V1, V1-3, V3, P0.
2. **Prompts Nuevos v2** (`prompts2.ts`): R1 a R11.

---

## 1. Métricas Globales Comparativas

| Variante | Set de Prompt | Accuracy | Falsos Aprobados (Crítico) | Falsos Rechazados | Latencia Media |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **V0_original** | `prompts.ts` | 86.4% | 6 / 44 | 0 / 44 | ~132 ms |
| **V0b_original** (S+) | `prompts.ts` | 79.5% | 9 / 44 | 0 / 44 | ~73 ms |
| **V1_original** (Choice 6) | `prompts.ts` | **88.6%** | **5 / 44** | **0 / 44** | ~48 ms |
| **V1_original-reverse** | `prompts.ts` | 86.4% | 5 / 44 | 1 / 44 | ~48 ms |
| **V1-3_original** (Choice 3) | `prompts.ts` | 86.4% | 6 / 44 | 0 / 44 | ~44 ms |
| **V3_original** (4 noul) | `prompts.ts` | 81.8% | 7 / 44 | 1 / 44 | ~142 ms |
| **P0_original** (Pre-ejecución)| `prompts.ts` | **86.4%** | **5 / 44** | **1 / 44** | ~29 ms |
| --- | --- | --- | --- | --- | --- |
| **R1_V0_clipHT** | `prompts2.ts` | 86.4% | 6 / 44 | 0 / 44 | ~71 ms |
| **R2_V0_preguntasB** | `prompts2.ts` | 77.3% | 8 / 44 | 2 / 44 | ~73 ms |
| **R3_V0_preambuloB** | `prompts2.ts` | 84.1% | 6 / 44 | 1 / 44 | ~82 ms |
| **R4_V3_targetsS4** | `prompts2.ts` | 79.5% | 7 / 44 | 2 / 44 | ~155 ms |
| **R5_V3_B** (5 noul estrictas)| `prompts2.ts` | 70.5% | **1 / 44** | 12 / 44 | ~198 ms |
| **R6_V3_C** (3 noul mínimas) | `prompts2.ts` | 70.5% | **1 / 44** | 12 / 44 | ~122 ms |
| **R7_V1_3_B** | `prompts2.ts` | 81.8% | 8 / 44 | 0 / 44 | ~46 ms |
| **R7_V1_3_B-reverse** | `prompts2.ts` | 86.4% | 5 / 44 | 1 / 44 | ~46 ms |
| **R8_V1_3_C** (Choice estricto)| `prompts2.ts` | **88.6%** | **5 / 44** | **0 / 44** | ~49 ms |
| **R8_V1_3_C-reverse** | `prompts2.ts` | **88.6%** | **5 / 44** | **0 / 44** | ~48 ms |
| **R9_V1_B** | `prompts2.ts` | 84.1% | 7 / 44 | 0 / 44 | ~55 ms |
| **R10_Preguntas_Negativas** | `prompts2.ts` | **88.6%** | **5 / 44** | **0 / 44** | ~121 ms |
| **R11_P_B** (Pre-ejecución) | `prompts2.ts` | 84.1% | 5 / 44 | 2 / 44 | ~38 ms |
| **R11_P_C** (Pre-ejecución) | `prompts2.ts` | 84.1% | 5 / 44 | 2 / 44 | ~41 ms |

---

## 2. Hallazgos sobre el Nuevo Dataset v2

1. **Mayor Dificultad del Dataset v2**:
   - Mientras el dataset v1 alcanzaba un 94–96%, `dataset_v2` puso a prueba casos límites de alta ambigüedad (rutas con `..`, nombres en plural/singular como `log` vs `logs`, comandos que terminan en exit 0 pero con warnings, etc.), situando el techo de precisión en **88.6%**.
2. **Las Variantes más Fuertes en Post-Ejecución**:
   - **`V1_original`**, **`R8_V1_3_C`** y **`R10_Preguntas_Negativas`** empatan como las más sólidas con un **88.6% de exactitud y 0 falsos rechazos**.
   - `R8_V1_3_C` (choice de 3 opciones con criterio exigente de no aprobar sin evidencia positiva) demostró ser inmune al sesgo posicional: sacó **88.6% idéntico** tanto en orden estándar como invertido (`reverse`).
3. **Mínimos Falsos Aprobados a Costa de Rigidez**:
   - Las variantes **`R5_V3_B`** y **`R6_V3_C`** prácticamente erradicaron los falsos aprobados (**solo 1 fallo en 44 casos**), pero son excesivamente punitivas (12 falsos rechazos) al exigir evidencia inequívoca de PID y bytes en operaciones donde la salida del sistema es naturalmente escueta.
