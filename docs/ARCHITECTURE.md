# Arquitectura del Sistema

## 1. Propósito
El backend es un sistema determinista de asistencia y automatización local. Orquesta la ejecución supervisada de herramientas en el entorno operativo y la web mediante la separación estricta entre planificación, clasificación de decisiones y ejecución segura.

## 2. Principios Invariantes
1. **Núcleo único de ejecución**: Todo comando o acceso a herramientas se procesa a través de un único canal determinista. La planificación no ejecuta herramientas; solo secuencia etapas sobre el núcleo.
2. **Desacoplamiento estricto de modelos**: El modelo de razonamiento descompone objetivos, formula parámetros estructurados y valida etapas; el clasificador factual selecciona rutas, herramientas y evalúa el cumplimiento técnico inmediato. Ningún modelo tiene acceso directo al sistema operativo.
3. **Seguridad con cierre por defecto**: Toda acción potencialmente mutante requiere autorización explícita previa. Cualquier herramienta no registrada en el catálogo oficial queda excluida de la ejecución.
4. **Aislamiento ontológico de datos**: Las salidas voluminosas de herramientas se segregan bajo referencias deterministas. Los modelos razonan sobre observaciones acotadas y direccionan contenidos mediante identificadores indirectos.
5. **Volatilidad controlada del estado**: El estado operativo reside exclusivamente en memoria volátil, con un cupo de tareas retenidas; la trazabilidad externa opera en modo de solo adición para auditoría (ver detalle en `CONTEXT_AND_MEMORY.md`).

## 3. Componentes

| Componente | Responsabilidad | Qué NO hace |
|---|---|---|
| **Host del Servidor** | Inicializa el entorno, gestiona señales del sistema operativo para el apagado ordenado de subprocesos y expone los canales de comunicación y eventos. | No toma decisiones de ejecución ni gestiona el estado interno de las tareas. |
| **Núcleo Orquestador** | Centraliza el ciclo de vida de las tareas en memoria, emite eventos de observabilidad y coordina las solicitudes de intervención del usuario. | No dialoga directamente con los servidores de herramientas ni contiene la lógica de los bucles de ejecución. |
| **Motores de Modo** | Implementan las estrategias reactiva y deliberativa, regulan cotas operativas, gestionan la escalación ante desvíos y ejecutan la replanificación autónoma. | No generan argumentos estructurados ni evalúan políticas de seguridad. |
| **Ejecutor Atómico de Pasos** | Conduce el pipeline secuencial de cada acción: validación de ruta, selección de herramienta, formulación de argumentos, resolución de referencias, control anti-bucle, compuerta de seguridad, despacho, procesamiento y verificación. | No decide la estrategia global de la tarea ni define secuencias de pasos. |
| **Clasificador Factual** | Discrimina entre rutas operativas o fin de tarea, selecciona la herramienta correspondiente al destino y emite el dictamen técnico inmediato sobre los resultados observables. | No genera texto libre, planes complejos ni argumentos estructurados. |
| **Razonador** | Descompone objetivos en etapas estructuradas, genera argumentos validados contra esquema, evalúa semánticamente el progreso de las etapas y sintetiza la respuesta final. | No despacha comandos ni accede al entorno local. |
| **Compuerta de Seguridad** | Evalúa argumentos normalizados contra patrones destructivos prohibidos y políticas de mutación para autorizar, solicitar intervención humana o denegar la acción. | No modifica argumentos ni negocia alternativas con los modelos. |
| **Catálogo de Herramientas** | Define formalmente las herramientas autorizadas, sus rutas funcionales, capacidades asociadas y requisitos de autorización. | No ejecuta llamadas ni mantiene estado dinámico. |
| **Procesador de Resultados** | Parsea salidas de herramientas, sintetiza observaciones acotadas, calcula señales de fallo y aísla cargas pesadas en el almacén de referencias. | No evalúa la veracidad semántica de los datos ni interactúa con disco. |
| **Resolutor de Referencias** | Sustituye tokens de referencia por sus contenidos reales en los argumentos antes de la evaluación de seguridad y el despacho. | No genera nuevas referencias ni invoca herramientas. |
| **Gestor de Contexto y Memoria** | Recupera la memoria de la tarea para cada llamada a un modelo y la expone en bloques acotados y delimitados que previenen inyecciones. | No persiste información ni realiza llamadas a servicios. |
| **Registro de Trazabilidad** | Emite un registro secuencial en disco al término de cada tarea para análisis y evaluación externa. | No actúa como base de datos ni restaura estado al reiniciar el servidor. |

## 4. Dependencias entre Capas
- **Dirección permitida**: Jerárquica y descendente. Las capas superiores de orquestación dependen de los componentes subordinados de ejecución, seguridad e inferencia, nunca a la inversa.
- **Dirección prohibida**: Ningún componente de inferencia, seguridad o procesamiento de herramientas conoce ni depende de las capas de orquestación o del host. El backend no posee dependencias hacia capas de presentación ni de laboratorio.

## 5. Puntos de Extensión
- **Nuevas herramientas**: Se registran exclusivamente en el catálogo de herramientas asociando su identificador, destino, capacidad, esquema de parámetros y política de mutación.
- **Nuevos destinos funcionales**: Se definen en las rutas del catálogo asociándolos al servidor correspondiente e incorporando sus descripciones operativas.
- **Nuevos servidores de herramientas**: Se conectan implementando el protocolo estándar de comunicación y registrándose en el gestor de descubrimiento del servidor.

## 6. Archivos Base
- `server.ts`
- `src/server/jarvisRouter.ts`
- `src/core/core.ts`
- `src/core/modeEngines.ts`
- `src/core/callExecutor.ts`
- `src/core/decision.ts`
- `src/core/reasoner/qwen.ts`
- `src/core/policy/guard.ts`
- `src/core/tools/manifest.ts`
- `src/core/processor/resultProcessor.ts`
- `src/core/processor/refResolver.ts`
- `src/core/context.ts`
- `src/core/taskTrace.ts`
- `src/core/types.ts`