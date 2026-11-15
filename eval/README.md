# Jarvis · Eval

> Mide cómo decide y responde Jarvis, y valida cada cambio de prompt contra producción antes de tocar `src`.

Evalúa las once etapas del flujo, compara variantes de prompt y deja cada resultado trazable.

---

## Qué ofrece

| | |
|---|---|
| **Contexto real de Jarvis** | Los casos por escenario describen la situación y el eval arma el prompt con el mismo código que usa Jarvis: vistas, mensajes fijos, renderizadores y parámetros de cada etapa. Si `src` cambia, el eval se actualiza solo. |
| **Cobertura completa** | Seis etapas de decisión (cinco del flujo —`d0`, `route`, `tool_choice`, `args_review`, `result_verification`— y el juez de fragmentos de `web_search`) y cinco generativas, cada una con graders propios: etiqueta y probabilidad en las decisiones; estructura y contenido en las salidas generativas. |
| **A/B de prompts sin riesgo** | Las variantes se aplican en memoria y se comparan contra la baseline `prod`: deltas, regresiones y mejoras caso por caso, prueba de signos y promedio por etapa. No modifica `src` ni los casos. |
| **Lectura por tipo de modelo** | El resumen separa etapas generativas y de decisión, y avisa cuando una variante mejora un tipo y empeora el otro, para que el total no engañe. |
| **Fiel a producción** | Mismos reintentos (1 en generativas, 0 en decisión ante salidas inválidas), mismos criterios de validación y un `pass` estricto: un run solo pasa si no registra ningún error. Los datasets con 0 casos tras el filtro de etapa se omiten sin crear carpetas vacías. |
| **Verificable sin GPU** | El cliente `oracle` responde lo que pide cada caso y debe dar 100 %: si falla, el problema no es el modelo. `mock` y `--dry-run` prueban la maquinaria sin red. |
| **Trazable** | Cada celda guarda cada ejecución, sus métricas y su configuración: commit, hashes de dataset y variante, filtros y casos corridos. |
| **Listo para CI** | `--min-pass-rate` y códigos de salida definidos. También incluye un asistente interactivo (`--menu`). |

---

## Inicio rápido

