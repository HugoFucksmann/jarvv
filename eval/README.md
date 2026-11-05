# Jarvis · Eval de prompts

Laboratorio para medir prompts y modelos de Jarvis contra casos congelados, y para comparar una variante de prompt con producción antes de tocar `src`.

- **Mide** cada etapa del flujo con graders específicos: etiqueta correcta en las decisiones, y estructura y contenido en las salidas generativas.
- **Compara** variantes de prompt contra la baseline `prod`, con deltas, regresiones y mejoras por caso.
- **Prueba con el contexto real de Jarvis**: los casos por escenario arman el prompt con el mismo código que usa Jarvis (vistas, mensajes fijos, renderizadores y parámetros de cada etapa), así que no se desactualizan cuando cambia `src`. Los casos escritos a mano siguen disponibles y se distinguen con `--source`.
- **No modifica nada**: ni `src` ni los casos. Las variantes se aplican en memoria, solo durante la corrida.

> Referencia completa de flags, formatos y códigos de salida: [`INSTRUCCIONES.md`](./INSTRUCCIONES.md).

---

## Inicio rápido

Desde la raíz del repo:

```bash
npm run eval -- --list
```

```bash
npm run eval:smoke
```

```bash
npm run eval -- --client=oracle --dataset=eval/datasets/smoke.jsonl
```

```bash
npm run eval -- --dataset=eval/datasets/smoke.jsonl
```

| Comando | Qué hace | Necesita Ollama |
|---|---|:---:|
| `--list` | Lista etapas, variantes y datasets | No |
| `eval:smoke` | Imprime los requests que se enviarían (`--dry-run`) | No |
| `--client=oracle` | Responde lo que pide cada caso. **Debe dar 100 %** | No |
| (sin `--client`) | Corrida real contra `qwen3.5:4b` y `d3:2b` | Sí |
| `--model=a+x` | Todas las etapas con ese modelo generativo (`a`) y de decisión (`x`) | Sí |
| `--llm-model=a,b` / `--d-model=x,y` | Corre solo las etapas generativas / de decisión y compara los modelos | Sí |
| `--source=scenario` / `--source=frozen` | Solo casos con contexto armado por Jarvis / escrito a mano | Según el resto |

Por defecto usa Ollama en `http://127.0.0.1:11434` con `qwen3.5:4b` para las etapas generativas y `d3:2b` para las de decisión.

---

## Cómo funciona

```mermaid
flowchart LR
    D[Dataset .jsonl<br/>request fijo o escenario] --> V[Variante<br/>edita el request en memoria]
    V --> C[Cliente<br/>real, mock u oracle]
    C --> P[Parseo de la salida]
    P --> G[Graders<br/>checks por etapa]
    G --> S[Scores y comparación<br/>runs.jsonl, scores.json, comparison.md]
```

Cada corrida ejecuta **variante × dataset × caso × repetición**. Un run pasa solo si no registra ningún error: llamada al modelo, aplicación de la variante, parseo y todos los checks de los graders.

### Etapas

| Tipo | Etapa | Qué se evalúa |
|---|---|---|
| Decisión (`d3`) | `route` | Ruta elegida (`files`, `web`, `fin`, `ask_user`…) y su probabilidad |
| Decisión (`d3`) | `tool_choice` | Herramienta elegida o `ask_user` |
| Decisión (`d3`) | `args_review` | `approved`, `args_invalid`, `tool_rejected` o `info_missing` |
| Decisión (`d3`) | `result_verification` | Veredictos `ok` y `cumple` |
| Generativa | `plan` | Cantidad de pasos, rutas permitidas y requeridas, palabras clave |
| Generativa | `arguments` | Campos requeridos, valores exactos, refs válidos, valores prohibidos |
| Generativa | `final` | Datos y efectos que debe mencionar, alucinaciones prohibidas |
| Generativa | `question` | Largo, una sola pregunta, sin fugas de identificadores internos |

### Reintentos iguales a producción

Las etapas generativas y el transporte reintentan como lo hace Jarvis, para que el pass rate sea comparable con el real:

