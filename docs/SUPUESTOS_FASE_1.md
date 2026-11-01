# Supuestos y decisiones nuevas · Fase 1 (módulo `ctx`) · contra v0.28

Nada se ejecutó: no se corrió `tsc`, ni pruebas, ni comandos (salvo borrar el archivo enviado por error). La verificación mecánica es tu `tsc --noEmit` al cerrar la fase.

## A. Observado en el código del proyecto

| # | Observación | Dónde |
|---|---|---|
| O1 | `tsconfig.json`: `strict`, `target ES2022`, `moduleResolution: "bundler"`, `isolatedModules`, `allowImportingTsExtensions`, `useDefineForClassFields: false`. `package.json`: `lint` = `tsc --noEmit`, sin runner. | `tsconfig.json`, `package.json` |
| O2 | El código existente importa con extensión `.ts` y usa `import type`; `ctx` sigue ese estilo. | `types/task.ts` y el resto |
| O3 | El código vigente usa modos `NORMAL`/`PLAN` y estados en mayúsculas; `ctx` usa los del diseño y no depende de los tipos viejos. | `types/task.ts` |
| O4 | Hoy el `id` de una tarea lo genera `JarvisCore`. | `core.ts` |
| O5 | `signals.denied` lo activan el Guard, el rechazo del usuario y el texto del resultado del servidor. El contexto no distingue origen: ambos son `status = denied`. | `callExecutor.ts`, `resultProcessor.ts` |

## B. DECISIÓN NUEVA (no está en v0.28; la tomé yo y quiero que la valides)

| # | Decisión | Dónde |
|---|---|---|
| D1 | **`ContextOptions` exige todos los topes y el reloj** (`now`, `summaryMax`, `argsStringMax`, `factValueMax`, `jsonMaxDepth`); no hay valores por defecto ni `Date.now`. `onListenerError` es opcional. | `types.ts`, `create.ts`, `context.ts` |
| D2 | **`create.fromSnapshot` usa los mismos topes** que `create.context` para validar un snapshot. La profundidad del snapshot completo se acota con `jsonMaxDepth + 3` (raíz → sección → elemento → `args`). | `snapshot.ts` · `parseBody` |
| D3 | **Una llamada sin veredicto posible** (`interrupted`, `denied`) que reciba `update` de veredicto se rechaza con la regla 6 (`transition`), aunque se evalúe al procesar la operación y no al final del lote. | `validate.ts` · `assertVerifiable` |
| D4 | **`result` en el mismo lote que `finish` se rechaza** (consecuencia de «en un `apply` posterior»): el `finish` solo fija el estado al confirmarse, así que dentro del lote la tarea sigue `running` para esta regla. | `apply.ts` · `Draft.set` |
| D5 | **Código de error de «`result`/`verdict` ya escrito» = `not_mutable` (regla 4)**; el de «`result` con la tarea abierta» = `not_mutable` (regla 1). | `apply.ts` |
| D6 | **`ctx/budget.ts` queda como lápida** (`export {}`) porque no puedo borrar archivos: debes borrarlo tú; nada lo importa. | `ctx/budget.ts` |

## C. Supuestos vigentes (interpretaciones de v0.28; **[CONFIRMAR]** si conviene que los valides)

| # | Supuesto | Dónde | Estado |
|---|---|---|---|
| S1 | `create.context` recibe el `id` de la tarea (principio 5). | `create.ts` | aprobado (v0.28) |
| S2 | `request` e `id` son textos no vacíos; `""` no se acepta en ningún campo de texto (un hecho retirado usa `null`). | `create.ts`, `validate.ts` | [menor] |
| S3 | `add` es estricto: los campos son exactamente los de la entrada; `id`, `at`, `verdict`, `reason`, `superseded` y el `state` inicial no los escribe quien ejecuta. | `validate.ts` · `ensureKeys` | [menor] |
| S4 | Reglas condicionales de `args`/`sig`: `args = null` solo con `args_invalid`; `sig = null` solo con `args_invalid` o `refs_unresolved` y siempre con `args = null`; `refs_unresolved` exige `sig = null`. | `validate.ts` · `checkCallInput` | **[CONFIRMAR]** |
| S5 | `expected` estricto: `null` solo en reactivo; en deliberativo es obligatorio. | `validate.ts` · `checkStepInput` | aprobado (v0.28) |
| S6 | No se validan motivos por modo (`no_alternatives`, `replans_exhausted`). | `closure.ts` | aprobado (v0.28) |
| S7 | Las transiciones de paso se comprueban comparando el estado previo al lote con el final; un lote no encadena `pending → running → completed`. | `apply.ts` · `Draft.checkEnd` | **[CONFIRMAR]** |
| S8 | `snapshot` y `create.fromSnapshot` validan por completo (ids, referencias, vocabularios, invariantes 1 y 2, estado terminal por motivo); no se agregó consistencia entre `result` y el estado de la tarea (se deja como está implementada). | `snapshot.ts` | aprobado (como está) |
| S9 | Solo lectura por congelado en ejecución (`deepFreeze` profundo) y tipos `Readonly` superficiales: sin poder correr `tsc`, evité un `DeepReadonly` recursivo. | `json.ts`, `types.ts` | [menor] |
| S10 | Todo el lote comparte una marca de tiempo `at` (la del evento), tomada del reloj inyectado. | `context.ts` | [menor] |
| S11 | `meta` se valida solo como objeto plano de valores primitivos. | `validate.ts` · `checkMeta` | [menor] |
| S12 | `find` recorre solo las cinco secciones con arreglo; compara con `===` e ignora campos `undefined` de `where`. | `query.ts` | [menor] |
| S13 | `ContextError` lleva `code` y el número de regla de la sección 6. | `errors.ts` | [menor] |
| S14 | Las claves de `facts` se leen con `hasOwnProperty` (`constructor` no devuelve el prototipo). | `query.ts`, `apply.ts` | [menor] |
| S15 | Una llamada puede agregarse a cualquier paso existente, sea cual sea su estado. | `validate.ts` | [menor] |
| S16 | Valores provisorios en `src/core/budget.ts`: `jsonMaxDepth = 32` y `argsStringDefault = 300` son de implementación; el resto copia el diseño. `argsStringMax` no está en la tabla: se calcula desde el catálogo. | `budget.ts` | [menor] |

## D. Respuesta a la pregunta 4: `deepFreeze`

`deepFreeze` congela **la copia que `apply` construye, no el objeto que entregó el ejecutor**. Cada `add`/`update`/`set` valida y copia el valor (`checkArgs` usa `cloneJson`; los demás `check*` devuelven objetos nuevos con los campos copiados) y congela esa copia. El objeto original del ejecutor queda intacto y mutable. Cada sitio de llamada debe seguir pasando objetos propios o `cloneJson`, porque `snapshot()` también devuelve una copia independiente.