Desde la raíz del repo, con [Ollama](https://ollama.com) activo para las corridas reales:

```bash
npm run eval -- --list
npm run eval -- --menu
npm run eval -- --client=oracle --dataset=smoke
npm run eval -- --dataset=smoke
npm run eval -- --variant=prod,mi_variante --dataset=smoke --repeat=3
npm run eval -- --variant=mi_variante --no-baseline --dataset=smoke   # sin prod como baseline
```

| Comando | Qué hace |
|---|---|
| `--list` | Lista etapas, variantes y datasets disponibles |
| `--menu` | Asistente interactivo que arma y ejecuta el comando |
| `--client=oracle` | Valida casos y graders sin modelos |
| `--dataset=smoke` | Corrida real con los modelos de producción (por defecto `qwen3.5:4b` y `d3:2b`) |
| `--variant=… --repeat=3` | Compara una variante contra `prod` con tres repeticiones |

---

## Cómo funciona

```mermaid
flowchart LR
    D[Dataset<br/>escenarios] --> V[Variante<br/>prompts enteros]
    V --> C[Cliente<br/>real, mock u oracle]
    C --> G[Graders<br/>checks por etapa]
    G --> R[Resultados<br/>scores y comparación]
```

Cada corrida ejecuta **variante × dataset × caso × repetición** y guarda el resultado en `eval/results/`:

```
eval/results/<modelo>/<YYYY-MM-DD_HHmmss>[_<label>]/   (oracle y mock van a eval/results/_oracle/ y _mock/; una colisión en el mismo segundo agrega -2, -3)
├── comparison.md                  reporte para leer
├── comparison.json
└── <variante>__<dataset>/
    ├── runs.jsonl                 cada ejecución: request, salida, errores, latencia, tokens
    ├── scores.json                métricas agregadas
    └── meta.json                  configuración, commit, hashes, filtros y casos
```

---

## Modos reales (`--source=real-stage` y `--source=real-task`)

Además del modo `--source=dataset` (por defecto, sin cambios en CLI, clientes ni formatos), el evaluador permite probar etapas y tareas completas directamente sobre el núcleo de JARVIS (`src/core`):

| Modo | Qué ejecuta | Entradas (`--dataset=…`) |
|---|---|---|
| `--source=dataset` *(default)* | Casos sintéticos por escenario con los clientes históricos del evaluador | Datasets de `eval/datasets/` |
| `--source=real-stage` | Etapas aisladas reconstruidas o congeladas y materializadas con vistas reales y variantes (`applyVariantPrompts`), generando `RunRecord` y reportes estándar | `.jsonl` con specs `trace` / `frozen` / `executable` (o carpeta/traza directa `trace.json` / `full.json.gz` en `--dry-run`) |
| `--source=real-task` | Tareas completas de extremo a extremo (`runTask`) usando `QwenEngine`, `Decision20Engine`, `TaskTraceRecorder` y el pipeline completo de seguridad y refs | `.jsonl` con casos `RealTaskCaseSpec` (`request`, `mode`, `files`, `commands`, `webSearches`, `expect`) |

```bash
# Modo real por etapa (reconstrucción de traza o escenario ejecutable)
npm run eval -- --source=real-stage --dataset=ruta/suite.jsonl --variant=prod,mi_variante
npm run eval -- --source=real-stage --dataset=ruta/traza/trace.json --dry-run

# Modo real encadenado en sandbox temporal aislado
npm run eval -- --source=real-task --dataset=ruta/tareas.jsonl --variant=prod,mi_variante
npm run eval -- --source=real-task --dataset=ruta/tareas.jsonl --dry-run
```

**Sandbox y seguridad en `--source=real-task`:**
- Cada ejecución corre en un directorio temporal aislado (`home`, `Desktop`, `Documents`, `Downloads`, carpeta de refs y servidores MCP acotados al sandbox) que se limpia automáticamente al terminar la tarea, tras extraer las métricas de traza.
- Corre con `autoMode: true`, `homeDirs` fijados al sandbox y lista negra compilada en nivel `blocked` para rechazar de forma determinista comandos o herramientas de borrado peligroso (`tool_rejected`, sin delegar a D3 ni ejecutarlos).
- `VerifyDecisionInput.request` no se inyecta sintéticamente en ninguno de los dos modos reales, respetando la firma de producción.

---

## Datasets generados y cruce con el pre-chequeo

Los datasets de `eval/datasets/<etapa>/` se cargan a mano (casos por escenario, hoy con ayuda de otros modelos y revisión humana); no hay generación automática de casos. Los scripts de `eval/gen/` (`mutaciones.ts`, `ram_real.ts`, `ram_retry.ts`, `repeticiones.ts`) generan casos sintéticos puntuales y escriben `eval/datasets/*.jsonl`: no se editan a mano los archivos generados. `npm run eval:psvalid` mide la validez PowerShell de los `command` de una corrida. `npm run eval:cross` mide el pre-chequeo determinista (`src/core/engine/precheck.ts`) sobre los casos `args_review` y lo cruza con los resultados de una corrida (falsos rechazos, recall por modo de falla, test pareado). Las variantes descartadas se eliminaron el 2026-11-07 (lista y motivos en la sección 8 de [`CONCLUSIONES_HISTORICAS.md`](./CONCLUSIONES_HISTORICAS.md)). Resultados y conclusiones: [`MEJORES_VARIANTES.md`](./MEJORES_VARIANTES.md) (las mejores variantes por etapa) y `conclusiones_*.md` en la carpeta de cada etapa de `variants/`.

## Documentación

Toda la referencia está en [`INSTRUCCIONES.md`](./INSTRUCCIONES.md): flags, formato de casos y escenarios, cómo escribir variantes, estructura de resultados, interpretación de métricas y estructura del código. La hoja de ruta y checklist de la extensión al modo real está en [`PLAN_EVAL_V2.md`](./PLAN_EVAL_V2.md).
