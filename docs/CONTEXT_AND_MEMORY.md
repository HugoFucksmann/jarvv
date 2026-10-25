# Contexto, Memoria y Persistencia

## 1. Tipos de Contexto y Memoria

| Tipo | Contenido | Alcance | Vida Útil |
|---|---|---|---|
| **Estado Transitorio de Trabajo** | Fotografía inmediata de la última observación realizada (rutas activas, procesos, metadatos de búsqueda). | Tarea activa. | Se sobrescribe o complementa con el delta de cada paso ejecutado. Es estado visible para la interfaz: no se inyecta en los prompts, cuyo contexto sale de la memoria, las lecturas con datos y la última observación. El proceso activo se limpia al terminar y habilita las herramientas que dependen de él. |
| **Registro Cronológico de Acciones** | Secuencia ordenada de pasos ejecutados con la acción invocada (herramienta y destino), estado de la llamada y síntesis determinista del hallazgo (`paso\|acción\|estado\|hallazgo`). | Tarea activa. | Persiste durante toda la tarea; retiene únicamente las entradas más recientes al alcanzar la cota operativa. |
| **Hechos Confirmados** | Claves y valores verificados del entorno (p. ej. rutas o el pid de un proceso lanzado, siempre como texto), hallazgos contrastados y respuestas completas provistas por el usuario. Las URL de una búsqueda no son hechos: viajan completas en las lecturas con datos y en la última observación. | Tarea activa. | Persiste durante toda la tarea. Se consolidan los hechos de un paso validado, de un paso sin veredicto o de una acción que mutó el entorno; los de un paso con veredicto negativo y sin mutación se descartan. |
| **Mutaciones Consolidadas** | Alteraciones físicas sobre archivos, procesos o configuración. No tienen almacén propio: se derivan de los registros de llamadas de la tarea (herramienta mutante cuya ejecución corrió sin error, aunque su verificación no la aprobara). Una entrada por llamada, con el paso, la acción y su destino (`paso\|acción: resultado`); dos escrituras sobre un mismo destino son dos entradas. | Tarea activa. | Permanente durante toda la tarea y sin tope de entradas, porque las llamadas nunca se borran; la replanificación las recibe todas y no las retrae. Una mutación que terminó con error no se registra, aunque haya aplicado cambios parciales (limitación conocida). |
| **Registro de Fallos** | Índice de fallos con texto fijo por causa, en el formato `paso\|herramienta\|causa` (`-` si no hay paso). Las causas son un vocabulario cerrado: argumentos inválidos, referencias sin resolver, bloqueo anti-loop, denegación de seguridad, rechazo del usuario, ejecución fallida, no encontrado, sin resultados, ejecutada con resultado no aprobado, excepción, servicio no disponible, fin rechazado e información insuficiente. El detalle del hallazgo vive en el registro cronológico; nunca se guarda prosa de un modelo. Único punto de escritura: `recordFailure`. | Tarea activa. | Persiste durante la tarea; opera como memoria negativa acotada a los fallos más recientes para podar caminos inviables. |
| **Observaciones de Datos** | Contenido resumido de lecturas útiles previas conservadas para alimentar argumentos posteriores. | Tarea activa. | Retiene un conjunto acotado de las lecturas más recientes para no perder datos ante pasos intermedios. |
| **Enlace Determinista de Paso** | Resumen del hallazgo, hecho principal y referencia del paso completado previo. | Entre pasos contiguos. | Se actualiza tras cada paso exitoso y se descarta tras un paso fallido o sin veredicto. Solo alimenta el prompt de argumentos del paso siguiente. |
| **Almacén de Referencias** | Cargas de datos extensas aisladas bajo identificadores indirectos para evitar desbordes de ventana. Una misma llamada con idéntico resultado reutiliza su referencia. | Tarea activa (en memoria). | Reside en memoria volátil mientras la tarea permanezca retenida; se purga al expulsarse la tarea. |

### Estado de una llamada
El resultado de cada llamada se calcula **una sola vez** (`classifyCall`, en `callExecutor.ts`) y se guarda en `StepCall.status`. De ese estado se derivan, sin lógica propia, el estado en el registro cronológico, la línea de fallos, `evidence.ok`, `outcome.success`, la consolidación de hechos, el enlace entre pasos, las mutaciones y el veredicto que muestran la traza y la UI.

| Estado | Cuándo | Registro | ¿Aprobada? | ¿Cuenta como mutación? |
|---|---|---|---|---|
| `ok` | Señales limpias y aprobada por algún verificador | `ok` | Sí | Sí |
| `unverified` | Señales limpias y ningún verificador disponible | `unv` | No (sin veredicto) | Sí |
| `rejected` | Señales limpias y ningún verificador la aprobó | `rej` | No | Sí |
| `tool_error` | Error, timeout o código de salida distinto de 0 | `err` | No | No |
| `not_found` | El recurso no existe (p. ej. `ENOENT`, `[NOT_FOUND]`) | `nf` | No | No |
| `no_data` | El recurso existe pero no hay datos (archivo vacío, búsqueda sin resultados) | `nd` | No | No |
| `args_invalid`, `refs_unresolved`, `loop_blocked`, `denied`, `user_rejected`, `exception` | Falló antes de ejecutarse o por una excepción | sin entrada | No | No |

