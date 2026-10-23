# Contexto, Memoria y Persistencia

## 1. Tipos de Contexto y Memoria

| Tipo | Contenido | Alcance | Vida Útil |
|---|---|---|---|
| **Estado Transitorio de Trabajo** | Fotografía inmediata de la última observación realizada (rutas activas, procesos, metadatos de búsqueda). | Tarea activa. | Se sobrescribe o complementa con el delta de cada paso ejecutado. Es estado visible para la interfaz: no se inyecta en los prompts, cuyo contexto sale de la memoria, las lecturas con datos y la última observación. |
| **Registro Cronológico de Acciones** | Secuencia ordenada de pasos ejecutados con la acción invocada, estado y síntesis del hallazgo. | Tarea activa. | Persiste durante toda la tarea; retiene únicamente las entradas más recientes al alcanzar la cota operativa. |
| **Hechos Confirmados** | Claves y valores verificados del entorno, hallazgos contrastados y respuestas completas provistas por el usuario. | Tarea activa. | Persiste durante toda la tarea. Se consolidan los hechos de un paso validado, de un paso sin veredicto o de una acción que mutó el entorno; los de un paso con veredicto negativo y sin mutación se descartan. |
| **Mutaciones Consolidadas** | Registro acumulativo de alteraciones físicas irreversibles sobre archivos, procesos o configuración. | Tarea activa. | Permanente durante toda la tarea y sin tope de entradas; la replanificación las recibe todas y no las retrae. |
| **Registro de Fallos** | Registro de desvíos lógicos, argumentos rechazados y bloqueos de seguridad. | Tarea activa. | Persiste durante la tarea; opera como memoria negativa acotada a los fallos más recientes para podar caminos inviables. |
| **Observaciones de Datos** | Contenido resumido de lecturas útiles previas conservadas para alimentar argumentos posteriores. | Tarea activa. | Retiene un conjunto acotado de las lecturas más recientes para no perder datos ante pasos intermedios. |
| **Enlace Determinista de Paso** | Resumen del hallazgo, hecho principal y referencia del paso completado previo. | Entre pasos contiguos. | Se actualiza tras cada paso exitoso y se descarta tras un paso fallido o sin veredicto. Solo alimenta el prompt de argumentos del paso siguiente. |
| **Almacén de Referencias** | Cargas de datos extensas aisladas bajo identificadores indirectos para evitar desbordes de ventana. | Tarea activa (en memoria). | Reside en memoria volátil mientras la tarea permanezca retenida; se purga al expulsarse la tarea. |

## 2. Construcción del Contexto
Cada llamada a un modelo recibe solo los bloques que necesita, delimitados y con presupuesto propio. El prompt de argumentos se ensambla así: entorno, herramienta, esquema, objetivo (si difiere de la instrucción), contexto de chat (hoy sin uso), registro, ventana del plan (solo modalidad deliberativa), fallos, hechos, efectos, referencias, lecturas con datos, última observación e instrucción del paso (con el enlace determinista del paso anterior, si lo hay).

Los hallazgos, etiquetas y valores de una línea pasan por `sanitizeForMemory` (aplanado, sin caracteres de control, con delimitadores y etiquetas neutralizados); los bloques multilínea de observaciones se envuelven en `<obs>` neutralizando solo esos delimitadores.

