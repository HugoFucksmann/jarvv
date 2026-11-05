# Conclusiones y Registro del Ciclo Iterativo de Evaluación (`eval`)

Este documento registra los hallazgos, mediciones empíricas, diagnósticos y comparativas sistemáticas obtenidas a lo largo de las iteraciones del framework de evaluación de prompts y modelos en Jarvv.

---

## 1. Validación Previa de Datasets (`--dry-run` y `--client=oracle`)

Antes de realizar inferencias con modelos reales, se verificó la integridad sintáctica, consistencia de esquemas y funcionamiento de los evaluadores/graders para cada dataset disponible:

| Dataset | Casos | `--dry-run` | `--client=oracle` | Estado |
|---|---|---|---|---|
| `smoke` | 8 casos | Exitoso (código 0) | **100.0%** (9/9 pasados) | Validado |
| `agentic_30` | 30 casos | Exitoso (código 0) | **100.0%** (33/33 pasados) | Validado |
| `agentic_hard_40` | 40 casos | Exitoso (código 0) | **100.0%** (38/38 pasados) | Validado |
| `decision_combo_52` | 52 casos | Exitoso (código 0) | **100.0%** (52/52 pasados) | Validado |
| `decision_discriminating` | 10 casos | Exitoso (código 0) | **100.0%** (10/10 pasados) | Validado |
| `llm_generative_48` | 48 casos | Exitoso (código 0) | **100.0%** (58/58 pasados) | Validado |
| `scenarios_messages` | 12 casos | Exitoso (código 0) | **100.0%** (14/14 pasados) | Validado |
| `scenarios_chains` | 84 casos | Exitoso (código 0) | **100.0%** (96/96 pasados) | Validado tras corregir `"state": "completed"` y veredictos aprobados |

---

## 2. Diagnóstico de la Baseline (`prod`) y Análisis de `jarvis_alt_v3`

Al correr la baseline `prod` con los modelos reales (`qwen3.5:4b` generativo + `d3:2b` decisión) sobre el benchmark `agentic_30`, se obtuvieron **27/33 pasados (81.8%)**.

### Puntos Débiles Detectados en `prod`:
1. **`arguments` (Pass Rate: 33.3% / 1 de 3)**:
   - Casos como `busq-args-search` y `fs-args-write-append` fallan porque el modelo generativo `qwen3.5:4b` adivina nombres de parámetros al no tener el esquema en el prompt (omite `max_results`, o escribe `limit`, omite `mode: "append"`).
2. **`route` (Pass Rate: 85.7% / 6 de 7)**:
   - En `term-route-tests`, el modelo de decisión elige prematuramente `fin` en lugar de `terminal` (probabilidad 0.41 fin vs 0.18 terminal).
3. **`args_review` (Pass Rate: 33.3% / 1 de 3)**:
   - Sesgo severo hacia `approved`. Casos como `prob-review-clave-incorrecta` (donde la clave requerida era `destination` y se pasó `dest`) o `term-review-ls-en-terminal` (se usó terminal en lugar de herramientas de filesystem) son aprobados porque los criterios `Args are malformed` y `Wrong tool` en `prod` son excesivamente ambiguos.

### Evaluación de la Variante Existente `jarvis_alt_v3`:
Al comparar `jarvis_alt_v3` contra `prod`:
- **Mejoras:** Resolvió `term-route-tests` (+14.3% en ruta) y `fs-args-write-append`.
- **Regresiones Críticas:**
  - `result_verification`: cayó de 66.7% a 33.3% en `agentic_30`, y colapsó de **100.0% a 0.0%** en `decision_discriminating` (-100%).
  - Al cambiar la instrucción de `ok` a *"Is the result usable? Answer yes if it contains data or confirms an action. Answer no only if it is empty or an error message..."*, el modelo `d3:2b` interpretó los mensajes de error como "texto con datos" y comenzó a aprobar errores graves de permisos (`prob-verify-permiso-denegado`).
  - En `arguments`, `jarvis_alt_v3` introdujo regresión en `term-args-start-process` (perdió el parámetro requerido `command`).

---

## 3. Iteraciones de Prompt (`jarvis_alt_v4`, `v5`, `v6`)

### `jarvis_alt_v4`:
- Se corrigió `route` y se agregaron las convenciones de herramientas.
- Se detectó que el modelo envolvía los argumentos dentro del nombre de la herramienta (ej. `{"search": {...}}`).
- Se observó sobre-rechazo en `decision_combo_52` (-11.1%) al intentar modificar los criterios globales de `args_review`.

### `jarvis_alt_v5`:
- Se implementó la directiva estricta de **JSON plano sin anidamiento**.
- Se mantuvieron intactos `result_verification` y `args_review` para prevenir regresiones.
- **Resultados**: +9.1% en `agentic_30`, +10.5% en `agentic_hard_40`, y +12.1% en `llm_generative_48`, con 0 regresiones.