El motivo de un fallo (`step.error`, que recibe el replan) es la causa fija más el hallazgo determinista de la herramienta. Las probabilidades de Eos y el `reason` de Qwen viajan solo en los eventos y la traza.

## 2. Construcción del Contexto
Cada llamada a un modelo recibe solo los bloques que necesita, delimitados y con presupuesto propio. El prompt de argumentos se ensambla así: entorno, herramienta, esquema, objetivo (si difiere de la instrucción), contexto de chat (hoy sin uso), registro, ventana del plan (solo modalidad deliberativa), fallos, hechos, efectos, referencias, lecturas con datos, última observación e instrucción del paso (con el enlace determinista del paso anterior, si lo hay).

Los hallazgos, etiquetas y valores de una línea pasan por `sanitizeForMemory` (aplanado, sin caracteres de control, con delimitadores y etiquetas neutralizados); los bloques multilínea de observaciones se envuelven en `<obs>` neutralizando solo esos delimitadores.

## 3. Límites y Política de Recorte
- **Preservación de cola**: En registros cronológicos y listas de fallos, al alcanzarse la capacidad operativa asignada se descartan las entradas antiguas y se preservan las más recientes para garantizar razonamiento sobre la consecuencia inmediata.
- **Acotación de observaciones**: Las salidas de herramientas se condensan mediante extractores específicos y el texto íntegro se resguarda en el almacén de referencias. Las búsquedas y las salidas de procesos se compactan bajo un presupuesto de caracteres; `list_directory` (primeras 40 entradas) y `read_file` (hasta 30 líneas) se acotan por líneas y el procesador no les impone tope de caracteres: lo aplican los prompts al insertarlas.
- **Ventana de planificación**: En tareas por etapas, el razonador observa un resumen consolidado de las etapas previas ya completadas, la etapa activa en curso de forma íntegra con sus criterios de éxito, y un horizonte acotado de las etapas inmediatamente posteriores.
- **Recuperación progresiva**: En la evaluación reactiva, la cantidad de historial contextual inyectada comienza en un nivel mínimo y se amplía progresivamente solo si median escalaciones o desvíos técnicos.
- **Sin tope propio**: El registro de mutaciones (derivado de las llamadas) no se recorta: la replanificación lo recibe completo, acotado en la práctica por el tamaño del plan, y los demás prompts lo acotan por presupuesto de caracteres, conservando lo más reciente. La respuesta del usuario se conserva completa en la memoria; en el prompt de argumentos, la instrucción del paso (que la incluye) se acota a 12 000 caracteres. Los prompts de clasificación y verificación mantienen sus recortes.
- **Guarda de contexto**: Antes de cada llamada al razonador se estima el prompt (3 caracteres por token); si no deja un margen mínimo de salida, la llamada se rechaza. La petición no fija el contexto del servidor, por lo que `qwenNumCtx` debe coincidir con el contexto real configurado en él.

Cotas vigentes (definidas en `types.ts`, `context.ts` y `prompts.ts`):

| Elemento | Cota |
|---|---|
| Registro cronológico | 30 entradas |
| Registro de fallos | 5 entradas |
| Lecturas con datos | 3 |
| Mutaciones consolidadas | Sin tope |
| Recuperación progresiva de historial | 2, 5 y 10 entradas |
| Observación compacta de una llamada | 2 500 caracteres |
| Instrucción del paso en el prompt de argumentos | 12 000 caracteres |
| Resultados de búsqueda en el estado transitorio | 10 |