## 3. Límites y Política de Recorte
- **Preservación de cola**: En registros cronológicos y listas de fallos, al alcanzarse la capacidad operativa asignada se descartan las entradas antiguas y se preservan las más recientes para garantizar razonamiento sobre la consecuencia inmediata.
- **Acotación de observaciones**: Las salidas de herramientas se condensan mediante extractores específicos y el texto íntegro se resguarda en el almacén de referencias. Las búsquedas y las salidas de procesos se compactan bajo un presupuesto de caracteres; `list_directory` (primeras 40 entradas) y `read_file` (hasta 30 líneas) se acotan por líneas y el procesador no les impone tope de caracteres: lo aplican los prompts al insertarlas.
- **Ventana de planificación**: En tareas por etapas, el razonador observa un resumen consolidado de las etapas previas ya completadas, la etapa activa en curso de forma íntegra con sus criterios de éxito, y un horizonte acotado de las etapas inmediatamente posteriores.
- **Recuperación progresiva**: En la evaluación reactiva, la cantidad de historial contextual inyectada comienza en un nivel mínimo y se amplía progresivamente solo si median escalaciones o desvíos técnicos.
- **Sin tope propio**: El registro de mutaciones no se recorta: la replanificación lo recibe completo y los demás prompts lo acotan por presupuesto de caracteres, conservando lo más reciente. La respuesta del usuario se conserva completa y la instrucción del prompt de argumentos no se recorta; los prompts de Decision y de verificación mantienen sus recortes. Para el replan y el prompt de argumentos no hay cota máxima definida: solo actúa la guarda de contexto del razonador (`qwen.ts`), que estima tokens (1 token / ~3 caracteres) y rechaza cualquier prompt que no deje al menos 256 tokens libres para la salida antes de invocar al servidor.

## 4. Persistencia
- **Gestión de tareas en memoria volátil**: El estado de las tareas activas y concluidas se mantiene exclusivamente en memoria RAM. El sistema conserva un cupo acotado de tareas en memoria; al superarse dicho cupo, las tareas terminales más antiguas junto con sus referencias asociadas son expulsadas de la memoria.
- **Cupo y cancelación**: Si al crear una tarea se supera el cupo y no quedan terminales que expulsar, se cancela la tarea en espera más antigua; sin tareas en espera, el cupo se excede mientras las demás sigan en ejecución.
- **Sin restauración de estado**: Al reiniciar el proceso del servidor no se restaura el historial operativo desde disco; el sistema inicializa limpio.
- **Trazabilidad append-only para auditoría**: Si la configuración de registro está habilitada, la conclusión de una tarea agrega una línea estructurada a un archivo de registro secuencial en disco. Dicho registro es de consumo externo para auditoría y evaluación analítica, y nunca es consultado ni interpretado por el backend para reanudar tareas.

## 5. Invariantes de Acceso a Memoria
- **Exclusión de escritura por modelos**: Los modelos de lenguaje nunca escriben directamente en la memoria ni en el almacén de referencias; toda incorporación de hechos, fallos o mutaciones es procesada y validada deterministamente por el motor de ejecución.
- **Restricción de lectura sobre datos masivos**: Los modelos nunca leen contenidos completos almacenados bajo referencias; únicamente acceden a observaciones compactas y delimitadas.
- **Inmutabilidad del registro de efectos**: Ninguna operación de replanificación o retroceso puede alterar ni purgar las mutaciones físicas ya asentadas en el registro histórico.
- **Aislamiento en resolución**: Los componentes de consulta nunca leen ni resuelven referencias fuera del identificador de la tarea activa.

## 6. Invariantes del Subsistema
1. **Permanencia de efectos**: Las mutaciones físicas consolidadas nunca se eliminan ni se ocultan ante una replanificación.
2. **Segregación de referencias por tarea**: Ninguna tarea puede consultar, resolver o alterar referencias pertenecientes a otra tarea.
3. **Sustitución determinista no recursiva**: Los tokens de referencia se sustituyen una sola vez en los argumentos antes de la evaluación de seguridad; el contenido inyectado jamás se vuelve a analizar en busca de nuevos tokens.
4. **Volatilidad estricta**: Ningún fallo de proceso o reinicio depende de almacenamiento secundario para la coherencia del runtime; la memoria operativa no persiste en disco.
5. **Barrera de sanitización**: Todo dato externo ingresa al contexto saneado o delimitado como dato (ver §2 y el principio de aislamiento ontológico en `ARCHITECTURE.md`).

## 7. Archivos Base
- `src/core/context.ts`
- `src/core/callExecutor.ts`
- `src/core/core.ts`
- `src/core/processor/resultProcessor.ts`
- `src/core/processor/refResolver.ts`
- `src/core/reasoner/prompts.ts`
- `src/core/reasoner/qwen.ts`
- `src/core/taskTrace.ts`
- `src/core/types.ts`