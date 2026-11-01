# JARVIS: plan de implementación del contexto v1 (revisión 5)

> Base: `PLAN_CONTEXT.md` **v0.28** (aprobado; es la base desde ahora) contrastado con `src/core` y `src/server`. Alcance: **solo el back (`src`)**. `lab/`, la UI y los scripts quedan fuera y no se tocan ni se consideran.
> Revisión 4: al cerrar cada fase corres `tsc --noEmit`; las fases traen pocas pruebas, solo estructurales y justificadas; la validación fuerte va al final, antes del corte del servidor (Fase 7). La tabla de configuración sale de `ctx/` y pasa a `src/core/budget.ts`.

> **Estado actual (para retomar en una sesión nueva).** Fase 1 (`ctx`) **cerrada**: `tsc --noEmit` limpio, aprobada por el usuario, `ctx/budget.ts` borrado. Decisiones aprobadas: D1 a D6 de `SUPUESTOS_FASE_1.md` (topes y reloj obligatorios sin defaults; `fromSnapshot` con los mismos topes; veredicto sobre `interrupted`/`denied` se rechaza; `result` en el mismo lote que `finish` se rechaza; códigos `not_mutable`), más S4 (reglas `args`/`sig`) y S7 (un salto de estado por lote). **Siguiente: Fase 2.** Reglas que no cambian: todo lo que el doc no diga o diga distinto se informa como **DECISIÓN NUEVA** y se espera (no se implementa primero); prioridad al contexto sobre el borde; no se ejecuta nada; el usuario corre `tsc --noEmit` al cerrar cada fase.

## 0. Reglas de trabajo

1. **No se cambia el esquema ni las reglas del diseño sin tu aprobación.** Si el diseño choca con la implementación, se formula una pregunta concreta y no se resuelve por cuenta propia.
2. **Yo no ejecuto nada durante las fases:** ni tests, ni `tsc`, ni runner, ni comandos; solo escribo código. **Al cerrar cada fase corres tú `tsc --noEmit`** (`npm run lint`) y la fase no se da por cerrada hasta que pase limpio y des tu visto bueno. Cada fase puede traer **pocas pruebas, solo estructurales** (que algo compile, que una forma exista, que un invariante básico se cumpla), cada una con su justificación escrita; la validación fuerte (pruebas por regla, escenarios completos) va en la **Validación final**, antes del corte del servidor (Fase 7).
3. **Trazabilidad por fase.** Cada fase se entrega con una tabla regla → código: cada regla del diseño que le aplica (validaciones de la sección 6, transiciones de 5.3, invariantes, topes) con archivo y función donde se cumple. Una regla sin fila se considera no implementada.
4. **Tabla única de configuración: `src/core/budget.ts`, fuera de `ctx/`.** Todo valor provisorio o tentativo vive ahí, con su marca `provisional`, la sección del diseño que lo origina y la fase que lo consume. El contexto **no la importa** (principio 5): quien crea el contexto le pasa los topes ya resueltos (`summaryMax`, `argsStringMax`, `factValueMax`, `jsonMaxDepth`). `ARGS_MAX` no está en la tabla: se calcula desde el catálogo de herramientas (`argCaps` del manifest), con `argsStringDefault` como respaldo. Las constantes de `types/limits.ts` migran a esa tabla. Las rutas (`refsDir`, `tracePath`) siguen en `ConfigManager`.
5. Lo observado en el código y lo supuesto se separan siempre (cada entrega lista sus supuestos).
6. **No se avanza a la siguiente fase sin tu visto bueno.**

## 1. Decisión: adaptar o rehacer

**Se reconstruye el centro y se conserva el borde.** El centro es todo lo que hoy guarda o decide estado de tarea: el `Task` actual lleva las llamadas dentro de cada paso, mezcla estado de ejecución con memoria en strings (`log`, `fail`, `facts`) y `scratchpad`, y trata las esperas del usuario como estado de la tarea. El borde (MCP, manifest, guard, extractores, transporte, prompts) ya funciona.

