# Dataset `recovery`

Casos de la etapa `recovery`: **qué hacer cuando falla el paso de un ítem de la lista del modo reactivo.** En el motor corre solo en **modo sombra** (`src/core/engine/recoveryShadow.ts`, config `recoveryShadow`): registra qué haría y no actúa. El diseño está en [`docs/pendientes/PENDIENTES_CODIGO.md`](../../../docs/pendientes/PENDIENTES_CODIGO.md), §9.1, punto 1; los resultados, los descartes y cómo leer las trazas, en [`eval/GUIA_DECISION.md`](../../GUIA_DECISION.md) (sección 5).

El prompt de producción (`prod`) es `DECISION_PROMPTS.buildRecovery` en `src/core/models/prompts.ts`. Las variantes activas vigentes (tres opciones) viven en `eval/variants/recovery/` (las variantes heredadas de cuatro opciones y las de dos ejes fueron retiradas).

## Cómo correrlo

```bash
npm run eval -- --client=oracle --dataset=eval/datasets/recovery --stages=recovery            # valida casos y graders: debe dar 100 %
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery                            # modelo real (d3:2b-text), baseline prod
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery --variant=prod,recovery_three_options_nobehind
npm run eval -- --dataset=eval/datasets/recovery --stages=recovery --ids=n1-rp-04 --dry-run --client=mock   # ver el prompt de un caso
```

El modelo de decisión trabaja con temperatura 0: **repetir la corrida (`--repeat`) no aporta nada**. `--client=oracle` solo vale con `prod`. La carpeta se pasa completa; para un solo archivo, `--dataset=eval/datasets/recovery/recovery_n4.jsonl`.

## Qué decide la consulta

Una pregunta `action` (`choice`) con tres opciones: `rewrite_item` (el fallo se arregla reintentando el ítem), `replan` (falta un prerrequisito: hay que rehacer lo que queda) y `close` (no tiene arreglo o el usuario o la política lo rechazaron). **No hay `skip_continue`**: un ítem existe porque el pedido lo necesita, y si no se puede hacer lo honesto y seguro es cerrar. Los casos que antes eran `skip_continue` se reetiquetaron a `close` (conservan el tag `was_skip_continue`).

## Regla de etiquetado

Es una regla de trabajo para tener etiquetas consistentes, no una verdad: **hay que revisarla con una persona**, y los casos que no encajan limpiamente van como `isRaw: true` con el tag `borderline`.

1. **¿El objetivo sigue siendo válido y el fallo parece corregible?** (un argumento mal puesto o faltante, un formato, un tipeo, otra redacción u otro enfoque, un comando de otra shell que se reescribe) → `rewrite_item`.
2. **¿El fallo muestra que el plan supone algo que falta?** (la carpeta destino no existe, un programa de desarrollo no está instalado, un puerto ocupado, un formato no soportado, el archivo está en otra carpeta) → `replan`.
3. **Si no tiene arreglo** (la red caída tras dos intentos, no hay permiso, la aplicación de escritorio no existe, los tests o la compilación del proyecto fallan de verdad, disco lleno, archivo corrupto) → `close`.
4. **El usuario o la política de seguridad rechazaron la operación** → `close`.

Un programa de desarrollo que falta (`node`, `pip`, `git`) se etiquetó `replan` (se puede instalar); una aplicación de escritorio que falta (Photoshop, Word) se etiquetó `close`. Es un criterio, no una verdad.

`at.attempts` pesa en la regla 1: con un solo intento y un error corregible se espera `rewrite_item`; con dos o más intentos y el mismo tipo de error, no. **Ojo:** en estos datasets `attempts` cuenta las llamadas fallidas del caso; en el motor, el prompt recibe los **pasos fallidos seguidos** (y un paso falla tras 2 o 3 errores de la herramienta). Ver `eval/GUIA_DECISION.md`, «Modo sombra».

## Formato de un caso

```json
{"id":"n1-rp-01","stage":"recovery","tags":["recovery","replan","tool_failed","attempts_1","alone"],"description":"...",
 "scenario":{"mode":"reactive","request":"...",
   "steps":[{"instruction":"Listar el escritorio","state":"completed"},{"instruction":"Crear clientes.txt dentro de la carpeta Clientes del escritorio","state":"failed"}],
   "calls":[{"step":0,"route":"files","tool":"list_directory","kind":"read","status":"ok","args":{...},"summary":"...","verdict":"approved"},
            {"step":1,"route":"files","tool":"write_file","kind":"write","status":"tool_error","args":{...},"summary":"Error: ENOENT...","verdict":"rejected","reason":"no_usable_data"}],
   "at":{"previous":["Crear clientes.txt dentro de la carpeta Clientes del escritorio"],"cause":"tool_failed","attempts":1}},
 "expect":{"expectedAction":"replan"}}
```

- El último paso en `steps` debe estar `failed`; sus llamadas fallidas se escriben como las registra el motor (`tool_error` y `exception` con `verdict: rejected` y `reason: no_usable_data`; un resultado que no sirve, `ok` con `verdict: rejected` y `reason: not_accomplished`; `args_invalid` y `tool_rejected` sin veredicto).
- `at.previous`: la lista de la vuelta, con el ítem fallido de primero. `at.cause`: una causa del motor (`tool_failed`, `verify_rejected`, `review_rejected`, `call_cap`, `repeat_blocked`, `user_rejected`, `denied`, `no_tools`). `at.attempts`: entero ≥ 1.
- `expect.expectedAction` (obligatoria) y `expect.minProbability` (opcional).

## Qué contiene

| Archivo | Casos | Quién lo escribió / uso |
|---|---:|---|
| `recovery_casos.jsonl` | 30 | semilla original (11 `rewrite_item`, 5 `replan`, 14 `close`, varios con mensajes de error reales) |
| `recovery2.jsonl`, `recovery3.jsonl` | 48 + 48 | casos añadidos en la ronda de cuatro opciones (reetiquetados) |
| `recovery_n1.jsonl`, `recovery_n2.jsonl`, `recovery_n3.jsonl` | 30 + 25 + 36 | escritos a mano para la ronda sin `skip_continue`: conjunto de ajuste |
| `recovery_n4.jsonl` | 30 | holdout de esa ronda; **ya se midió una vez, no es un holdout limpio** |

Tres casos con `Remove-Item` sin `-Recurse` (`n1-rp-08`, `n3-rp-09`, `n4-rp-08`) están como `isRaw` + `borderline`: se arreglan con un argumento (`rewrite_item`) y la etiqueta `replan` es discutible. Casi todo es sintético; los casos reales de fallos son escasos. Para decidir hace falta ampliarlo con **trazas reales** (el modo sombra las produce).

## Errores que importan más

No todos los errores cuestan lo mismo. Al leer los resultados conviene separar, además del acierto por acción:

- **Falso `close`**: se corta una tarea que se podía arreglar.
- **Falso reintento**: se insiste en algo que ya se sabe que no tiene arreglo (gasta pasos y confunde al usuario).
