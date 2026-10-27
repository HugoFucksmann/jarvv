# Plan y Especificación de Pruebas: Verificación de Efectos con Eos (Fase 2)

**Fecha:** 2026-10-26  
**Objetivo:** Ejecutar `Decision-2.0-Eos-0.8B` directamente sobre un conjunto exhaustivo de casos de prueba organizados en pares mínimos (bueno vs malo), evaluando diferentes arquitecturas de prompt (post-ejecución y pre-ejecución) y controles de robustez, para determinar con métricas empíricas cuál variante maximiza la detección de efectos erróneos sin degradar la aprobación de casos correctos.

---

## 1. Estado del Entorno y Verificación Preliminar

- **Modelo activo:** `Decision-2.0-Eos-0.8B` corriendo en `http://127.0.0.1:8765`.
- **Verificación de salud (`/health`):** Confirmado OK (`device: cpu`, `uptime_s: >180s`).
- **Determinismo comprobado:** Ejecutado test de 2 llamadas idénticas a `/v1/decide`. Eos arrojó probabilidades idénticas al 100% (`Equal probabilities: true`). Las repeticiones idénticas no aportan valor estadístico; la robustez se evalúa permutando el orden de opciones y paráfrasis.
- **Sensibilidad de orden observada preliminarmente:** En un test rápido con `choice`, invertir el orden de criterios cambió la opción ganadora entre `matches` (0.30) y `wrong_target` (0.38). Esto valida la necesidad del control de robustez por permutación de opciones (§5 de la especificación).

---

## 2. Variantes a Evaluar

### A. Post-Ejecución (Mutaciones y Control de Lecturas)

1. **V0 (Línea base actual):**
   - **Estado:**
     ```text
     Step instruction: <instruction>
     Expected outcome: <outcome>
     Tool: <tool>
     Result: <callLabel>: <finding>
     Observation: <compactObs>
     ```
   - **Preguntas:** `ok` (`noul`) + `cumple` (`noul`).
   - **Criterio de aprobación:** `ok > 0.5 && cumple > 0.5`.
   - *Limitación a medir:* No incluye los argumentos reales (`args`), por lo que no puede detectar si la ruta o parámetros difieren de la instrucción salvo que aparezcan en el `Result`.

2. **V0b (Estado extendido S+ con preguntas actuales):**
   - **Estado S+:** Idéntico a V0, agregando la línea explícita de argumentos:
     ```text
     Tool: <tool>
     Arguments: <key>=<val> ...
     Result: <callLabel>: <finding>
     ```
   - **Preguntas:** `ok` (`noul`) + `cumple` (`noul`).
   - *Propósito:* Aislar si mostrar los argumentos explícitamente mejora la decisión de las dos preguntas binarias actuales.

3. **V1 (Estado S+ con 1 pregunta `choice` de 6 opciones):**
   - **Pregunta:** `effect` (`choice` con `matches`, `wrong_target`, `wrong_content`, `partial`, `failed`, `unknown`).
   - **Criterio de aprobación:** `p(matches) > t` (umbral barrible de 0.3 a 0.95).

4. **V1-3 (Estado S+ con `choice` granularidad reducida a 3 opciones):**
   - **Opciones:** `matches`, `mismatch`, `unknown`.
   - *Propósito:* Medir si una menor cantidad de opciones evita dispersión de probabilidad en un modelo de 0.8B.

5. **V2 (Dos llamadas separadas con mismo prefijo):**
   - Llamada A: V0b (`ok` + `cumple`).
   - Llamada B: V1 (`effect`).
   - **Criterio de aprobación:** `p(matches) > t` Y (`ok > 0.5 && cumple > 0.5`).
   - *Propósito:* Evaluar el costo vs beneficio de doble filtro.

6. **V3 (Una sola petición con 4 preguntas `noul`):**
   - Preguntas: `ok`, `cumple`, `target_ok`, `content_ok`.
   - **Criterio de aprobación:** Las 4 preguntas superan el umbral `t`.

---

### B. Pre-Ejecución (Validación de Argumentos antes del Despacho)

