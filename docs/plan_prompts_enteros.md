> **Estado: implementado, con cambios.** El camino de prompts enteros se hizo con un modelo de variantes único (composición en orden de la cadena y aplicación al cargar) y la comparación de modelos se quitó. Ver `PLAN_EVAL.md` y `eval/INSTRUCCIONES.md` (sección 6). Este documento queda como referencia del diseño original.

# Plan: prompts enteros del eval viejo en el eval nuevo

## 1. Objetivo y decisión

Un archivo de prompt (`Q5.ts`) es **una variante más**, con la misma forma que `prompts.ts`. El escenario aporta el contexto real de Jarvis, el archivo aporta el prompt, y se juntan **al cargar el dataset**, que es donde hoy ya se arma el request.

```bash
npm run eval -- --variant=prod,Q5 --dataset=<dataset> --stages=arguments --repeat=3
npm run eval -- --variant=Q5+retoque ...   # prompt primero, ediciones después
```

Sin flags nuevas. Sin `prompts`, todo funciona como hoy.

**Diferencia con el md original:** el original guarda el escenario en cada caso y rearma el request dentro del runner. Este plan lo rearma en la carga, con los overrides de la variante. Se evita tocar `FrozenCase`, `runner.ts`, `validateCase`, el `throw` de seguridad y el filtro duplicado de casos `frozen`.

## 2. Qué se verificó en el código

| Afirmación | Archivo | Resultado |
|---|---|---|
| `PROMPTS` y `DECISION_PROMPTS` son objetos literales | `prompts.ts` | El spread de dos niveles funciona. `buildSystemPrompt` usa `this.SYSTEM` y `this.READ_REFS_NOTE`, y con el spread `this` apunta al objeto mezclado. |
| `Partial<typeof PROMPTS>` sirve como tipo | `prompts.ts` | **No.** `PROMPTS` es `as const`: `SYSTEM` tiene tipo literal y un texto distinto no compila. Hace falta un tipo ensanchado. |
| Los helpers (`todayLine`, `join`, `safe`, `listBlock`, `frameLines`…) | `prompts.ts` | Privados. El eval no importa `src/`, así que un `Q5` que redefina `buildUserPrompt` o un `buildX` trae sus propias copias. |
| El request se arma al cargar y el escenario se descarta | `datasets.ts` (`loadFile`) | Confirmado. El escenario se separa con `{ scenario, ...rest }` y nunca llega al caso. |
| Existe un filtro por origen | `datasets.ts` (`CaseFilters.source`) | Confirmado: `"frozen" \| "scenario"`. |
| `validateCase` corre después de materializar | `datasets.ts` | Confirmado. El request ya armado entra por el mismo camino que un caso fijo. |
| Las ediciones actuales solo editan texto ya armado | `apply.ts` | Pueden reemplazar `system` y `user` (valor fijo o función sobre el texto), y en decisión `state` y preguntas. **No pueden reconstruir `user` ni `state` desde los datos del caso.** Por eso el rebuild sigue haciendo falta. |
| `questionStageRequest` no recibe `config` | `stageRequests.ts` | Confirmado. |
| El tipo real de `Variant` está en `eval/core/types.ts` | `variants/types.ts` (re-export) | Confirmado, líneas 236-240. |
| `composeParseView` pierde campos nuevos con `a+b` | `variants/load.ts` | Confirmado: devuelve solo `{ name, decision, generative }`. |
| Los datasets se cargan una sola vez, antes de las variantes | `cli.ts` líneas 285-297 | Confirmado. Con `prompts` hay que cargar por variante. |
| El loop real es `variante × dataset × modelo`; el dry-run es `dataset × variante × modelo` | `cli.ts` líneas 347-349 y 406-408 | Confirmado. |

## 3. Complejidad que se descarta

| Del plan original | Por qué sobra |
|---|---|
| `FrozenCase.scenario?` y guardarlo en `datasets.ts` | Con el rebuild en la carga, el caso no necesita recordar su escenario. |
| Bloque nuevo en `runner.ts` dentro del `try` de "Aplicar variante" | El request ya llega armado. El runner no cambia. |
| `throw` si la variante trae `prompts` y el caso no tiene escenario | Los casos `frozen` nunca llegan a una variante con `prompts` (ver sección 4.6). |
| Filtrar `frozen` en dos lugares de `cli.ts` | Se resuelve una vez, al armar los datasets de cada variante, con el filtro `source` que ya existe. |
| Unificar las firmas de las cuatro funciones de `stageRequests.ts` | Tocaría el motor. Alcanza con un parámetro final con default. |
| Mantener `Partial<typeof PROMPTS>` | No compila (sección 2). Se reemplaza por un tipo ensanchado. |