### `jarvis_alt_v6`:
- Se añadió instrucción para usar tokens de referencia `{{ref:rX}}` cuando hay datos previos de herramientas.
- Se reforzó en `route` la instrucción para elegir imperativamente `ask_user` ante fallos por `info_missing`.
- Se guió la etapa de `plan` para mantener el subsistema idóneo tras fallos de conexión (ej. HTTP 503).

---

## 4. Evaluación Comparativa Multirronda (`--repeat=3`)

Prueba de estabilidad y varianza corriendo cada caso **3 veces consecutivas** sobre `agentic_hard_40` y `scenarios_messages` (156 ejecuciones por variante):

| Variante | Pass Rate Total | $\Delta$ vs Baseline | Pass Rate Generativo | Pass Rate Decisión | Macro por Etapa | Regresiones | Mejoras | $p$ (signos) | Reintentos | Latencia p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| **`prod` (Baseline)** | 76.9% (120/156) | — | 78.9% (45/57) | 75.8% (75/99) | 78.2% | — | — | — | 16 | 958 ms |
| **`jarvis_alt_v2`** | 80.8% (126/156) | +3.8% | 78.9% (45/57) | 81.8% (81/99) | 82.1% (+3.9%) | 3 | 5 | 0.727 | 15 | 929 ms |
| **`jarvis_alt_v5`** | 85.3% (133/156) | +8.3% | 96.5% (55/57) | 78.8% (78/99) | 87.8% (+9.6%) | 1 | 6 | 0.125 | 2 | 648 ms |
| **`jarvis_alt_v6`** | **87.8% (137/156)** | **+10.9%** | **98.2% (56/57)** | **81.8% (81/99)** | **90.3% (+12.1%)** | **0** | **7** | **$p = 0.016$** | **4** | **830 ms** |

### Desglose por Etapa (`jarvis_alt_v6` vs `prod` con 3 repeticiones):
- **`arguments` (`agentic_hard_40`)**: pasó de 40.0% a **100.0% (15/15)** (**+60.0%**).
- **`tool_choice` (`agentic_hard_40`)**: pasó de 80.0% a **100.0% (15/15)** (**+20.0%**).
- **`route` (`scenarios_messages`)**: pasó de 75.0% a **100.0% (12/12)** (**+25.0%**).
- **`plan` (`scenarios_messages`)**: pasó de 66.7% a **100.0% (3/3)** (**+33.3%**).
- **Regresiones**: **Cero regresiones** en los 52 casos evaluados a través de 3 repeticiones.
- **Significancia estadística**: $p = 0.016$ ($p < 0.05$).

---

## 5. Evaluación sobre Cadenas Multietapa Reales (`scenarios_chains.jsonl`)

Evaluación de 84 casos (96 corridas efectivas) simulando la ejecución incremental paso a paso de tareas reales de Jarvis (`pkgver`, `contrato`, `factura-luz`, `dolar`, `tests`, `repl-csv`, `fotos`, `limpieza`, `config`, `xlsx`, `funcion-iva`, `comparar-precios`, `paginado`, `plan-replan`):

| Variante | Pass Rate Total | Pass Rate Generativo | Pass Rate Decisión | Macro por Etapa | Latencia Generativa p50 |
|---|---|---|---|---|---|
| **`prod` (Baseline)** | 64.6% (62/96) | 77.4% (24/31) | 58.5% (38/65) | 71.5% | 6406 ms |
| **`jarvis_alt_v2`** | 61.5% (59/96) | 71.0% (22/31) | 56.9% (37/65) | 69.4% | 3519 ms |
| **`jarvis_alt_v5`** | 63.5% (61/96) | 71.0% (22/31) | **60.0% (39/65)** | 67.6% | **2804 ms (-56%)** |
| **`jarvis_alt_v6`** | 63.5% (61/96) | 74.2% (23/31) | 58.5% (38/65) | 71.1% | **3053 ms (-52%)** |

### Hallazgos Clave en Cadenas Reales:
1. **Cuello de Botella Principal del Dataset**: La etapa `result_verification` en `scenarios_chains` tiene un pass rate bajo en todas las variantes (~58.3% en `cumple`), debido a que en tareas incrementales de varios pasos el modelo tiende a considerar prematuramente que la llamada cumplió el objetivo global cuando sólo cumplió un subpaso.
2. **`tool_choice`**: Tanto `jarvis_alt_v5` como `jarvis_alt_v6` lograron un incremento de **+5.9% en selección de herramienta** (`seq-repl-csv-01-tool_choice` y `seq-comparar-precios-02-tool_choice` pasaron de fallar a aprobar).
3. **Reducción de Latencia**: Las variantes `v5` y `v6` redujeron a **menos de la mitad la latencia generativa p50** (de 6406 ms en `prod` a 2804–3053 ms) gracias a la eliminación de reintentos y formateo directo de argumentos.
