# Flujo de Ejecución y Orquestación

## 1. Ciclo de Vida
1. **Recepción**: la instrucción entra por `/process` con un modo (`reactive` o `deliberative`). La fachada crea el contexto de la tarea, lo registra y lanza `runTask` en segundo plano.
2. **Estrategia**: `runTask` ejecuta el modo elegido (§2 y §3). Es el único que decide cuándo y cómo se cierra la tarea.
3. **Ejecución por pasos**: cada paso consulta el destino (Decisión 1) y ejecuta llamadas (§4) hasta que una queda aprobada o el paso falla.
4. **Recuperación**: un paso fallido dispara la recuperación del modo: escalación en reactivo, replan en deliberativo (§6).
5. **Cierre**: `finalize` escribe el estado terminal una sola vez y, después, la respuesta final (§8).

### Mapa del flujo
Las flechas punteadas son los cierres de la tarea; todos pasan por `finalize` (§8). Los números de las cajas remiten a las secciones.

```mermaid
flowchart TD
    IN(["POST /process<br/>modo + instrucción"]) --> CTX["Crear contexto y lanzar runTask"]
    CTX --> MODE{"Modo"}

    MODE -->|reactive| PEND["Lista de pendientes<br/>(modelo generativo) §2"]
    MODE -->|deliberative| PLAN["Plan inicial<br/>§3"]

    PEND -->|vacía y canFinish| CLOSE
    PEND -->|el primer pendiente<br/>es la instrucción| RS["Paso nuevo sin plan"]

    PLAN -->|inválido tras reintento| CLOSE
    PLAN --> CONF{"Confirmación<br/>del usuario"}
    CONF -->|pide cambios| PLAN
    CONF -->|rechaza sin instrucción| CLOSE
    CONF -->|acepta| DS["Siguiente paso vigente pendiente"]

    RS --> STEP
    DS --> STEP
    STEP[["runStep §4<br/>Decisión 1, runCall"]]

    STEP -->|completed| NEXT{"¿Terminó?"}
    NEXT -->|deliberativo: todos completed| CLOSE
    NEXT -->|no| MODE2{"Modo"}
    MODE2 -->|reactive| PEND
    MODE2 -->|deliberative| DS

    STEP -->|failed| REC{"Recuperación §6"}
    REC -->|reactivo: escalación 1 y 2| PEND
    REC -->|deliberativo: replan| PLAN2["Replan autónomo<br/>step_failure"]
    PLAN2 --> DS
    REC -.->|tercera escalación| CLOSE
    REC -.->|replans agotados| CLOSE

    STEP -.->|Guard DENY| CLOSE
    STEP -.->|modelo o catálogo caído| CLOSE
    PEND -.->|modelo caído| CLOSE
    PEND -.->|tope de pasos| CLOSE

    CLOSE["finalize §8<br/>estado terminal una sola vez, luego respuesta"]
    CLOSE --> OUT(["completed, partial, failed o cancelled"])
```

### Dentro de un paso
`runStep` (§4) elige el destino y `runCall` (§5) recorre las fases de la llamada. Cada rama de error vuelve al inicio del paso con lo ocurrido a la vista del modelo, salvo las marcadas como cierre o como falla del paso.

```mermaid
flowchart TD
    A{"¿Tope de llamadas<br/>en el paso?"} -->|sí| QCAP["Una pregunta al usuario<br/>si no se hizo ya"] --> FAIL(["Paso failed"])
    A -->|no| D1["Decisión 1<br/>ruta"]
    D1 -->|sin opciones| FAIL
    D1 -->|ruta| C1

    subgraph CALL ["runCall"]
        direction TB
        C1["1 Descubrir herramientas<br/>(sin las vetadas por la lista negra)"] --> C2["2 Decisión 2: elegir herramienta"]
        C2 --> C3["3 Generar argumentos"]
        C3 --> C4["4 Resolver refs"]
        C4 --> C5["5 Anti-bucle"]
        C5 --> C6{"6 Guard"}
        C6 -->|ALLOW o pide aprobación| C6A["6a Lista negra"] --> C6B["6b Pre-chequeo determinista"] --> C7["7 Confirmación del usuario<br/>si Guard la pidió y autoMode está apagado"]
        C7 --> C8["8 Decisión 3: revisar argumentos<br/>solo escrituras sin confirmación"]
        C8 --> C9["9 Despacho a la herramienta"]
        C9 --> C10["10 Procesar resultado<br/>resumen y ref"]
        C10 --> C11{"11 Decisión 4:<br/>preguntas de VERIFY_CHECKS ≥ 0,6"}
    end

    C11 -->|approved| DONE(["Paso completed"])

    C1 -.->|sin herramientas| FAIL
    C1 -.->|catálogo caído| CLOSE(["Cierre de la tarea"])
    C6 -.->|DENY| CLOSE
    C3 -->|args_invalid| R
    C4 -->|refs_unresolved| A
    C5 -->|loop_blocked| A
    C8 -->|info_missing| Q["Pregunta, espera, hecho answer<br/>(una por paso)"] --> A
    C6A -->|tool_rejected| A
    C6B -->|args_invalid, info_missing| R
    C8 -->|args_invalid| R{"¿Segundo rechazo<br/>de la revisión?"}
    R -->|no| A
    R -->|sí| FAIL
    C7 -->|user_rejected| A
    C9 -->|exception, interrupted| A
    C11 -->|rejected| A
```

