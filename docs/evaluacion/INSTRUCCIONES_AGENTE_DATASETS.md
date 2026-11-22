# Instrucciones para el agente que crea datasets de `eval`

Este documento es el encargo completo. Lo que no está acá no se asume. El formato de los archivos está en `eval/REFERENCIA.md`, sección 3; este documento agrega el método, la calidad exigida y la validación.

## 1. Qué hay que producir

Para **una etapa de decisión** indicada en el pedido (`d0`, `route`, `tool_choice`, `args_review`, `result_verification`, `fragment_judge`, `d5`, `recovery` o `continuation`), dos archivos en `eval/datasets/<etapa>/`:

| Archivo | Uso | Casos mínimos |
|---|---|---:|
| `<etapa>_v<N>.jsonl` | **Desarrollo**: el optimizador del modo `--auto` mide variantes con este dataset (ve solo un resumen de errores por etiqueta, nunca los casos) | 40 |
| `<etapa>_v<N>_holdout.jsonl` | **Holdout**: el optimizador nunca lo ve; solo confirma que una variante mejora de verdad | 60 |

- El nombre del holdout debe terminar en `_holdout.jsonl` (el cargador lo reconoce por `(?:^|[_-])holdout\d*\.jsonl$`). Con otro nombre se mezcla con los de desarrollo.
- `N` es el número siguiente al último existente en esa carpeta.
- **Desarrollo y holdout no comparten casos**, ni el mismo pedido con cambios triviales de redacción. Si dos casos se parecen, van los dos al mismo archivo.

## 2. Qué es un caso

Un caso describe una **situación** y la **etiqueta correcta**. No contiene el prompt: lo arma la variante con el código de `src/`. Una clave desconocida o un valor inválido es error de carga (`archivo:línea: mensaje`).

Campos de una línea: `id` (único en el archivo), `stage`, `tags`, `description`, `scenario`, `expect`. Los campos de `scenario` (incluido `at`) y las claves de `expect` de cada etapa están en `eval/REFERENCIA.md` sección 3 y en `eval/core/stages/<etapa>.ts` (función `buildRequest` y `expectSpec`).

Claves obligatorias de `expect` por etapa de decisión:

| Etapa | Clave | Valores |
|---|---|---|
| `d0` | `expectedKind` | `chat`, `single`, `multi` |
| `route` | `expectedRoute` | una ruta ofrecida en `scenario.at.routes` |
| `tool_choice` | `expectedTool` | una herramienta ofrecida |
| `args_review` | `expectedReview` | `approved`, `args_invalid`, `info_missing` |
| `result_verification` | `expectedOk`, `expectedCumple` | booleanos |
| `fragment_judge` | `expectedRelevant` | lista de booleanos |
| `d5` | `expectedComplete` | booleano |
| `recovery` | `expectedAction` | `close`, `rewrite_item`, `replan` |
| `continuation` | `expectedFollows` | booleano |

Ejemplo del formato (etapa `route`): ver los archivos de ejemplo listados al final de este documento.

## 3. Cómo se decide la etiqueta

1. **La etiqueta sale de la documentación del sistema, no de lo que responda un modelo.** Las fuentes son `src/core/tools/manifest.ts` (descripción de cada ruta y de cada herramienta), el código de la etapa en `src/` y `eval/core/stages/<etapa>.ts`.
2. **No uses a `prod` para etiquetar** ni para decidir qué casos conservar.
3. Si según la documentación un caso admite dos etiquetas razonables, **descartalo**. Si solo una es defendible pero un modelo podría dudar, conservalo con el tag `ambiguous` y explicá el criterio en `description`.
4. Cada `description` dice qué distingue al caso y por qué la etiqueta es la correcta (una frase).

## 4. Composición

- **Etiquetas balanceadas:** ninguna etiqueta supera el 35 % del archivo; ninguna queda por debajo del 5 % si el sistema la usa. Documentá el motivo de cualquier excepción.
- **Tags** (en `tags`): `typical` (caso claro), `edge` (límite entre dos etiquetas), `hard` (confusión típica entre etiquetas, pensada por diseño), `ambiguous`, `negative` (parece de una etiqueta pero es de otra), `recovery` (con intento previo fallido en `calls`).
- **Proporciones orientativas por archivo:** 50 a 60 % `typical`, 25 a 30 % `hard`, el resto `edge`, `ambiguous`, `negative` y `recovery`.
- **Variedad:** distintos verbos y estructuras de pedido; con y sin ruta o archivo mencionado; con y sin contexto previo (`steps` y `calls`); en etapas con opciones ofrecidas, subconjuntos distintos que incluyan siempre la correcta.
- Los casos `hard` se escriben **por diseño**: enumerá las confusiones típicas entre etiquetas (por ejemplo, información del sistema contra ejecutar un comando) y escribí casos para cada una.

