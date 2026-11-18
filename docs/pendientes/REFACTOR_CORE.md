# Refactor del core de Jarvis: reescribir lo que hay para que escale

> Alcance: no se agregan funciones nuevas ni se cambia el comportamiento. Solo se reescribe el código actual para que sea más fácil de entender, ubicar y extender.
> Origen: análisis de `src/core/` hecho por un agente de código (sin leer el código directamente). Los detalles finos hay que confirmarlos contra el código real.

## La idea

**Que cada cosa se pueda encontrar en un solo lugar y que cada función haga una sola cosa.**

Criterio para saber si el refactor salió bien: ante cualquier cambio futuro, ¿se sabe en qué único lugar tocar?

- Agregar una tool nueva: una entrada en una tabla.
- Cambiar una regla de seguridad: un archivo.
- Cambiar el orden de los filtros: una lista.

Si el resultado solo movió el desorden a más archivos, no sirve.

## Cómo está hoy (resumen)

- `src/core/` tiene 124 archivos y unas 16.000 líneas. La estructura de carpetas está bien y no hay ciclos.
- `callRunner.ts` (595 líneas) concentra en `runCall()` unas 12 responsabilidades como una receta secuencial. Las etapas se comunican con variables sueltas (`askUser`, `userAuthored`, `canRemember`, `tier`, `listed`, `allowedUnresolvableReason`).
- El conocimiento de cada herramienta está repartido en `callRunner`, `precheck`, `guard`, `tiers`, `postcondition`, `readOnly` y `egress` mediante condiciones por nombre de tool. La lista de claves de ruta está copiada en 4 archivos.
- Conviven tres estilos de estado: el estado de la tarea (`ctx`, bien resuelto), el estado de ejecución en variables locales y cajas mutables, y estado global de módulo (`llmDown`, caché en `environment.ts`).
- Hay dos imports en la dirección equivocada: `tools/host.ts → engine/capture.ts` y `engine/services.ts → memory/index.ts`. Además `guard.ts` llama directo a `os.homedir()`.

## Los 4 puntos

### 1. `runCall` pasa a ser una lista de pasos

Cada bloque se vuelve una función que recibe lo que necesita y devuelve su resultado. `runCall` queda como un índice corto:

```ts
async function runCall(...) {
  const selected = await selectTool(...)
  const prepared = await prepareArgs(selected, ...)
  const decision = authorize(prepared, ...)      // reúne guard, tier, blacklist, precheck, dirs
  if (decision.kind === "reject") return decision.failure
  await confirmIfNeeded(decision, ...)
  await reviewIfNeeded(decision, ...)
  return executeAndRecord(prepared, ...)
}
```

- El orden de los cortes de seguridad es exactamente el de hoy.
- `askUser`, `userAuthored`, `canRemember` y similares se calculan dentro de `authorize` y salen empaquetados en `decision`, en vez de flotar como variables sueltas.
- Según el mapa del agente, ninguna flag de autorización llega a la etapa de ejecución, así que el corte es limpio y no hace falta un objeto de contexto gigante (dato inferido, no verificado).

### 2. Una tabla por herramienta

Cada tool (o familia) declara sus datos una sola vez:

```ts
write_file: { pathKeys: ["path"], readOnly: false, postcondition: ..., approvalKey: ... }
```

- Los demás archivos consultan `getToolSpec(name).pathKeys` en lugar de `if (name === "write_file")`.
- Las 4 listas de claves de ruta pasan a ser una sola constante.
- La tabla puede apuntar a funciones (`precheck: miFuncion`), no solo a valores. Las reglas especiales de una tool viven junto a la tool, aunque sean código.
- No abre el sistema a plugins ni a rutas dinámicas: solo ordena lo que ya existe.

### 3. El estado de ejecución en un solo objeto

Juntar en un `TaskExecutionState` lo que hoy está en `llmDown`, las cajas de `env.ts` y las variables locales de `runReactive`. Se crea al empezar la tarea y se pasa hacia abajo.

- Desaparece el estado global de módulo.
- El estado vivo de la tarea queda visible y con dueño, igual que el estado persistido en `ctx`.
- Debe mantenerse chico. Si se le mete todo lo que hoy es una variable suelta, se vuelve un cajón de sastre.

### 4. Dependencias en una sola dirección

- `tools/` deja de importar de `engine/`: recibe el wrapper de captura desde afuera.
- `engine/` deja de elegir la implementación de memoria: recibe el `MemoryProvider` desde el arranque de la app.
- `guard.ts` recibe el homedir por parámetro en vez de llamar a `os.homedir()`.

## Estado (2026-11-18)

**Punto 1 (`runCall`): hecho.** `callRunner.ts` pasó de 595 a 76 líneas y encadena `callPrepare` → anti-bucle → `callAuthorize` → `callConfirm` → `callExecute`. Red de seguridad: `tests/approval_matrix.test.ts` (54 casos) y `tests/authorize.test.ts`.

