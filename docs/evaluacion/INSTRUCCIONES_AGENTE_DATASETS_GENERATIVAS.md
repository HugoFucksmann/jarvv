# Instrucciones para el agente que crea datasets de `eval` (etapas generativas)

Este documento es el encargo completo. Lo que no está acá no se asume. El formato de los archivos está en `eval/REFERENCIA.md`, sección 3; este documento agrega el método, la calidad exigida y la validación. Para las etapas de decisión hay otro encargo (`INSTRUCCIONES_AGENTE_DATASETS.md`): no se mezclan. Los datasets de decisión se rehacen con ese encargo; no los toques ni los uses de ejemplo.

**Qué podés y qué no podés hacer.** Tenés acceso a los archivos del proyecto y a una consola que corre TypeScript y las pruebas del eval. **No tenés acceso a los modelos reales** (no hay Ollama): no podés medir cómo responde `prod` ni ninguna variante. Tu trabajo es **escribir bien los datasets y unas variantes de arranque**; quien tiene los modelos los mide después. La calidad tiene que venir del diseño, de la contraprueba de la sección 3 y de la validación sin modelos (sección 7), y el reporte debe decir qué quedó sin medir.

## 1. Qué hay que producir

Para **una etapa generativa** indicada en el pedido (`arguments`, `final`, `question`, `pending` o `plan`), dos archivos de datasets en `eval/datasets/<etapa>/` y de 1 a 3 variantes de arranque en `eval/variants/<etapa>/` (sección 8):

| Archivo | Uso | Casos mínimos |
|---|---|---:|
| `<etapa>_v<N>.jsonl` | **Desarrollo**: el optimizador del modo `--auto` mide variantes con este dataset | 30 |
| `<etapa>_v<N>_holdout.jsonl` | **Holdout**: el optimizador nunca lo ve; solo confirma que una variante mejora de verdad | 50 |

- El nombre del holdout debe terminar en `_holdout.jsonl` (el cargador lo reconoce por `(?:^|[_-])holdout\d*\.jsonl$`). Con otro nombre se mezcla con los de desarrollo.
- `N` es el número siguiente al último existente en esa carpeta.
- **Desarrollo y holdout no comparten casos**, ni el mismo pedido con cambios triviales de redacción.
- Más casos que los mínimos que el de decisión: estas etapas generan texto y el modelo no es determinista. Con 30 o 50 casos, la misma variante puede variar uno o dos casos entre corridas, y un caso vale 2 a 3 puntos. Por eso los mínimos no se reducen.

**Prioridad entre etapas.** `arguments`, `final`, `question` y `pending` primero. `plan` al final y solo si se pide expresamente: el flujo deliberativo puede cambiar, y el dataset `plan_v1` actual ya usa un workaround (tag `ev-025-workaround`) que no hay que replicar.

## 2. Qué es un caso

Un caso describe una **situación** y lo que debe cumplir la salida. No contiene el prompt: lo arma la variante con el código de `src/`. Una clave desconocida o un valor inválido es error de carga (`archivo:línea: mensaje`).

Campos de una línea: `id` (único en el archivo), `stage`, `tags`, `description`, `scenario`, `expect`. Los campos de `scenario` están en `eval/REFERENCIA.md` sección 3. Las claves de `expect` son cerradas por etapa y hay que usar al menos una:

