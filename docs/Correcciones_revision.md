# CORRECCIONES_REVISION

Seguimiento de las notas "JARVIS back — notas de revisión". Método: cada ítem se constata contra el código (sin tests; validación con `npx tsc --noEmit`, que corre el usuario). Lo que toca infraestructura, contexto, flujo o core queda **pendiente de decisión** hasta que se apruebe.

## Estado general

| # | Ítem | Veredicto | Estado |
|---|---|---|---|
| A1 | URL `/v1/decide` con barra final | Confirmado | Aplicado (etapa 1, tsc OK) |
| A2 | Headers de túnel siempre enviados | Confirmado | Aplicado (etapa 1, tsc OK) |
| A3 | `catch (err: any)` en discovery | Confirmado | Aplicado (etapa 1, tsc OK) |
| A4a | Caché de 30 s fija | Confirmado, sin impacto | No se modifica |
| A4b | Alias de servidores en discovery | Confirmado | No se modifica (ver etapa 2) |
| A5 | `import type` | Parcial (`discovery.ts` ya estaba bien) | Aplicado (etapa 1, tsc OK) |
| B1 | `RefStore.clear("")` borra todo | Confirmado, latente | **Aplicado (etapa 2)** |
| B2 | `ResultProcessor.process`: `args = {}` antes de `taskId` | Confirmado | **Aplicado (etapa 3)** |
| H1 | `callExecutor.ts`: error TS2339 en `Phase` (`.result`) | Reproducido; depende de `strictNullChecks` | **Aplicado (etapa 3)** |
| B3 | `taskTrace`: `appendFileSync` bloquea | Confirmado, sin impacto demostrado | No se modifica |
| B4 | `taskTrace`: error de directorio "ignorado en silencio" | **Falso**: se registra con `console.warn` | Sin cambio |
| C1 | Guard: `rm -rf /<ruta>` dispara DENY | Confirmado | Cerrado: se mantiene el DENY (decisión del usuario) |
| C2 | Guard: `approvalReason` puede imprimir `[object Object]` | Confirmado (con matices) | **Aplicado (etapa 2)** |
| D1 | `generatePlan` con 6 parámetros posicionales | Confirmado; 2 de los 6 nunca se usan | Pendiente de decisión |
| D2 | Llamadas MCP no cancelables | Confirmado | Pendiente de decisión (recomendado: dejar) |
| D3 | `stepIndex` según quién emite | Confirmado, intencional | Pendiente de decisión (recomendado: dejar) |
| D4 | PLAN: `signals?.denied \|\| BLOCKED` redundante | Redundante en los archivos revisados | Pendiente de decisión (falta una búsqueda) |
| D5 | `modifyPlan.reportFailure` emite `WAITING_INPUT` | Confirmado, más una carrera real en el `catch` | **Aplicado (aprobado por el usuario)** |
| D6 | Dos reglas para PARTIAL/FAILED | Confirmado | **Aplicado (aprobado por el usuario)**: regla única |
| D7 | Casts de estrechamiento en `modeEngines.ts` | **Ya corregido** (helper `hasState`) | Sin cambio |
| D8 | Problemas estructurales (estado compartido, tipos de eventos, `types.ts`…) | Confirmados | No se modifican (ver etapa 3) |

---

## Etapa 1 (cerrada): Grupo A

Archivos: `core/decision.ts` (A1), `core/llmTransport.ts` (A2), `core/mcp/discovery.ts` (A3), `core/mcp/types.ts` (A5).

- **A1:** `const base = endpoint.replace(/\/+$/, ""); const url = base.endsWith("/v1/decide") ? base : \`${base}/v1/decide\`;` Antes `.../v1/decide/` daba `.../v1/decide/v1/decide`.
- **A2:** se quitan `ngrok-skip-browser-warning` y `bypass-tunnel-reminder` de `REQUEST_HEADERS` (el usuario ya no usa túnel; ambos modelos van por `ollama serve`).
- **A3:** `catch (err)` + `errorMessage(err)` (`utils.ts`). Diferencia: si se lanza algo que no es `Error` pero tiene `.message`, el motivo guardado pasa a `String(obj)`.
- **A5:** `import type { MCPTool, MCPCallResult }` en `mcp/types.ts`.