| Disposición | Archivos |
|---|---|
| **Se conserva sin cambios** | `llmTransport.ts`, `utils.ts`, `text.ts`, `guard.ts`, `environment.ts`, `models.ts`, `mcp/*`, `discovery.ts`, `types/routes.ts`, `types/mcp.ts`, `types/policy.ts`, `types/audit.ts` |
| **Se adapta** | `manifest.ts` (agrega `argCaps`), `callExecutor.ts` (se parte en las fases actuales más un bucle de paso), `resultProcessor.ts` y extractores, `decision.ts` y `prompts.ts`, `qwen.ts`, `refResolver.ts`, `core.ts`, `events.ts`, `taskTrace.ts`, `jarvisRouter.ts`, `config.ts` |
| **Se reescribe** | `context.ts` (viejo), `modeEngines.ts`, `taskConclusion.ts`, `taskWire.ts`, `modelIterations.ts`, `types/task.ts`, `types/execution.ts`, partes de `types/plan.ts` |
| **Nuevo** | `ctx/`, `refs/`, `engine/`, `trace/` |

**Corte.** Todo lo nuevo se construye en directorios nuevos, en una rama (`refactor/context-v2`), sin tocar el código vigente hasta la Fase 7, que va **después de la Validación final**. No hay bandera de versión: la vuelta atrás es git.

## 2. Estructura de módulos

```
src/core/
├── budget.ts                 # TABLA ÚNICA de configuración (valores provisorios); ctx/ no la importa   [Fase 1]
├── ctx/                      # el contexto: no importa nada fuera de ctx/
│   ├── types.ts              # esquema, vocabularios, operaciones, eventos            [Fase 1]
│   ├── errors.ts             # ContextError (código + número de regla)                [Fase 1]
│   ├── json.ts               # JSON plano: validación, copia, congelado               [Fase 1]
│   ├── ids.ts                # p1, s1, c4, e1, r3                                     [Fase 1]
│   ├── closure.ts            # tabla de estado terminal, invariante 3, canFinish      [Fase 1]
│   ├── validate.ts           # reglas 2, 3, 5 y 7 por campo                           [Fase 1]
│   ├── apply.ts              # lote atómico, reglas 1, 4 y 6                          [Fase 1]
│   ├── query.ts              # get, find, current                                     [Fase 1]
│   ├── snapshot.ts           # snapshot y validación de snapshot                      [Fase 1]
│   ├── context.ts            # TaskContext (n, on, apply, lecturas, snapshot)         [Fase 1]
│   ├── create.ts             # create.context({id,…}, options), create.fromSnapshot   [Fase 1]
│   ├── index.ts                                                                       [Fase 1]
│   ├── derive.ts             # efectos, isRepeat, contadores (reutiliza closure.ts)    [Fase 2]
│   └── views/                # forPlan, forRoute, forArgs, forVerify, forFinal, forFallback [Fase 2]
├── refs/
│   ├── refVault.ts           # resultado crudo en disco; devuelve `where`
│   └── refResolver.ts        # {{ref:rN}} → contenido, vía ctx.get(rN).where
├── engine/
│   ├── runtime.ts            # TaskRuntime: lo que NO va en el contexto
│   ├── callRunner.ts         # runCall: las fases actuales
│   ├── stepLoop.ts           # bucle interno de un paso (varias llamadas)
│   ├── providers.ts          # proveedor reactivo y deliberativo
│   ├── recovery.ts           # escalación (reactivo) y replan (deliberativo)
│   └── closeout.ts           # finish + result, cancelación, respaldo
└── trace/                    # opcional: sin esta carpeta todo compila y funciona
    └── recorder.ts           # se enlaza por `change` (stepId y orden); recibe lo capturado en los bordes   [Fase 7]
```

**Reloj y topes.** `create.context(params, { now, summaryMax, argsStringMax, factValueMax, jsonMaxDepth })`: el contexto no usa `Date.now` ni valores propios. `create.fromSnapshot(snapshot, options)` es la única forma de cargar un estado (no hay `ctx.load`); el `id` de la tarea lo pasa quien llama.

`TaskRuntime` reúne lo que el diseño deja fuera del contexto: `AbortController`, aprobación pendiente, espera actual (confirmación de plan, aprobación de mutación, respuesta del usuario), pregunta en curso y descarte de eventos tardíos.

## 3. Mapeos ya resueltos (sin cambio de diseño)