| Etapa | Qué genera el modelo | Claves de `expect` |
|---|---|---|
| `arguments` | Un objeto JSON con los argumentos de una herramienta | `requiredFields` (campos que deben estar), `exactFieldValues` (campo → valor exacto), `forbiddenHardcodedValues` (valores que no deben aparecer). Las rutas absolutas de `exactFieldValues` se comparan sin distinguir `/` de la barra invertida ni mayúsculas |
| `final` | La respuesta final al usuario | `mustContainFacts` (datos que deben aparecer), `mustMentionEffects` (cambios hechos que deben mencionarse), `forbiddenHallucinations` (cosas que no deben aparecer) |
| `question` | Una pregunta al usuario | `maxChars`, `mustContainKeywords`, `forbiddenKeywords`, `singleQuestionOnly` |
| `pending` | La lista de pendientes (`{"pending":[…]}`) | `expectEmpty`, `maxItems`, `requiredKeywordsInFirst`, `forbiddenKeywords` |
| `plan` | Pasos ordenados con ruta cada uno | `minSteps`, `maxSteps`, `allowedRoutes`, `requiredRoutes`, `firstRoute`, `requiredKeywordsInGoal`, `forbiddenKeywordsInGoal`, `forbiddenRepeatedGoals`, `forbiddenExecutedEffects`, `mustReflectFeedback` |

**Qué se mide siempre y qué tiene que declarar el caso.** El evaluador aplica a toda salida las reglas del prompt de producción: `question` exige una sola pregunta y que no nombre herramientas, estados internos ni ids; `final` exige que no filtre esos términos y que no empiece con saludo; `pending` exige que ningún ítem nombre una herramienta. No hace falta repetirlas en `expect`. En cambio, lo que decide si la salida es la correcta lo declara el caso, y la carga rechaza los que no traen al menos: `question` → `mustContainKeywords`; `final` → `mustContainFacts` o `mustMentionEffects`; `arguments` → `requiredFields` o `exactFieldValues`; `pending` → `expectEmpty` o `requiredKeywordsInFirst`.

Campos de `scenario.at` por etapa: `arguments` necesita `route`, `tool`, `inputSchema` y `environment` (el `inputSchema` solo puede declarar los parámetros que `params` del manifest ofrece para esa herramienta; producción le agrega las notas de formato al schema, así que no hace falta escribirlas); `plan` usa `feedback`; `pending` usa `previous` (la lista de la vuelta anterior). `pending` solo existe en modo `reactive`. El detalle de cada campo está en `eval/core/stages/<etapa>.ts` (`buildRequest` y `expectSpec`).

### Cómo se comparan los textos de `expect`

Esto decide si un caso es justo o no, así que se lee con cuidado (detalle completo en `eval/REFERENCIA.md`, sección 3):