- **Red o HTTP 503:** un reintento tras 1 s, en todas las etapas.
- **Salida inválida o truncada** (`plan`, `arguments`, `final`, `question`): un reintento con `ERROR_PREVIO`, 1.5× tokens y temperatura 0.3.

El run guarda `measurements.attempts` y un warning por cada reintento.

---

## Los tres clientes

| `--client` | Para qué sirve |
|---|---|
| `real` *(default)* | Llama a los modelos. Es la única forma de medir prompts |
| `oracle` | Lee el `expect` del caso y responde lo correcto. Valida casos, graders y parseo: si falla, el problema **no** es el modelo |
| `mock` | Respuestas genéricas sin red. Solo prueba la maquinaria |

El oráculo solo entiende la variante `prod` (no interpreta `labelMap` ni `answerMap`).

---

## Comparar modelos

Hay tres flags de modelo y se usa **uno solo** por corrida (combinarlos es error):

| Flag | Corre | Ejemplo |
|---|---|---|
| `--model=<llm>[+<decisión>]` | todas las etapas (modo común) | `--model=qwen3.5:4b+d3:2b` |
| `--llm-model=a[,b…]` | solo las etapas generativas | `--llm-model=qwen3.5:4b,qwen3:8b` |
| `--d-model=x[,y…]` | solo las etapas de decisión | `--d-model=d3:2b,lfm3:1.7b` |

Sin ninguno se usan los defaults (`qwen3.5:4b` + `d3:2b`). Todos aceptan varios elementos separados por coma: la misma variante y dataset corren contra cada uno y `comparison.md` los compara entre sí, con deltas contra el primero. Con `--model=a+x,b+y` se comparan configuraciones completas.