---

## Etapa 2: Grupos B y C

Archivos revisados: `core/callExecutor.ts`, `core/tools/manifest.ts`, `core/policy/guard.ts`, `core/taskTrace.ts`, `core/processor/resultProcessor.ts`, `core/processor/refStore.ts`.

### B1 — `RefStore.clear("")` → Aplicado

`findstr /s /n "RefStore.clear" *.ts *.tsx` en la raíz: un único uso, `core.ts:369` (`evictTerminalTasks`, con la clave del `Map` `taskContexts`). Se elimina la rama "todas":

```ts
static clear(taskId: string): void {
    RefStore.tasks.delete(taskId);
}
```

Archivo: `core/processor/refStore.ts`. `core.ts` no cambia.

### C2 — `Guard.approvalReason` → Aplicado

- **Confirmado:** `${args.command || args.cmd || tool}` y `${args.path || args.filename || "sistema"}` interpolan el valor tal cual; si no es texto se imprime `[object Object]`.
- **Matices (sin cambiar):** con el manifest actual ninguna herramienta usa `COMMAND_EXECUTION`, `DOWNLOAD` ni `CONFIGURATION` (solo `FILE_READ`, `FILE_WRITE`, `PROCESS_CONTROL` y `READ`; `COMMAND_EXECUTION` aparece solo en `UNKNOWN_TOOL_POLICY`, que `evaluate` resuelve antes con su propio texto). Esas ramas de `approvalReason` hoy no se alcanzan. Además, para `start_process` (`PROCESS_CONTROL`) el motivo no incluye el comando; el comando viaja aparte en `args` dentro de la solicitud de aprobación (`callExecutor.ts`, `authorizeCall`).
- **Modificación:** helper privado `Guard.text(value)` (devuelve el valor solo si es texto no vacío) usado en ambas interpolaciones; se conservan los alias `cmd` y `filename`.
- **Archivo:** `core/policy/guard.ts`. El motivo es solo texto que `callExecutor.ts` pasa a la solicitud de aprobación; no hay otro consumidor que dependa de su formato en los archivos revisados.

### C1 — `rm -rf /<ruta>` → Cerrado (se mantiene el DENY)

- **Confirmado:** el patrón `/\brm\s+(-\w+\s+)+\//` coincide con `rm -rf /` seguido de cualquier ruta. No coincide con `rm -r ./x`, `rm -rf ~/x` ni rutas de Windows.
- **Es política de seguridad (Guard):** se decide, no se corrige solo. Opciones:
  1. Dejarlo: el catálogo apunta a Windows, donde `rm -rf /ruta` casi no aparece; el costo del falso positivo es mínimo y falla hacia el lado seguro.
  2. Acotarlo a la raíz (`rm -rf /` o `/*`) y directorios de sistema: reduce el falso positivo, pero hay que enumerar qué se considera de sistema.
- **Resolución:** el usuario mantiene la protección tal como está (opción 1). Sin cambios de código.

### B2 — `ResultProcessor.process`, `args = {}` antes de `taskId` → Aplicado (etapa 3)

- **Confirmado:** `process(mcp, tool, rawResult, args = {}, taskId)`. Como `taskId` es obligatorio, todo llamador debía pasar `args` igualmente; el default no servía de nada y, si alguien pasaba `undefined`, fallaba dentro de `refLabel` (lee `args.source`).
- **Llamadores (`findstr /s /n "ResultProcessor" *.ts *.tsx`):** uno solo, `callExecutor.ts:536`, que pasa `args` reales. Lo demás es el import y un comentario.
- **Modificación:** `args: Record<string, unknown>,` (sin `= {}`). Archivo: `core/processor/resultProcessor.ts`.

### B3 / B4 — `taskTrace.ts` → Sin cambio