- **`/modify-plan`.** Hoy solo actúa mientras el plan espera confirmación, regenera con el feedback y reemplaza todos los pasos reiniciando ids. Se mapea a "plan rechazado con instrucción": plan `user_feedback`, pasos `pending` anteriores `superseded`, ids nuevos. `/reject-plan` sigue siendo cancelar (`user_cancelled`); se confirma contigo en la Fase 7.
- **Duraciones e `isError` de la traza.** `isError` no se guarda: sale de `status`. La captura ocurre **en los bordes**: el cliente del modelo y `callTool` reportan a un **receptor opcional** (interfaz con versión vacía por defecto, que no hace nada); el motor no sabe de la traza. El registrador (Fase 7) se enlaza por `change`, relaciona lo capturado con la llamada por `stepId` y orden, y escribe. **Nada de traza antes de la Fase 5**; criterio de salida: sin `trace/`, todo compila y funciona.
- **Retención de refs.** No se borran nunca en esta etapa (v0.28, sección 4); no hay barrido ni ligadura a la traza. La idea de borrarlas al terminar la tarea está en 10.2 del diseño.
- **`loopExempt`.** `runCall` lo resuelve con el manifest y lo pasa a `isRepeat(tool, sig, { exempt })`.
- **Traza v2 directa**, sin adaptadores ni compatibilidad con v1.

## 4. Fases

Criterio de salida común (fases 1 a 6): el código escrito, la tabla de trazabilidad completa, la lista de supuestos y de DECISIÓN NUEVA, `tsc --noEmit` limpio (lo corres tú) y tu visto bueno. Las pruebas de cada fase son pocas y estructurales, cada una con su justificación.

### Fase 1: módulo `ctx` (L) — CERRADA (v0.28, `tsc` limpio, aprobada)
Esquema, vocabularios, `create.context` / `create.fromSnapshot`, `apply` (las 7 validaciones, atomicidad, invariantes al final del lote), evento `change` con `n`, `get`, `find`, `current`, `snapshot`. Tabla única `src/core/budget.ts` fuera de `ctx/`. Sin `ctx.load`.
- **Salida:** `TRAZABILIDAD_FASE_1.md`; `SUPUESTOS_FASE_1.md`; `tsc --noEmit` limpio. `ctx/budget.ts` ya borrado.

### Fase 2: derivaciones y vistas (L)
- `derive.ts`: efectos y posibles efectos, `isRepeat` con `exempt`, reintento tras fallo transitorio, escritura o lectura intermedia, `answer_*` como intermedio, contadores, ventanas por escalaciones, handoff. Reutiliza `closure.ts` (`canFinish`, `planClosure`, `hasApprovedCall`). Una llamada `denied` del servidor cuenta como ejecutada para el anti-loop (v0.28).
- Seis vistas: objetos estructurados más un renderizador por consumidor que arma el texto de los prompts y sanea (C9). Efectos sin recorte en `forPlan` (`ContextOverflowError` si exceden). Las vistas arman `ref:rN (tamaño, ruta)` desde `call.ref` y `refs` (C4, v0.28) y los mensajes fijos por `status` y por `reason` (sección 8, v0.28).
- **Salida:** tabla de trazabilidad (5.4, sección 8, sección 9); supuestos.

### Fase 3: refs en disco (M)
- `refVault`: `put` escribe el crudo y devuelve `where`; lectura por trozos. Flujo: guardar en disco → `apply add ref` → `apply add call` con `ref`. `refResolver` resuelve con `ctx.get(rN).where`. Sin borrado al expulsar tareas.
- **Verificación obligatoria de esta fase (por lectura de código y documentación, sin ejecutar):** (a) que `read_file` acepta `offset` y `length` sobre las rutas de las refs; (b) que la carpeta de refs está dentro de `allowedDirectories` del servidor de archivos; (c) anotar en la entrega el **riesgo de exposición a escritura** de esa carpeta (la herramienta de archivos podría escribir sobre un crudo). Lo que no se pueda confirmar sin ejecutar queda como supuesto explícito y se te consulta antes de seguir.
- **Salida:** tabla de trazabilidad (5.2 refs, sección 4 retención); supuestos; nota de riesgo.

### Fase 4: procesador y extractores (M)
- `ProcessedResult` pierde `factsDelta`, `scratchpadDelta`, `verification` y `decisionSummary`; gana `truncated` y `process: { pid, active }`. Marcadores de omisión neutros (C4). Estados de llamada incluido `denied` del servidor (C6). `summary` recortado al tope; saneado fuera del resumen (C9).
- **Salida:** tabla de trazabilidad (5.2 notas de `summary`, `ref`, `args`, 5.3 registro de llamada); supuestos.

