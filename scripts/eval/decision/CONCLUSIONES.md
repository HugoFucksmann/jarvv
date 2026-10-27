# Guía de Conclusiones y Reglas Probadas — Verificación de Paso Eos/D3

> **Propósito:** Documento de referencia rápido con lo que **SÍ funciona**, lo que **NO funciona**, y las **reglas de diseño** validadas empíricamente para usar en las próximas pruebas.

---

## 1. Lo que SÍ funciona (Patrones Ganadores)

1. **`criteria` explícito en preguntas binarias (`noul`)**:
   - Definir `criteria: { true: "...", false: "..." }` en la pregunta `cumple` elimina la zona gris.
   - Pasa de dejar colar 5 casos malos en `v0` a **0 casos malos** en `v4/v5` con AUC 0.999.

2. **Clasificación en 4 vías (`choice` sin solapamiento)**:
   - Dividir las opciones en: `matches`, `mismatch`, `failed` y `unconfirmed`.
   - Separa el fallo visible de la falta de evidencia. Logra bajar el peor caso malo a **0.510** (zona de rechazo directo).

3. **Veto estricto dual AND — J1: `four_way` + `noul_criteria` en 1 request**:
   - Es el diseño más sólido probado. Peor malo **0.355** en dataset_v2 y **0.416** en dataset_v3 (62 casos).
   - 31/31 buenos auto-aprobados en dataset_v3. 22/22 en dataset_v2. 0 falsos positivos en ambos.
   - Robusto a ausencias, ruido, inyecciones, ediciones de código y pasos encadenados.
   - El orden de preguntas en el payload no importa: J1 y J1r dan el mismo resultado (sesgo nulo confirmado).

4. **Preguntas conjuntas en un solo request (`runMulti`)**:
   - Enviar 2 preguntas en un único payload JSON da exactamente la misma precisión que dos llamadas separadas, ahorrando 50% de llamadas y latencia.

5. **Política de 3 bandas (0.90 / 0.60)**:
   - >= 0.90: Auto-aprobación garantizada sin falsos positivos.
   - 0.60 a 0.90: Zona de revisión humana o escalado al segundo juez.
   - < 0.60: Rechazo automático.

6. **Generalización validada (dataset_v3 — 62 casos)**:
   - Los patrones de v5 generalizan correctamente a: `search_results_partial`, `chained_step_context`, `code_edit_verification`, `injection`, `long_noise`, `partial`, `empty_cases`, `bilingual`, `process_nopid`.
   - J1 maneja correctamente los casos de "verificar ausencia" (0 resultados = éxito) donde J2 falla.

---

## 2. Lo que NO funciona (Descartar)

1. **La pregunta `ok` de producción**:
   - *"Does the result contain usable data...?"* no detecta paths incorrectos ni contenido erróneo. Peor malo = **0.997** en dataset_v3.

2. **`cumple` sin criterios definidos**:
   - Tiende a sobre-aprobar por sesgo positivo natural del modelo, dejando colar casos malos con P > 0.90.

3. **`read_status` aislada**:
   - Peor malo = **1.000** en dataset_v2. Peor malo = **0.998** en dataset_v3.
   - No funciona: preguntar qué reporta la tool sin contrastarla contra la instrucción es insuficiente.

4. **J2 (`read_status` + `noul_criteria`) para casos de ausencia**:
   - Cuando el éxito se define por "0 resultados" o "no encontrado", `read_status` clasifica el output como `nothing_changed` y activa el veto incorrectamente.
   - Falla en: `n3-c03` (old_logs borrado), `n3-s04` (búsqueda sin hits), `n3-c08` (proceso detenido).
   - **Usar J1 en su lugar para cualquier caso donde verificar ausencia sea parte del paso.**

5. **Votación por mayoría (2 de 3)**:
   - Peligrosa en verificación de tools: un solo indicio de fallo debe bastar para vetar.

6. **Repetir llamadas para medir ruido**:
   - Con temperatura 0 en D3, la diferencia de repetición es 0.000. Duplica llamadas sin aportar información.

---

## 3. Tabla Resumen de Métricas (Evolución v0 → v5)

### Benchmark principal: dataset_v2 (44 casos difíciles)

| Diseño | Estructura | Peor Caso Malo | Buenos Auto (22) | Falsos Positivos |
| :--- | :--- | :---: | :---: | :---: |
| **`v0` (Producción)** | `ok` + `cumple` aislados | 0.991 | 18/22 | **5 errores** |
| **`v4: N2`** | `noul_criteria` aislado | 0.733 | 22/22 | **0** |
| **`v4: N1`** | `four_way` aislado | 0.510 | 21/22 | **0** |
| **`v5: C1_dual`** | AND(four_way, noul_criteria) — 2 requests | 0.358 | 22/22 | **0** |
| **`v5: J1/J1r`** ⭐ | AND(four_way, noul_criteria) — 1 request | **0.355** | **22/22** | **0** |
| **`v5: J2`** | AND(read_status, noul_criteria) — 1 request | 0.355 | 22/22 | **0** |

### Validación: dataset_v3 (62 casos — mayor variedad)

| Diseño | Peor Caso Malo | Buenos Auto (31) | Falsos Positivos |
| :--- | :---: | :---: | :---: |
| **`v5: J1/J1r`** ⭐ | **0.416** | **31/31** | **0** |
| **`v5: C1_dual`** | 0.422 | 31/31 | **0** |
| **`v4: N2`** | 0.422 | 31/31 | **0** |
| **`v5: J2`** | 0.402 | 28/31 | **0** (3 buenos rechazados por ausencia) |

> ⭐ **Mejor diseño:** `v5 J1` con `runMulti`. Peor malo 0.355 (v2) / 0.416 (v3). Robusto a todos los tipos de casos probados incluyendo verificación de ausencias.

---

## 4. Reglas Fijas para las Próximas Pruebas

1. **Mantener siempre 0 falsos positivos** en la banda >= 0.90 como condición excluyente de éxito.
2. **Usar el peor caso malo como métrica principal** (el AUC ya está saturado > 0.99 y no discrimina entre variantes buenas).
3. **El diseño base es J1 (`runMulti` con `four_way` + `noul_criteria`)**: cualquier variante nueva debe superar peor malo **0.355** y **22/22** buenos en dataset_v2.
4. **No usar J2 si el paso puede verificar ausencias** — usar J1 en su lugar.
5. **Dataset_v2 es el benchmark de referencia**: dataset_v3 valida generalización pero los casos son más fáciles y no sirve para comparar variantes finas.
