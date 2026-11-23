# Instrucciones para el agente que crea datasets de `eval` (etapas de decisión)

Este documento es el encargo completo. Lo que no está acá no se asume. El formato de los archivos está en `eval/REFERENCIA.md`, sección 3; este documento agrega el método, la calidad exigida y la validación. Para las etapas generativas hay otro encargo (`INSTRUCCIONES_AGENTE_DATASETS_GENERATIVAS.md`): no se mezclan.

**Estado de partida.** Los datasets y las variantes de decisión anteriores se eliminaron: no existen archivos de ejemplo ni casos que reutilizar. Todo se escribe desde cero, por diseño.

**Qué podés y qué no podés hacer.** Tenés acceso a los archivos del proyecto y a una consola que corre TypeScript y las pruebas del eval. **No tenés acceso a los modelos reales** (no hay Ollama): no podés medir cómo responde `prod` ni ninguna variante. Tu trabajo es **escribir bien los datasets y unas variantes de arranque**; quien tiene los modelos los mide después. Por eso toda la calidad tiene que venir del diseño y de la validación sin modelos (sección 7), y el reporte debe decir qué quedó sin medir.

## 1. Qué hay que producir

Para **una etapa de decisión** indicada en el pedido (`d0`, `route`, `tool_choice`, `args_review`, `result_verification`, `fragment_judge`, `d5`, `recovery` o `continuation`), dos archivos de datasets en `eval/datasets/<etapa>/` y de 1 a 3 variantes de arranque en `eval/variants/<etapa>/` (sección 8):

| Archivo | Uso | Casos mínimos |
|---|---|---:|
| `<etapa>_v1.jsonl` | **Desarrollo**: el optimizador del modo `--auto` mide variantes con este dataset (ve solo un resumen de errores por etiqueta, nunca los casos) | 40 |
| `<etapa>_v1_holdout.jsonl` | **Holdout**: el optimizador nunca lo ve; solo confirma que una variante mejora de verdad | 60 |

- El nombre del holdout debe terminar en `_holdout.jsonl` (el cargador lo reconoce por `(?:^|[_-])holdout\d*\.jsonl$`). Con otro nombre se mezcla con los de desarrollo.
- Si la carpeta de la etapa ya tiene archivos, `N` es el número siguiente al último; si no, `1`.
- **Desarrollo y holdout no comparten casos**, ni el mismo pedido con cambios triviales de redacción. Si dos casos se parecen, van los dos al mismo archivo.

## 2. Qué es un caso

Un caso describe una **situación** y la **etiqueta correcta**. No contiene el prompt: lo arma la variante con el código de `src/` (`prod` usa el de Jarvis). Una clave desconocida o un valor inválido es error de carga (`archivo:línea: mensaje`); esto incluye las claves de `scenario.at`.

Campos de una línea: `id` (único en el archivo), `stage`, `tags`, `description`, `scenario`, `expect`. Los campos de `scenario` (incluido `at`) y las claves de `expect` de cada etapa están en `eval/REFERENCIA.md` sección 3 y en `eval/core/stages/<etapa>.ts` (función `buildRequest` y `expectSpec`).

Ejemplo del formato (etapa `route`; hay un caso por etapa en `eval/datasets/smoke.jsonl`, solo para leer):

```json
{"id":"route-v1-01","stage":"route","tags":["typical"],"description":"Hay que leer package.json y falta anotar la versión en el README: la lectura es files_read.","scenario":{"mode":"reactive","request":"Fijate qué versión tiene /home/user/app/package.json y dejá anotada esa versión al final del README.md","steps":[{"state":"running"}]},"expect":{"expectedRoute":"files_read"}}
```

Claves obligatorias de `expect` por etapa:

| Etapa | Clave | Valores |
|---|---|---|
| `d0` | `expectedKind` | `chat`, `single`, `multi` |
| `route` | `expectedRoute` | una de las 6 rutas ejecutables |
| `tool_choice` | `expectedTool` | una herramienta del grupo de `scenario.at.route` |
| `args_review` | `expectedReview` | `approved`, `args_invalid`, `info_missing` |
| `result_verification` | `expectedOk`, `expectedCumple` | booleanos |
| `fragment_judge` | `expectedRelevant` | lista de booleanos |
| `d5` | `expectedComplete` | booleano |
| `recovery` | `expectedAction` | `close`, `rewrite_item`, `replan` |
| `continuation` | `expectedFollows` | booleano |

### Las opciones de `route` y `tool_choice` no las declara el caso