**Punto 2 (tabla por herramienta): hecho en lo que valía la pena.** Al leer el código, el manifest (`tools/manifest.ts`) ya era la tabla de políticas, sondas, plazos, repetición y recortes por herramienta; el análisis original subestimaba eso. Lo que seguía repartido eran tres cosas, y ya están en tablas:
- Dónde deja su resultado cada herramienta que escribe (`tools/toolTargets.ts`), que reemplazó 4 `if (tool === "move_file")` en sondas, aviso final y pre-chequeo.
- Regla de nivel de aprobación por herramienta (`TIER_RULES` en `policy/tiers.ts`), antes un `switch`.
- Poscondición de disco por herramienta (`POSTCONDITIONS` en `engine/postcondition.ts`) y chequeo de tipo de ruta (`PATH_KIND_CHECKS` en `engine/precheck.ts`), antes `switch`.

`tests/tool_specs.test.ts` hace fallar la suite si una herramienta que modifica el sistema no tiene su fila en alguna tabla: antes caía en silencio en un valor por omisión (amarillo, «lo decide el modelo»). **Decisión de diseño:** las funciones no se registran dentro del manifest, porque `manifest.ts` importaría `policy/` y `engine/` y `tiers.ts` necesita al manifest para despachar (ciclo), además de invertir la dirección de dependencias que el punto 4 quiere arreglar. Cada tabla queda junto a su código, indexada por nombre, y el test garantiza la coherencia con el catálogo. **Queda fuera a propósito:** las ramas por argumento de `read_file` (`isUrl`) y `run_command` (`cwd`) en `callAuthorize.ts`, y el plazo de `run_command` en `timeouts.ts`; son comportamiento de un argumento concreto, no clasificación de herramientas.

**Punto 3 (estado de ejecución): hecho.** `engine/state.ts` define `TaskExecutionState` (`thread`, `lastCompletion`, `llmDown`), que se crea con la tarea y viaja en `env.state`: reemplaza las dos cajas sueltas de `EngineEnv` (`follow`, `completion`) y el `WeakSet` global `llmDown` de `failures.ts` (`closeOnFailure` y `fromFailure` reciben ahora `env` en vez de `ctx`). Lo que `runReactive` guardaba en seis variables locales pasó a `ReactiveList` (`engine/reactiveList.ts`), con transiciones con nombre (`applyModelList`, `applyModelDone`, `completeHead`, `failHead`…), probadas sin modelos en `tests/reactive_list.test.ts`; `runReactive` conserva solo el flujo. Se mantuvo chico a propósito: no se metió ahí lo que usa una sola función. **Queda fuera:** la caché de `getUserEnvironment()` (`environment.ts`) es una caché de proceso de datos de la PC (no estado de una tarea) y ya es inyectable por `deps.environment`; el log que deja la tarea abierta si falla su escritura (`PENDIENTES_CODIGO.md` §9.2) es una corrección de comportamiento y va aparte.

**Punto 4 (dependencias en una dirección): hecho.** `tools/host.ts` ya no importa `engine/capture.ts`: `createToolHost` recibe el envoltorio de captura (`CaptureCall`; `DIRECT_CALL` para quien corre fuera de una tarea, como los scripts de validación) y lo arma `callExecute` con `captureCallTool`. `engine/services.ts` ya no elige la memoria: `createEngineServices(getConfig, { memoryProvider })` la recibe y `server.tsx` construye `createJsonMemoryProvider(memoryFileOf(config))`; sin proveedor no hay memoria (el `TaskManager` por defecto, usado por las pruebas, queda sin ella). El inicio del usuario llega a Guard, a la lista negra y a las reglas de solo lectura por parámetro (`guardScope.homeDirs`, fijado en `services.ts`); el valor por omisión vive en un solo archivo (`policy/homeDirs.ts`). Tres pruebas en `tests/architecture.test.ts` fijan el sentido: `core/tools` y `core/policy` no importan `engine/` ni `models/`, el motor solo importa el puerto de memoria (tipos) y `policy/` solo llama a `os.homedir()` en `homeDirs.ts`.

## Qué no cambia

- La estructura de carpetas.
- `ctx/` y el event sourcing.
- Los contratos de modelos (`EngineLLM`, `IActionDecision`, `IDiscoveryEngine`).
- Las 4 rutas cerradas (files, locate, terminal, web), que responden al uso de un modelo chico en D1.
- `tasks.ts`, grande pero estable.
- El comportamiento externo.

## Cuidados para no hacerlo mal

- La tabla por herramienta es para datos y referencias a funciones, no para forzar lógica a ser "declarativa".
- No convertir el pipeline en un framework (middlewares, registro de filtros). Alcanza con funciones simples que devuelven una unión discriminada.
- El orden de los cortes de seguridad debe quedar escrito a la vista, de arriba abajo, no escondido en configuración.
- "Función pura" es una aspiración, no un requisito: `authorize` consulta disco y está bien, siempre que tenga entrada y salida claras.

## Pendiente por confirmar

- Qué significa `listed` en el código real. Hipótesis: es el resultado de `blacklistMatch`, con nivel `sensitive` o `blocked`, o `null` si no coincide.
- Que el corte entre `authorize` y `confirmIfNeeded` sea tan limpio como sugiere el resumen. Se confirma leyendo `callRunner.ts`, no solo el reporte.
- El siguiente paso natural es bajar los puntos 1 y 2 a un caso concreto (por ejemplo `read_file`) con el código real, para comparar antes y después.