## 5. Calibración de dificultad

El holdout debe poder distinguir una mejora real. Un holdout donde `prod` ya saca 95 % no lo permite.

1. Escribí los casos por diseño, **sin mirar cómo responde `prod`**.
2. Validá el formato (sección 7).
3. Medí `prod` **una vez** sobre cada archivo y reportá el resultado (`n/N`).
4. **No agregues ni quites casos por haber visto fallar a `prod`.** Eso sesga el dataset. Si el resultado de `prod` en el holdout es mayor o igual a 90 %, reportalo tal cual; se puede ampliar con casos **nuevos** `hard` escritos por diseño, nunca copiando los que `prod` falló.
5. Con 60 casos, un caso vale unos 1,7 puntos. Por eso el holdout no baja de 60 casos.

## 6. Uso de trazas reales

Las trazas están en `jarvis-traces/<carpeta>/` (`summary.md` legible, `trace.json`, `full.json.gz`). Sirven para tres cosas: tipos de pedidos reales, formulaciones reales y errores reales de herramientas (`status` y `summary` de las llamadas).

- **Anonimizá siempre:** rutas como `C:/Users/usuario/...`; sin nombres reales, correos, tokens, claves ni URLs privadas.
- **Reescribí los textos**, no los copies literales.
- `npm run eval:traces -- --dry-run --anonymize` convierte trazas a casos candidatos. Las etiquetas inferidas **pueden ser erróneas**: revisalas una por una contra la sección 3.
- Una traza produce, como mucho, uno o dos casos por etapa; no la uses para llenar un dataset.

## 7. Validación (en este orden)

```powershell
npx tsx eval/cli.ts --dataset=<nombre> --stages=<etapa> --dry-run
```

```powershell
npx tsx eval/cli.ts --client=oracle --dataset=<nombre> --stages=<etapa> --label=oraculo
```

El cliente `oracle` debe dar 100 %: confirma que el formato y las etiquetas son coherentes con el evaluador. Después, con Ollama activo, medí `prod` real:

```powershell
npx tsx eval/cli.ts --dataset=<nombre> --stages=<etapa> --label=base_prod
```

Los dos últimos comandos escriben en `eval/results/`; borrá esas carpetas al terminar.

## 8. Qué no hacer

- No modificar `src/`, `eval/core/`, `eval/auto/`, `eval/datasets/smoke.jsonl` ni datasets existentes.
- No crear variantes ni ejecutar `--auto`.
- No copiar ni reutilizar casos de `eval/auto/fixtures/`.
- No repetir `id` ni reutilizar los de otros archivos.
- No incluir datos personales.

## 9. Reporte final que debe entregar

1. Archivos creados, con cantidad de casos.
2. Tabla de casos por etiqueta y por tag, para cada archivo.
3. Resultado del oráculo y de `prod` (`n/N`) en desarrollo y en holdout.
4. Lista de casos `ambiguous` con el criterio aplicado.
5. Supuestos y casos descartados, con el motivo.

---

## Archivos para pasarle al agente

Si el agente tiene acceso a los archivos del proyecto, alcanza con las rutas. Si no, pasarle:

1. **Este documento:** `docs/evaluacion/INSTRUCCIONES_AGENTE_DATASETS.md`.
2. **Un dataset de ejemplo de la etapa pedida:** `eval/datasets/<etapa>/<etapa>_v1.jsonl` (desarrollo). Para ver un holdout completo de ejemplo: `eval/datasets/route/route_v1_holdout.jsonl`.
3. **Dos o tres trazas** de `jarvis-traces/` con tareas distintas y, si hay, con herramientas que fallaron: de cada carpeta, `summary.md` y `trace.json`. (`full.json.gz` solo si el agente puede descomprimirlo.)
4. **Para saber cómo se arma cada etapa:** `eval/REFERENCIA.md` (sección 3), `eval/core/stages/<etapa>.ts` y `src/core/tools/manifest.ts` (descripciones de rutas y herramientas, que son la fuente de las etiquetas).

Con el dataset de ejemplo y un par de trazas alcanza para empezar en `route` y `d0`. Para las demás etapas el agente necesita además `eval/core/stages/<etapa>.ts`, porque los campos de `scenario.at` cambian de una a otra.
