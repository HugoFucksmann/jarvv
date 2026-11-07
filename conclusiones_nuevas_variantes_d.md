# Hallazgos y Conclusiones de Variantes para Decisiones D (D3 y D4) y Etapas Críticas

> Documento de referencia independiente con las mediciones sobre la revisión (D3), verificación (D4) y generación de argumentos.
> Fecha: 2026-11-07. Modelos: `d3:2b` (decisión, temp=0, `--repeat=1`, `--concurrency=3`) y `qwen3.5:4b` (generativo, `--concurrency=3`) en Ollama local.
> Todas las métricas de D4 se reportan por la decisión de aprobación (`min(ok, cumple) > 0.5`) separando falsos aprobados y falsos rechazados.

---

## 1. Correcciones Metodológicas Previas (Baseline Real)

1. **Impacto del PATH en el pre-chequeo determinista:**
   - **En Windows sin Git en PATH:** el pre-chequeo marcaba 68/73 malas (93% de recall) y 0/32 falsos rechazos (95% global).
   - **En el entorno real de JARVIS (con `C:\Program Files\Git\usr\bin` en PATH):** herramientas como `head`, `grep`, `find`, `ls` existen en disco. Para este entorno real, el pre-chequeo marca **61/73 malas (84% de recall)** y **0/32 falsos rechazos (89% de acierto)**.
   - Los 12 casos que no marca son: 7 con tag `depende_del_path` (`mut-linux_ls`, `mut-linux_find`, `mut-linux_head`, `real-t2-c1`, `real-t2-c2`, `real-t9-c0`), 3 por opciones inválidas que no rompen sintaxis (`real-t2-c0`, `real-t4-c0`, `real-t4-c2`, `tasklist /SO`), y 2 por comandos de Linux bajo bash (`rev-linux-top-bash`, `rev-linux-grep-cmd`).

2. **Comparativa real de tuberías D3:**
   - **Pre-chequeo solo (con Git en PATH):** 93/105 casos correctos (89%), **0% falsos rechazos (0/32)**, 84% de recall en malas.
   - **Pre-chequeo + D3 de prod (`pre+d3`):** 90/105 casos correctos (86%), **19% falsos rechazos (6/32)**, 88% de recall.
   - **Pre-chequeo + D3 solo para escrituras (`pre+d3w`):** 92/105 casos correctos (88%), **13% falsos rechazos (4/32)**, 88% de recall.
   - **Conclusión neta:** `pre+d3w` y `pre+d3` agregan 1 detección sobre el pre-chequeo solo, pero a costa de introducir entre 4 y 6 falsos rechazos en llamadas perfectamente buenas (PowerShell). Por tanto, **el pre-chequeo solo es superior** a cualquier combinación con D3 actual.

3. **Métrica real de aprobación en D4 (`min(ok, cumple) > 0.5` sobre 103 casos: 54 buenos, 49 malos):**
   - El pass rate de `cumple` y `ok` por separado enmascara el efecto real en el pipeline. Midiendo la decisión de aprobación:

| Variante / Regla | Aprobadas correctas (de 54 buenas) | Falsos rechazados | Malas bloqueadas (de 49 malas) | Falsos aprobados (malas que pasan) | Acierto global |
|---|---|---|---|---|---|
| `prod` (`ok` + `cumple` > 0.5) | 54/54 (100 %) | **0 %** (0/54) | 21/49 (43 %) | **57 %** (28/49) | 75/103 (72.8 %) |
| `d4_j1` estricto (`min(matches, cumple)`) | 51/54 (94 %) | **6 %** (3/54) | 30/49 (61 %) | **39 %** (19/49) | 81/103 (78.6 %) |
| `d4_j1_hybrid` (0.25 / 0.35 / 0.60) | 54/54 (100 %) | **0 %** (0/54) | 24/49 (49 %) | **51 %** (25/49) | 78/103 (75.7 %) |
| `d4_five_way_balanced` (5 vías sin ejemplos) | 54/54 (100 %) | **0 %** (0/54) | 23/49 (47 %) | **53 %** (26/49) | 77/103 (74.8 %) |
| `d4_direct_checks` (3 preguntas binarias directas) | 40/54 (74 %) | **26 %** (14/54) | 32/49 (65 %) | **35 %** (17/49) | 72/103 (69.9 %) |

   - `d4_j1` estricto sigue siendo el techo de capacidad en discriminación de fallas (39% de falsos aprobados vs 57% de `prod`), con solo 3 falsos rechazos en 54 buenos.
   - Intentar descomponer en 3 preguntas binarias directas (`d4_direct_checks`) destruye los casos buenos (26% de falsos rechazos): `d3:2b` sospecha de llamadas perfectamente válidas.
   - La opción múltiple de 4 vías (J1) o 5 vías (`d4_five_way_balanced`) es necesaria para anclar la calibración del modelo.

---

## 2. Experimentos de Variantes en D3 (`args_review`)