## 2. Modo Reactivo
Cada vuelta del bucle toma el primer ítem de la **lista de pendientes** y crea un paso nuevo, sin plan previo.

- **Lista de pendientes**: una consulta aparte al modelo generativo (sin razonamiento extendido) devuelve la lista completa de lo que falta para cumplir la solicitud. Recibe la solicitud, la lista de la vuelta anterior, lo hecho (con argumentos y resumen del resultado), los últimos intentos fallidos con su motivo y la entrada del usuario. La lista vive solo en el bucle; en el contexto entra únicamente la instrucción del paso. **La mantiene el código** (`pendingList.ts`): el modelo la genera al empezar, el paso que termina bien quita su ítem sin consultar, y solo se vuelve a consultar al modelo tras un paso fallido (para reescribir el ítem) o al vaciarse la lista (para confirmar que no falta nada). `reconcileList` evita que el modelo vuelva a agregar ítems ya cumplidos o abandonados y conserva los que venían detrás del reescrito.
- **Salida parcial**: un ítem con `maxItemFailures` (2) pasos fallidos seguidos se abandona si quedan otros; se ejecutan los restantes (p. ej. guardar lo obtenido) y la tarea cierra `no_alternatives` (`partial`), con lo no logrado en el encabezado de la respuesta final.
- **Instrucción del paso**: el primer pendiente. Decisión 1, 2, 3 y 4 y la generación de argumentos ven esa instrucción, no la solicitud completa.
- **Lista vacía**: significa que no queda nada por hacer y cierra la tarea según `canFinish`: `completed` si no hay llamadas o alguna está aprobada; `no_alternatives` si solo hubo rechazos del usuario. Sin llamadas (primera vuelta) o con solo fallos, una lista vacía no se acepta de inmediato: se consulta una vez más. Si en la primera vuelta vuelve vacía se acepta (la solicitud no necesita herramientas); si solo hubo fallos, la instrucción pasa a ser la solicitud entera.
- **Lista inválida**: un reintento y, si persiste, la tarea se cierra con `unrecoverable`.
- **Tope de pasos**: al llegar a `maxSteps` pasos (los fallidos cuentan) la tarea se cierra con `max_steps`.
- **Escalación**: un paso fallido es una escalación. Al tercero, la tarea se cierra con `no_alternatives`.

## 3. Modo Deliberativo
1. **Plan inicial**: el modelo generativo propone pasos (hasta el tope), cada uno con instrucción, ruta y resultado esperado. Un plan inválido tras el reintento cierra la tarea con `unrecoverable`.
2. **Confirmación humana**: la tarea espera la decisión del usuario.
   - *Aceptar*: se ejecutan los pasos.
   - *Pedir cambios* (con instrucción): se genera un plan nuevo (`user_feedback`), sin tope de veces, y se vuelve a pedir confirmación. Si el plan nuevo resulta inválido, se conserva el vigente y se vuelve a preguntar.
   - *Rechazar sin instrucción*: la tarea se cancela.
3. **Ejecución**: se toma el paso vigente pendiente y se corre con su ruta fija. La tarea se completa cuando todos los pasos vigentes quedan `completed`.
4. **Replan autónomo**: un paso fallido genera un plan nuevo (`step_failure`) sin pedir confirmación, hasta `maxReplans` veces. Los pasos no completados pasan a `superseded` y se agregan los nuevos; los completados nunca se repiten. El tope de pasos del plan nuevo es `maxSteps` menos los ya completados. Agotados los replans, o si el replan es inválido, la tarea se cierra con `replans_exhausted`.