Son las del backend, siempre, y salen del catálogo (`src/core/tools/manifest.ts`, vía `eval/core/offered.ts`). `at.routes` y `at.tools` no existen y son error de carga.

- **`route` (D1)** ofrece siempre las 6 rutas: `terminal`, `files_read`, `files_write`, `system`, `multimedia`, `web`.
- **`tool_choice` (D2)** ofrece todas las herramientas visibles de la ruta que declara el caso en `scenario.at.route` (un grupo por ruta; las herramientas internas no se ofrecen):

| Ruta (`at.route`) | Herramientas que ve D2 |
|---|---|
| `files_read` | `find_files`, `list_folder`, `search_content`, `read_file` |
| `files_write` | `write_file`, `edit_file`, `convert_file`, `create_folder`, `copy_file`, `move_file`, `delete_file`, `archive_files` |
| `system` | `system_info`, `stop_process`, `pc_settings`, `power`, `open_on_screen`, `clipboard` |
| `multimedia` | `play_media`, `media_control` |
| `web` | `web_search`, `download_file` |
| `terminal` | `run_command` (una sola: no hay decisión, no se escriben casos de `tool_choice` para ella) |

Verificá la lista vigente en `eval/core/offered.ts` y el manifest antes de escribir: si `src/` cambió, manda el catálogo y no esta tabla.

Producción descarta en tiempo de ejecución algunas rutas y herramientas (lista negra, ruta agotada); el eval no lo reproduce. Los marcadores de intento fallido (por ejemplo `[FAILED - AVOID]`) sí aparecen en el prompt cuando el escenario trae llamadas con `status` fallido.

## 3. Cómo se decide la etiqueta

1. **La etiqueta sale de la documentación del sistema, no de lo que responda un modelo.** Las fuentes son `src/core/tools/manifest.ts` (descripción de cada ruta y de cada herramienta), el código de la etapa en `src/` y `eval/core/stages/<etapa>.ts`.
2. **No uses a `prod` para etiquetar** ni para decidir qué casos conservar.
3. Si según la documentación un caso admite dos etiquetas razonables, **descartalo**. Si solo una es defendible pero un modelo podría dudar, conservalo con el tag `ambiguous` y explicá el criterio en `description`.
4. Cada `description` dice qué distingue al caso y por qué la etiqueta es la correcta (una frase).

## 4. Composición

- **Etiquetas balanceadas:** ninguna etiqueta supera el 35 % del archivo; ninguna queda por debajo del 5 % si el sistema la usa. Documentá el motivo de cualquier excepción.
- **Tags** (en `tags`): `typical` (caso claro), `edge` (límite entre dos etiquetas), `hard` (confusión típica entre etiquetas, pensada por diseño), `ambiguous`, `negative` (parece de una etiqueta pero es de otra), `recovery` (con intento previo fallido en `calls`).
- **Proporciones orientativas por archivo:** 50 a 60 % `typical`, 25 a 30 % `hard`, el resto `edge`, `ambiguous`, `negative` y `recovery`.
- **Variedad:** distintos verbos y estructuras de pedido; con y sin ruta o archivo mencionado; con y sin contexto previo (`steps` y `calls`). Para variar la dificultad se varía el pedido y el contexto, nunca las opciones ofrecidas.
- Los casos `hard` se escriben **por diseño**: enumerá las confusiones típicas entre etiquetas (por ejemplo, información del sistema contra ejecutar un comando) y escribí casos para cada una.

**Cobertura propia de cada etapa:**

- **`route`:** las 6 etiquetas con casos; ninguna ruta debe quedar fuera. Incluí las confusiones entre rutas vecinas (`files_read` contra `files_write`, `system` contra `terminal`, `web` contra `files_read`).
- **`tool_choice`:** casos de **cada grupo con más de una herramienta** (`files_read`, `files_write`, `system`, `multimedia`, `web`), repartidos de forma pareja: como mínimo 8 por grupo en desarrollo y 12 en holdout, y todas las herramientas del grupo como respuesta correcta en algún caso (donde la mayoría tiene que ser una herramienta distinta de la más obvia). Sin casos de `terminal`.
- **`args_review`, `result_verification`, `recovery`, `d5`, `continuation`:** casos con y sin historia previa de la tarea (`steps`, `calls`), con resultados de herramientas reales del manifest y errores plausibles (`status`, `summary`).
- **`fragment_judge`:** fragmentos relevantes, de navegación, de publicidad y parcialmente relevantes; de 1 a 5 fragmentos por caso.

## 5. Dificultad: se diseña, no se mide