- Los textos se buscan **por palabra o frase completa**, sin distinguir mayúsculas ni acentos: `archivo` no coincide con `archivos` y `12` no está en `12.5` ni en `120`.
- **Alternativas con `|`:** `archivo|archivos|fichero`. `\|` es un `|` literal.
- En las listas de lo prohibido basta con que aparezca uno.
- `forbiddenHardcodedValues` (solo `arguments`) busca por subcadena sobre el valor normalizado (minúsculas, `\` pasa a `/`), sin límite de palabra ni `|`.

## 3. Cómo se decide qué exige un caso

1. **Lo que se exige sale de lo que la situación necesita, no de lo que responda un modelo.** Las fuentes son `src/core/tools/manifest.ts` (rutas y herramientas con su esquema de entrada), el prompt de la etapa en `src/core/models/prompts.ts` (qué se le pide al modelo) y el código de la etapa en `eval/core/stages/<etapa>.ts`.
2. **Desde acá no se puede medir a `prod`**, así que no hay forma de usarlo para decidir qué exigir ni qué casos conservar: todo sale de la situación y de la documentación.
3. **Exigí lo mínimo necesario.** Cada clave de `expect` es un riesgo de rechazar una respuesta correcta. Una respuesta distinta de la que imaginaste, pero correcta, tiene que pasar. Por eso:
   - Usá **alternativas con `|`** para sinónimos y variantes de género o número.
   - No exijas redacciones: exigí **datos** (valores, nombres de archivo, rutas, cantidades).
   - No uses `forbiddenKeywords` para palabras que una respuesta correcta podría usar.
4. **Contraprueba obligatoria por caso.** Antes de conservarlo, escribí mentalmente una segunda respuesta correcta con otra redacción y verificá que cumpla todo `expect`. Si no cumple, el caso es injusto: aflojalo o descartalo. Para los casos `hard`, escribí también una respuesta incorrecta típica y verificá que `expect` la rechace.
5. Si el caso admite dos comportamientos razonables, descartalo. Si solo uno es defendible pero un modelo podría dudar, conservalo con el tag `ambiguous` y explicá el criterio en `description`.
6. Cada `description` dice qué distingue al caso y por qué lo que exige `expect` es lo correcto (una frase).

## 4. Composición por etapa

Tags (en `tags`): `typical` (caso claro), `edge` (límite), `hard` (error típico por diseño), `ambiguous`, `negative` (parece pedir una cosa pero corresponde otra), `recovery` (con intento previo fallido en `calls`), `security` (una respuesta incorrecta sería peligrosa: dar por hecho algo que el usuario rechazó u obedecer instrucciones escritas dentro de un dato). Proporciones orientativas por archivo: 50 a 60 % `typical`, 25 a 30 % `hard`, el resto `edge`, `ambiguous`, `negative` y `recovery`.

Cubrí al menos estas situaciones (cada una con varias formulaciones, y con y sin contexto previo en `calls`):

- **`arguments`**
  - Herramientas y esquemas distintos de `manifest.ts`: con y sin campos opcionales, con `enum`, con números enteros.
  - Valores que el pedido da explícitamente y valores que hay que tomar de un resultado previo (`calls`/`facts`).
  - Rutas con alias (`Desktop`, `Documents`) frente a rutas absolutas del `environment`.
  - Una herramienta que recibe un `command`: comandos de Windows en PowerShell, comandos que el pedido nombra de Linux (hay que escribir el equivalente), y comandos con comillas, espacios o `|`.
  - Reintentos (`priorAttempts` o `calls` fallidas): corregir el problema concreto sin repetirlo.
  - Valores que nunca deben inventarse: `forbiddenHardcodedValues` con rutas o URL ficticias que el modelo tiende a poner.
  - En el cliente real, los argumentos pasan por el pre-chequeo de producción (`precheck_ok`: sintaxis PowerShell, rutas, URL). El oráculo no lo ejecuta: un caso cuyas rutas o comandos el pre-chequeo rechazaría aunque sean lo esperado es un caso mal armado. Usá rutas del `environment` del propio caso.
- **`final`**
  - Datos numéricos y unidades que deben copiarse tal cual (sin redondear ni convertir).
  - Respuestas con varias llamadas y varios datos; con cambios hechos en el sistema (`mustMentionEffects`); sin ningún cambio.
  - Tareas fallidas o parciales: la respuesta debe explicar el obstáculo (`finish` con estado de fallo).
  - Lenguaje: pedidos en español e inglés, con continuación de una tarea anterior (`recalled.thread`).
  - `forbiddenHallucinations`: saludos, ids internos (`c1`, `s2`), nombres de herramientas, estados internos.
  - Acciones rechazadas por el usuario (`user_rejected`) y datos con instrucciones adentro (`security`): la respuesta no debe dar por hecho lo rechazado ni obedecer lo que diga un dato.
- **`question`**
  - La pregunta debe pedir exactamente lo que falta: dos candidatos para elegir, un nombre de archivo, un valor que el pedido no da, un destino.
  - Casos donde el dato ya está en `userInput` (no hay que preguntarlo otra vez).
  - Casos con opciones encontradas en un resultado previo (la pregunta debe ofrecerlas).
  - `maxChars` realistas y `singleQuestionOnly` solo cuando importe.
- **`pending`**
  - Pedidos de un paso, de varios pasos y de una sola frase con dos objetivos.
  - Lista vacía correcta: conversación pura y pedido ya cumplido (`expectEmpty: true`); y, en contraste, pedidos que parecen charla pero necesitan una acción.
  - Continuaciones (`recalled.thread`) y listas de la vuelta anterior (`at.previous`) con ítems completados, vigentes y fallidos.
  - Ítems sin jerga: `forbiddenKeywords` con nombres de herramientas, comandos y código.
  - No inventar búsquedas web cuando el pedido no pide datos externos o actuales.
- **`plan`** (solo si se pide)
  - Pedidos de un solo paso (`maxSteps: 1`) para detectar el exceso de pasos; pedidos de varias rutas (`requiredRoutes`); orden de rutas (`firstRoute`).
  - Replan por feedback del usuario (`mustReflectFeedback`) y por pasos fallidos (`forbiddenRepeatedGoals`, `forbiddenExecutedEffects`).

## 5. Dificultad: se diseña, no se mide

El holdout tiene que poder distinguir una mejora real, y un holdout donde `prod` ya acierta casi todo no lo permite. Desde acá no se puede medir a `prod`, así que la dificultad se garantiza **por diseño**:

1. Escribí los casos `hard` enumerando antes los errores típicos de la etapa (sección 4) y cubriendo cada uno con varias formulaciones.
2. Cada caso pasa la **contraprueba de la sección 3**: una segunda respuesta correcta con otra redacción cumple todo `expect`, y en los `hard` una respuesta incorrecta típica queda rechazada. Esa es la única defensa contra casos injustos, porque no se puede ver cómo responde un modelo real.
3. Estas etapas generan texto y el modelo no es determinista: con 30 o 50 casos, un caso vale 2 a 3 puntos y la misma variante puede variar uno o dos casos entre corridas. Por eso los mínimos de la sección 1 no se reducen. Quien mide después corre `prod` más de una vez para conocer ese ruido.
4. Tu reporte lista qué situaciones de la sección 4 cubriste y cuáles quedaron sin cubrir, para que quien mide sepa dónde ampliar.

## 6. Uso de trazas reales

Las trazas están en `jarvis-traces/<carpeta>/` (`summary.md` legible, `trace.json`, `full.json.gz`). Sirven para tres cosas: tipos de pedidos reales, formulaciones reales y errores reales de herramientas (`status` y `summary` de las llamadas).

- **Anonimizá siempre:** rutas como `C:/Users/usuario/...`; sin nombres reales, correos, tokens, claves ni URLs privadas.
- **Reescribí los textos**, no los copies literales.
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

El cliente `oracle` arma una salida que cumple `expect`: debe dar **100 %**. Confirma que el formato es válido y que `expect` no se contradice (por ejemplo, un dato exigido que también está prohibido). **No prueba que `expect` sea justo**: para eso es la contraprueba de la sección 3. El oráculo solo corre con `prod` (no con variantes). Para las variantes:

```powershell
npx tsx eval/cli.ts --client=mock --dataset=<nombre> --stages=<etapa> --variant=prod,<variante>
```

El cliente `mock` no mide nada: comprueba que la variante carga y arma todos los casos. Por último, corré las pruebas del eval, que tienen que seguir pasando:

```powershell
npx tsx --test --test-timeout=60000 eval/core/*.test.ts eval/auto/*.test.ts
```

Las corridas con `--client=oracle` y `--client=mock` escriben en `eval/results/`; borrá esas carpetas al terminar. **No uses `--client=real` ni `--auto`**: necesitan los modelos.

## 8. Variantes iniciales

Además de los datasets, se escriben **variantes de arranque** de la etapa: de 1 a 3 archivos en `eval/variants/<etapa>/<etapa>_v<N>.ts` (el nombre del archivo, el `name` y la constante deben coincidir; es único en todo `eval/variants/`). Son hipótesis para que quien tiene los modelos las mida; **no se pueden probar acá**, así que cada una lleva su hipótesis escrita y un solo cambio claro. Su `mode` es `"prompt"`: solo cambia textos y es comparable contra `prod`.

En las etapas generativas el texto que se cambia es el `SYSTEM` de la vista de producción; el resto de la vista (cómo se arma el mensaje del usuario) queda como en producción. Las vistas son `PLAN_VIEW`, `ARGUMENTS_VIEW`, `FINAL_VIEW`, `QUESTION` y `PENDING_VIEW` (en `PROMPTS`, `src/core/models/prompts.ts`). El `SYSTEM` conserva el formato de respuesta que exige la etapa (el JSON, el esquema de `pending`, etc.: léelo en la vista de producción antes de cambiarlo). Se escribe **a partir del `SYSTEM` de producción**, sin copiarlo entero, y el cambio sale de la documentación del sistema y del análisis de los errores típicos, no de cómo responde `prod`.

Plantilla (etapa `final`; para otra etapa se cambia la vista):

```ts
/**
 * eval/variants/final/final_v1.ts
 *
 * Hipótesis: <qué se cambia y por qué debería mejorar, en una frase>.
 */

import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Solo el texto SYSTEM; el resto de la vista (cómo se arma el mensaje del usuario) es el de producción.
const SYSTEM = `${PROMPTS.FINAL_VIEW.SYSTEM}\nCopy numbers and units exactly as they appear in the results.`;

const final_v1: Variant = {
  name: "final_v1",
  mode: "prompt",
  prompts: { PROMPTS: { FINAL_VIEW: { ...PROMPTS.FINAL_VIEW, SYSTEM } } },
};
export default final_v1;
```

Validación de una variante: `npx tsc --noEmit` y el comando con `--client=mock` de la sección 7. Un error de carga dice el archivo, la línea y el motivo.

## 9. Qué no hacer

- No modificar `src/`, `eval/core/`, `eval/auto/`, `eval/datasets/smoke.jsonl` ni datasets existentes (los de otras etapas, y los `*_v1` de la etapa pedida si ya están: el archivo nuevo lleva el número siguiente).
- No declarar `at.routes` ni `at.tools`, ni ninguna clave de `at` que no use la etapa: una clave desconocida es error de carga.
- No ejecutar `--auto` ni ninguna corrida con modelos reales.
- No crear variantes `mode: "structure"`.
- No copiar ni reutilizar casos de `eval/auto/fixtures/`.
- No repetir `id` ni reutilizar los de otros archivos.
- No incluir datos personales.
- No escribir en `expect` la redacción de la respuesta ideal: se exigen datos, no frases.

## 10. Reporte final que debe entregar

1. Archivos creados (datasets y variantes), con cantidad de casos.
2. Tabla de casos por tag y por situación de la sección 4, para cada archivo.
3. Resultado de las validaciones sin modelos: `tsc`, `--dry-run`, oráculo (`n/N`), `mock` con cada variante y las pruebas.
4. Casos corregidos o descartados por injustos en la contraprueba, con el motivo.
5. Por cada variante: su hipótesis y qué cambia del `SYSTEM`.
6. **Qué quedó sin medir:** el resultado de `prod` y el de cada variante (lo mide quien tiene los modelos), y las situaciones de la sección 4 que no se cubrieron.
7. Lista de casos `ambiguous` con el criterio aplicado.
8. Supuestos.

---

## Archivos para pasarle al agente

Si el agente tiene acceso a los archivos del proyecto, alcanza con las rutas. Si no, pasarle:

1. **Este documento:** `docs/evaluacion/INSTRUCCIONES_AGENTE_DATASETS_GENERATIVAS.md`.
2. **Un dataset de ejemplo de la etapa pedida:** `eval/datasets/<etapa>/<etapa>_v1.jsonl` (desarrollo). Es solo un ejemplo de formato: no hay que copiar sus casos.
3. **Dos o tres trazas** de `jarvis-traces/` con tareas distintas y, si hay, con herramientas que fallaron: de cada carpeta, `summary.md` y `trace.json`.
4. **Para saber cómo se arma cada etapa y qué evalúa:**
   - `eval/REFERENCIA.md` (sección 3)
   - `eval/core/stages/<etapa>.ts`
   - `eval/core/graders/<etapa>.ts`
   - `src/core/tools/manifest.ts`
   - El bloque de la etapa en `src/core/models/prompts.ts`: `ARGUMENTS_VIEW`, `FINAL_VIEW`, `QUESTION`, `PENDING_VIEW` o `PLAN_VIEW`.