## 4. Un Paso (`runStep`)
El paso repite este ciclo hasta que termina:

1. **Tope de llamadas**: si el paso ya hizo `maxCallsPerStep` llamadas (sin contar las rechazadas por el usuario), antes de fallar se le hace una pregunta al usuario, si todavía no se le hizo una en el paso; el paso falla igual y la respuesta queda a la vista de lo que siga (siguiente paso o replan).
2. **Decisión 1**: en ambos modos. Ofrece las rutas con alguna herramienta utilizable (en deliberativo, solo la ruta del paso). Si no queda ninguna opción, el paso falla (`no_tools`). Con una sola opción disponible, el modelo de decisión no se consulta.
3. **Llamada** (§5): si queda aprobada, el paso termina `completed`. Si el servidor deniega la herramienta, el paso falla. Una revisión que detecta `info_missing` hace una pregunta al usuario (una por paso): se genera con el modelo generativo, se espera la respuesta y se registra como hecho `answer_<paso>_<n>`. Una llamada bloqueada por el anti-bucle contra una llamada idéntica que la verificación ya aprobó da el paso por cumplido (`completed`: lo pedido ya está hecho); el segundo bloqueo del paso lo falla (`repeat_blocked`, `maxRepeatsPerStep`). Cualquier otro resultado (argumentos inválidos, referencias sin resolver, anti-bucle, revisión rechazada, rechazo del usuario o verificación rechazada) vuelve al inicio con lo ocurrido a la vista del modelo.
4. **Rechazos de la revisión**: al segundo `args_invalid` (el pre-chequeo y D3 lo producen; `tool_rejected` ya no se ofrece) en el mismo paso, el paso falla (`review_rejected`) y la recuperación del modo lo reencauza.

`ask_user` no es una opción de las decisiones: solo se pregunta en los dos casos de arriba (`info_missing` y tope de llamadas).

## 5. Una Llamada (`runCall`)
Fases en orden. Cada llamada se registra una sola vez, al terminar el intento, con su estado final.

| # | Fase | Qué ocurre si falla |
|---|---|---|
| 1 | **Descubrir** las herramientas del destino | Servidor o catálogo no disponible: se registra el error y la tarea se cierra (`unrecoverable`). Sin ninguna herramienta utilizable en ese momento, el paso falla (`no_tools`) |
| 2 | **Elegir herramienta** (Decisión 2). Solo se ofrecen las herramientas utilizables: las que dependen de un proceso activo o de una búsqueda iniciada aparecen solo mientras existan | — |
| 3 | **Generar argumentos** (modelo generativo, conforme al esquema). El prompt incluye, además de `FAIL` (fallos del paso), la sección `LAST ERROR`: el último intento ejecutado de esa misma herramienta que falló (error de la herramienta o resultado rechazado por la verificación), de cualquier paso, con los argumentos que se probaron y lo que devolvió, para que no los repita y corrija solo la causa. No aparece si una llamada posterior de esa herramienta quedó aprobada ni si ese intento ya está en `FAIL`. Se agrega aunque la escritura ya figure en `EFFECTS` | Salida inválida tras el reintento: `args_invalid` |
| 4 | **Resolver referencias** `{{ref:rN}}` / `ref:rN` por su contenido en disco | Referencia desconocida: `refs_unresolved` |
| 5 | **Anti-bucle** sobre la huella de los argumentos resueltos | Repetición bloqueada: `loop_blocked` |
| 6 | **Guard** | `DENY`: la llamada queda `denied` y la tarea se cierra con `security_denied` |
| 6a | **Lista negra** (`policy/blacklist.ts`, clave `blacklist` de `jarvis-config.json`): una herramienta que modifica el sistema, entera o con un patrón sobre los argumentos. Las lecturas nunca se rechazan. Una herramienta vetada entera no se ofrece en la Decisión 2 | `tool_rejected`, con la razón escrita; el modelo sigue con otra herramienta u otros argumentos (no cierra la tarea, a diferencia de Guard) |
| 6b | **Pre-chequeo determinista** (código, sin modelo; `engine/precheck.ts`): valores vacíos o `N/A`, marcadores de posición, rutas de otro usuario o de Linux, comandos que no existen en el sistema (parser de PowerShell), rutas de lectura y URLs que no aparecen en nada de lo que la tarea sabe. Ante la duda no rechaza | `args_invalid` o `info_missing`, con la razón escrita como resumen (llega a la línea FAIL del LLM de argumentos) |
| 7 | **Confirmación del usuario**, si Guard pidió aprobación y el modo automático (`autoMode`) está apagado, después del pre-chequeo (no se le pide aprobar lo que ya se sabe inválido). No se registra nada mientras se espera. **Si el usuario aprueba, la llamada se da por revisada: Decisión 3 no entra** | Rechazo: `user_rejected`, con la instrucción opcional del usuario |
| 8 | **Revisar argumentos**, con umbral (`REVIEW_APPROVE` = 0,6 en `engine/verify.ts`: aprueba solo si la probabilidad de `approved` llega a 0,6; si no, rechaza con la opción de rechazo más probable), solo en escrituras a las que no se les pidió confirmación (`kind: write` sin aprobación de Guard o con el modo automático encendido; las lecturas pasan por el pre-chequeo) (Decisión 3; opciones `approved`, `args_invalid` e `info_missing`: no hay `tool_rejected`, la herramienta la elige Decisión 2) | `args_invalid` (con un motivo fijo: el modelo de decisión solo elige la opción; los argumentos rechazados no se muestran en `FAIL`) o `info_missing` |
| 9 | **Despacho** a la herramienta, compitiendo contra la cancelación. En Windows, un `start_process` en PowerShell se despacha con `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ` antepuesto (`mcp/desktopCommanderMcp.ts`): Desktop Commander decodifica la salida como UTF-8 y PowerShell 5.1 escribe en la página OEM (850), lo que corrompía las tildes. El contexto y la traza guardan el comando sin el prefijo | Excepción: `exception`. Cancelación: `interrupted`, y un resultado tardío se descarta |
| 10 | **Procesar el resultado**: estado, resumen acotado y, si el resumen no contiene todo, el texto completo va a una ref en disco | — |
| 11 | **Verificar** (Decisión 4, §7) | Rechazada: vuelve al paso con el motivo |