### Fase 5: `callRunner` y `stepLoop` (L)
- `runCall` reutiliza las fases actuales sin `TaskExecutionContext`. Registro en dos `apply`; `interrupted` en `finally`. Cancelación con `Promise.race` sobre `callTool`. `stepLoop`: paso creado en `running` antes de consultar al modelo de decisión; reintentos; tope de llamadas; `user_rejected` fuera de la cuenta; una pregunta por paso. Verificador solo con el modelo de decisión (razones de C10). Revisión de argumentos: gancho y estados, sin prompt activo.
- **Receptor de captura (opcional):** interfaz mínima con versión vacía por defecto; el cliente del modelo y `callTool` reportan a ella en los bordes. Es lo único de traza que existe antes de la Fase 7.
- **Salida:** tabla de trazabilidad (5.3 registro de llamada, esperas del usuario, reglas de estado); supuestos.

### Fase 6: proveedores, recuperación y cierre (L)
- Reactivo y deliberativo; plan `user_feedback`; `superseded`; recuperación unificada; cierre con `finish` + `result` (en un `apply` posterior al `finish`); cancelación en el orden `interrupted` → `finish` → `result`. `qwen.ts`: se eliminan `verifyStage`, su schema y `qwenMaxTokens.verify`; `parsePlanSteps` deja de asignar ids; se agrega la generación de la pregunta; `ContextOverflowError`.
- **Salida:** tabla de trazabilidad (5.3 reglas de estado y estado terminal por motivo); supuestos.

### Validación final (L) — antes del corte
Única etapa con validación fuerte: pruebas por regla y escenarios completos (sección 4.1). Corre antes de tocar el servidor. **Salida:** pruebas en verde y `tsc --noEmit` limpio sobre todo `src`.

### Fase 7: traza v2, eventos, fachada y corte (M) — después de la Validación final
- `trace/recorder.ts` en **formato v2 directo**, enlazado por `change` (con `stepId` y orden) y alimentado por el receptor de los bordes. Eventos del back: `change` con `{ n, at, ops, meta }` más los eventos de modelo; `/state` devuelve snapshot, `n` y las esperas de `TaskRuntime`. `core.ts` conserva sus métodos públicos; `jarvisRouter.ts` según la sección 3. `server.ts` pasa a los motores nuevos.
- **Criterio de salida:** sin `trace/` todo compila y funciona; con él, la traza sale en v2.
- **Salida:** tabla de trazabilidad (sección 7 del diseño); supuestos.

### Fase 8: limpieza (S)
Borrar `context.ts` viejo, `modeEngines.ts`, `taskConclusion.ts`, `taskWire.ts`, `modelIterations.ts`, `RefStore` y tipos huérfanos; revisar el barril `types.ts`.
- **Salida:** lista de archivos borrados y de referencias huérfanas; supuestos; `tsc --noEmit` limpio.

### 4.1 Validación final: contenido
Runner: `node:test` ejecutado con `tsx --test` (el proyecto no tiene runner; no se agregan dependencias).

**Módulo `ctx` (Fase 1)**
- Validación, una prueba por regla de la sección 6: (1) tarea cerrada rechaza todo salvo `result`; `result` con la tarea `running` se rechaza; `result` en el mismo lote que `finish` se rechaza; (2) operación mal formada, destino inexistente, `add` sobre destino no admitido, `update` sobre destino no id; (3) JSON plano (`undefined`, `NaN`, `Date`), profundidad máxima, campos faltantes y desconocidos, vocabularios, `""` en campos nulables, `args`/`sig` según `status`, `expected` null solo en reactivo; (4) campos no mutables, `plans`/`errors`/`refs` inmutables, `verdict`/`reason` una sola vez, `result` una sola vez; (5) `stepId`, `planId`, `ref` inexistentes y ids creados por el mismo lote; (7) `summary`, strings de `args`, valor de hecho y clave.
- Transiciones de `step.state` (cada par permitido y no permitido) e invariantes 1, 2 y 3.
- Estado terminal por motivo: cada `stopReason` con y sin efectos o llamada aprobada `ok`.
- Atomicidad, ids consecutivos dentro del lote, lote de `superseded` múltiple, dos `apply` para `ref` + llamada.
- Evento `change`: `n` consecutivo, `ops` normalizadas con `id` y `at` del reloj inyectado, `meta` null por defecto; suscriptor que falla; `apply` reentrante; elementos y `ops` congelados.
- Lecturas: `get` por id y `facts.<clave>` (incluida `constructor`), `find`, `current`.
- `snapshot` / `create.fromSnapshot`: ida y vuelta idéntica, copia independiente, `v` distinto → `snapshot_version`, snapshot corrupto → `snapshot_invalid`, `n` en 0; `deepFreeze` actúa sobre la copia, no sobre el objeto del ejecutor.
- Tabla única: cada entrada de `BUDGET` tiene su `BUDGET_META`; `ctx/` no importa nada fuera de `ctx/`.