El holdout tiene que poder distinguir una mejora real, y un holdout donde `prod` ya acierta casi todo no lo permite. Desde acá no se puede medir a `prod`, así que la dificultad se garantiza **por diseño**:

1. Escribí los casos `hard` enumerando antes las confusiones típicas entre etiquetas (sección 4) y cubriendo cada una con varias formulaciones. No alcanza con casos claros.
2. Cada etiqueta se defiende con la documentación (sección 3). Un caso fácil de etiquetar no es por eso un caso fácil para el modelo: pensá en pedidos con ruido, con contexto previo que distrae, con verbos que apuntan a otra etiqueta.
3. Con 60 casos, un caso vale unos 1,7 puntos. Por eso el holdout no baja de 60 casos.
4. **No hay calibración contra `prod`.** Quien mide después puede ampliar el holdout con más casos `hard`; tu reporte lista qué confusiones cubriste y cuáles quedaron sin cubrir, para que sepa dónde ampliar.

## 6. Uso de trazas reales

Las trazas están en `jarvis-traces/<carpeta>/` (`summary.md` legible, `trace.json`, `full.json.gz`). Sirven para tres cosas: tipos de pedidos reales, formulaciones reales y errores reales de herramientas (`status` y `summary` de las llamadas).

- **Anonimizá siempre:** rutas como `C:/Users/usuario/...`; sin nombres reales, correos, tokens, claves ni URLs privadas.
- **Reescribí los textos**, no los copies literales.
- `npm run eval:traces -- --dry-run --anonymize` convierte trazas a casos candidatos. Las etiquetas inferidas **pueden ser erróneas**: revisalas una por una contra la sección 3. Las opciones que vio el modelo en la traza no se copian: el conversor ya no las vuelca al caso.
- Una traza produce, como mucho, uno o dos casos por etapa; no la uses para llenar un dataset.

## 7. Validación (en este orden, todo sin modelos)

```powershell
npx tsc --noEmit
```

```powershell
npx tsx eval/cli.ts --dataset=<nombre> --stages=<etapa> --dry-run
```

```powershell
npx tsx eval/cli.ts --client=oracle --dataset=<nombre> --stages=<etapa> --label=oraculo
```

El cliente `oracle` responde lo que pide cada caso y debe dar **100 %**: confirma que el formato y las etiquetas son coherentes con el evaluador. Si no da 100 %, el problema está en el caso, no en un modelo. El oráculo solo corre con `prod` (no con variantes). Para las variantes:

```powershell
npx tsx eval/cli.ts --client=mock --dataset=<nombre> --stages=<etapa> --variant=prod,<variante>
```

El cliente `mock` no mide nada: comprueba que la variante carga y arma todos los casos respetando la estructura de producción. Por último, corré las pruebas del eval, que tienen que seguir pasando:

```powershell
npx tsx --test --test-timeout=60000 eval/core/*.test.ts eval/auto/*.test.ts
```

Las corridas con `--client=oracle` y `--client=mock` escriben en `eval/results/`; borrá esas carpetas al terminar. **No uses `--client=real` ni `--auto`**: necesitan los modelos.

## 8. Variantes iniciales

Además de los datasets, se escriben **variantes de arranque** de la etapa: de 1 a 3 archivos en `eval/variants/<etapa>/<etapa>_v<N>.ts` (el nombre del archivo, el `name` y la constante deben coincidir; es único en todo `eval/variants/`). Son hipótesis para que quien tiene los modelos las mida; **no se pueden probar acá**, así que cada una lleva su hipótesis escrita y un solo cambio claro.

- **`mode: "prompt"`** (el valor por defecto de este encargo): la variante solo cambia textos (instrucción de cada pregunta, descripción de cada opción, nota de estado). Las preguntas y las opciones, y su orden, son las del backend: el eval arma también el request de `prod` y rechaza al cargar cualquier desvío. Una variante con otras preguntas u opciones es `mode: "structure"` y solo se escribe si el pedido lo indica.
- Se escribe **envolviendo la función de producción** (`DECISION_PROMPTS.<constructor>`) y reemplazando solo textos. No se copia ni se reescribe el constructor entero.
- Los textos de la variante salen de la documentación del sistema (`manifest.ts`, el código de la etapa), no de cómo responde `prod`: no hay forma de verlo desde acá.
- Constructor de cada etapa: `d0` → `buildFirstQuery`, `route` → `buildRouteChoice`, `tool_choice` → `buildToolChoice`, `args_review` → `buildArgsReview`, `result_verification` → `buildResultVerification`, `fragment_judge` → `buildFragmentJudge`, `d5` → `buildCompletionCheck`, `recovery` → `buildRecovery`, `continuation` → `buildContinuation`. Las claves de pregunta y de opción se ven armando un caso: `npx tsx eval/cli.ts --client=mock --dataset=smoke --stages=<etapa> --dry-run`.