**Costo asumido:** un prompt con error aborta la corrida al cargar, con formato `archivo:línea` y salida 2, en vez de marcar `variant_apply_error` caso por caso. Falla rápido, y es consistente con cómo ya se tratan los escenarios inválidos.

## 4. Cambios

Orden sugerido: hacer antes la tarea de la sección 7, porque quita una dimensión del loop de `cli.ts` que se toca acá.

### 4.1 `src/core/reasoner/stageRequests.ts` (src, comportamiento de producción intacto)

Tipo ensanchado y parámetro final con default. El motor sigue llamando igual.

```ts
type Widen<T> = T extends string ? string : T extends (...a: never[]) => unknown ? T : { -readonly [K in keyof T]: Widen<T[K]> };
export type PromptSet = Widen<typeof PROMPTS>;

planStageRequest(input, config, prompts: PromptSet = PROMPTS)       // prompts.PLAN_VIEW
argumentsStageRequest(input, config, prompts: PromptSet = PROMPTS)  // prompts.ARGUMENTS_VIEW
questionStageRequest(input, prompts: PromptSet = PROMPTS)           // prompts.QUESTION (sin config, como hoy)
finalStageRequest(input, config, prompts: PromptSet = PROMPTS)      // prompts.FINAL_VIEW
```

Reemplazar cada `PROMPTS.X` del cuerpo por `prompts.X`.

### 4.2 `eval/core/scenario.ts`

```ts
import { DECISION_PROMPTS, PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { PromptSet } from "../../src/core/reasoner/stageRequests.ts";

export interface PromptOverrides {
  PROMPTS?: { [K in keyof PromptSet]?: Partial<PromptSet[K]> };
  DECISION_PROMPTS?: Partial<typeof DECISION_PROMPTS>;
}

function effectivePrompts(ov?: PromptOverrides) {
  if (!ov) return { P: PROMPTS as PromptSet, D: DECISION_PROMPTS };   // idéntico a hoy
  const P = Object.fromEntries(
    Object.entries(PROMPTS).map(([k, v]) => [k, { ...v, ...ov.PROMPTS?.[k as keyof PromptSet] }]),
  ) as PromptSet;
  return { P, D: { ...DECISION_PROMPTS, ...ov.DECISION_PROMPTS } };
}

export function materializeScenario(stage: string, sc: Scenario, ov?: PromptOverrides): Materialized {
  const { P, D } = effectivePrompts(ov);
  ...
}
```

- Decisión: `DECISION_PROMPTS.buildX(...)` pasa a `D.buildX(...)` (4 sitios).
- Generativas: pasar `P` como último argumento (4 sitios). En `question` es `questionStageRequest({ view }, P)`.
- Actualizar el comentario del encabezado: el `request` se arma "al cargar el dataset, con los prompts de producción o los de la variante".

### 4.3 `eval/core/datasets.ts`

- `loadFile(path, errors, ov?)` pasa `ov` a `materializeScenario(String(rest.stage), scenario as Scenario, ov)`.
- `loadDatasets(specs, filters = {}, ov?)` pasa `ov` a `loadFile`.

### 4.4 `eval/core/types.ts` (interfaz `Variant`, línea 236)

```ts
import type { PromptOverrides } from "./scenario.ts";
export interface Variant {
  name: string;
  prompts?: PromptOverrides;
  decision?: ...;
  generative?: ...;
}
```

Es un `import type`, así que no hay ciclo en runtime. **Confirmar al implementar** que ninguna regla del repo (el encabezado de `types.ts` dice "sin imports de `src/`", y `contract.ts` aísla el eval) prohíba importar `scenario.ts` desde ahí. Si la prohíbe, definir `PromptOverrides` en un archivo neutro que solo importe tipos.

### 4.5 `eval/core/variants/load.ts` (`composeParseView`)

Merge por pieza; con `a+b` gana la última de la cadena. Sin esto, `variant.prompts` llega vacío en las composiciones.