## 4. Persistencia
- **Gestión de tareas en memoria volátil**: El estado de las tareas activas y concluidas se mantiene exclusivamente en memoria RAM. El sistema conserva un cupo acotado de tareas en memoria; al superarse dicho cupo, las tareas terminales más antiguas junto con sus referencias asociadas son expulsadas de la memoria.
- **Cupo y cancelación**: Si al crear una tarea se supera el cupo y no quedan terminales que expulsar, se cancela la tarea en espera más antigua; sin tareas en espera, el cupo se excede mientras las demás sigan en ejecución.
- **Sin restauración de estado**: Al reiniciar el proceso del servidor no se restaura el historial operativo desde disco; el sistema inicializa limpio.
- **Configuración**: `jarvis-config.json` es lo único que se guarda entre sesiones; no contiene estado de tareas.
- **Trazabilidad append-only para auditoría**: Si la configuración de registro está habilitada, la conclusión de una tarea agrega una línea estructurada a un archivo de registro secuencial en disco. Dicho registro es de consumo externo para auditoría y evaluación analítica, y nunca es consultado ni interpretado por el backend para reanudar tareas. Su formato es un contrato versionado (`v: 1`) que consume el laboratorio (`lab/`); los campos se añaden sin romper a los consumidores existentes. Por tarea: mensaje, estado, plan, respuesta final y su origen (`model` o `fallback`), un registro por cada intercambio real con un modelo y las ejecuciones de herramientas.
  - **Intercambios con modelos**: etapa, entrada y salida crudas, inicio (`startedAt`) y duración (`durationMs`) de la llamada, ordenados por su inicio real. Solo cuentan los intercambios reales: el atajo de Decision #2 con una sola herramienta y las verificaciones que no llegaron a ejecutarse no se registran (criterio único: `ModelIteration.invoked`). En argumentos, cada intento inválido o sin respuesta se registra con su error, y en verificación semántica con salida inválida, el error.
  - **Ejecuciones de herramientas**: estado de la llamada, inicio y duración de la ejecución (sin la verificación posterior), resultado y vista previa.
  - **Pensamiento de los modelos**: nunca se registra. La salida cruda de Qwen se reduce a una lista blanca de campos (identificador, modelo, `finish_reason`, contenido sin bloques `<think>` y uso de tokens), en la traza, los eventos y las iteraciones; si el cuerpo no se puede leer, solo se registra su tamaño.

## 5. Invariantes de Acceso a Memoria
- **Exclusión de escritura por modelos**: Los modelos de lenguaje nunca escriben directamente en la memoria ni en el almacén de referencias; toda incorporación de hechos, fallos o mutaciones es procesada y validada deterministamente por el motor de ejecución.
- **Sin prosa de modelos en la memoria**: Lo que un modelo razona o justifica (p. ej. el `reason` del verificador semántico o las probabilidades de Eos) no entra en el registro de fallos, en `step.error`, en el motivo de detención de la tarea (un paso declarado irrecuperable usa un texto fijo) ni en el contexto de otros modelos; solo viaja en eventos y trazas, donde es auditoría y no alimenta ningún prompt.
- **Restricción de lectura sobre datos masivos**: Los modelos nunca leen contenidos completos almacenados bajo referencias; únicamente acceden a observaciones compactas y delimitadas.
- **Inmutabilidad del registro de efectos**: Ninguna operación de replanificación o retroceso puede alterar ni purgar las mutaciones físicas ya asentadas; al derivarse de las llamadas, que nunca se borran (un paso reemplazado solo se marca como tal), esta garantía se cumple por construcción.
- **Aislamiento en resolución**: Los componentes de consulta nunca leen ni resuelven referencias fuera del identificador de la tarea activa.

## 6. Invariantes del Subsistema
1. **Permanencia de efectos**: Las mutaciones físicas consolidadas nunca se eliminan ni se ocultan ante una replanificación.
2. **Segregación de referencias por tarea**: Ninguna tarea puede consultar, resolver o alterar referencias pertenecientes a otra tarea.
3. **Sustitución determinista no recursiva**: Los tokens de referencia se sustituyen una sola vez en los argumentos antes de la evaluación de seguridad; el contenido inyectado jamás se vuelve a analizar en busca de nuevos tokens.
4. **Volatilidad estricta**: Ningún fallo de proceso o reinicio depende de almacenamiento secundario para la coherencia del runtime; la memoria operativa no persiste en disco.
5. **Barrera de sanitización**: Todo dato externo ingresa al contexto saneado o delimitado como dato (ver §2 y el principio de aislamiento ontológico en `ARCHITECTURE.md`).

## 7. Limitaciones conocidas de v1.0
- **`start_process` no informa el exit code**: el servidor solo avisa que el proceso terminó, así que un comando que falla es indistinguible de uno exitoso. `read_process_output` sí informa el código cuando el proceso ya había terminado.
- **`search_active` no se apaga**: `start_search` exitoso habilita `get_more_search_results` durante el resto de la tarea, aunque la búsqueda haya terminado.
- **`process_id` tras un error de interacción**: si `interact_with_process` falla porque el proceso terminó, el estado transitorio conserva el pid hasta la siguiente lectura exitosa.
- **`toolRuns.ok` de la traza** solo indica error de protocolo; el resultado real está en `status`.
- **Emparejamiento en `lab/`**: asocia llamadas a modelos con ejecuciones de herramientas por paso, no por llamada; con reintentos dentro de un paso puede emparejar mal.
- **Timeouts intermedios**: un timeout de Qwen o de Decision durante un paso queda registrado como servicio no disponible, sin distinguirlo de una caída.

## 8. Archivos Base
- `src/core/context.ts`
- `src/core/config.ts`
- `src/core/callExecutor.ts`
- `src/core/modeEngines.ts`
- `src/core/core.ts`
- `src/core/modelIterations.ts`
- `src/core/reasoner/qwen.ts`
- `src/core/processor/resultProcessor.ts`
- `src/core/processor/refResolver.ts`
- `src/core/reasoner/prompts.ts`
- `src/core/taskTrace.ts`
- `src/core/types.ts`