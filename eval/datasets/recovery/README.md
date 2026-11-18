# Dataset `recovery`

Casos de la etapa `recovery`: **qué hacer cuando falla el paso de un ítem de la lista del modo reactivo.** Es una consulta al modelo de decisión que **todavía no existe en el motor**: se evalúa aquí primero, para ver cómo responde, antes de integrarla. El diseño completo está en [`docs/pendientes/PENDIENTES_CODIGO.md`](../../../docs/pendientes/PENDIENTES_CODIGO.md), §9.1, punto 6 («Idea acordada»).

El prompt base (`prod`) es `DECISION_PROMPTS.buildRecovery` en `src/core/models/prompts.ts`, escrito sin conectarlo al flujo. Las variantes de esta etapa viven en `eval/variants/recovery/`.

## Cómo correrlo

```bash
npm run eval -- --client=oracle --dataset=eval/datasets/recovery --stages=recovery        # valida casos y graders: debe dar 100 %
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery                        # modelo real (d3:2b-text), baseline prod
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery --variant=prod,recovery_neutral_labels
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery --ids=rec-rp-02 --dry-run --client=mock   # ver el prompt de un caso
```

El modelo de decisión trabaja con temperatura 0: **repetir la corrida (`--repeat`) no aporta nada**. Lo que cambia los resultados es la variante de prompt y el tamaño del dataset. `--client=oracle` solo vale con `prod`.

## Qué decide la consulta

Dos preguntas en el mismo request:

| Pregunta | Tipo | Qué dice |
|---|---|---|
| `action` (principal) | `choice` | Una de cuatro acciones: `close`, `skip_continue`, `rewrite_item`, `replan` |
| `independent` | `noul` | ¿Los ítems de atrás pueden hacerse sin el resultado del fallido? (se mide con `expect.answers.independent`) |

## Regla de etiquetado

Para etiquetar un caso se sigue este orden. Es una regla de trabajo para tener etiquetas consistentes, no una verdad: **hay que revisarla con una persona**, y los casos que no encajan limpiamente van como `isRaw: true` con el tag `borderline`.

1. **¿El objetivo sigue siendo válido y el fallo parece corregible?** (un argumento mal puesto o faltante, un formato, un typo, otra redacción u otro enfoque) → `rewrite_item`. Vale aunque los ítems de atrás sean independientes: primero se intenta arreglar. Suele ser el primer o segundo fallo de un ítem.
2. **¿El fallo muestra que el plan supone algo que falta o está mal?** (una carpeta o un archivo que hay que crear o ubicar antes; el pedido dice que existe pero no está donde se lo busca) → `replan`.
3. **Si no tiene arreglo** (la red caída tras dos intentos, no hay permiso, la aplicación no existe, los tests del proyecto fallan de verdad):
   - todos los ítems de atrás son independientes → `skip_continue`;
   - algún ítem de atrás depende del resultado, **o no hay ítems detrás** → `close`.
4. **El usuario o la política de seguridad rechazaron la operación**, y no hay otra forma de hacerlo → `close`. (Si hubiera ítems independientes detrás, la regla da `skip_continue`; es discutible y está como `rec-bd-01`, borderline.)

`at.attempts` (pasos fallidos del ítem hasta ahora) pesa en la regla 1: con un solo intento y un error que parece transitorio o corregible se espera `rewrite_item`; con dos o más intentos y el mismo tipo de error, no.

## Formato de un caso

```json
{"id":"rec-rp-02","stage":"recovery","tags":["recovery","replan"],"description":"...",
 "scenario":{"mode":"reactive","request":"...",
   "steps":[{"instruction":"Listar la carpeta Documentos","state":"completed"},{"instruction":"Leer presupuesto.xlsx de Documentos","state":"failed"}],
   "calls":[{"step":0,"route":"files","tool":"list_directory","status":"ok","args":{...},"summary":"...","verdict":"approved"},
            {"step":1,"route":"files","tool":"read_file","status":"tool_error","args":{...},"summary":"Error: ENOENT...","verdict":"rejected","reason":"no_usable_data"}],
   "at":{"previous":["Leer presupuesto.xlsx de Documentos","Decir cuál es el total"],"cause":"tool_failed","attempts":1}},
 "expect":{"expectedAction":"replan","answers":{"independent":{"yes":false}}}}
```

- El último paso en `steps` debe estar `failed`; sus llamadas fallidas se escriben como las registra el motor (`tool_error` y `exception` con `verdict: rejected` y `reason: no_usable_data`; un resultado que no sirve, `ok` con `verdict: rejected` y `reason: not_accomplished`; `args_invalid` y `tool_rejected` sin veredicto).
- `at.previous`: la lista de la vuelta, con el ítem fallido de primero; lo que viene detrás son los ítems restantes.
- `at.cause`: una de las causas del motor (`tool_failed`, `verify_rejected`, `review_rejected`, `call_cap`, `repeat_blocked`, `user_rejected`, `denied`, `no_tools`). `at.attempts`: entero ≥ 1 (por defecto 1).
- `expect.expectedAction` (obligatoria), `expect.minProbability` (opcional) y `expect.answers.independent` (`yes: true/false`; ponerlo en todos los casos que tengan ítems detrás, para medir también la dependencia).

## Lo que contiene hoy (semilla, 30 casos)

| Acción esperada | Casos | Ids |
|---|---:|---|
| `rewrite_item` | 11 | `rec-rw-01` … `rec-rw-11` (`rw-11` es un hard negative de `skip_continue`) |
| `replan` | 5 | `rec-rp-01` … `rec-rp-05` |
| `skip_continue` | 7 | `rec-sk-01` … `rec-sk-06` y `rec-bd-01` (borderline, `isRaw`) |
| `close` | 7 | `rec-cl-01` … `rec-cl-07` |

Es una **semilla pequeña**: sirve para que la etapa funcione y para una primera lectura, no para decidir. Los casos reales de fallos son escasos (las trazas tenían apenas 4 errores de herramienta); casi todo es sintético, aunque varios mensajes de error son los reales (`write_file` «already exists», `.xlsx` con formato inválido, `web_search` con más de 5 URLs). Para decidir hace falta ampliarlo, sobre todo con más casos reales de `skip_continue` y `close` y más ejemplos de dependencia sutil.

## Errores que importan más

No todos los errores cuestan lo mismo. Al leer los resultados conviene separar, además del acierto por acción:

- **Falso `skip_continue`**: se ejecutan ítems que dependían del fallido.
- **Falso `close`**: se corta una tarea que se podía arreglar.
- En la pregunta `independent`: un **falso «independiente»** es el error caro; un falso «dependiente» solo cierra de más (lado seguro).

## Cosas para explorar con variantes

- La vista que se envía es la de `pending`, y rotula los fallos como `FAILED TASKS (REPLACE IN PENDING)`, una instrucción que pertenece a otra consulta. `recovery_neutral_labels` la reemplaza (y quita la pregunta `independent`): sirve de plantilla y como primera hipótesis.
- Si el modelo usa el número de intentos (`at.attempts`) y la causa que se le da.
- Si separar las preguntas (una por acción, o dependencia en una consulta aparte) mejora el acierto frente a una sola pregunta de cuatro opciones.
- La probabilidad de la acción elegida y si sirve para decidir cuándo dudar (un umbral por debajo del cual se mantiene la conducta de hoy).