### 2.1 Intentos de prompts alterados y nuevas opciones
- `d3_semantic_checks` (preguntas binarias semánticas): 39.0% acierto global en D3 solo.
- `d3_compact_choice` (3 opciones concisas sin texto redundante): 42.9% acierto en D3 solo (-12.4% vs prod).
- `d3_flags_criteria` (pregunta binaria con criteria sobre flags/opciones estándar de herramientas): 40% falsos rechazos en buenas.
- `d3_four_choice` (nueva opción: `os_incompatible` para separar fallas de sistema operativo):
  - **Resultado extremo:** El modelo `d3:2b` colapsó por completo a predecir `approved` en el 100% de los casos (52/52 en mutaciones).
  - Al agregar una opción más, la masa de probabilidad se dispersó y `approved` superó a todas por defecto. El pass rate cayó al **26.9%** en mutaciones.
- **Conclusión Definitiva de D3:** Se confirma categóricamente que **toda alteración de opciones o prompts en D3 para `d3:2b` empeora**. El pre-chequeo determinista en código resuelve el 84% de las fallas con 0% de falsos rechazos sin necesidad de consultar al modelo.

---

## 3. Hipótesis H1 y H2 en `arguments` (Comandos PowerShell y Manejo de FAIL)

### 3.1 Hipótesis H1: Generalización de `args_comando_simple`
Se midió la frase: *"el comando más simple, sin tablas hash innecesarias"* en el prompt de argumentos sobre:
- `scenarios_arguments` (17 casos)
- `dificil_arguments` (16 casos)
- `ram_real` (4 casos de la falla real observada en producción)

| Variante | scenarios_arguments | dificil_arguments | ram_real | Pass Rate Global | PS Válido en ram_real |
|---|---|---|---|---|---|
| `prod` | 100 % (17/17) | 100 % (16/16) | **0 %** (0/4) | 89.2 % (33/37) | **0 %** (0/4) |
| `args_comando_simple` | 100 % (17/17) | 100 % (16/16) | **50 %** (2/4) | **94.6 %** (35/37) | **50 %** (2/4) |

- **Resultado:** **Cero regresiones** en los 33 casos de `scenarios` y `dificil`.
- Resuelve al 100% el primer intento de la falla real de los 10 procesos con más RAM (2/2 casos directos pasan inmediatamente).

### 3.2 Hipótesis H2: Cómo mostrar el intento rechazado en FAIL (`ram_retry_a..d`)
Midiendo con 3 repeticiones por caso (24 corridas por variante) sobre los reintentos tras rechazo:
- `ram_retry_a`: comando fallido visible + razón.
- `ram_retry_b`: **comando oculto** (args `null`) + razón.
- `ram_retry_c`: comando fallido visible + razón + reescribir desde cero.
- `ram_retry_d`: **comando oculto** + razón + reescribir desde cero.

| Variante | ram_retry_a (visible) | ram_retry_b (oculto) | ram_retry_c (visible + reescritura) | ram_retry_d (oculto + reescritura) |
|---|---|---|---|---|
| `prod` | 0 % (0/6) | 0 % (0/6) | 0 % (0/6) | 0 % (0/6) |
| `args_comando_simple` | 0 % (0/6) | 16.7 % (1/6) | 0 % (0/6) | **50.0 % (3/6)** |

- **Análisis de sintaxis (`eval:psvalid`):**
  - Con el comando visible (`a` y `c`), el modelo copia el patrón de sintaxis rota el **100 % de las veces** (0/6 comandos válidos).
  - Al ocultar el comando en la línea FAIL (`d`), el modelo genera PowerShell con sintaxis 100% válida el **50 % de las veces** (3/6).

---

## 4. Conclusiones y Respuestas a las Preguntas

1. **¿Qué hace bien lo que funciona?**
   - **`d4_j1` (en D4):** La combinación de una clasificación multi-vía con descripciones exhaustivas (`matches`, `mismatch`, `failed`, `unconfirmed`) más una pregunta binaria con `criteria` explícito rompe la complacencia de `d3:2b`.
   - **`args_comando_simple` (en Argumentos):** Una sola instrucción restrictiva pero concreta ("el comando más simple, sin tablas hash") encamina a `qwen3.5:4b` sin sobrecargar el prompt ni causar regresiones.
   - **Pre-chequeo determinista (en D3):** Código estricto sin inferencia probabilística; cero falsos rechazos y 84% de captura.

2. **¿Qué pasa al probar preguntas directas o más opciones?**
   - **Más preguntas binarias directas en D4 (`d4_direct_checks`):** Provoca **26% de falsos rechazos**. El modelo 2B no tolera preguntas separadas de target vs acción sin desconfiar de casos válidos.
   - **Más opciones en D3 (`d4_four_choice` con `os_incompatible`):** **Colapso a `approved` (100% de aprobación de todo)**. Añadir una opción a un modelo 2B dispersa la masa de probabilidad y destruye el umbral de decisión.
   - **Prompts compactos en D3 (`d3_compact_choice`):** El modelo pierde los anclajes de frontera y aprueba comandos de Linux y rutas inventadas.

3. **Recomendación de arquitectura final para el flujo:**
   - **D3:** Mantener el **pre-chequeo determinista como filtro exclusivo**. No delegar la revisión a `d3:2b`.
   - **D4:** Implementar el diseño **`d4_j1`** (baja las fugas de casos malos del 57% al 39%).
   - **Argumentos:** Incorporar la frase de `args_comando_simple` y ocultar los argumentos de la línea FAIL en reintentos.
