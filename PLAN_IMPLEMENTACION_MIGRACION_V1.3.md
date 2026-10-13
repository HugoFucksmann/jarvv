JARVIS — Plan Maestro de Migración v1.3 (revisado)

Documento: PLAN_IMPLEMENTACION_MIGRACION_V1.3.md
Título Oficial: JARVIS — Plan Maestro de Migración v1.3 (revisado)
Fecha de Actualización: 13 de octubre de 2026
Estado: Especificación técnica de migración corregida y consolidada (incluye arquitectura objetivo del modo PLAN) · Pendiente de auditorías previas a la ejecución
Fuentes Normativas: Código fuente en src/core/*, server.ts, contratos de herramientas MCP en docs/MCP_TOOLS_SNAPSHOT.md, Desicion-2.0-Eos.md, docs/JARVIS_Migracion.md y decisiones confirmadas de arquitectura.

Sistema de Clasificación Normativa

Cada enunciado relevante de este documento utiliza una de las cuatro etiquetas oficiales siguientes, con el significado indicado. No existen categorías adicionales ni variantes equivalentes.

[DECISIÓN CONFIRMADA]: Decisión arquitectónica, funcional o de alcance acordada y ratificada explícitamente. No está sujeta a debate ni puede modificarse sin una nueva instrucción expresa.
[REQUISITO DE IMPLEMENTACIÓN]: Comportamiento funcional, técnico, de seguridad o de validación que el sistema deberá cumplir obligatoriamente durante la implementación.
[PENDIENTE DE VERIFICAR]: Comportamiento, contrato, estado o regla técnica que depende de inspeccionar el código real, realizar pruebas empíricas o consultar documentación oficial. Debe comprobarse con evidencia antes de implementar la decisión correspondiente.
[PENDIENTE DE CONFIRMAR]: Propuesta de diseño o decisión funcional que todavía requiere aprobación explícita. No debe resolverse unilateralmente.

Reglas de aplicación:
Una decisión confirmada y su detalle técnico todavía desconocido se clasifican por separado: la decisión como [DECISIÓN CONFIRMADA] y el detalle que requiere auditoría como [PENDIENTE DE VERIFICAR].
Un comportamiento del código no comprobado no se marca como confirmado.
Las 11 decisiones de diseño de PLAN (sección 3.2.9) están aprobadas y no se tratan como [PENDIENTE DE CONFIRMAR].
Los registros de la sección 13.1 son antecedentes históricos sin vigencia normativa; ante cualquier discrepancia prevalecen las secciones 1 a 12.
1. Objetivo y Restricciones Generales
1.1 Objetivo

[REQUISITO DE IMPLEMENTACIÓN]
Definir la especificación técnica completa, coherente y auditable para migrar JARVIS Core al diseño objetivo v1.3, orientando el sistema hacia la unificación de la ejecución de pasos, el desacoplamiento de la selección y verificación en Decision 2.0 (Eos-0.8B) y liberando a Qwen 3.5 9B de tareas de clasificación o escalación, sin introducir subsistemas complejos innecesarios ni límites artificiales.

[DECISIÓN CONFIRMADA]
Dentro de ese objetivo, el modo PLAN se define como una capa de coordinación y supervisión (planificación, aprobación, verificación por etapa y replanificación) que reutiliza el flujo de ejecución de FAST, y no como un segundo motor de ejecución (ver sección 3.2).

1.2 Restricciones Generales
1. [DECISIÓN CONFIRMADA]: No modificar el código del proyecto durante la elaboración y revisión de este plan.
2. [DECISIÓN CONFIRMADA]: Conservar las decisiones ya acordadas y no reinventar comportamientos ni contratos.
3. [DECISIÓN CONFIRMADA]: No eliminar pendientes de verificación sin evidencia empírica directa del código o contratos.
4. [DECISIÓN CONFIRMADA]: No convertir propuestas históricas o resúmenes preliminares en requisitos confirmados sin validación.
5. [REQUISITO DE IMPLEMENTACIÓN]: Ningún modelo de lenguaje (Eos o Qwen) podrá inventar herramientas, servidores, nombres de parámetros ni esquemas que no existan en el catálogo vigente. Los valores de los argumentos generados por el modelo según la tarea deben validarse rigurosamente contra el schema real de la herramienta seleccionada antes de su ejecución. Esta restricción aplica también a Qwen en su rol de planificador, verificador y replanificador en PLAN.
6. [DECISIÓN CONFIRMADA]: No incorporar un límite global de tiempo de ejecución (deadline global) por tarea. La migración no implementará un cronómetro de tarea de 10 minutos ni lógica de pausa o reanudación de dicho límite. Los timeouts técnicos específicos de herramientas o servicios (como el timeout stdio de MCP o el timeout HTTP de Qwen) se auditan y gestionan por separado.
7. [DECISIÓN CONFIRMADA]: La propuesta de arquitectura de PLAN no rediseña ni modifica runStep. PLAN consume el flujo de ejecución de FAST tal como esté definido en el resto de este plan.
2. Límites de Ejecución y Pasos
2.1 Conservación del Límite MAX_STEPS = 15
[DECISIÓN CONFIRMADA]: Se conservan como límites de referencia MAX_STEPS = 15 y MAX_REPLAN = 2, ratificados formalmente. No se implementa un tope artificial de 8 pasos en PLAN; la ejecución se rige por el límite de 15 pasos. No se asume la semántica de ambos valores con el flujo de PLAN por etapas hasta verificar su implementación.
[PENDIENTE DE VERIFICAR]: La semántica exacta de los límites en el código actual:
En FAST (src/core/modeEngines.ts:251), cada iteración de runFastLoop instancia un nuevo Step e incrementa stepIndex, limitando efectivamente a 15 iteraciones.
En PLAN (src/core/modeEngines.ts:452), el bucle itera sobre los pasos generados.
Cómo se contabilizan los pasos de runStep de las distintas etapas frente a MAX_STEPS = 15 y cómo se cuentan los replanteos sucesivos frente a MAX_REPLAN = 2, de modo que el total acumulado de pasos ejecutados no exceda 15. Se determinará por auditoría; no se define aquí ninguna fórmula nueva.
[REQUISITO DE IMPLEMENTACIÓN]: No se inventa una nueva fórmula de cálculo ni se eliminan restricciones existentes hasta auditar exhaustivamente el contador y el ciclo de vida de los pasos en el código real. Cualquier tope asociado a replanificación no podrá actuar como un techo global alternativo que reproduzca los límites de llamadas eliminados (sección 2.2).
2.2 Eliminación Total de Límites de Llamadas
[DECISIÓN CONFIRMADA]: Se eliminan definitivamente los límites de 30 llamadas por tarea (MAX_TOOL_CALLS_TASK = 30) y 4 llamadas por paso (MAX_TOOL_CALLS_PER_STEP = 4).
[REQUISITO DE IMPLEMENTACIÓN]: Deben localizarse y eliminarse todas sus restricciones efectivas en todo el proyecto, no únicamente en src/core/types.ts:
src/core/modeEngines.ts: bucle while (callCount < MAX_TOOL_CALLS_PER_STEP) (línea 462) y comprobaciones de callCount (líneas 330, 488).
src/core/types.ts: constantes MAX_TOOL_CALLS_TASK y MAX_TOOL_CALLS_PER_STEP.
src/core/callExecutor.ts: cualquier corte artificial dependiente de conteo de llamadas.
[DECISIÓN CONFIRMADA]: No se introducirán límites globales nuevos que reproduzcan la restricción eliminada. Quedan prohibidos pools de llamadas (como pools de 15 o 30 llamadas) o multiplicadores de invocaciones que actúen como techos globales alternativos.
[DECISIÓN CONFIRMADA]: La eliminación de estos límites se diferencia claramente de los mecanismos de detección de bucles infinitos y de las políticas de recuperación ante fallos.
[PENDIENTE DE VERIFICAR]: Auditar el mecanismo anti-loop existente en src/core/callExecutor.ts:169–191 (firma basada en nonReadCounter). No se inventará un nuevo mecanismo antibucles sin previa justificación y auditoría de la implementación actual.
3. Reparto Estricto de Responsabilidades de Arquitectura

Para evitar ambigüedades o duplicación de responsabilidades entre subsistemas, se establece la siguiente separación inequívoca:

[Usuario / Interfaz]
        │
        ▼
   ┌─────────┐
   │  CORE   │ ◄─── Control de flujo, validación de schemas/respuestas,
   └────┬────┘      políticas de Guard, resolución de referencias y despacho
        │
        ├────────────────────────┬────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐        ┌───────────────┐        ┌───────────────┐
│ Decision 2.0  │        │   Qwen 3.5    │        │  Servidores   │
│   (Eos 0.8B)  │        │     (9B)      │        │      MCP      │
├───────────────┤        ├───────────────┤        ├───────────────┤
│• Elecciones   │        │• Generación   │        │• Ejecución    │
│  cerradas     │        │  abierta      │        │  efectiva de  │
│• Selección de │        │• Argumentos   │        │  herramientas │
│  herramientas │        │  complejos    │        │  por stdio    │
│• Verificación │        │• Planificación│        │  (Windows,    │
│  binaria      │        │• Redacción    │        │   Desktop C., │
│  (ok / cumple)│        │  (compose)    │        │   Free Search)│
│• Arbitraje en │        │• Respuesta    │        │               │
│  escalaciones │        │  final        │        │               │
└───────────────┘        └───────────────┘        └───────────────┘
Decision 2.0 Eos (0.8B):
[DECISIÓN CONFIRMADA]: Responsabilidad: Toma exclusivamente decisiones cerradas de selección y evaluación dentro de los contratos choice, noul y score (a verificar, sección 4.2).
[REQUISITO DE IMPLEMENTACIÓN]: Límite estricto: Eos no ejecuta herramientas, no resuelve argumentos abiertos y no puede autorizar una ejecución mediante una respuesta malformada, incompleta o inválida.
Qwen 3.5 (9B):
[DECISIÓN CONFIRMADA]: Responsabilidad: Generación de texto abierto: elaboración inicial de planes, replanteos estructurados, generación de argumentos abiertos complejos cuando no sean deterministas ni elecciones cerradas, redacción con la herramienta local compose y redacción de la respuesta final. En el modo PLAN, Qwen además verifica cada etapa frente a su objetivo y criterios de éxito, y evalúa y ajusta el plan cuando hay desviaciones (sección 3.2).
[REQUISITO DE IMPLEMENTACIÓN]: Límite estricto: Qwen no clasifica seguridad ni resuelve escalaciones de fallo técnico. La replanificación de PLAN no constituye una escalación de seguridad ni habilita acciones (sección 3.2.7).
[DECISIÓN CONFIRMADA]: Se migra la responsabilidad de escalación hacia código y Eos; la autorización para retirar físicamente la implementación actual (deps.qwenEngine.escalate) queda condicionada a la auditoría que demuestre que sus funciones de recuperación están completamente cubiertas (sección 3.1).
JARVIS Core (Orquestador y Runtime):
[REQUISITO DE IMPLEMENTACIÓN]: Responsabilidad: Validación rigurosa de respuestas de Eos y argumentos de Qwen, aplicación determinista de políticas de seguridad (Guard), sustitución de referencias temporales, control del ciclo de vida de tareas y pasos, detección de bucles (anti-loop) y despacho uniforme hacia handlers locales o servidores MCP.
Servidores MCP (Herramientas Externas):
[REQUISITO DE IMPLEMENTACIÓN]: Responsabilidad: Ejecución efectiva de las llamadas sobre el entorno a través del transporte stdio y retorno de salidas estructuradas.
3.1 Objetivo de Unificación y Auditoría Previa de Responsabilidades
[REQUISITO DE IMPLEMENTACIÓN]: Se conserva el objetivo arquitectónico de unificar la ejecución de pasos mediante un motor común (runStep). No obstante, la eliminación de los motores anteriores (runFastLoop, runPlanLoop), de la escalación actual (deps.qwenEngine.escalate) y de las decisiones D1, D2 y D5 queda estrictamente condicionada a demostrar que todas sus responsabilidades operativas están cubiertas sin regresiones. La decisión de eliminar Decision #5 está confirmada (sección 5); su supresión física queda sujeta a esta misma condición.
[REQUISITO DE IMPLEMENTACIÓN]:
No se asume que la implementación propuesta de runStep sea suficiente antes de auditar el código real.
Ninguna función se elimina únicamente porque su denominación parezca obsoleta.
Debe comprobarse en el código que no existan efectos secundarios o dependencias ocultas en src/core/modeEngines.ts, src/core/callExecutor.ts y src/core/decision.ts.
No se deben duplicar responsabilidades entre el motor unificado, Eos, Qwen y los componentes deterministas del Core.
[REQUISITO DE IMPLEMENTACIÓN]: En relación con PLAN, la auditoría de runPlanLoop debe clasificar cada una de sus responsabilidades en una de dos categorías: (a) responsabilidades de ejecución (selección de herramientas, generación de argumentos, validación, llamadas, reintentos), que deben quedar cubiertas por el flujo FAST / runStep y no duplicarse en PLAN; y (b) responsabilidades de coordinación (generación del plan, aprobación, verificación por etapa, replanificación), que permanecen en la capa de PLAN. Ninguna responsabilidad de runPlanLoop se elimina sin haber sido asignada explícitamente a una de ellas.
[PENDIENTE DE VERIFICAR]: Auditar las responsabilidades exactas de D1, D2 y D5 en src/core/decision.ts y cómo se mapean punto por punto en el nuevo flujo de runStep.
3.2 Arquitectura del Modo PLAN
3.2.1 Principio Rector: FAST y PLAN son Modos con Responsabilidades Distintas
[DECISIÓN CONFIRMADA]: FAST y PLAN son modos con responsabilidades distintas:
FAST es el flujo de ejecución: selecciona herramientas, genera argumentos, valida, ejecuta y verifica a nivel de paso mediante runStep.
PLAN es una capa de coordinación y supervisión: planifica, obtiene la aprobación del usuario, entrega cada etapa al flujo FAST, verifica el resultado de cada etapa y replanifica cuando corresponde.
[DECISIÓN CONFIRMADA]: PLAN no es un segundo motor de ejecución. Reutiliza el flujo de ejecución existente de FAST (runStep), que conserva su lógica actual de selección de herramientas, generación de argumentos, validación y ejecución. No se rediseña ni se modifica runStep (sección 1.2, punto 7).
[REQUISITO DE IMPLEMENTACIÓN]: No se duplica en PLAN la lógica de ejecución de FAST. PLAN no implementa su propia selección de herramientas, generación de argumentos, validación de schemas, despacho de llamadas ni reintentos de ejecución.
3.2.2 Separación entre Planificación, Ejecución y Verificación
[DECISIÓN CONFIRMADA]: Flujo de PLAN y responsabilidades por fase:
[Solicitud del usuario]
        │
        ▼
 1. PLANIFICACIÓN (Qwen) ─────────► plan en etapas
        │
        ▼
 2. APROBACIÓN (Usuario) ─────────► aceptar / rechazar / solicitar modificaciones
        │   (la ejecución comienza solo tras la aceptación)
        ▼
 3. EJECUCIÓN DE UNA ETAPA (flujo FAST · runStep, con Guard y controles de FAST)
        │
        ▼
 4. VERIFICACIÓN DE LA ETAPA (Qwen) ─► ¿resultado real cumple objetivo y criterios de éxito?
        │
        ▼
 5. REPLANIFICACIÓN (Qwen, solo si corresponde) ─► ajusta etapas pendientes
        │
        └──► siguiente etapa pendiente (vuelve a 3) o cierre de la tarea
Fase	Responsable	Qué hace	Qué no hace
Planificación	Qwen	Genera el plan detallado en etapas, con objetivos, dependencias y criterios de éxito.	No ejecuta herramientas ni autoriza acciones.
Aprobación	Usuario (vía Core / interfaz)	Acepta, rechaza o solicita modificaciones del plan.	Su aprobación no autoriza automáticamente todas las acciones futuras.
Ejecución	Flujo FAST (runStep)	Ejecuta cada etapa con su lógica actual de selección, argumentos, validación y ejecución.	No es rediseñado ni duplicado por PLAN.
Verificación	Qwen	Evalúa el resultado real de la etapa frente a su objetivo y criterios de éxito.	No reemplaza los controles de Guard ni la verificación a nivel de paso de runStep.
Replanificación	Qwen (mismo planificador)	Evalúa desviaciones y modifica las etapas pendientes preservando el objetivo original.	No elude denegaciones de seguridad ni autoriza acciones por sí misma.
[DECISIÓN CONFIRMADA]: La separación entre planificación, ejecución y verificación es explícita y se mantiene en la implementación: quien planifica y verifica (Qwen) no ejecuta, y quien ejecuta (flujo FAST) no decide el plan.
3.2.3 Planificación con Qwen
[DECISIÓN CONFIRMADA]: Qwen recibe como entrada: la solicitud del usuario, el contexto relevante, el system prompt y un catálogo de las capacidades/herramientas disponibles.
[DECISIÓN CONFIRMADA]: Qwen genera un plan detallado, dividido en etapas operativas. Schema y granularidad del plan: cada etapa representa un objetivo operativo verificable e incluye dependencias, resultado esperado y criterio de éxito. Las herramientas candidatas son opcionales dentro de una etapa.
[DECISIÓN CONFIRMADA]: Catálogo de herramientas para Qwen: se entrega un catálogo compacto con nombres, descripciones y capacidades relevantes, sin cargar indiscriminadamente todos los schemas de las herramientas.
[REQUISITO DE IMPLEMENTACIÓN]: El catálogo compacto entregado a Qwen y las herramientas candidatas de cada etapa, cuando existan, deben corresponder al catálogo real vigente (sección 4.1). Qwen no puede inventar herramientas, servidores ni capacidades inexistentes al planificar (sección 1.2, punto 5).
[REQUISITO DE IMPLEMENTACIÓN]: La selección de la herramienta concreta y la generación de sus argumentos dentro de una etapa permanecen en el flujo FAST; ni el plan ni las herramientas candidatas sustituyen esa selección.
[PENDIENTE DE VERIFICAR]: Detalles técnicos que dependen del código: nombres, tipos y validación de los campos del plan y de las etapas; cómo se construye el catálogo compacto a partir del catálogo real y qué campos de los registros existentes se utilizan; y su ajuste a la ventana de contexto efectiva (QWEN_CTX, sección 9).
[PENDIENTE DE VERIFICAR]: Cómo se genera actualmente el plan en el código (runPlanLoop y componentes asociados) y qué parte de esa implementación se reutiliza.
3.2.4 Aprobación del Usuario
[DECISIÓN CONFIRMADA]: Antes de ejecutar, se presenta el plan al usuario, que puede aceptarlo, rechazarlo o solicitar modificaciones. La ejecución comienza únicamente después de su aceptación.
[DECISIÓN CONFIRMADA]: La espera de aprobación opera bajo WAITING_INPUT (waitingReason: plan_confirmation) sin temporizadores de expiración (sección 8.1).
[DECISIÓN CONFIRMADA]: Modificación del plan: si el usuario solicita modificaciones, se actualiza el plan y se vuelve a presentar para su aprobación.
[DECISIÓN CONFIRMADA]: Rechazo del plan: si el usuario lo rechaza, no se ejecuta y se esperan nuevas instrucciones o una cancelación explícita.
[DECISIÓN CONFIRMADA]: Aprobación tras replanificar: no se exige nueva aprobación para ajustes que mantengan el objetivo y las restricciones. Se solicita nueva aprobación cuando el cambio sea material, altere significativamente el impacto de las acciones o requiera una decisión del usuario.
[PENDIENTE DE VERIFICAR]: Si el endpoint actual POST /api/jarvis/tasks/:id/confirm-plan y su flujo soportan aceptar, rechazar y solicitar modificaciones (con nueva presentación del plan) o solo la confirmación, y cómo se representan estas respuestas en los estados de tarea existentes (por ejemplo WAITING_INPUT con plan_confirmation).
[PENDIENTE DE VERIFICAR]: Mecanismo técnico mediante el cual se determina que un cambio de replanificación es material y se solicita la nueva aprobación, a partir de los componentes existentes.
3.2.5 Ejecución mediante el Flujo FAST
[DECISIÓN CONFIRMADA]: Una vez aprobado el plan, PLAN entrega cada etapa al flujo FAST existente, que utiliza runStep y conserva su lógica actual de selección de herramientas, generación de argumentos, validación y ejecución, y recibe sus resultados (interfaz PLAN ↔ FAST).
[REQUISITO DE IMPLEMENTACIÓN]: PLAN no interviene en la ejecución interna de la etapa; solo la entrega y recibe su resultado para supervisarlo. Los controles de FAST (incluidos Guard, validación contra catálogo y schema, anti-loop y reintentos) aplican a cada etapa tal como aplican en FAST.
[PENDIENTE DE VERIFICAR]: El contrato técnico exacto (qué información recibe FAST por etapa, qué devuelve a PLAN y cómo se delimita el comienzo y el fin de una etapa) debe determinarse auditando el código. No se define ningún contrato en este documento.
[PENDIENTE DE VERIFICAR]: Contabilización de los pasos y replanteos de las etapas frente a MAX_STEPS = 15 y MAX_REPLAN = 2 (sección 2.1).
[PENDIENTE DE VERIFICAR]: Cómo se transfieren datos entre etapas dependientes y si los mecanismos previstos en el plan (RefStore, FACTS, effects, handoff determinista; Fase 4) son aplicables al encadenamiento de etapas.
[PENDIENTE DE VERIFICAR]: Si el flujo FAST actual puede ser invocado por etapa sin modificar runStep, o si requiere algún punto de entrada adicional en el código que lo invoca. Cualquier cambio necesario fuera de runStep debe documentarse a partir de la auditoría y no asumirse.
3.2.6 Verificación por Etapa y Replanificación

Verificación

[DECISIÓN CONFIRMADA]: Al finalizar una etapa, Qwen evalúa el resultado real de la ejecución frente al objetivo y los criterios de éxito definidos en el plan.
[DECISIÓN CONFIRMADA]: Que una herramienta termine sin errores no implica necesariamente que la etapa haya cumplido su objetivo. La verificación de etapa evalúa el cumplimiento del objetivo, no solo la ausencia de errores técnicos.
[REQUISITO DE IMPLEMENTACIÓN]: PLAN no reimplementa la verificación a nivel de paso que forma parte del flujo FAST (runStep, incluidas las verificaciones ok y cumple de Eos, sección 5). La verificación de etapa por Qwen opera sobre el resultado de la etapa completa y no duplica esas verificaciones.
[DECISIÓN CONFIRMADA]: Qwen verifica las etapas usando evidencia observable. Eos conserva sus evaluaciones a nivel de paso.
[DECISIÓN CONFIRMADA]: Las discrepancias entre el veredicto de Qwen a nivel de etapa y las evaluaciones de Eos a nivel de paso deben analizarse sin asumir automáticamente el éxito.
[DECISIÓN CONFIRMADA]: La verificación de etapa distingue cuatro situaciones, que son la base de la replanificación:
Etapa cumplida: la etapa cumplió su objetivo y criterio de éxito; se continúa con el plan.
Desviación recuperable: la etapa no cumplió, pero el plan puede ajustarse para recuperarse.
Información insuficiente: no se puede continuar sin información adicional.
Bloqueo o error no recuperable: no se debe continuar de forma autónoma.
[DECISIÓN CONFIRMADA]: Estas cuatro situaciones se mapean a estados existentes tras la auditoría del código.
[PENDIENTE DE VERIFICAR]: La forma técnica de la evidencia entregada a Qwen (a partir de los resultados, resúmenes y hechos que el flujo FAST efectivamente produce), el contrato de salida de la verificación y el mecanismo concreto de análisis de discrepancias, considerando QWEN_CTX (sección 9) y la regla de persistencia mínima (sección 7).
[PENDIENTE DE VERIFICAR]: El mapeo concreto de cada situación a los estados de tarea y de espera existentes (incluido si la información insuficiente se resuelve con WAITING_INPUT user_answer o ask_user, y qué estado terminal corresponde a un bloqueo o error no recuperable), a determinar tras auditar types.ts, core.ts y los flujos actuales.

Replanificación

[DECISIÓN CONFIRMADA]: El mismo Qwen que generó el plan evalúa las desviaciones y, cuando corresponda, modifica las etapas pendientes, preservando el objetivo original.
[DECISIÓN CONFIRMADA]: No se debe regenerar todo el plan innecesariamente. La replanificación modifica las etapas pendientes que lo requieran y conserva el resto.
[REQUISITO DE IMPLEMENTACIÓN]: La replanificación no puede inventar herramientas, servidores ni schemas (sección 1.2, punto 5) y sus ajustes se ejecutan siempre a través del flujo FAST, sujetos a sus controles.
[DECISIÓN CONFIRMADA]: La frontera entre los reintentos locales de FAST y la replanificación de PLAN se rige por la sección 6.2.
[DECISIÓN CONFIRMADA]: Continuidad del contexto de Qwen: entre planificación y replanificación se preservan el objetivo, las restricciones, el plan vigente, las etapas completadas y los resultados relevantes, usando contexto compacto.
[PENDIENTE DE VERIFICAR]: Cómo se construye y reinyecta técnicamente ese contexto compacto en las invocaciones de Qwen (formato, límites de tamaño frente a QWEN_CTX y relación con la memoria progresiva de la sección 7.1).
[PENDIENTE DE VERIFICAR]: Cómo se implementan actualmente los replanteos en el código y qué relación tienen con handleEscalation y deps.qwenEngine.escalate (sección 3.1), para no duplicar ni perder responsabilidades.
3.2.7 Seguridad y Permisos en PLAN
[DECISIÓN CONFIRMADA]: Aprobar el plan no implica autorizar automáticamente todas las acciones futuras. Se mantienen los controles existentes de FAST y de Guard sobre cada acción ejecutada en cualquier etapa.
[DECISIÓN CONFIRMADA]: Cuando Guard deniega una acción o el usuario la rechaza, la acción no se ejecuta. Un DENY de Guard no puede reintentarse ni eludirse, tampoco mediante replanificación, y una replanificación no puede autorizar acciones por sí misma (sección 6.2). Cualquier acción distinta que se proponga permanece sujeta a Guard como cualquier otra.
[REQUISITO DE IMPLEMENTACIÓN]: Guard sigue inspeccionando los argumentos reales resueltos de cada llamada (sección 12, criterio 7), con independencia de que la acción provenga de un plan aprobado o de un plan replanificado. Las aprobaciones puntuales que Guard exija durante la ejecución no se consideran satisfechas por la aprobación del plan.
[PENDIENTE DE VERIFICAR]: El desenlace técnico en los estados existentes de la etapa y de la tarea ante una denegación o rechazo, a determinar junto con el mapeo de estados de la sección 3.2.6.
3.2.8 Transversales: Cancelación, Esperas y Persistencia en PLAN
[REQUISITO DE IMPLEMENTACIÓN]: Las decisiones confirmadas de cancelación simple, WAITING_INPUT sin timers y persistencia mínima (secciones 7 y 8) aplican también a PLAN; el alcance sobre los resultados tardíos de Qwen y de etapas en ejecución se define en la sección 8.2.
[DECISIÓN CONFIRMADA]: Persistencia del plan: se guardan únicamente los metadatos, el plan y los resúmenes mínimos necesarios para recuperar el estado de la tarea. No se asume que las referencias no persistidas sobreviven a un reinicio.
[PENDIENTE DE VERIFICAR]: Qué campos concretos de jarvis-tasks.json y de las estructuras existentes se utilizan para guardar el plan y el avance por etapa, y qué estado de tarea es recuperable tras un reinicio según el comportamiento actual de core.ts.
3.2.9 Resumen de las 11 Decisiones de Diseño de PLAN Aprobadas
[DECISIÓN CONFIRMADA]: Las siguientes 11 decisiones están aprobadas; no son preguntas abiertas ni se tratan como [PENDIENTE DE CONFIRMAR]. Su definición normativa está en las secciones indicadas; los detalles técnicos que dependen del código se consolidan en la sección 13.2 como [PENDIENTE DE VERIFICAR].
1. Plan en etapas con objetivos operativos verificables, dependencias, resultado esperado y criterios de éxito; herramientas candidatas opcionales (3.2.3).
2. Catálogo compacto de herramientas para Qwen, sin cargar indiscriminadamente todos los schemas (3.2.3).
3. Modificación: Qwen actualiza el plan y lo vuelve a presentar. Rechazo: no se ejecuta y se esperan nuevas instrucciones o cancelación explícita (3.2.4).
4. Nueva aprobación tras replanificar solo ante cambios materiales, de impacto significativo o que requieran una decisión del usuario (3.2.4).
5. PLAN coordina las etapas y reutiliza el flujo FAST existente; el contrato técnico exacto se comprueba mediante auditoría (3.2.1, 3.2.5).
6. MAX_STEPS = 15 y MAX_REPLAN = 2 como referencias; semántica y contabilización por verificar en el código (2.1).
7. Eos evalúa a nivel de paso (ok y cumple); Qwen verifica a nivel de etapa con evidencia observable; las discrepancias no implican éxito automático (3.2.6, 5).
8. La verificación distingue etapa cumplida, desviación recuperable, información insuficiente y bloqueo o error no recuperable; mapeo a estados existentes por auditoría (3.2.6).
9. Contexto compacto de Qwen con objetivo, restricciones, plan vigente, etapas completadas y resultados relevantes (3.2.6).
10. Acción denegada por Guard o rechazada por el usuario: no se ejecuta; un DENY no se reintenta ni se elude (3.2.7, 6.2).
11. Persistencia limitada a metadatos, plan, estado de etapas y resúmenes mínimos; las referencias no persistidas no se asumen recuperables (3.2.8).
Decisión confirmada adicional, ajena a las 11: frontera entre los reintentos de FAST y la replanificación de PLAN (6.2).
4. Selección de Herramientas y Alcance de Servidores
4.1 Flujo Normativo de Selección

[REQUISITO DE IMPLEMENTACIÓN]
El ciclo de vida para seleccionar una herramienta dentro de un paso sigue estrictamente cinco fases:

Obtención del catálogo real: Consultar el catálogo de herramientas descubiertas en los servidores MCP activos (DiscoveryEngine) y las herramientas locales registradas.
Exclusión de herramientas no permitidas: Filtrar herramientas que no estén habilitadas en configuración, que estén vetadas por la política de seguridad o que hayan sido restringidas por un replanteo previo.
Resolución determinista: Si las reglas cubren el caso de forma unívoca (candidato único disponible o regla fija de código), resolver directamente por código sin invocar a Eos.
Elección por Eos: Si existen múltiples candidatos válidos, construir la consulta de elección cerrada (choice) y solicitar la selección a Eos.
Validación contra catálogo vigente y schema de argumentos: Validar que la herramienta seleccionada exista efectivamente en el catálogo activo antes de preparar los argumentos y ejecutar la llamada. Si la respuesta de Eos no coincide con ningún candidato del catálogo, la llamada no puede autorizarse. Asimismo, los valores de argumentos generados se validan rigurosamente contra el schema real de la herramienta seleccionada (sección 1.2, punto 5).

[DECISIÓN CONFIRMADA]
Este ciclo corresponde al flujo de ejecución de FAST (runStep) y es el que utilizan las etapas de PLAN; PLAN no implementa un ciclo de selección propio (sección 3.2.1).

4.2 Validación Estricta de Respuestas de Eos
[REQUISITO DE IMPLEMENTACIÓN]: El Core debe validar la estructura y el contenido de las respuestas de Eos antes de utilizarlas. Una respuesta vacía, malformada, con claves faltantes o incompatible con el catálogo vigente no puede autorizar ninguna ejecución.
[DECISIÓN CONFIRMADA]: Sin umbrales numéricos de corte por ahora. Para evitar complejidad innecesaria, Eos opera sin umbrales numéricos de corte (sin filtro de confianza mínima de 0.50 en selección, ni umbrales de 0.60 o 0.75 en verificaciones); el modelo elige la opción con mayor probabilidad (argmax).
[PENDIENTE DE VERIFICAR]:
Los schemas y formatos reales de respuestas de Eos (choice, noul, score) deben verificarse contrastando Desicion-2.0-Eos.md con el cliente HTTP y el parser real en src/core/decision.ts.
La construcción exacta de la lista de candidatos, los criterios de selección y el comportamiento ante respuestas inválidas deben auditarse contra el código; no se inventará un mecanismo de fallback no soportado.
4.3 Auditoría de StepExecutionResult
[PENDIENTE DE VERIFICAR]: En src/core/types.ts:164–183, StepExecutionResult define status: "ok" | "logical_error" | "unverified" | "blocked_loop".
[REQUISITO DE IMPLEMENTACIÓN]: No se afirma que estos cuatro estados sean insuficientes. Debe auditarse cómo los consumen actualmente callExecutor.ts y modeEngines.ts.
[PENDIENTE DE VERIFICAR]: Comprobar si StepExecutionStatus en combinación con StepExecutionSignals (exit_code, denied, timeout, not_found, empty_output, unverified) puede representar o no todos los escenarios requeridos (éxito, error, resultado no verificado, bloqueo por Guard, aprobación pendiente, cancelación, reintentos y varias llamadas por paso). Solo se propondrán cambios si la auditoría demuestra que son estrictamente necesarios.
[PENDIENTE DE VERIFICAR]: Comprobar si este contrato resulta suficiente para que PLAN (sección 3.2) pueda supervisar el resultado de una etapa ejecutada por FAST, sin asumir que requiere cambios.
4.4 Alcance Confirmado de Servidores de Herramientas
Windows MCP (windows):
[DECISIÓN CONFIRMADA]: Se conserva dentro del alcance de la migración. No se excluye el servidor ni sus herramientas del sistema.
[DECISIÓN CONFIRMADA]: No se añade una capa extra de seguridad para el uso de UI. No se introducirán subsistemas complejos de inspección profunda de árboles de accesibilidad, recuperación de stale_element ni restricciones complejas de ventanas.
[PENDIENTE DE VERIFICAR]: Auditar la integración real de sus 12 herramientas con el catálogo, las rutas, la selección y PolicyRegistry (src/core/policy/policyRegistry.ts:18–29) para mantener sus políticas básicas existentes (READ, UI_ACTION, PROCESS_CONTROL) sin inventar cambios.
Desktop Commander (desktop_commander):
[PENDIENTE DE VERIFICAR]: Auditar las 26 herramientas observadas en el runtime (docs/MCP_TOOLS_SNAPSHOT.md) frente a las registradas en el código, verificando nombres reales (edit_block, start_process, kill_process) y políticas de Guard.
Free Search (free_search):
[PENDIENTE DE VERIFICAR]: Auditar las 11 herramientas del runtime free-search-mcp==0.13.1, confirmando que fetch_page y read_cached_resource no existen upstream y verificando que download exija aprobación.
Herramientas Locales Internas (recall, compose, ask_user):
[PENDIENTE DE VERIFICAR]: Auditar cómo se integran al catálogo plano para ser seleccionadas por Eos y despachadas localmente sin invocar transportes MCP externos.
5. Verificación Factual (ok y cumple)
[DECISIÓN CONFIRMADA]: Eliminación de Decision #5 y supresión del override forzado de exit_code === 0 con baja confianza (src/core/decision.ts:291).
[REQUISITO DE IMPLEMENTACIÓN]: La verificación posterior a la ejecución de una herramienta se realiza mediante dos preguntas binarias de tipo noul a Eos:
ok: Validez técnica y semántica del resultado (descarta errores disfrazados o salidas vacías anómalas).
cumple: Cumplimiento del criterio observable del paso frente a la evidencia obtenida.
[REQUISITO DE IMPLEMENTACIÓN]: Ambas preguntas se formulan únicamente si las señales técnicas previas están limpias (CLEAN). Ante fallos técnicos directos, el Core gestiona determinísticamente el resultado sin consultar a Eos.
[DECISIÓN CONFIRMADA]: Evaluación de ok y cumple sin umbrales numéricos de corte. Para evitar complejidad, no se establecen umbrales numéricos fijos (como 0.60 o 0.75); Eos evalúa las respuestas binarias seleccionando la opción afirmativa o negativa de mayor probabilidad (argmax).
[DECISIÓN CONFIRMADA]: Las verificaciones ok y cumple pertenecen al nivel de paso (flujo FAST / runStep). En el modo PLAN, la verificación del nivel de etapa corresponde a Qwen (sección 3.2.6) y es distinta de estas verificaciones; ninguna reemplaza a la otra.
6. Reglas de Reintento y Recuperación ante Errores
6.1 Auditoría del Comportamiento Existente
[DECISIÓN CONFIRMADA]: Se permiten reintentos ante fallos recuperables.
[DECISIÓN CONFIRMADA]: No se añadirá un subsistema complejo para gestionar mutaciones de resultado incierto.
[REQUISITO DE IMPLEMENTACIÓN]: Auditar las reglas de reintento existentes antes de alterar cualquier flujo:
Reintentos de argumentos por error de schema en Qwen (MAX_ARG_RETRIES = 2).
Reintentos de consulta o lectura en callExecutor.ts.
Reintentos de transporte o reconexión en adaptadores MCP.
6.2 Políticas Confirmadas y Pendientes de Reintento
Política Confirmada de Seguridad:
[DECISIÓN CONFIRMADA]: Bajo ninguna circunstancia se eludirá una denegación de Guard (DENY) o un rechazo del usuario mediante reintentos. Si una acción es denegada por seguridad, la llamada no se reintenta.
Frontera entre los Reintentos de FAST y la Replanificación de PLAN:
[DECISIÓN CONFIRMADA]: FAST gestiona los reintentos locales de un paso conforme a los mecanismos que ya existen (sección 6.1).
[DECISIÓN CONFIRMADA]: PLAN replanifica cuando los mecanismos de FAST no permiten completar el paso, cuando el resultado invalida una dependencia o cuando cambian las condiciones del plan.
[DECISIÓN CONFIRMADA]: Un DENY de Guard nunca puede generar un reintento ni una replanificación destinada a eludir la denegación; lo mismo rige para un rechazo del usuario (sección 3.2.7).
[REQUISITO DE IMPLEMENTACIÓN]: No se agregan nuevos límites, políticas de reintentos ni subsistemas sin auditar primero los mecanismos existentes (sección 6.1).
Pendientes de Verificación:
[PENDIENTE DE VERIFICAR]: La taxonomía y los criterios exactos de error recuperable vs no recuperable (por ejemplo, cuántos reintentos ante not_found o ante códigos de salida no cero), a determinar auditando el comportamiento actual del código. No se inventa una matriz arbitraria sin respaldo.
[PENDIENTE DE VERIFICAR]: La frontera técnica entre los reintentos actuales de FAST (a nivel de paso) y la replanificación de PLAN (a nivel de etapa): qué mecanismos concretos de FAST se agotan antes de replanificar y cómo se detecta que el resultado invalida una dependencia o que cambiaron las condiciones del plan, para que no se superpongan ni se dupliquen. No se inventa una política técnica no acordada.
Garantía Factual:
[REQUISITO DE IMPLEMENTACIÓN]: No se debe afirmar que una operación tuvo éxito sin evidencia observable suficiente.
[REQUISITO DE IMPLEMENTACIÓN]: No se deben utilizar límites globales de llamadas como mecanismo alternativo de corte ante errores.
7. Memoria, Persistencia y Comportamiento tras Reinicio
7.1 Política de Memoria Contextual Progresiva
[DECISIÓN CONFIRMADA]: Política de recuperación progresiva de memoria:
Recuperar inicialmente un máximo de 2 mensajes o elementos de memoria relevantes.
Si esa información resulta insuficiente, permitir ampliaciones progresivas a 5 y posteriormente hasta un máximo de 10.
Mantener el contexto estrictamente compacto y recuperar únicamente información pertinente para la tarea en curso.
[REQUISITO DE IMPLEMENTACIÓN]: Esta política no implica en ningún caso cargar el historial completo de la sesión ni persistir salidas completas de herramientas.
7.2 Persistencia Mínima y Recuperación tras Reinicio
[DECISIÓN CONFIRMADA]: Persistencia mínima: Se guardan en disco únicamente metadatos mínimos y resúmenes compactos, sin persistir salidas brutas completas de herramientas.
[REQUISITO DE IMPLEMENTACIÓN]: Los resultados completos pueden residir temporalmente en memoria (RefStore) durante la vida de la tarea activa.
[REQUISITO DE IMPLEMENTACIÓN]: Recuperación tras reinicio:
Solo se pueden recuperar tras un reinicio del servidor los datos que hayan sido efectivamente persistidos en el almacenamiento secundario (jarvis-tasks.json).
Las referencias temporales en memoria (RefStore) no persistidas no deben tratarse como recuperables.
No se debe prometer ni intentar la reanudación de una ejecución activa si faltan los datos temporales necesarios en memoria.
[PENDIENTE DE VERIFICAR]: Auditar el comportamiento actual de src/core/core.ts cuando el servidor reinicia y encuentra tareas previas.
[DECISIÓN CONFIRMADA]: La persistencia específica de PLAN (metadatos, plan y resúmenes mínimos) se define en la sección 3.2.8.
[DECISIÓN CONFIRMADA]: Persistencia simple sin rotación fija ni backups automáticos por ahora: Para no agregar complejidad prematura, no se implementará la retención fija de las últimas 20 tareas, el descarte de tareas antiguas ni la creación obligatoria de copias de respaldo (.backup.json). Se mantiene la persistencia simple de tareas en disco sin mecanismos complejos de rotación o purga.
8. Estados de Espera, Timeouts y Cancelación
8.1 Estado de Espera WAITING_INPUT sin Timers
[DECISIÓN CONFIRMADA]: Adopción de WAITING_INPUT sin temporizadores de expiración: Se adopta el estado unificado WAITING_INPUT para gestionar pausas por aprobación, confirmación de plan o respuesta interactiva del usuario (waitingReason: approval, plan_confirmation, user_answer), pero sin temporizadores ni límites de caducidad. El usuario puede tomarse el tiempo que requiera; la tarea permanece suspendida limpiamente a la espera de su interacción, sin agregar la complejidad de cronómetros de expiración ni transiciones de error por tiempo.
[REQUISITO DE IMPLEMENTACIÓN]: La reanudación o resolución se produce exclusivamente por la acción del usuario (aprobación, confirmación, respuesta o cancelación explícita). No se implementan timers de caducidad automática para estas esperas.
[PENDIENTE DE VERIFICAR]: Auditar el comportamiento existente en el código:
requestUserApproval en src/core/callExecutor.ts:42–71 suspende mediante una promesa sin timeout fijo.
El modo PLAN espera la confirmación del usuario mediante el endpoint POST /api/jarvis/tasks/:id/confirm-plan. La representación de las respuestas de modificación y rechazo del plan se verifica según la sección 3.2.4.
8.2 Cancelación Simple
[DECISIÓN CONFIRMADA]: Alcance simple de cancelación:
Marcar la tarea como CANCELLED.
Ignorar cualquier resultado tardío de llamadas que lleguen con posterioridad a la cancelación.
No incorporar en esta migración un sistema avanzado de cancelación de transportes, AbortController, terminación forzada de subprocesos externos, cancelación de llamadas MCP en curso ni limpieza compleja de recursos.
[DECISIÓN CONFIRMADA]: Invarianza de estados terminales: una vez que una tarea alcanza un estado terminal (COMPLETED, PARTIAL, FAILED o CANCELLED), su estado no puede ser alterado por llamadas tardías.
[REQUISITO DE IMPLEMENTACIÓN]: En PLAN, la cancelación y la invarianza de estados terminales alcanzan también a los resultados tardíos de planificación, verificación y replanificación de Qwen y a los resultados de etapas en ejecución (sección 3.2.8).
9. Modelo de Razonamiento Qwen 3.5 9B
[DECISIÓN CONFIRMADA]: Qwen 3.5 9B es el único modelo razonador principal para generación abierta, redacción, planificación y síntesis final. En el modo PLAN, también es el responsable de la verificación por etapa y de la replanificación (sección 3.2).
[PENDIENTE DE VERIFICAR]: Auditar la configuración efectiva en src/core/types.ts y src/core/reasoner/qwen.ts (QWEN_CTX = 8192, opciones de generación y parámetros HTTP a Ollama).
[PENDIENTE DE VERIFICAR]: Se registra que generateArguments fuerza thinking: false para optimizar latencia (src/core/reasoner/qwen.ts:441); no se considera confirmado hasta comprobarlo en el código.
[PENDIENTE DE VERIFICAR]: Configuración de generación aplicable a las invocaciones de planificación, verificación por etapa y replanificación (incluido el modo de razonamiento), y si la ventana de contexto efectiva alcanza para el catálogo de capacidades, el contexto y la evidencia de cada etapa. No se define ningún valor aquí.
[REQUISITO DE IMPLEMENTACIÓN]: La detección de salidas truncadas (finish_reason = "length") debe propagarse formalmente para solicitar reintentos con argumentos más breves o utilización de referencias.
[PENDIENTE DE VERIFICAR]: Medir el impacto de la ordenación de bloques de prompt sobre la reutilización de la caché de prefijo en Ollama/llama.cpp antes de consolidar el cambio de estructura de prompts.
10. Matriz Consolidada de Clasificación
Componente / Tema	Clasificación	Estado / Definición
Límites de referencia MAX_STEPS = 15 y MAX_REPLAN = 2	[DECISIÓN CONFIRMADA]	Conservados. Sin límite artificial de 8 pasos en PLAN. Semántica y contabilización con etapas de PLAN pendientes de verificar en el código (sección 2.1).
Eliminación de límites de llamadas	[DECISIÓN CONFIRMADA]	ELIMINADOS. Se suprimen las restricciones de 30 llamadas por tarea y 4 llamadas por paso.
Prohibición de nuevos pools de llamadas	[DECISIÓN CONFIRMADA]	PROHIBIDOS. No se introducirán pools de 15/30 llamadas ni techos globales alternativos.
Eliminación de Deadline Global	[DECISIÓN CONFIRMADA]	ELIMINADO. No habrá límite global de tiempo de ejecución de 10 min por tarea ni pausas de deadline.
Cancelación simple	[DECISIÓN CONFIRMADA]	Marcar CANCELLED e ignorar resultados tardíos. Sin AbortController ni terminación compleja de procesos.
Alcance de windows-mcp	[DECISIÓN CONFIRMADA]	CONSERVADO EN EL ALCANCE. Sin capa extra de seguridad para UI.
Migración de escalación (Qwen Etapa 5B)	[DECISIÓN CONFIRMADA]	Decisión confirmada de migrar la responsabilidad de escalación hacia código y Eos. La autorización de eliminar físicamente qwenEngine.escalate queda expresamente condicionada a la auditoría previa que demuestre que sus funciones están completamente cubiertas.
Eliminación de Decision #5 y del override forzado de exit_code === 0	[DECISIÓN CONFIRMADA]	Confirmada (sección 5). Su supresión física queda condicionada a la auditoría de responsabilidades (sección 3.1).
Persistencia mínima	[DECISIÓN CONFIRMADA]	Solo metadatos mínimos y resúmenes compactos. Sin salidas completas de herramientas en disco.
Memoria contextual progresiva (2 → 5 → 10)	[DECISIÓN CONFIRMADA]	Recuperación progresiva: 2 mensajes iniciales, ampliables a 5 y hasta un máximo de 10.
Acción denegada por Guard o rechazada por el usuario (prohibición de eludir DENY)	[DECISIÓN CONFIRMADA]	No se ejecuta. Un DENY de Guard nunca se reintenta ni se elude, tampoco mediante replanificación (secciones 3.2.7 y 6.2).
Adopción de WAITING_INPUT sin timers	[DECISIÓN CONFIRMADA]	WAITING_INPUT adoptado sin temporizadores de caducidad ni timeouts automáticos; el usuario dispone de tiempo ilimitado.
Decisión en Eos sin umbrales numéricos	[DECISIÓN CONFIRMADA]	Sin umbrales numéricos de corte (sin 0.50 en selección ni 0.60/0.75 en ok/cumple); selección por mayor probabilidad (argmax) para evitar complejidad.
Persistencia simple sin rotación ni backups	[DECISIÓN CONFIRMADA]	No implementar retención fija de 20 tareas, descarte de tareas antiguas ni backups automáticos por ahora.
PLAN como capa de coordinación y supervisión	[DECISIÓN CONFIRMADA]	PLAN no es un segundo motor de ejecución; FAST y PLAN son modos con responsabilidades distintas. PLAN coordina las etapas, las entrega al flujo FAST existente (runStep) y recibe sus resultados; el contrato técnico exacto se comprueba por auditoría.
Separación planificación / ejecución / verificación	[DECISIÓN CONFIRMADA]	Qwen planifica y verifica; el flujo FAST ejecuta; el usuario aprueba el plan antes de ejecutar.
runStep no se rediseña por la propuesta de PLAN	[DECISIÓN CONFIRMADA]	PLAN consume runStep sin modificarlo ni duplicar su lógica.
Verificación por etapa con Qwen	[DECISIÓN CONFIRMADA]	Qwen evalúa el resultado real frente al objetivo y los criterios de éxito con evidencia observable; terminar sin errores no implica cumplimiento. Eos conserva sus evaluaciones a nivel de paso (ok, cumple); las discrepancias se analizan sin asumir automáticamente el éxito (secciones 3.2.6 y 5).
Resultados de la verificación por etapa	[DECISIÓN CONFIRMADA]	Etapa cumplida, desviación recuperable, información insuficiente, bloqueo o error no recuperable; mapeo a estados existentes tras la auditoría (sección 3.2.6).
Replanificación con el mismo Qwen	[DECISIÓN CONFIRMADA]	Modifica solo las etapas pendientes, preserva el objetivo original y no regenera el plan innecesariamente (sección 3.2.6).
Aprobación del plan no autoriza acciones futuras	[DECISIÓN CONFIRMADA]	Se mantienen los controles de FAST y Guard; la replanificación no elude DENY ni autoriza acciones.
Schema y granularidad del plan	[DECISIÓN CONFIRMADA]	Cada etapa: objetivo operativo verificable, dependencias, resultado esperado y criterio de éxito. Herramientas candidatas opcionales. Campos y tipos exactos: pendiente de verificar.
Catálogo de herramientas para Qwen	[DECISIÓN CONFIRMADA]	Catálogo compacto (nombres, descripciones, capacidades relevantes), sin cargar indiscriminadamente todos los schemas.
Modificación o rechazo del plan	[DECISIÓN CONFIRMADA]	Modificación: actualizar y volver a presentar. Rechazo: no ejecutar y esperar nuevas instrucciones o cancelación explícita.
Aprobación tras replanificar	[DECISIÓN CONFIRMADA]	No se exige para ajustes que mantengan objetivo y restricciones; sí para cambios materiales, que alteren significativamente el impacto o requieran decisión del usuario.
Continuidad del contexto de Qwen	[DECISIÓN CONFIRMADA]	Objetivo, restricciones, plan vigente, etapas completadas y resultados relevantes, en contexto compacto.
Persistencia del plan	[DECISIÓN CONFIRMADA]	Solo metadatos, plan y resúmenes mínimos; las referencias no persistidas no se asumen recuperables tras un reinicio.
Frontera entre reintentos de FAST y replanificación de PLAN	[DECISIÓN CONFIRMADA]	FAST gestiona los reintentos locales de un paso con los mecanismos existentes; PLAN replanifica cuando FAST no puede completar el paso, el resultado invalida una dependencia o cambian las condiciones del plan. Un DENY nunca genera reintento ni replanificación para eludirlo. Sin nuevos límites, políticas de reintentos ni subsistemas sin auditoría previa (sección 6.2).
Validación de respuestas de Eos	[REQUISITO DE IMPLEMENTACIÓN]	Core debe validar estructura y contenido. Respuestas inválidas jamás autorizan ejecución.
Validación de herramientas y argumentos	[REQUISITO DE IMPLEMENTACIÓN]	Ningún modelo puede inventar herramientas, servidores, nombres de parámetros ni esquemas no declarados (incluido Qwen al planificar y replanificar). Los valores de argumentos generados deben validar rigurosamente contra el schema real de la herramienta.
Auditoría de responsabilidades previa a eliminación	[REQUISITO DE IMPLEMENTACIÓN]	Verificar responsabilidades de runFastLoop, runPlanLoop, D1, D2 y D5 antes de su supresión; clasificar las de runPlanLoop en ejecución (a FAST) y coordinación (permanecen en PLAN).
No duplicar ejecución de FAST en PLAN	[REQUISITO DE IMPLEMENTACIÓN]	PLAN no implementa selección de herramientas, argumentos, validación, despacho ni reintentos propios.
Referencias no persistidas tras reinicio	[REQUISITO DE IMPLEMENTACIÓN]	Las referencias temporales en memoria no se tratan como recuperables tras reiniciar el servidor.
Contrato de StepExecutionResult	[PENDIENTE DE VERIFICAR]	Auditar consumidores antes de proponer cambios. Verificar si los 4 estados actuales y señales son suficientes, también para la supervisión de etapas por PLAN.
Mecanismo anti-loop existente	[PENDIENTE DE VERIFICAR]	Auditar el funcionamiento real de nonReadCounter en callExecutor.ts antes de proponer ajustes.
Herramientas de Desktop Commander y Free Search	[PENDIENTE DE VERIFICAR]	Auditar las 26 herramientas de DC y 11 de FS del snapshot real frente a PolicyRegistry.
Contrato real y parser de Eos	[PENDIENTE DE VERIFICAR]	Contrastar choice, noul, score de Desicion-2.0-Eos.md contra el cliente HTTP y parser real de src/core/decision.ts.
Flujo actual de PLAN en el código	[PENDIENTE DE VERIFICAR]	Generación del plan, confirm-plan, replanteos y relación con handleEscalation / qwenEngine.escalate; viabilidad de invocar FAST por etapa sin modificar runStep.
Existencia real de comandos de test/lint	[PENDIENTE DE VERIFICAR]	Comprobar herramientas reales de compilación y pruebas en el repositorio (compile_applet, npm run build, etc.).
Taxonomía de errores recuperables y frontera técnica FAST / PLAN	[PENDIENTE DE VERIFICAR]	Criterios exactos de error recuperable y delimitación técnica entre los reintentos actuales de FAST y la replanificación de PLAN; a determinar auditando el código (sección 6.2).
Detalles técnicos de PLAN dependientes del código	[PENDIENTE DE VERIFICAR]	Contrato PLAN ↔ FAST, contabilización con MAX_STEPS/MAX_REPLAN, forma de la evidencia, mapeo de estados, soporte de confirm-plan, cambio material, construcción del contexto y del catálogo compactos, campos persistidos (sección 13.2).
11. Orden de Implementación por Fases de la Migración
[REQUISITO DE IMPLEMENTACIÓN]: Las acciones y criterios de salida de cada fase son obligatorios. Las auditorías que incluyen cierran los [PENDIENTE DE VERIFICAR] correspondientes (sección 13.2) y no pueden sustituirse por suposiciones.
Fase 0: Auditoría de Contratos, Responsabilidades y Versiones de MCP
Objetivo: Auditar componentes existentes, verificar contratos de herramientas y tipos sin alterar lógica funcional.
Acciones:
Auditar src/core/types.ts (StepExecutionResult, StepExecutionSignals, estados de tareas y pasos, y constantes de límites).
Auditar las responsabilidades de runFastLoop, runPlanLoop, handleEscalation, D1, D2 y D5 para mapearlas de forma exhaustiva antes de cualquier supresión.
Auditar el flujo actual de PLAN: generación del plan, confirmación (confirm-plan), replanteos (MAX_REPLAN), y la forma en que hoy se ejecutan las etapas; clasificar cada responsabilidad de runPlanLoop como ejecución (a cubrir por FAST) o coordinación (permanece en PLAN).
Verificar si el flujo FAST puede invocarse por etapa sin modificar runStep y determinar, a partir del código, el contrato técnico PLAN ↔ FAST (información recibida por etapa, resultado devuelto y delimitación de una etapa).
Auditar la semántica de MAX_STEPS = 15 y MAX_REPLAN = 2 frente a etapas, los estados existentes de tarea y espera para mapear las situaciones de la verificación por etapa, y el soporte actual de confirm-plan para aceptar, rechazar y modificar.
Auditar los mecanismos de reintento existentes (sección 6.1) para determinar la taxonomía de errores recuperables y la frontera técnica entre los reintentos de FAST y la replanificación de PLAN (sección 6.2), sin agregar límites, políticas ni subsistemas.
Auditar el comportamiento actual de arranque de core.ts frente a tareas previas en jarvis-tasks.json.
Auditar y ratificar las versiones y herramientas reales de windowsMcp, desktopCommanderMcp y freeSearchMcp.
Criterio de Salida: Mapeo formal de responsabilidades documentado con evidencia de código, incluida la clasificación ejecución/coordinación de runPlanLoop; auditoría de contratos MCP y tipos completada; taxonomía de errores recuperables y frontera de reintentos FAST / PLAN documentadas con evidencia de código.
Fase 1: Manifiesto de Herramientas y Auditoría de Catálogo
Objetivo: Establecer la fuente de verdad tipada de las herramientas disponibles sin inventar capacidades.
Acciones:
Auditar las herramientas reales descubiertas en los tres servidores (windows, desktop_commander, free_search) y las herramientas locales (recall, compose, ask_user).
Crear el Manifiesto Tipado asociando cada herramienta a su capacidad real y política de Guard preexistente.
Eliminar herramientas que ya no existan en runtime upstream (fetch_page, read_cached_resource).
Dejar el catálogo vigente accesible como fuente única, tanto para el flujo FAST como para el catálogo compacto (nombres, descripciones y capacidades relevantes, sin cargar indiscriminadamente todos los schemas) que recibe Qwen al planificar (sección 3.2.3).
Criterio de Salida: Catálogo verificado contra runtime MCP; herramientas mapeadas en PolicyRegistry.
Fase 2: Erradicación de Límites de Llamadas, Auditoría de Cancelación y Memoria Progresiva
Objetivo: Eliminar los límites globales de llamadas, auditar los mecanismos preexistentes de memoria y cancelación, e implementar la política acordada de recuperación progresiva y cancelación simple sin cambios innecesarios.
Acciones:
Eliminar MAX_TOOL_CALLS_TASK y MAX_TOOL_CALLS_PER_STEP de types.ts, modeEngines.ts y callExecutor.ts, verificando que no subsistan pools ni techos globales alternativos.
Comprobar y auditar el comportamiento actual del manejo de memoria e historial en context.ts y modeEngines.ts antes de alterarlo; implementar la política de memoria contextual progresiva (2 → 5 → 10 elementos relevantes) preservando el alcance confirmado.
Comprobar el mecanismo actual de cancelación en core.ts y sus dependencias; implementar la cancelación simple (marcar CANCELLED e ignorar resultados tardíos) sin introducir subsistemas complejos de interrupción, asegurando que cubra también los resultados tardíos de Qwen en PLAN.
Criterio de Salida: Límites de llamadas eliminados; dependencias de memoria y cancelación auditadas y ajustadas al alcance confirmado; cancelación simple y memoria progresiva operativas sin código superfluo.
Fase 3: Implementación de Motor Unificado (runStep) e Integración de Eos
Objetivo: Avanzar hacia el objetivo de unificación de la ejecución de pasos e integrar la toma de decisiones con Eos, condicionando la supresión de motores anteriores a la verificación de cobertura de responsabilidades.
Acciones:
Implementar runStep como bucle atómico de ejecución de pasos persiguiendo la unificación del flujo.
Validar contra el código que todas las responsabilidades operativas de runFastLoop, runPlanLoop (las clasificadas como ejecución) y de las decisiones D1, D2 y D5 estén plenamente cubiertas antes de autorizar su eliminación física.
Implementar la selección de herramientas en Eos con validación estricta contra el catálogo y resolución por mayor probabilidad (argmax) sin umbrales numéricos de corte.
Implementar las verificaciones binarias ok y cumple en Eos sobre señales limpias evaluadas por mayor probabilidad sin umbrales numéricos.
Integrar el estado WAITING_INPUT sin temporizadores de caducidad para esperas de usuario.
Migrar la responsabilidad de escalación hacia código y Eos; autorizar la supresión de deps.qwenEngine.escalate únicamente tras demostrar en la auditoría que todas sus funciones de recuperación están cubiertas.
Criterio de Salida: runStep operativo; responsabilidades previas auditadas y cubiertas; selección y verificación resueltas por Eos por mayor probabilidad; migración de escalación verificada.
Fase 3B: Capa de Coordinación del Modo PLAN sobre el Flujo FAST
Prerrequisitos: Fase 0 completada (flujo actual de PLAN auditado) y runStep operativo (Fase 3). Esta fase no modifica runStep.
Objetivo: Implementar PLAN como capa de coordinación y supervisión que reutiliza el flujo FAST, sin duplicar su lógica de ejecución.
Acciones:
Implementar la planificación con Qwen conforme a la sección 3.2.3 (entrada: solicitud, contexto relevante, system prompt y catálogo compacto; salida: plan en etapas con objetivo operativo verificable, dependencias, resultado esperado, criterio de éxito y herramientas candidatas opcionales), validando que no se inventen herramientas ni servidores.
Implementar la aprobación del plan conforme a la sección 3.2.4 (aceptar, rechazar, solicitar modificaciones) sin timers; la ejecución solo comienza tras la aceptación.
Implementar la entrega de cada etapa al flujo FAST existente y la recepción de su resultado, sin reimplementar selección, argumentos, validación ni ejecución en PLAN; el contrato técnico se toma de la auditoría de Fase 0.
Implementar la verificación por etapa con Qwen conforme a la sección 3.2.6: evidencia observable, evaluaciones de Eos a nivel de paso conservadas y discrepancias analizadas sin asumir automáticamente el éxito; distingue etapa cumplida, desviación recuperable, información insuficiente y bloqueo o error no recuperable (mapeadas a estados existentes tras la auditoría).
Implementar la replanificación con el mismo Qwen conforme a las secciones 3.2.4, 3.2.6 y 6.2: contexto compacto, solo etapas pendientes, sin regenerar el plan innecesariamente, replanificación solo según la frontera con los reintentos de FAST y nueva aprobación únicamente ante cambio material, de impacto significativo o que requiera una decisión del usuario.
Garantizar que la aprobación del plan no sustituya los controles de Guard y FAST, que la replanificación no pueda eludir una denegación ni autorizar acciones, y que una acción denegada por Guard o rechazada por el usuario no se ejecute, no se reintente y no se replanifique para eludir la denegación.
Persistir únicamente metadatos, plan y resúmenes mínimos conforme a la sección 3.2.8.
Retirar de PLAN toda lógica de ejecución duplicada de runPlanLoop, solo si la auditoría de Fase 0 demostró que está cubierta por FAST.
Criterio de Salida: PLAN opera como capa de coordinación sobre FAST; separación planificación/ejecución/verificación verificable; sin lógica de ejecución duplicada; Guard y controles de FAST aplicados a cada etapa; contratos técnicos de PLAN derivados de la auditoría del código y documentados antes de su implementación.
Fase 4: Manejo Factual, Sustitución de Referencias y Reintentos
Objetivo: Consolidar la transferencia de datos entre llamadas y pasos sin subsistemas complejos.
Acciones:
Implementar la sustitución de referencias {{ref:rX}} desde memoria temporal antes de la evaluación de Guard.
Consolidar las capas de memoria en memoria (LOG continuo sin colapso estadístico prematuro, FACTS y effects).
Auditar y consolidar las reglas de reintentos deterministas garantizando que una denegación de Guard jamás sea reintentada.
Implementar el handoff determinista entre pasos completados.
Auditar si el handoff y los mecanismos de memoria factual son aplicables al encadenamiento de etapas dependientes de PLAN (sección 3.2.5) y documentar, a partir de la auditoría, la frontera entre reintentos de FAST y replanificación de PLAN (sección 6.2), sin agregar límites, políticas de reintentos ni subsistemas nuevos.
Criterio de Salida: Argumentos resueltos validados por Guard; memoria factual transferida entre pasos; reintentos controlados sin eludir seguridad.
Fase 5: Interfaz de Usuario y Sincronización en Tiempo Real
Objetivo: Reflejar el nuevo flujo y estados en la interfaz web sin errores.
Acciones:
Adaptar DecisionStream para visualizar la selección unificada y los veredictos ok / cumple.
Adaptar ContextInspector para exponer effects, ledger, facts y referencias temporales.
Adaptar GuardBanner para reflejar la solicitud de aprobación (sin cuenta regresiva de timeout).
Adaptar ProcessFlow para visualizar la línea de tiempo de forma homogénea.
Reflejar en la interfaz el modo PLAN: presentación del plan para aceptar, rechazar o solicitar modificaciones; avance por etapa; resultado de la verificación por etapa; y replanificaciones. Qué componentes concretos se adaptan o se crean para ello queda por definir tras la auditoría del frontend; no se asumen componentes nuevos.
Criterio de Salida: UI reactiva sincronizada con eventos del Core; compilación y renderizado limpios sin errores en consola.
Fase 6: Calibración, Documentación y Cierre
Objetivo: Validar la estabilidad global y sincronizar toda la documentación.
Acciones:
Recolectar trazas reales de ejecución para validar la precisión de las decisiones de Eos por mayor probabilidad.
Recolectar trazas reales del modo PLAN (planes generados, verificaciones por etapa y replanificaciones) para validar que el comportamiento coincide con la arquitectura de la sección 3.2.
Sincronizar los documentos vivos (docs/ARCHITECTURE.md, CORE_FLOW.md, TOOLS_AND_SECURITY.md, CONTEXT_AND_MEMORY.md), incluyendo la arquitectura de PLAN.
Ejecutar verificación estricta de compilación y pruebas del proyecto.
Criterio de Salida: Pruebas de regresión superadas; compilación TypeScript (compile_applet o npm run build) exitosa sin errores bloqueantes; documentación sincronizada.
12. Criterios de Aceptación Objetivos

[REQUISITO DE IMPLEMENTACIÓN]: La migración a JARVIS v1.3 se considerará formalmente completada únicamente cuando se verifiquen fehacientemente las siguientes condiciones:

1. Límites de llamadas totalmente erradicados: No existe en ningún módulo del código una restricción de 30 llamadas por tarea ni de 4 llamadas por paso, ni pools equivalentes que limiten artificialmente la ejecución.
2. Límite MAX_STEPS = 15 conservado: Se conserva el límite global de 15 pasos sin topes artificiales de 8 pasos, y MAX_REPLAN = 2 como referencia; la semántica del contador y de los replanteos frente a las etapas de PLAN se comprueba en el código y se documenta antes de implementarla (sección 2.1).
3. Sin deadline global ni cancelación compleja: No existe implementación de deadline global de tarea; la cancelación opera bajo el alcance simple de marcar CANCELLED e ignorar resultados tardíos.
4. windows-mcp plenamente operativo: El servidor Windows MCP y sus herramientas están integrados al flujo común sin capas extras ni complejas de seguridad para UI.
5. Objetivo de motor único y migración de escalación verificados: La ejecución de pasos avanza hacia la unificación mediante runStep. La supresión efectiva de runFastLoop, runPlanLoop y el retiro de deps.qwenEngine.escalate se autorizan únicamente tras demostrar mediante auditoría que todas sus responsabilidades están plenamente cubiertas por el nuevo diseño.
6. Validación estricta y decisiones de Eos: Ninguna llamada de herramienta se ejecuta si la respuesta de Eos es inválida o no coincide con una opción del catálogo vigente. Eos resuelve la selección y las verificaciones ok y cumple por mayor probabilidad (argmax) sin umbrales numéricos de corte.
7. Seguridad y Guard sobre argumentos resueltos: Guard inspecciona los argumentos reales tras la sustitución de referencias temporales. Una denegación de Guard nunca es reintentada.
8. Memoria contextual progresiva (2 → 5 → 10): El contexto de memoria se recupera progresivamente (2 iniciales, ampliables a 5 y hasta 10 elementos pertinentes).
9. Persistencia simple e integridad: Las tareas persisten metadatos mínimos y resúmenes compactos sin salidas completas de herramientas, sin rotación fija de 20 tareas ni backups automáticos en esta fase.
10. WAITING_INPUT sin timers de expiración: Las esperas por aprobación, confirmación de plan o respuesta del usuario operan sin cronómetros de expiración, permitiendo al usuario tomarse el tiempo que requiera.
11. Compilación y pruebas verificadas: La aplicación compila exitosamente (compile_applet / npm run build) y las pruebas del proyecto se ejecutan sin errores bloqueantes.
12. PLAN como capa de coordinación sobre FAST: PLAN no contiene lógica propia de selección de herramientas, generación de argumentos, validación, despacho ni reintentos de ejecución; cada etapa se entrega al flujo FAST (runStep), y runStep no fue rediseñado por esta propuesta.
13. Separación verificable de planificación, ejecución y verificación: Qwen genera el plan y verifica cada etapa; el flujo FAST ejecuta; no se ejecuta ninguna etapa antes de la aceptación del plan por parte del usuario. Ante modificaciones el plan se actualiza y se vuelve a presentar; ante rechazo no se ejecuta y se espera una nueva instrucción o una cancelación explícita.
14. Verificación por etapa basada en el resultado real: Una etapa no se da por cumplida solo porque la herramienta terminó sin errores; Qwen evalúa el resultado real frente al objetivo y los criterios de éxito definidos en el plan, y distingue etapa cumplida, desviación recuperable, información insuficiente y bloqueo o error no recuperable.
15. Replanificación acotada: La replanificación modifica solo las etapas pendientes, preserva el objetivo original, no regenera el plan innecesariamente y solo exige nueva aprobación cuando el cambio es material, altera significativamente el impacto de las acciones o requiere una decisión del usuario; respeta la frontera de la sección 6.2.
16. Seguridad en PLAN: La aprobación del plan no autoriza automáticamente las acciones futuras; Guard y los controles de FAST se aplican a cada acción de cada etapa, y ninguna replanificación elude una denegación de seguridad ni autoriza acciones por sí misma. Una acción denegada por Guard o rechazada por el usuario no se ejecuta, y un DENY no se reintenta ni se elude.
17. Contratos técnicos de PLAN derivados de la auditoría: El contrato PLAN ↔ FAST, la forma de la evidencia de verificación, el mapeo de las situaciones de la verificación por etapa a estados existentes y los campos persistidos se definen a partir de la auditoría del código y se documentan antes de su implementación; no se implementan contratos inventados.
18. Persistencia y contexto compactos en PLAN: Se persisten únicamente metadatos, plan y resúmenes mínimos para recuperar el estado de la tarea; no se asume que referencias no persistidas sobreviven a un reinicio; Qwen recibe contexto compacto (objetivo, restricciones, plan vigente, etapas completadas y resultados relevantes) y un catálogo compacto de herramientas.
19. Frontera entre reintentos de FAST y replanificación de PLAN: PLAN no gestiona reintentos locales de paso y replanifica solo cuando los mecanismos de FAST no permiten completar el paso, el resultado invalida una dependencia o cambian las condiciones del plan; ningún DENY genera un reintento ni una replanificación para eludirlo; no se agregaron límites, políticas de reintentos ni subsistemas sin auditoría previa; la taxonomía de errores recuperables y la frontera técnica se documentan a partir de la auditoría antes de implementarlas (sección 6.2).
13. Cambios Aplicados y Pendientes
13.1 Cambios y Correcciones Aplicadas en este Documento
Los registros de esta sección son antecedentes históricos sin vigencia normativa. Ante cualquier discrepancia prevalecen las secciones 1 a 12. Los puntos 13, 14 y 16 describen estados intermedios reemplazados por los puntos 17 y 18.
1. Deadline global eliminado (límite de 10 minutos por tarea, pausas y cronómetros asociados) en las secciones 1, 8, 10, 11 y 12.
2. Cancelación simplificada a marcar CANCELLED e ignorar resultados tardíos, sin AbortController, terminación de subprocesos ni limpieza de recursos; auditoría previa del mecanismo actual en core.ts (Fase 2).
3. WAITING_INPUT ratificado sin temporizadores de expiración (secciones 8.1, 10, 11 y 12).
4. Eos sin umbrales numéricos (sin 0.50 en selección ni 0.60/0.75 en ok/cumple), por mayor probabilidad (argmax) (secciones 4.2, 5, 10, 11 y 12).
5. MAX_STEPS = 15 ratificado y descartado un tope artificial de 8 pasos en PLAN (secciones 2.1, 10 y 12).
6. Persistencia simple sin retención fija de 20 tareas, descarte de tareas antiguas ni backups automáticos (secciones 7.2, 10 y 12).
7. Memoria contextual progresiva (2 → 5 → 10 elementos pertinentes), condicionada en Fase 2 a la auditoría del manejo actual de memoria.
8. Supresión de runFastLoop, runPlanLoop y retiro de deps.qwenEngine.escalate condicionados a demostrar por auditoría que sus responsabilidades quedan cubiertas; se distinguió la decisión de migrar la responsabilidad de la autorización para eliminar el código.
9. Regla de argumentos ajustada (secciones 1.2, 4.1 y 10): se prohíbe inventar herramientas, servidores, nombres de parámetros y schemas no declarados, y se exige validar los valores generados contra el schema real.
10. Matriz de responsabilidades consolidada entre Eos (elecciones cerradas), Qwen (texto y planes abiertos), Core (validación y políticas) y MCP (ejecución).
11. Reglas de reintento: se distinguió el comportamiento existente de las políticas pendientes, se conservó la prohibición de reintentar un DENY de Guard y se evitaron matrices de reintento inventadas.
12. Fases y criterios de aceptación alineados con los comandos reales de compilación y pruebas (compile_applet / npm run build), sin exigir «cero advertencias» absolutas.
13. Incorporación de la arquitectura objetivo del modo PLAN (sección 3.2): FAST y PLAN son modos con responsabilidades distintas, PLAN reutiliza runStep sin duplicar su lógica y runStep no se rediseña. En ese momento el resumen de decisiones figuraba como abierto; reemplazado por los puntos 17 y 18.
14. Ajustes de coherencia por la arquitectura de PLAN en las secciones 1.1, 1.2, 2.1, 3, 3.1, 4.1, 4.3, 5, 6.2, 7.2, 8, 9, 10, las fases 0, 1, 2, 4, 5 y 6 y los criterios de aceptación. La relación entre etapas y MAX_STEPS/MAX_REPLAN figuraba entonces como pendiente de confirmar; estado intermedio reemplazado por el punto 17.
15. Nueva Fase 3B: capa de coordinación de PLAN sobre el flujo FAST, dependiente de la auditoría de Fase 0 y de runStep operativo (Fase 3), sin modificar runStep.
16. Detalles de PLAN sin resolver (antecedente histórico sin vigencia normativa, reemplazado por el punto 17): una revisión previa registró como pendientes los detalles de PLAN (schemas, interfaces, estados y contabilización de límites). Esa formulación no está vigente: las 11 decisiones de diseño están aprobadas (sección 3.2.9) y solo permanecen pendientes de verificación los detalles técnicos dependientes del código (sección 13.2).
17. Incorporación de las 11 decisiones de diseño de PLAN aprobadas: los puntos de la sección 3.2 que figuraban como [PENDIENTE DE CONFIRMAR] pasaron a [DECISIÓN CONFIRMADA]; se actualizaron las secciones 2.1, 3.2.3 a 3.2.9, 7.2, 8.1, la matriz de la sección 10, las fases 0, 1 y 3B, los criterios de aceptación y la sección 13.
18. Revisión integral de coherencia y simplificación: se incorporó como [DECISIÓN CONFIRMADA] la frontera entre reintentos de FAST y replanificación de PLAN (sección 6.2); la taxonomía de errores recuperables y la frontera técnica pasaron de [PENDIENTE DE CONFIRMAR] a [PENDIENTE DE VERIFICAR]; se aclaró que la eliminación de Decision #5 es una decisión confirmada con supresión física condicionada a auditoría (secciones 3.1 y 5); se reclasificó como [PENDIENTE DE VERIFICAR] el registro de thinking: false, que figuraba como confirmado en código (sección 9); las cuatro situaciones de replanificación pasaron a ser resultados de la verificación por etapa; se etiquetaron enunciados sin etiqueta; se numeraron los criterios de aceptación y se agregó el 19; y se consolidaron duplicados (secciones 2.1, 3.2.3 a 3.2.9, 7.2, 8, 10, 11 y 13.2 a 13.4).
13.2 Pendientes de Verificar con el Código Fuente
Índice consolidado; el detalle de cada auditoría está en las secciones indicadas. Ninguno se considera resuelto sin evidencia de código, pruebas empíricas o documentación oficial.
1. [PENDIENTE DE VERIFICAR] Semántica y contabilización de MAX_STEPS = 15 y MAX_REPLAN = 2 en FAST y en PLAN con etapas (2.1, 3.2.5).
2. [PENDIENTE DE VERIFICAR] Mecanismo anti-loop existente, nonReadCounter (2.2).
3. [PENDIENTE DE VERIFICAR] Responsabilidades de D1, D2 y D5 y su mapeo en runStep (3.1).
4. [PENDIENTE DE VERIFICAR] Flujo actual de PLAN: generación del plan, soporte de confirm-plan para aceptar, rechazar y solicitar modificaciones, replanteos y su relación con handleEscalation y deps.qwenEngine.escalate (3.1, 3.2.3, 3.2.4, 3.2.6).
5. [PENDIENTE DE VERIFICAR] Contrato técnico PLAN ↔ FAST e invocación de FAST por etapa sin modificar runStep (3.2.5).
6. [PENDIENTE DE VERIFICAR] Transferencia de datos entre etapas: RefStore, FACTS, effects y handoff determinista (3.2.5).
7. [PENDIENTE DE VERIFICAR] Schema del plan, catálogo compacto y contexto compacto de Qwen frente a QWEN_CTX (3.2.3, 3.2.6).
8. [PENDIENTE DE VERIFICAR] Verificación por etapa: forma de la evidencia, contrato de salida y análisis de discrepancias con Eos (3.2.6).
9. [PENDIENTE DE VERIFICAR] Mapeo de las cuatro situaciones de verificación y del desenlace ante denegación o rechazo a estados existentes; representación en WAITING_INPUT de la modificación y el rechazo del plan (3.2.4, 3.2.6, 3.2.7, 8.1).
10. [PENDIENTE DE VERIFICAR] Mecanismo para determinar que un cambio de replanificación es material (3.2.4).
11. [PENDIENTE DE VERIFICAR] Campos persistidos del plan y estado recuperable tras un reinicio (3.2.8, 7.2).
12. [PENDIENTE DE VERIFICAR] Arranque de core.ts frente a tareas previas, suspensión sin timeout de requestUserApproval y endpoint confirm-plan (7.2, 8.1).
13. [PENDIENTE DE VERIFICAR] Contrato StepExecutionResult y su suficiencia, también para la supervisión de etapas por PLAN (4.3).
14. [PENDIENTE DE VERIFICAR] Contratos y parser de Eos: choice, noul y score (4.2).
15. [PENDIENTE DE VERIFICAR] Catálogo real y contratos MCP: Windows MCP (12), Desktop Commander (26), Free Search (11), herramientas locales y versiones, frente a PolicyRegistry (4.4, Fases 0 y 1).
16. [PENDIENTE DE VERIFICAR] Configuración de Qwen: QWEN_CTX, parámetros de generación, modo de razonamiento para PLAN y thinking: false en generateArguments (9).
17. [PENDIENTE DE VERIFICAR] Impacto de la ordenación de bloques de prompt en la caché de prefijo de Ollama/llama.cpp (9).
18. [PENDIENTE DE VERIFICAR] Taxonomía y criterios de error recuperable (6.2).
19. [PENDIENTE DE VERIFICAR] Frontera técnica entre los reintentos de FAST y la replanificación de PLAN (6.2).
20. [PENDIENTE DE VERIFICAR] Comandos reales de compilación y pruebas del repositorio, como compile_applet y npm run build (Fase 6, criterio de aceptación 11).
13.3 Decisiones de Diseño de PLAN Aprobadas
[DECISIÓN CONFIRMADA]: Las 11 decisiones de diseño de PLAN están aprobadas y no son preguntas abiertas; se enumeran en la sección 3.2.9.
13.4 Pendientes de Confirmar
Estado: ningún enunciado vigente de este documento está clasificado como [PENDIENTE DE CONFIRMAR]. La taxonomía de errores recuperables y la frontera técnica entre FAST y PLAN, antes abiertas, quedan como [PENDIENTE DE VERIFICAR] (secciones 6.2 y 13.2, puntos 18 y 19). Toda propuesta nueva sin aprobación debe etiquetarse [PENDIENTE DE CONFIRMAR] y no resolverse unilateralmente.