```ts
const prompts: PromptOverrides = {};
for (const v of variants) {
  for (const [view, piece] of Object.entries(v.prompts?.PROMPTS ?? {})) {
    prompts.PROMPTS = { ...prompts.PROMPTS, [view]: { ...prompts.PROMPTS?.[view as keyof PromptSet], ...piece } };
  }
  if (v.prompts?.DECISION_PROMPTS) {
    prompts.DECISION_PROMPTS = { ...prompts.DECISION_PROMPTS, ...v.prompts.DECISION_PROMPTS };
  }
}
return { name: ..., decision, generative, ...(prompts.PROMPTS || prompts.DECISION_PROMPTS ? { prompts } : {}) };
```

Actualizar los comentarios de `composeParseView` y de `loadVariantSpec`, que dicen que `variant` solo sirve para parseo y params.

### 4.6 `eval/cli.ts`

Después de cargar las variantes (línea ~327), armar los datasets de cada una, así los errores salen con código 2 antes de correr nada:

```ts
const datasetsByVariant = new Map<string, Dataset[]>();
for (const vr of variantResults) {
  const ov = vr.variant.prompts;
  if (!ov) { datasetsByVariant.set(vr.spec, datasets); continue; }
  let own: Dataset[];
  try {
    own = loadDatasets(cfg.datasetSpecs, { ...filtros_actuales, source: "scenario" }, ov);
  } catch (e) {
    fail(`Error de dataset con la variante '${vr.spec}': ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const skipped = total(datasets) - total(own);
  if (skipped > 0) warn(`${vr.spec}: ${skipped} casos fijos (frozen) omitidos: no admiten prompts enteros.`);
  if (total(own) === 0) { fail(`La variante '${vr.spec}' no dejó ningún caso por escenario.`); return 2; }
  datasetsByVariant.set(vr.spec, own);
}
```

- `filtros_actuales` es el mismo objeto de filtros de las líneas 288-294; extraerlo a una constante para no duplicarlo.
- **Dry-run** (línea ~347): invertir a `for (vr) for (ds of datasetsByVariant.get(vr.spec)!)`, igual que el loop real.
- **Loop real** (línea ~407): `for (const ds of datasetsByVariant.get(vr.spec)!)`.
- `cases`, `caseIds` y los conteos de `meta.json` salen de esos datasets, así que son coherentes sin tocar nada más. `meta.filters.source` sigue mostrando el filtro del usuario; la omisión de `frozen` queda en el aviso de consola.
- `printRunConfig(cfg, datasets, ...)` sigue mostrando los conteos base.
- Si el usuario pasa `--source=frozen` con una variante de prompts, el resultado es cero casos y sale por el `fail` de arriba.

### 4.7 Archivos nuevos en `eval/variants/`

- **`Q5.ts`** (y los demás prompts que se porten), ver sección 5.
- **`prod_explicit.ts`**, solo para verificación: `{ name: "prod_explicit", prompts: { PROMPTS: {}, DECISION_PROMPTS: {} } }`. Es truthy, así que recorre el camino de rebuild con el merge pero con los prompts de producción.

## 5. Cómo queda `Q5.ts`

Misma forma que `prompts.ts`, y solo lo que cambia:

```ts
// eval/variants/Q5.ts
const SYSTEM = `...texto completo del nuevo SYSTEM...`;