**Derivaciones y vistas (Fase 2):** pruebas por vista con contextos armados a mano, incluido el escenario real de la traza de ejemplo; `isRepeat` con las excepciones de 5.4 y `exempt`; efectos sin recorte; `ContextOverflowError`.

**Refs (Fase 3):** una ref de 25 KB se guarda, aparece en `forArgs` con su tamaño, se lee por trozos con `read_file` y sobrevive a la expulsión de la tarea; verificación real del acceso del servidor de archivos a la carpeta de refs y de su exposición a escritura.

**Procesador (Fase 4):** `truncated` por extractor; mapeo a estados de llamada; `denied` del servidor; `summary` sin claves de ref.

**Ejecutor (Fases 5 y 6):** el flujo de la traza de ejemplo se reproduce con servidor MCP y modelos simulados; tarea feliz, mutación rechazada (ambos modos), `denied` del servidor (paso `failed` con recuperación) y del Guard (`security_denied`), replan por fallo, plan `user_feedback`, `max_steps`, cancelación con `callTool` en vuelo, servicio caído → `unrecoverable`, verificador caído → `unrecoverable`, generación de plan inválida.

**Tras el corte (Fase 7):** formato v2, intercambios enlazados a pasos y llamadas, `/state` con snapshot, `n` y esperas; sin `trace/` el motor sigue funcionando.

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| Yo no compilo: los errores de tipos aparecen cuando corres `tsc --noEmit` al cerrar la fase | Revisión manual contra el diseño y tabla de trazabilidad en cada entrega; código simple y sin tipos recursivos; se corrige antes de pasar a la fase siguiente |
| `read_file` no lee las rutas de las refs | Contraste con la documentación del servidor en la Fase 3; verificación real en la Validación final |
| Carpeta de refs expuesta a escritura por la herramienta de archivos | Anotarlo en la entrega de la Fase 3; verificar en la Validación final si se puede acceso de solo lectura; definir mitigación con tu aprobación |
| El modelo de decisión pierde el `log` y repite búsquedas | `forRoute` con intentos por ruta y herramienta; probar con la traza real |
| `forPlan` con efectos sin tope desborda | `ContextOverflowError` → `unrecoverable`, sin recorte silencioso |
| Verificador caído cierra la tarea (hoy se toleraba) | Aceptado por el diseño; deja `partial` si hubo efectos |
| Crecimiento de refs sin borrado (no se borran nunca en esta etapa) | Medir el tamaño tras las primeras tareas; la idea de borrarlas al terminar la tarea está en 10.2 del diseño |

## 6. Pendientes que no bloquean

Revisión de argumentos (prompt y evaluación), lista definitiva de razones del verificador, valores abiertos de 10.1 (quedan en `src/core/budget.ts`), unificación de `loop_blocked`, (cerrado en v0.28: una llamada `denied` del servidor cuenta como ejecutada para el anti-loop).

## 7. Observado en el código y supuesto

**Observado**
- `RefStore` es un `Map` en memoria; guarda el texto crudo; se libera al expulsar la tarea.
- `IMCPServer.callTool(name, args)` no recibe señal de cancelación.
- Los extractores omiten contenido bajo el tope de 2500.
- La traza v1 toma duración de `StepCall.execution` y el crudo de `RefStore`.
- `signals.denied` lo activan el Guard, el rechazo del usuario y el texto del resultado del servidor; en ambos modos cierra la tarea hoy.
- Qwen reintenta una vez ante salida inválida.
- `tsconfig.json`: `strict`, `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `isolatedModules`; el código existente importa con extensión `.ts`. `package.json`: sin runner; `lint` es `tsc --noEmit`.

**Supuesto (a verificar en la Fase 3 por lectura y en la Validación final por ejecución)**
- `read_file` acepta `offset` y `length` sobre rutas de refs dentro de `allowedDirectories`.
- `Promise.race` alcanza para cancelar: la llamada al servidor sigue y puede terminar de escribir, como ya admite el diseño.
- `tsx --test` funciona con la configuración de TypeScript y los imports `.ts` del proyecto.
- Tamaño de refs: decenas de KB por tarea; sin medir.