```bash
npm run eval -- --d-model=d3:2b,lfm3:1.7b --dataset=eval/datasets/decision_discriminating.jsonl
``` Detalle en [`INSTRUCCIONES.md`](./INSTRUCCIONES.md#comparar-modelos).

---

## Escribir un caso

Un caso es una línea de un `.jsonl` en `eval/datasets/`. Las líneas vacías y las que empiezan con `#` se ignoran.

```json
{"id":"smoke-route","stage":"route","tags":["smoke"],
 "request":{"type":"decision","state":"Request: list the files in the project",
   "questions":{"route":{"type":"choice","instructions":"Pick the next route.",
     "criteria":{"files":"Read or write files","web":"Browse the web","fin":"Task is done","ask_user":"Need more info"}}}},
 "expect":{"expectedAction":"route","expectedRoute":"files"}}
```

| Campo | Descripción |
|---|---|
| `id` | Único dentro del dataset |
| `stage` | Una de las ocho etapas |
| `request` | Lo que se envía al modelo: `decision` (`state` + `questions`) o `generative` (`system` + `user` + parámetros) |
| `expect` | Lo que debe cumplir la salida. Claves cerradas por etapa; un typo falla al cargar con `archivo:línea` |
| `tags`, `description` | Opcionales. Los tags sirven con `--tags=` |
| `isRaw` | Caso adversarial: se reporta aparte, fuera del pass rate canónico |
| `meta.toolSchema` | **Obligatorio en `arguments`**: schema real de la herramienta, para validar como prod |

Un request de decisión puede llevar varias preguntas y `expect.answers` fija la respuesta esperada de las adicionales. Cada pregunta se registra y evalúa por separado, con accuracy, FP/FN por clase y cruces entre preguntas en `comparison.md` (ver [`INSTRUCCIONES.md`](./INSTRUCCIONES.md#decisiones-con-varias-preguntas)).

Los casos de decisión con una sola opción (donde producción omitiría la llamada) se etiquetan solos como `prod_shortcut` y quedan fuera del pass rate salvo que uses `--include-shortcut`.

Hay datasets de ejemplo: `smoke.jsonl` (una pasada por todas las etapas), `decision_discriminating.jsonl` (decisiones donde la respuesta correcta **no** es la primera opción, para detectar sesgo de posición) y `scenarios_messages.jsonl` (casos por escenario que prueban los mensajes fijos de `ctx/views/messages.ts`).

### Casos por escenario

En vez de `request` (el prompt ya armado, con contexto escrito a mano), un caso puede traer `scenario`: la situación de la tarea y el punto de decisión. Al cargar, el eval arma el `request` con el código de Jarvis (`ctx.view.*` → `engine/adapters.ts` → `reasoner/prompts.ts` y `reasoner/stageRequests.ts`).

```json
{"id":"msg-route-info-missing","stage":"route","tags":["messages"],
 "scenario":{"mode":"reactive","request":"Creá el archivo de notas con el resumen de la reunión de hoy",
   "steps":[{"state":"running"}],
   "calls":[{"route":"files","tool":"write_file","kind":"write","status":"info_missing","args":{"path":"/home/user/notas.txt"}}]},
 "expect":{"expectedAction":"ask_user"}}
```

- Un caso lleva `request` **o** `scenario`, nunca los dos. El resto de los campos es igual.
- Lo que se arma así llega al modelo igual que en producción: mensajes de estado, razones y motivos de detención, topes de cada sección, renderizado y parámetros (tokens, thinking, schema). Un cambio en `src` se refleja en el eval sin tocar los casos.
- El escenario se valida con las reglas reales del contexto: uno imposible falla al cargar con `archivo:línea: scenario: …`.
- `--source=scenario` / `--source=frozen` corre solo un origen. Formato completo del escenario en [`INSTRUCCIONES.md`](./INSTRUCCIONES.md#casos-por-escenario-scenario).

---

## Escribir una variante

Una variante es un archivo en `eval/variants/<nombre>.ts` que edita el request en memoria. El `name` debe coincidir con el archivo, y `prod` es la identidad.

```ts
import type { Variant } from "../core/variants/types.ts";

const concise_plan: Variant = {
  name: "concise_plan",
  generative: {
    plan: {
      user: { append: "\n\nUse the fewest steps possible." },
      params: { temperature: 0.2 },
    },
  },
  decision: {
    route: {
      questions: {
        route: { instructions: { append: "\n\nPrefer web when the user asks to look something up." } },
      },
    },
  },
};

export default concise_plan;
```

Para decisiones también podés editar `state`, cambiar o quitar criterios (`criteria: { set, remove, append }`), reemplazar una pregunta y renombrar opciones con `labelMap`. Un ejemplo completo está en `variants/route_example.ts`.

Se corren y comparan así:

```bash
npm run eval -- --variant=prod,concise_plan --dataset=eval/datasets/smoke.jsonl
```

`prod` se incluye siempre como baseline. Se pueden combinar variantes con `+` (`--variant=varA+varB`).

---

## Leer los resultados

Cada corrida imprime la configuración, el progreso por caso y dos resúmenes:

```
── Resumen por variante ──
  Variante         passRate      Δ vs baseline  Macro por etapa  Regresiones  Mejoras  p (signos)  Sin medir  p50
  ---------------  ------------  -------------  ---------------  -----------  -------  ----------  ---------  ---
  prod (baseline)  100.0% (9/9)  —              100.0%           —            —        —           0          0ms
  route_example    100.0% (9/9)  0.0%           100.0% (0.0%)    0            0        —           0          0ms
```

Todo queda guardado en `eval/results/<modelo>/<fecha>[_<label>]/`:

```
<corrida>/
├── comparison.md              ← el reporte para leer
├── comparison.json
└── <variante>__<dataset>/
    ├── runs.jsonl             ← un registro por ejecución: request, salida, errores, latencia, tokens
    ├── scores.json            ← métricas agregadas de la celda
    └── meta.json              ← configuración, commit de git, hashes de dataset y variante
```

`comparison.md` trae el resumen por variante, el detalle por etapa con las variantes lado a lado (el delta contra la baseline va entre paréntesis), las regresiones y mejoras caso por caso, los casos raw (fuera de `passRate`) y las matrices de confusión de las decisiones.

El resumen por variante separa los tipos de etapas: con etapas generativas y de decisión en la misma corrida hay una fila por tipo (columna `Tipo`) más un total mezclado. Si una variante mejora un tipo y empeora el otro, el reporte avisa **Resultado mixto**: el total no sirve para decidir, hay que mirar cada tipo.

### Códigos de salida

| Código | Significado |
|:---:|---|
| `0` | Correcto (y umbral cumplido, si se pidió `--min-pass-rate`) |
| `1` | Alguna celda quedó por debajo de `--min-pass-rate` |
| `2` | Error de configuración o dataset, filtros sin casos, o todas las llamadas fallaron por red, timeout o HTTP |

---

## Qué tener en cuenta al interpretar

- **Latencia y concurrencia.** Con `--concurrency` mayor que 1, p50 y p95 incluyen espera del servidor y no son comparables. Usá `1` para medir latencia; el pass/fail no se ve afectado.
- **p95 con pocas muestras.** Con menos de 20 llamadas el p95 es el máximo, que suele ser la carga en frío del modelo. Se marca con `†` y no se publica su delta; compará con p50. El total mezclado no muestra p50 porque combina etapas de milisegundos y de segundos. Las latencias generativas suman los reintentos.
- **Casos sin medir.** Una llamada fallida (red, timeout, HTTP) o una variante que no se pudo aplicar cuenta como falla en `passRate`, pero no entra en las latencias ni aparece como regresión o mejora. Δ compara solo casos medidos en ambos lados, y el reporte avisa si alguno quedó afuera.
- **Ruido.** Un Δ no es un veredicto: mirá `p (signos)`, calculado sobre los casos que cambiaron. Con menos de 6 cambios nunca baja de 0.05. Las etapas generativas varían entre corridas con el mismo request: usá `--repeat` antes de decidir por pocos casos.
- **Peso de las etapas.** `passRate` pesa cada etapa según su cantidad de casos, y `final` corre dos veces con `--thinking=auto`. `Macro por etapa` pesa todas por igual y cuenta `final[think=on/off]` como una sola: si ambos difieren, el resultado depende de la composición del dataset.
- **Casos congelados vs. por escenario.** Los casos con `request` guardan el prompt tal como se escribió: si cambiás los prompts de producción, el eval compara contra esa foto, no contra `src` en vivo, y su contexto es inventado (`--source=frozen`). Los casos por escenario (`--source=scenario`) se arman con `src` en cada carga: miden el prompt actual, pero un cambio en `src`, en `jarvis-config.json` (tokens por etapa) o en la fecha (`TODAY`) cambia el request; `requestHash` de cada run permite detectarlo.
- **Palabras clave.** Se buscan por palabra completa, sin distinguir mayúsculas ni acentos: "archivo" no coincide con "archivos". Escribí ambas formas si hacen falta.
- **Variantes con `labelMap`.** Dos opciones que se mapeen al mismo nombre canónico se pisan entre sí; evitalo.
- **Modelos.** Los pass rates valen solo para el modelo con el que corren. Los defaults coinciden con los de producción.

---

## Estructura del código

```
eval/
├── README.md
├── INSTRUCCIONES.md              referencia completa de flags
├── cli.ts                        punto de entrada
├── datasets/                     casos (.jsonl): con request fijo o por escenario
├── variants/                     variantes de prompt (prod, route_example)
├── results/                      salidas de cada corrida
└── core/
        ├── runner.ts             ejecuta casos, reintentos, concurrencia
        ├── stages/               parseo y labels de cada etapa
        ├── graders/              checks por etapa
        ├── client/               real, mock y oracle
        ├── variants/             carga y aplicación de variantes
        ├── scenario.ts           casos por escenario: arma el request con el código de Jarvis (importa `src/`)
        ├── targets.ts            reparto de modelos en pasadas (comparación entre modelos)
        ├── questions.ts          preguntas múltiples en decisiones: parseo y checks por pregunta
        ├── scoring.ts            métricas agregadas
        ├── report.ts             comparison.md y resumen en consola
        └── contract.ts           helpers de producción copiados (parseo, validación, límites); lo demás del eval no importa `src/`
```