### Modo automático (`autoMode`)
Se lee en cada llamada (`deps.autoMode()`, `callRunner.ts`) y cambia solo dos fases de §5; el resto del flujo es igual.

| Fase | `autoMode` apagado | `autoMode` encendido |
|---|---|---|
| 7 Confirmación del usuario | Si Guard pide aprobación (toda escritura o comando del catálogo: `write_file`, `create_directory`, `move_file`, `start_process`, `interact_with_process`), la tarea espera la decisión | No se pide para herramientas del catálogo. Una herramienta no catalogada sigue pidiéndola |
| 8 Decisión 3 | Solo corre si no hubo confirmación (en la práctica, nunca para esas herramientas) | Corre en toda escritura o comando del catálogo, con el umbral `REVIEW_APPROVE` (0,6) |

No cambian: Guard (`DENY` cierra la tarea, regla B de carpetas protegidas, herramienta no catalogada → aprobación), la lista negra (6a), el pre-chequeo (6b), la verificación (D4) ni las lecturas (nunca pasan por D3). Con `autoMode` encendido la última barrera antes de ejecutar una escritura es D3, un modelo de 2B; D4 actúa después de ejecutar y no deshace nada.

Cobertura real de esas barreras (revisada en el código):
- Los patrones `DENY` de Guard son pocos y de estilo Linux (`rm -rf /…`, `mkfs`, `format c:`, `del /f /s /q c:/windows`, `/etc/shadow`, `system32/drivers`). No cubren comandos destructivos de PowerShell como `Remove-Item -Recurse -Force`, `rd /s`, `Format-Volume`, `Stop-Computer` o `reg delete`.
- `blacklist` viene vacía en el código y en `jarvis-config.json`, así que no agrega nada hasta que se cargue.
- Un `start_process` es siempre `write` (aunque el comando solo lea), por lo que con `autoMode` todo comando pasa por D3 y consume una consulta.