- **B3:** `appendFileSync` es sincrónico, pero se ejecuta una vez por tarea (`context.traced`) y el costo es una sola línea al cerrar. No hay impacto demostrado; pasarlo a asíncrono cambia el momento de escritura sin necesidad comprobada.
- **B4:** el informe dice que el error se ignora en silencio. No es así: el `catch` hace `console.warn("[TaskTrace] No se pudo registrar la traza:", …)`. Lo que sí es cierto: no se crea el directorio si no existe, y la traza se pierde con ese aviso en consola.

### A4b — alias de `DiscoveryEngine` → No se modifica

- `callExecutor.ts` pasa `serverOf(route)` (`DESTINATIONS`): siempre `desktop_commander` o `free_search`, nunca un alias. `jarvisRouter.ts` usa `discoverAll` (nombres reales).
- Queda `mcpRouter.ts:11`: `getServer(req.params.server)` toma el nombre de la URL. Hace falta saber si algún cliente (`ui/`) usa `desktop`, `commander`, `search` o `web`. Si ninguno, se pueden eliminar los alias.
- `findstr /s /n /i "api/mcp" ui\*.ts ui\*.tsx` no encontró nada, es decir, `ui/` no usa esa ruta. No prueba que nadie use alias: `server.ts` también monta `/mcp` y declara que inspectores externos usan esos endpoints.
- **Resolución:** sin evidencia de daño ni de uso, no se toca. Si se quiere eliminar los alias, hacen falta `mcpRouter.ts` y la búsqueda de `/mcp/` en `ui/`.

---

## Etapa 3: Grupo D (flujo y estados). Solo veredictos, nada aplicado

Archivos revisados: `modeEngines.ts`, `taskConclusion.ts`, `stepEvents.ts`, `engineDeps.ts`, `qwen.ts` (`ILLMClient`, `generatePlan`), `types.ts`, `server.ts`, más `callExecutor.ts` y `core.ts`. `stepEvents_1.ts` es idéntico a `stepEvents.ts`.

### D5 — `modifyPlan`, camino de error (core.ts) → Aplicado

- **Confirmado el informe:** `reportFailure` emite `TASK_STATE_CHANGED` con `WAITING_INPUT` sin cambiar `task.state`. No es una divergencia por sí sola: `isAwaitingPlanConfirmation` ya garantiza que el estado es `WAITING_INPUT/plan_confirmation`, y el evento funciona como canal de error hacia la UI (campo `error`).
- **Problema real (fuera del informe):** el camino de éxito vuelve a comprobar `isAwaitingPlanConfirmation` tras el `await`, pero el `catch` no. Si el usuario confirma el plan mientras se regenera y `generatePlan` falla (no por cancelación), se emite `WAITING_INPUT` con la tarea ya en `RUNNING`.
- **Cambio mínimo propuesto:**

```ts
} catch (err) {
  if (err instanceof RequestAbortedError) return;
  if (!this.isAwaitingPlanConfirmation(context)) return;   // nuevo: igual que en el camino de éxito
  reportFailure(errorMessage(err));
  return;
}
```

- **Aplicado** en `core/core.ts` (`modifyPlan`): el `catch` ahora hace `if (!this.isAwaitingPlanConfirmation(context)) return;` antes de `reportFailure`. Sin otros cambios.

### D6 — Dos reglas para PARTIAL / FAILED → Aplicado (opción A)

