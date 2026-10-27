# Comparativa: prompts2.ts vs prompts.ts sobre D3 (2B en GPU)

Este documento compara los resultados obtenidos con el set original de prompts (`prompts.ts`) frente a las nuevas variantes experimentales propuestas en `prompts2.ts` utilizando **`d3:2b` corriendo 100% en GPU (RTX 3070 Ti)**.

---

## 1. Tabla Comparativa de Variantes

| Corrida / Variante | Descripción | Accuracy | Falsos Aprobados (Peligrosos) | Falsos Rechazados | Latencia Media (GPU) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **V0 (Base Original)** | `ok` + `cumple` estándar | **96.3%** | 2 / 54 | 0 / 54 | ~45 ms |
| **V1 (Base Original)** | Choice 6 opciones estándar | **94.4%** | 2 / 54 | 1 / 54 | ~40 ms |
| **P0 (Base Original)** | Pre-ejecución choice estándar | **92.6%** | **0 / 54** | 4 / 54 | ~35 ms |
| --- | --- | --- | --- | --- | --- |
| **R1_V0_clipHT** | V0 con recorte cabeza + cola (`clipHT`) | **96.3%** | 2 / 54 | **0 / 54** | ~47 ms |
| **R2_V0_preguntasB** | Preguntas reformuladas para exigir evidencia | 85.2% | 7 / 54 | 1 / 54 | ~48 ms |
| **R3_V0_preambuloB** | V0 + Preámbulo de sistema auditor B | 92.6% | 4 / 54 | 0 / 54 | ~57 ms |
| **R4_V3_targetsS4** | 4 preguntas noul + Targets auto-extraídos | 92.6% | 3 / 54 | 1 / 54 | ~109 ms |
| **R5_V3_B** | 5 preguntas estrictas (`evidence_ok`, etc.) | 83.3% | 2 / 54 | 7 / 54 | ~139 ms |
| **R6_V3_C** | 3 preguntas mínimas (`target`, `content`, `evidence`) | 81.5% | 4 / 54 | 6 / 54 | ~87 ms |
| **R7_V1_3_B** | Choice 3 opciones con `unknown` refinado | 92.6% | 4 / 54 | 0 / 54 | ~34 ms |
| **R7_V1_3_B-reverse**| Inversión posicional de R7 | 94.4% | 3 / 54 | 0 / 54 | ~34 ms |
| **R8_V1_3_C** | Choice 3 opciones sesgado a no aprobar | 90.7% | 5 / 54 | 0 / 54 | ~37 ms |
| **R9_V1_B** | Choice 6 opciones refinado (unknown con ejemplos)| **94.4%** | 3 / 54 | 0 / 54 | ~43 ms |
| **R9_V1_B-reverse** | Inversión posicional de R9 | 92.6% | 4 / 54 | 0 / 54 | ~43 ms |
| **R10_Preguntas_Negativas** | **Polaridad inversa (pregunta por el error)** | **96.3%** | **1 / 54** | 1 / 54 | ~86 ms |
| **R11_P_B** | **Pre-ejecución con Targets extraídos (S4)** | **96.3%** | **0 / 54** | **2 / 54** | ~39 ms |
| **R11_P_C** | Pre-ejecución con regla de desempate estricta | 94.4% | 2 / 54 | 1 / 54 | ~42 ms |

---

## 2. Análisis de los Casos Críticos de Fallo

### A. El caso `proc-nopid-1-bad` (Proceso sin PID ni confirmación)
- **Problema previo**: En V0 y V1 casi siempre era un falso aprobado (el modelo veía que no había error explícito y aprobaba).
- **Cómo lo resolvieron las nuevas variantes**:
  - **R9_V1_B**: Lo clasificó correctamente como **`unknown`** con 67.2% de probabilidad (rechazado).
  - **R5_V3_B**: Le dio a `evidence_ok` un contundente **0.086** (rechazo absoluto por falta de evidencia).
  - **R10_Preguntas_Negativas**: `any_missing_evidence` saltó a **0.583**, bloqueándolo eficazmente.

### B. El caso `nearpath-3-bad` (Ruta cercana `config.json.old` vs `config.json`)
- **Problema previo**: Aprobado falsamente por semejanza léxica de la ruta.
- **En las nuevas variantes**:
  - **R10_Preguntas_Negativas**: Detectó `any_mismatch = 0.927` (rechazado con certeza total).
  - **R5_V3_B / R6_V3_C**: `target_ok` cayó a **0.123 / 0.165** (rechazado correctamente).
  - **R11_P_B (Pre-ejecución)**: Eligió **`wrong_path`** con 66.5% de probabilidad (bloqueo preventivo antes de tocar el disco).

### C. El caso `noise-1-bad` (Salida de compilador con error enterrado al final)
- **Problema previo**: El error quedaba truncado al final del log y los clasificadores de choice aprobaban erróneamente.
- **En las nuevas variantes**:
  - **R1_V0_clipHT** (recorte cabeza + cola): `cumple` bajó a **0.35** (rechazado).
  - **R10_Preguntas_Negativas**: Detectó `any_error = 0.995` (bloqueado de inmediato).

---

## 3. Conclusiones y Ganadores Claros

1. **Mejor Variante Pre-ejecución**: **`R11_P_B`**
   - Sube la exactitud a **96.3%** (frente al 92.6% de P0).
   - Mantiene **0 Falsos Aprobados** (cero operaciones erróneas autorizadas) y reduce los falsos rechazos a la mitad.

2. **Mejor Variante Post-ejecución**: **`R10_Preguntas_Negativas`**
   - Logra **96.3%** de Accuracy con **solo 1 Falso Aprobado en todo el dataset de 54 casos**.
   - Preguntar por el defecto (`any_error`, `any_mismatch`, `any_missing_evidence`) elimina el sesgo de complacencia afirmativa del modelo.

3. **Mejora estructural universal**:
   - `clipHT` (cabeza y cola) demostró ser indispensable frente al truncado ciego al final para logs y procesos largos.