## 6. Recuperación y Dudas
- **Reactivo**: tras un paso fallido, la lista de pendientes se regenera viendo los fallos con sus argumentos y puede reescribir la instrucción. Decisión 1 y 2 ven solo los intentos del paso actual (la línea de cada uno y, solo si explica el fallo —`tool_error`, `exception`, `args_invalid`, `info_missing`, `tool_rejected`, `user_rejected`—, su resumen recortado a `caps.attemptSummary`; el resultado leído de una llamada que la verificación rechazó no se repite); los de pasos anteriores los ve la lista. Una herramienta cuya llamada se bloqueó por repetición sigue ofrecida: el anti-bucle solo bloquea la llamada idéntica (misma herramienta y huella de argumentos) y compara contra toda la tarea; dos bloqueos en el paso lo fallan (`repeat_blocked`).
- **Deliberativo**: replan autónomo (§3).
- **Información faltante**: la revisión detecta `info_missing`, la llamada se registra con ese estado y se pregunta al usuario, una vez por paso. También se pregunta antes de fallar por tope de llamadas.
- **Seguridad**: una denegación de Guard cierra la tarea sin escalar ni replanificar. Un rechazo del usuario sobre una operación no cierra la tarea: queda como `user_rejected` y el flujo continúa.

## 7. Verificación del Resultado
Decisión 4 evalúa las preguntas `noul` de la tabla `VERIFY_CHECKS` (`engine/deps.ts`) sobre cada llamada ejecutada: `ok` (¿la llamada tuvo éxito y trajo datos utilizables?) y `cumple` (¿el resultado satisface la instrucción del paso?). El criterio es siempre el paso: en reactivo, el primer pendiente.

- Aprueba solo si pasan todas, cada una con probabilidad de al menos 0,6 (`NOUL_APPROVE` en `engine/verify.ts`, `verdictOf`).
- La razón es la de la primera pregunta que falla, en el orden de la tabla: si falla `ok`, `no_usable_data`; si falla solo `cumple`, `not_accomplished`.
- `tool_error` y `exception` se rechazan sin consultar al modelo. `interrupted` y `denied` no se verifican y quedan sin veredicto.
- Una respuesta inválida se repite una vez; si persiste, el servicio se considera no disponible.
- **Llamadas previas (`recent`)**: `forVerify` entrega además las llamadas aprobadas anteriores a la evaluada, completas (argumentos y resumen), en ambos modos (`VerifyView.previous`). `verifyInput` (`engine/adapters.ts`) se queda con las últimas `caps.lastReads` (3) como `VerifyDecisionInput.recent`. `buildResultVerification` (`reasoner/prompts.ts`) lo agrega al prompt como el bloque `Previous approved calls` (la más reciente al final), antes de la llamada evaluada; sin llamadas previas el bloque se omite.

## 8. Cierre y Respuesta Final
`finalize` escribe el estado terminal una sola vez y después la respuesta (`result`), con su origen:

- **`cancelled`**: siempre respuesta de respaldo, sin modelo.
- **Modelo generativo caído** (un fallo anterior ya lo marcó): respuesta de respaldo directa, sin consultarlo.
- **Resto de los cierres**: el modelo generativo redacta la respuesta con la vista final. Si la vista no entra en su reserva, o el modelo falla por cualquier causa, se entrega la respuesta de respaldo.

Cuando la tarea termina `partial` o `failed`, la respuesta del modelo va precedida de un **encabezado fijo** escrito por el código (`renderStatusNote`: estado, qué no se logró y cambios hechos en la computadora). El bloque `EFFECTS` dice "none" de forma explícita si no hubo cambios, y el prompt aclara que `read`/`write` junto a una herramienta es su tipo, no lo que hizo. Un `loop_blocked` muestra al modelo de argumentos los argumentos bloqueados y el mensaje pide cambiarlos; un rechazo con razón escrita oculta los argumentos.

La respuesta de respaldo es texto fijo, sin modelo: estado de la tarea, motivo de detención, fallos, cambios aplicados al entorno y últimas acciones. Su origen (`model` o `fallback`) queda registrado. El estado terminal nunca depende de cómo se redactó la respuesta.

## 9. Estados y Transiciones

| Estado | Condición |
|---|---|
| `running` | La tarea está en curso, incluidas las esperas del usuario (plan, aprobación o pregunta). |
| `completed` | Reactivo: lista de pendientes vacía con `canFinish` en `completed`. Deliberativo: todos los pasos vigentes `completed`. No lleva motivo. |
| `partial` | Se detuvo por `max_steps`, `replans_exhausted`, `no_alternatives` o `unrecoverable`, pero hubo efectos sobre el entorno o al menos una llamada aprobada. |
| `failed` | Se detuvo por `security_denied`, o por alguno de los motivos anteriores sin efectos ni llamadas aprobadas. |
| `cancelled` | El usuario canceló (`user_cancelled`), en cualquier momento. |

