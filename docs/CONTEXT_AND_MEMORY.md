# Contexto, Memoria y Persistencia

## 1. Tipos de Contexto y Memoria

| Tipo | Contenido | Alcance | Vida Útil |
|---|---|---|---|
| **Estado Transitorio de Trabajo** | Fotografía inmediata de la última observación realizada (rutas activas, procesos, metadatos de búsqueda). | Tarea activa. | Se sobrescribe o complementa con el delta de cada paso ejecutado. |
| **Registro Cronológico de Acciones** | Secuencia ordenada de pasos ejecutados con la acción invocada, estado y síntesis del hallazgo. | Tarea activa. | Persiste durante toda la tarea; retiene únicamente las entradas más recientes al alcanzar la cota operativa. |
| **Hechos Confirmados** | Claves y valores verificados del entorno, hallazgos contrastados y respuestas provistas por el usuario. | Tarea activa. | Persiste durante toda la tarea; los datos hipotéticos se descartan si el paso no aprueba la verificación. |
| **Mutaciones Consolidadas** | Registro acumulativo de alteraciones físicas irreversibles sobre archivos, procesos o configuración. | Tarea activa. | Permanente durante toda la tarea; no se descarta ni se retrae durante una replanificación. |
| **Registro de Fallos** | Registro de desvíos lógicos, argumentos rechazados y bloqueos de seguridad. | Tarea activa. | Persiste durante la tarea; opera como memoria negativa acotada a los fallos más recientes para podar caminos inviables. |
| **Observaciones de Datos** | Contenido resumido de lecturas útiles previas conservadas para alimentar argumentos posteriores. | Tarea activa. | Retiene un conjunto acotado de las lecturas más recientes para no perder datos ante pasos intermedios. |
| **Enlace Determinista de Paso** | Resumen del hallazgo, hecho principal y referencia del paso completado previo. | Entre pasos contiguos. | Se actualiza tras cada paso exitoso para contextualizar la etapa siguiente. |
| **Almacén de Referencias** | Cargas de datos extensas aisladas bajo identificadores indirectos para evitar desbordes de ventana. | Tarea activa (en memoria). | Reside en memoria volátil mientras la tarea permanezca retenida; se purga al expulsarse la tarea. |

## 2. Construcción del Contexto
Para maximizar la tasa de acierto en el almacenamiento en caché de los modelos locales y prevenir manipulaciones externas, el contexto se ensambla bajo un orden estricto:
1. **Directivas estables**: Instrucciones de sistema, convenciones de salida, descripciones de herramientas autorizadas y esquemas estructurales.
2. **Contexto histórico acumulado**: Mutaciones consolidadas, hechos confirmados, registro cronológico de acciones, historial de fallos y catálogo de referencias activas.
3. **Bloque dinámico del paso activo**: Objetivo global, ventana del plan vigente, enlace determinista del paso anterior, lecturas con datos y observación de la última acción.

Toda salida externa o contenido leído del entorno pasa por una barrera de sanitización que remueve caracteres de control, normaliza espacios y neutraliza delimitadores de bloque y etiquetas de observación, asegurando que el modelo trate el texto exclusivamente como datos pasivos y nunca como instrucciones operativas.

## 3. Límites y Política de Recorte
- **Preservación de cola**: En registros cronológicos y listas de fallos, al alcanzarse la capacidad operativa asignada se descartan las entradas antiguas y se preservan las más recientes para garantizar razonamiento sobre la consecuencia inmediata.
- **Acotación de observaciones**: Las salidas de herramientas se procesan bajo un presupuesto máximo de caracteres; si el contenido excede el espacio permitido, se condensa mediante extractores específicos y el texto íntegro se resguarda en el almacén de referencias.
- **Ventana de planificación**: En tareas por etapas, el razonador observa un resumen consolidado de las etapas previas ya completadas, la etapa activa en curso de forma íntegra con sus criterios de éxito, y un horizonte acotado de las etapas inmediatamente posteriores.
- **Recuperación progresiva**: En la evaluación reactiva, la cantidad de historial contextual inyectada comienza en un nivel mínimo y se amplía progresivamente solo si median escalaciones o desvíos técnicos.

## 4. Persistencia
- **Gestión de tareas en memoria volátil**: El estado de las tareas activas y concluidas se mantiene exclusivamente en memoria RAM. El sistema conserva un cupo acotado de tareas en memoria; al superarse dicho cupo, las tareas terminales más antiguas junto con sus referencias asociadas son expulsadas de la memoria.
- **Sin restauración de estado**: Al reiniciar el proceso del servidor no se restaura el historial operativo desde disco; el sistema inicializa limpio.
- **Trazabilidad append-only para auditoría**: Si la configuración de registro está habilitada, la conclusión de una tarea agrega una línea estructurada a un archivo de registro secuencial en disco. Dicho registro es de consumo externo para auditoría y evaluación analítica, y nunca es consultado ni interpretado por el backend para reanudar tareas.

## 5. Invariantes de Acceso a Memoria
- **Exclusión de escritura por modelos**: Los modelos de lenguaje nunca escriben directamente en la memoria ni en el almacén de referencias; toda incorporación de hechos, fallos o mutaciones es procesada y validada deterministamente por el motor de ejecución.
- **Restricción de lectura sobre datos masivos**: Los modelos nunca leen contenidos completos almacenados bajo referencias; únicamente acceden a observaciones compactadas y sanitizadas bajo presupuesto de caracteres.
- **Inmutabilidad del registro de efectos**: Ninguna operación de replanificación o retroceso puede alterar ni purgar las mutaciones físicas ya asentadas en el registro histórico.
- **Aislamiento en resolución**: Los componentes de consulta nunca leen ni resuelven referencias fuera del identificador de la tarea activa.

## 6. Invariantes del Subsistema
1. **Permanencia de efectos**: Las mutaciones físicas consolidadas nunca se eliminan ni se ocultan ante una replanificación.
2. **Segregación de referencias por tarea**: Ninguna tarea puede consultar, resolver o alterar referencias pertenecientes a otra tarea.
3. **Sustitución determinista no recursiva**: Los tokens de referencia se sustituyen una sola vez en los argumentos antes de la evaluación de seguridad; el contenido inyectado jamás se vuelve a analizar en busca de nuevos tokens.
4. **Volatilidad estricta**: Ningún fallo de proceso o reinicio depende de almacenamiento secundario para la coherencia del runtime; la memoria operativa no persiste en disco.
5. **Barrera de sanitización**: Todo dato externo se despoja de capacidad directiva antes de ingresar al contexto (ver principio de aislamiento ontológico en `ARCHITECTURE.md`).

## 7. Archivos Base
- `src/core/context.ts`
- `src/core/processor/resultProcessor.ts`
- `src/core/processor/refResolver.ts`
- `src/core/reasoner/prompts.ts`
- `src/core/taskTrace.ts`
- `src/core/types.ts`