export default {
  name: "Q5", // debe coincidir con el nombre del archivo
  prompts: {
    PROMPTS: { ARGUMENTS_VIEW: { SYSTEM } },
  },
};
```

- Lo que el archivo no define cae a producción, pieza por pieza: no hace falta repetir `READ_REFS_NOTE` ni `buildSystemPrompt`.
- Si `Q5` redefine un `buildUserPrompt` o un `buildX`, trae sus helpers copiados dentro del archivo (el eval no importa `src/`).
- Si el prompt de decisión cambia las preguntas, el mismo archivo declara el parseo: `decision.<etapa>.answerMap` / `labelMap`, como hoy. Con las claves de producción (`route`, `selected_tool`, `review`, `ok`, `cumple`) no hace falta.
- Los prompts viejos se reescriben, no se copian: las claves cambiaron (`ARGUMENTS` → `ARGUMENTS_VIEW`, `PLAN` → `PLAN_VIEW`, `FINAL_RESPONSE` → `FINAL_VIEW`) y el texto también. La vista actual trae `STATE`, `USER`, `STEPS`, `DONE`, `REFS`, `DATA`, `EFFECTS`, `FAIL` y `TASK`, no `DATA`, `LAST` y `FACTS`.

## 6. Verificación

1. `--client=oracle --dataset=scenarios_messages`: 100 %. La maquinaria no se rompió.
2. `--variant=prod` contra una corrida previa del mismo día: mismo `requestHash`. Prueba que sin `ov` nada cambió.
3. `--variant=prod,prod_explicit` sobre un dataset por escenario: mismo `requestHash` caso por caso. Prueba que el camino de rebuild equivale al de carga.
4. `--dry-run --variant=prod,Q5`: el body enviado trae el `SYSTEM` nuevo y se ve el aviso de casos `frozen` omitidos.
5. `--variant=Q5+retoque` en dry-run: las ediciones se aplican sobre el prompt nuevo.
6. Corrida real `prod` vs `Q5` con `--repeat=3` sobre un dataset por escenario.

Para comparar `requestHash` entre corridas: el mismo día y con la misma configuración (`TODAY` y `ConfigManager` entran en el prompt; ver `promptEnvironment()`).

## 7. Tarea aparte: quitar la comparación de modelos (hacer antes)

**Qué es:** el modo que compara un modelo contra otro: generativo vs generativo (LLM vs LLM) y decisión vs decisión (D vs D), con deltas contra una referencia. Se agregó después de la primera versión y quedó mal diseñado, y es lo único que se decidió quitar del eval. Hoy se materializa como varios `targets` por corrida y un tercer nivel en el loop de `cli.ts`.

**Qué se conserva:** correr con un modelo generativo y uno de decisión (los de producción o los que indique la configuración). Solo desaparece la comparación entre varios: `models` / `decisionModels` pasan a `model` / `decisionModel`. La comparación entre variantes de prompt (`prod` vs `Q5`) no se toca.

Verificado en `cli.ts`, con líneas aproximadas:

- `buildTargets`, `compareModels`, el array `prepared` y su tipo (~331-337).
- El tercer nivel `for (const p of prepared)` en el dry-run (~349) y en el loop real (~408); usar `stageFilter` donde hoy se usa `target.stages`.
- `modelName`, el filtro por `target.stages` de `cases` (~412), el `continue` (~413) y el texto `× modelo` del log.
- `createCellWriter(..., target.id)` y, en `buildRunMeta`, `stages: target.stages` y `scope: target.scope`.
- La fila "Configuraciones" de `printRunConfig` y la mención a modelos en el texto de `--menu` (~86).

**Sin verificar** (no se leyeron): `targets.ts` (eliminar `buildTargets`, `targetConfig`, `targetModelName`, `ModelTarget`), `config.ts` (`modelScope`, `pairs`; `models` / `decisionModels` pasan a `model` / `decisionModel`), `report.ts` (`printModelComparison` y la sección por modelo de `comparison.md`), `results.ts` (el `target.id` del escritor de celdas y `model` / `scope` en `InputCell`) y `INSTRUCCIONES.md`. El README también vende "Comparación de modelos" y hay que quitarlo.

Verificar después con `--client=oracle`: 100 %.

## 8. Límites

- Se reemplaza el `SYSTEM`, el armado del `user` (`buildUserPrompt`) y, en decisión, el prompt completo (`buildX`).
- Las secciones del contexto (`renderPlan`, `renderArgs`, `renderFinal`, `renderAsk` en `src/core/render`) siguen siendo las de producción.
- Los casos `frozen` (`dataset_v*.jsonl`, `cases_v3.ts`) no admiten prompts enteros. Con una variante de prompts se omiten con aviso y no cuentan como falla. Esos prompts solo se pueden cambiar con las ediciones actuales (`system`, `user`, `state`, `questions`).
- El hash de la variante es el de su archivo: no incluye `src/`, así que un cambio en producción no lo cambia.

## 9. Pendiente de confirmar al implementar

- Regla de imports en `types.ts` y `contract.ts` (sección 4.4).
- Que `prod.ts` exista como archivo físico (`{ name: "prod" }`, según el encabezado de `load.ts`).
- Que `PROMPTS` sea asignable a `PromptSet` sin cast (si el compilador se queja por `this` en `buildSystemPrompt`, un cast puntual en `effectivePrompts` alcanza).
- Qué define realmente el `Q5` viejo: si solo cambia `SYSTEM`, el plan se reduce a `scenario.ts` y `stageRequests.ts`; si trae sus propios `buildUserPrompt` o `buildX`, necesita sus helpers copiados.