El motivo de detención es una lista cerrada: `max_steps`, `no_alternatives`, `security_denied`, `user_cancelled`, `replans_exhausted` y `unrecoverable` (falló un modelo o el catálogo de herramientas, o una vista no cupo en su límite; no la tarea en sí).

## 10. Errores y Límites
- **Transporte hacia modelos**: los fallos de red o HTTP 503 se reintentan una vez tras 1 s. El timeout y la cancelación nunca se reintentan.
- **Salidas inválidas o truncadas**: el modelo generativo reintenta una vez inyectando el motivo del error en el prompt; el modelo de decisión repite la consulta una vez. Si persiste: en argumentos es `args_invalid`; en la lista de pendientes, `unrecoverable`; en decisión y verificación, servicio no disponible.
- **Servicio no disponible**: se registra el error `service_unavailable` (si ya hay un paso) y la tarea se cierra con `unrecoverable`.
- **Desborde de contexto**: si un prompt no deja margen para la salida, o una vista no entra en su límite, la tarea se cierra con `unrecoverable` sin registrar error y sin repetir.
- **Cancelación cooperativa**: la señal de aborto llega a las esperas y a las llamadas en vuelo, y la tarea concluye sin tratarse como error. Una herramienta ya despachada queda `interrupted`.

Límites vigentes (definidos en `budget.ts` y `config.ts`; los timeouts y el contexto son valores por defecto):

| Límite | Valor |
|---|---|
| Pasos máximos (`maxSteps`) | 20 (reactivo: tope de la tarea; deliberativo: tope por plan) |
| Replans (`maxReplans`) | 3 |
| Escalaciones (reactivo) | 2 (la tercera cierra la tarea) |
| Llamadas por paso (`maxCallsPerStep`) | 6 (sin contar rechazos del usuario) |
| Bloqueos por repetición por paso (`maxRepeatsPerStep`) | 2 (el segundo falla el paso; si repetía una llamada ya aprobada, el paso se da por cumplido) |
| Rechazos de la revisión por paso (`maxReviewRejectionsPerStep`) | 2 (el segundo falla el paso) |
| Preguntas al usuario por paso (`maxQuestionsPerStep`) | 1 |
| Salida de la lista de pendientes (`pending.maxTokens`) | 1024 tokens |
| Reintentos de transporte | 1, tras 1 s |
| Reintentos por salida inválida (`invalidResponseRetries`) | 1 |
| Tareas retenidas | 20 |
| Timeouts | Modelo generativo 120 s (180 s con razonamiento extendido); modelo de decisión 30 s; herramientas 60 s |
| Contexto configurado | 16 384 tokens para ambos modelos |

## 11. Invariantes del Flujo
1. **Unicidad de ejecución**: toda herramienta se ejecuta exclusivamente a través de `runCall` y detrás de Guard (ver `ARCHITECTURE.md`).
2. **Un solo cierre**: solo `runTask` decide el cierre; `runStep` y `runCall` nunca escriben el estado terminal ni la respuesta.
3. **Pasos completados inmutables**: un replan nunca repite ni reemplaza pasos `completed`.
4. **Efectos permanentes**: los efectos ya aplicados no se retiran ante desvíos posteriores (ver `CONTEXT_AND_MEMORY.md`).
5. **Estado terminal cerrado**: una vez terminal, ninguna respuesta demorada ni evento tardío modifica el estado; el contexto rechaza toda escritura posterior.

## 12. Archivos Base
| Tema | Ruta en `src/core/` |
|---|---|
| Entrada y estrategia | `tasks.ts`, `engine/runTask.ts`, `engine/stepLoop.ts`, `engine/planner.ts`, `engine/pending.ts` |
| Llamadas y verificación | `engine/callRunner.ts`, `engine/verify.ts`, `engine/ask.ts` |
| Cierre y fallos | `engine/finalize.ts`, `engine/failures.ts`, `engine/runtime.ts` |
| Modelos y transporte | `decision.ts`, `reasoner/qwen.ts`, `reasoner/prompts.ts`, `reasoner/stageRequests.ts`, `llmTransport.ts`, `budget.ts` |
| Etapas de modelo (ids de traza) | `types/stages.ts` |
| Seguridad | `policy/guard.ts` |