- `taskConclusion.resolveFailureState` (lo usa `concludeAsFailure`, es decir todo cierre por fallo): PARTIAL si **algún** paso, vigente o reemplazado, está `COMPLETED`.
- `modeEngines.resolveIncompleteState` (solo `concludeExhaustedPlan`): PARTIAL si algún paso **vigente** está `COMPLETED` o `UNVERIFIED`.
- **Efecto:** una tarea FAST con una acción `UNVERIFIED` que luego falla se cierra como FAILED; un plan agotado con pasos solo `UNVERIFIED` se cierra como PARTIAL. Un paso reemplazado cuenta en una regla y no en la otra.
- **Opciones:** (A) una sola función, con la regla de los pasos vigentes `COMPLETED` o `UNVERIFIED`, exportada desde `taskConclusion.ts`. Algunos cierres pasarían de FAILED a PARTIAL, y eso se ve en la UI y en las trazas. (B) Dejar ambas y solo renombrarlas para que la diferencia sea explícita.
- **Aplicado (opción A):** una sola función, `resolveIncompleteState`, exportada desde `core/taskConclusion.ts`: PARTIAL si algún paso vigente (no reemplazado) está `COMPLETED` o `UNVERIFIED`; FAILED si no. `concludeAsFailure` (taskConclusion) y `concludeExhaustedPlan` (modeEngines) usan esa misma función.
- **Archivos:** `core/taskConclusion.ts` (reemplaza `resolveFailureState`, que no estaba exportada) y `core/modeEngines.ts` (se elimina su copia local, se importa la común y se quitan los imports `Task` y `TaskState`, que quedaron sin uso).
- **Efecto visible:** un cierre por fallo con solo pasos `UNVERIFIED` pasa de FAILED a PARTIAL; un paso reemplazado deja de contar.

### D1 — `generatePlan` con 6 parámetros posicionales

- **Confirmado:** `(userMessage, chatContext?, signal?, compactCatalog?, modificationFeedback?, existingPlanSummary?)`, declarada en `ILLMClient` y en `QwenEngine`.
- **Llamadores en `src`:** `modeEngines.ts:473` (3 argumentos) y `core.ts` `modifyPlan` (6, con dos `undefined` de relleno). Ninguno usa `chatContext` ni `compactCatalog`: en la práctica son parámetros muertos.
- **Opciones:** (A) dejarlo; (B) quitar esos dos y pasar el resto como objeto. Toca `ILLMClient`, `qwen.ts`, `core.ts`, `modeEngines.ts` y cualquier mock o `lab/adapter.ts` que lo implemente o llame.
- **Búsqueda en todo el repo:** `generatePlan` aparece solo en `core.ts:249`, `modeEngines.ts:473` y `qwen.ts` (interfaz e implementación). `lab/` y `ui/` no lo usan.
- **Con eso, la opción B es acotada:** firma `generatePlan(userMessage, signal?, revision?: { feedback, existingPlanSummary })`, tocando solo `qwen.ts` (interfaz e implementación), `core.ts` y `modeEngines.ts`. Sigue siendo el contrato de `ILLMClient` (core), así que no se aplica sin tu aprobación. Si no hay un problema concreto, A (dejarlo) sigue siendo válida.

### D2 — Llamadas MCP no cancelables

- **Confirmado:** `IMCPServer.callTool(name, args)` no recibe señal; `dispatchTool` lo llama sin ella y, si la tarea se canceló, descarta el resultado tardío (`isStopped`). La herramienta sigue ejecutándose.
- **Cambiarlo** implica una señal opcional en `mcp/types.ts`, `desktopCommanderMcp.ts`, `freeSearchMcp.ts`, `transport.ts` y `callExecutor.ts` (no tengo los tres primeros de este grupo). Es un cambio de infraestructura.
- **Recomendación:** dejarlo, salvo que aparezca un caso real (por ejemplo, una búsqueda larga que no se pueda parar).

### D3 — `stepIndex` solo en algunos eventos

- **Confirmado, y es intencional:** `stepEvents.ts` lo documenta; los motores de modo conocen el índice y el ejecutor no. Unificarlo cambia el contrato SSE que consume la UI.
- **Recomendación:** dejarlo.

### D4 — PLAN: `signals?.denied || hasState(step, "BLOCKED")`

- **Redundancia confirmada en lo revisado:** un paso queda `BLOCKED` en `callExecutor.blockStep` (que siempre devuelve `denied: true`), en `modeEngines.ts:391` (FAST, anti-loop) y en `:610` (PLAN, después de esta comprobación). En PLAN el bucle solo toma pasos `PENDING/RUNNING` y los pone en `RUNNING` antes de `runStep`.
- **No verificado:** `context.ts` y `modelIterations.ts` no estaban en este lote. Búsqueda: `findstr /s /n "BLOCKED" src\*.ts`.
- **Recomendación:** dejarlo. Es una defensa barata y quitarla no mejora nada.