Plantilla (etapa `route`; para otra etapa se cambian el constructor, la clave de la pregunta y los textos):

```ts
/**
 * eval/variants/route/route_v1.ts
 *
 * Hipótesis: <qué se cambia y por qué debería mejorar, en una frase>.
 */

import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Solo textos. Las preguntas y las opciones (y su orden) son las de producción: el eval lo comprueba al cargar.
const INSTRUCTIONS = "Pick the single best executable route for the current step.";
const CRITERIA: Record<string, string> = {
  files_read: "Read-only file and folder inspection: find, list, search inside files, read content.",
};

// Producción agrega al final de una opción una marca entre corchetes (por ejemplo `[FAILED - AVOID]`); se conserva.
const MARK = /\s*(\[[^\]]*\])\s*$/;

function buildRouteChoice(data: Parameters<typeof DECISION_PROMPTS.buildRouteChoice>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildRouteChoice(data);
  const question = base.questions.route;
  if (question.type !== "choice") return base;
  const criteria = Object.fromEntries(
    Object.entries(question.criteria).map(([option, text]) => {
      const own = CRITERIA[option];
      return [option, own === undefined ? text : `${own}${MARK.exec(text) ? ` ${MARK.exec(text)?.[1]}` : ""}`];
    }),
  );
  return { ...base, questions: { route: { ...question, instructions: INSTRUCTIONS, criteria } } };
}

const route_v1: Variant = {
  name: "route_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRouteChoice } },
};
export default route_v1;
```

Validación de una variante (sin modelos): `npx tsc --noEmit` y `npx tsx eval/cli.ts --client=mock --dataset=<nombre> --stages=<etapa> --variant=prod,<variante>`. El cliente `mock` no mide nada (da cualquier resultado): solo comprueba que la variante carga, que arma todos los casos del dataset y que respeta la estructura de producción. Un error de carga dice el archivo, la línea y el motivo.

## 9. Qué no hacer

- No modificar `src/`, `eval/core/`, `eval/auto/`, `eval/datasets/smoke.jsonl` ni datasets de otras etapas.
- No ejecutar `--auto` ni ninguna corrida con modelos reales.
- No crear variantes `mode: "structure"` salvo que el pedido lo indique.
- No copiar ni reutilizar casos de `eval/auto/fixtures/`.
- No declarar `at.routes` ni `at.tools`: no existen.
- No repetir `id` ni reutilizar los de otros archivos.
- No incluir datos personales.

## 10. Reporte final que debe entregar

1. Archivos creados (datasets y variantes), con cantidad de casos.
2. Tabla de casos por etiqueta y por tag, para cada archivo (en `tool_choice`, también por ruta y por herramienta esperada).
3. Resultado de las validaciones sin modelos: `tsc`, `--dry-run`, oráculo (`n/N`), `mock` con cada variante y las pruebas.
4. Por cada variante: su hipótesis y qué textos cambia.
5. **Qué quedó sin medir:** el resultado de `prod` y el de cada variante (lo mide quien tiene los modelos), y las confusiones entre etiquetas que no se cubrieron.
6. Lista de casos `ambiguous` con el criterio aplicado.
7. Supuestos y casos descartados, con el motivo.

---

## Archivos para pasarle al agente

Si el agente tiene acceso a los archivos del proyecto, alcanza con las rutas. Si no, pasarle:

1. **Este documento:** `docs/evaluacion/INSTRUCCIONES_AGENTE_DATASETS.md`.
2. **Para ver el formato:** `eval/REFERENCIA.md` (sección 3) y `eval/datasets/smoke.jsonl` (un caso por etapa; solo de lectura).
3. **Dos o tres trazas** de `jarvis-traces/` con tareas distintas y, si hay, con herramientas que fallaron: de cada carpeta, `summary.md` y `trace.json`. (`full.json.gz` solo si el agente puede descomprimirlo.)
4. **Para saber cómo se arma cada etapa:** `eval/core/stages/<etapa>.ts` (los campos de `scenario.at` cambian de una etapa a otra), `eval/core/offered.ts` y `src/core/tools/manifest.ts` (descripciones de rutas y herramientas, que son la fuente de las etiquetas).