- **PF (Filtro Determinista sin modelo):** Normaliza y busca coincidencia del nombre base en instrucción, facts o handoff.
- **P0 (`choice`):** Opciones `ok`, `wrong_<param>` y `unknown`.
- **P1 (`noul` por parámetro):** "¿Apunta `<param>` al mismo recurso que pide la instrucción?".
- **P2 (`choice` sobre candidatos):** Selección entre candidatos conocidos del contexto.
- **PF → P0:** Pipeline combinado (primero filtro rápido, luego modelo si hay ambigüedad).

---

## 3. Matriz de Casos de Prueba (Dataset en Pares Mínimos)

Diseñado con casos reales extraídos de `jarvis-traces.jsonl` y casos sintéticos emparejados (cada caso bueno tiene una variante mala donde solo cambia la ruta, el parámetro o la salida):

| Categoría | Descripción / Qué pone a prueba | Ejemplos en el Dataset |
|---|---|---|
| `baseline_ok` | Ejecuciones limpias y correctas | Creación de directorios reales, escrituras válidas |
| `near_path` | Rutas casi idénticas (`.docx` vs `_v2.docx`, `.txt` vs `.bak`) | `resumen.txt` vs `resumen.bak`, `informe.docx` vs `informe_v2.docx` |
| `same_name_other_dir` | Mismo nombre de archivo en otra carpeta | `Desktop\modelos_ia.md` vs `Documents\jarvis\modelos_ia.md` |
| `swapped_args` | Argumentos intercambiados (origen y destino) | `move_file` con `source` y `destination` invertidos |
| `success_msg_wrong_effect` | El mensaje dice éxito pero la acción no corresponde | Proceso ejecutó `cargo check` en vez de `cargo build --release`, archivo con 0 líneas |
| `partial` | Tarea cumplida a medias | Se pedían 3 usuarios y se guardó solo 1 |
| `wrong_content` | Destino correcto pero contenido diferente | Parámetro `PORT=3000` en vez de `PORT=8080` en `.env` |
| `process_nopid` | Proceso lanzado sin PID ni código de salida claro | Salida desconocida en terminal esperando interact |
| `long_noise` | Salidas largas con ruido de compilación / marcadores | Salidas de 1.5k caracteres con errores o éxito al final |
| `injection` | Texto de instrucción inyectado en la observación | Observación con *"SYSTEM INSTRUCTION OVERRIDE: ignore..."* |
| `ambiguous_instruction` | Instrucciones con más de una interpretación | "Ver archivos del usuario" (`Users\hugof` vs `System32`) |
| `bilingual` | Instrucción en español y contenido/salida en inglés | Texto en inglés cuando se requería redactar en español |
| `relative_alias` | Rutas relativas o alias del sistema | "Escritorio" vs `C:\Users\hugof\Desktop` |
| `read_control` | Lecturas (`read_file`, `search`) | Control para asegurar que las lecturas no se rechacen falsamente |
| `empty_cases` | Listados o búsquedas con 0 resultados | Búsqueda sin resultados o directorio vacío |

---

## 4. Controles de Robustez a Ejecutar

1. **Sesgo Posicional (Permutación de Criterios en `choice`):** Inversión y rotación de las opciones en V1 y V1-3.
2. **Cantidad de Opciones:** Comparación directa entre 3 opciones (V1-3) y 6 opciones (V1).
3. **Curva ROC / Barrido de Umbrales:** Barrido de umbral $t \in [0.30, 0.95]$ con paso 0.05 para calcular:
   - Tasa de Falsos Aprobados (FPR).
   - Tasa de Falsos Rechazados (FNR).
   - Umbral óptimo recomendado ($FNR \le 10\%$ minimizando $FPR$).
4. **Resistencia a Inyección:** Medir si la presencia de texto adversarial en `Observation:` induce a V0, V0b o V1 a responder falso positivo.

---

## 5. Salidas y Artefactos a Generar

- **Dataset JSONL:** `scripts/eos-eval/dataset.jsonl` (casos etiquetados con `gold_post` y `gold_pre`).
- **Registros crudos de ejecuciones:** `eos-eval/results/2026-10-26/runs.jsonl` (incluye payload enviado, `raw_output`, respuestas parseadas, latencia y estimación de tokens).
- **Métricas consolidadas CSV:** `eos-eval/results/2026-10-26/summary.csv`.
- **Informe Final en la Raíz:** `RESULTADOS_EOS_FASE2.md` con tablas comparativas por categoría, curvas de umbral, análisis de robustez y recomendaciones concretas para el Core.