### D7 — Casts de estrechamiento

- **Ya corregido:** `modeEngines.ts` no tiene casts `as TaskState` / `as StepState`; usa el helper `hasState`.

### D8 — Estructurales (no se modifican)

Confirmados al leer el código, pero son deuda de diseño y no errores:
- **Estado mutable compartido:** `core.cancelTask`, `callExecutor` (`blockStep`, `authorizeCall`) y `modeEngines` modifican `task`/`step`.
- **`EngineDependencies`** expone `Decision20Engine` y `DiscoveryEngine` concretos; solo `ILLMClient` es interfaz.
- **Eventos sin tipo:** `CoreEvent.data` es `Record<string, unknown>`; unos 35 puntos de `emitEvent` en los 4 archivos revisados.
- **Dos vocabularios de estado** de una llamada (`StepCall.status` y `StepExecutionResult.status`), traducidos en `classifyCall`.
- **`types.ts`:** 73 exports, incluidas dos funciones (`isExecutableRoute`, `isTerminalState`).
- Recomendación: no tocarlos; refactorizar sin un problema demostrado agrega complejidad.

---

## Etapa 3 (continuación): error de compilación en `Phase`

- **Síntoma informado:** `Property 'result' does not exist on type 'Phase<void>'` (y `Phase<DispatchOutput>`) en `callExecutor.ts`, en `runStep`.
- **Causa (reproducida con el compilador en un caso mínimo):** `Phase<T>` es una unión discriminada por `proceed: true | false`. La comprobación `if (!x.proceed) return x.result;` solo estrecha el tipo con `strictNullChecks` activo. Sin él (como en `tsconfig.json`, que no declara `strict`) da exactamente ese error. Con `x.proceed === false` estrecha en ambas configuraciones. Con `strictNullChecks` activo compilan las dos formas.
- **Origen:** no es un cambio de las etapas anteriores (esas líneas no se tocaron). Depende de la configuración de tipos con la que se compile (editor o versión de TypeScript), no del código en sí; esto conecta con el hallazgo 1 de más abajo (tsconfig sin `strict`).
- **Modificación (4 líneas, sin cambio de comportamiento):** en `core/callExecutor.ts`, `runStep`: `if (!generated.proceed)`, `if (!loopCheck.proceed)`, `if (!authorized.proceed)` e `if (!dispatched.proceed)` pasan a `if (X.proceed === false)`.
- **Pendiente de confirmar:** dónde apareció el error (editor o consola) y la salida de `npx tsc -v`, porque `npx tsc --noEmit` no lo mostraba.

---

## Hallazgos fuera del informe (sin tocar)

1. **`tsconfig.json` sin `strict`.** Compilar sin errores garantiza menos de lo que parece (p. ej. `undefined` se acepta donde se espera un valor).
2. **`core.ts` `modifyPlan`, camino de error:** ver D5 (propuesta concreta en la etapa 3).
3. **Tamaño de los logs.** `decision.ts` registra estado y preguntas a 300 y la respuesta a 600; `callExecutor.ts` registra `args` a 300 y el resultado MCP a 400 (Grupo E).
4. **Capacidades sin uso en el manifest.** `COMMAND_EXECUTION`, `DOWNLOAD` y `CONFIGURATION` están en `NEEDS_APPROVAL` pero ninguna herramienta las usa.

## Validación pendiente

`npx tsc --noEmit` tras los cambios de la etapa 2 (`refStore.ts`, `guard.ts`): sin errores (informado por el usuario).

Pendiente tras los cambios de la etapa 3 (`callExecutor.ts`, `resultProcessor.ts`, `core.ts`, `taskConclusion.ts`, `modeEngines.ts`): `npx tsc --noEmit`.