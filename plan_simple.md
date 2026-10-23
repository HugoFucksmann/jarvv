Arquitectura de ejecución de JARVIS: FAST y PLAN
1. Objetivo
Unificar FAST y PLAN bajo un único motor reactivo. PLAN organiza la
tarea en etapas y utiliza ese motor para ejecutar cada una. Si la
recuperación local no resuelve un fallo durante la ejecución
planificada, Qwen replantea automáticamente el trabajo pendiente.
2. Responsabilidades
Motor común FAST
Ejecuta el objetivo de la etapa activa mediante este flujo:
1. Decision #1: selecciona el grupo o ruta de herramientas, o
   determina si corresponde finalizar.
2. Decision #2: selecciona la herramienta concreta dentro de la
   ruta.
3. Qwen: genera los argumentos.
4. Guard: autoriza o rechaza la ejecución.
5. MCP: ejecuta la herramienta.
6. Result Processor: procesa y normaliza el resultado.
7. Decision #3 (Eos): verifica si se cumplió el objetivo del paso
   y, si no se cumplió, clasifica el fallo.
8. Recuperación local: intenta resolver los fallos recuperables
   dentro de un límite definido.
9. Continuación: si el paso se resuelve, FAST continúa; si no,
   devuelve el control a la capa de orquestación correspondiente.
FAST conserva las responsabilidades de selección dinámica de rutas y
herramientas, ejecución, verificación y continuación del ciclo.
Capa PLAN
PLAN no mantiene un segundo motor de ejecución. Organiza el trabajo y
coordina el motor común.

Sus responsabilidades son:
- Pedir a Qwen un plan estructurado en etapas.
- Presentar el plan al usuario para su aprobación inicial.
- Mantener el plan completo y el estado de las etapas.
- Activar una etapa por vez y entregar su objetivo al motor FAST.
- Avanzar cuando la etapa activa se haya verificado como completada.
- Activar la replanificación cuando la ejecución de la etapa no pueda
  resolverse mediante la recuperación local.
3. Estructura del plan
El plan aprobado debe describir qué se necesita conseguir, no fijar
obligatoriamente qué grupo de herramientas se debe usar. Decision #1
selecciona la ruta durante la ejecución.

Cada etapa debe definir, como mínimo:
- Objetivo: qué debe conseguir.
- Resultado esperado: qué se espera obtener.
- Criterios de cumplimiento: cómo evaluar si se alcanzó el
  objetivo.
- Dependencias: qué etapas deben completarse antes, cuando
  corresponda.
- Restricciones: límites relevantes para la ejecución.
El formato exacto de estos campos queda pendiente de validación técnica.
4. Contexto por etapa
El plan completo permanece disponible en el estado de la tarea, pero no
se envía completo en cada decisión del motor.
- Contexto habitual: objetivo de la etapa activa, resultado de la
  etapa anterior y contexto o restricciones relevantes.
- Consulta bajo demanda: el motor puede solicitar información de
  otras etapas o resultados anteriores si la necesita.
- Evidencias: los resultados verificados de etapas anteriores se
  conservan y pueden incorporarse al contexto cuando sean pertinentes.
Las etapas no son completamente aisladas: reciben el contexto necesario
para continuar el trabajo, sin cargar automáticamente el plan entero en
cada llamada.
5. Recuperación local de fallos
Después de procesar el resultado, Eos evalúa el cumplimiento del
objetivo. Inicialmente, Decision #3 realizará en una misma llamada dos
evaluaciones:
1. ¿Se cumplió el objetivo del paso?
2. Si no se cumplió, ¿qué tipo de fallo ocurrió?
Si agrupar ambas preguntas reduce la fiabilidad o añade demasiada carga,
se podrá evaluar una Decision #4 separada para clasificar el fallo.
Tratamiento
- Objetivo cumplido: se acepta el resultado y el ciclo continúa.
- Fallo técnico transitorio: se permite un reintento limitado
  cuando sea seguro.
- Argumentos incorrectos o insuficientes: Qwen prepara una
  corrección usando el contexto específico del intento fallido.
- Herramienta o estrategia inadecuada: el control puede volver a
  FAST para que Decision #1 seleccione otra ruta.
- Resultado incierto: no se repite a ciegas una operación que
  podría haber producido efectos.
- Recuperación agotada o fallo no recuperable: en modo PLAN, se
  activa la replanificación.
El contexto de recuperación incluye el objetivo del paso, la herramienta
y ruta utilizadas, los argumentos enviados, el resultado o error, la
clasificación del fallo y los intentos anteriores. No necesita
reconstruir toda la conversación ni generar un plan nuevo para cada
reintento.

Cada reintento debe volver a pasar por los controles de autorización
aplicables y el resultado debe verificarse nuevamente. Los rechazos del
Guard no deben convertirse en reintentos para eludir la autorización.
Las operaciones con posibles efectos secundarios no se deben repetir sin
evaluar si el intento anterior llegó a ejecutarse.

El límite concreto de reintentos queda pendiente de decisión técnica.
6. Replanificación
Si la recuperación local no resuelve el fallo durante PLAN, Qwen entra
en modo pensamiento y genera una versión actualizada del plan para
completar el trabajo pendiente.

A diferencia de las llamadas normales de ejecución, la replanificación
recibe el plan completo y el estado global de la tarea, incluyendo:
- Plan vigente completo.
- Etapas completadas y sus resultados o evidencias.
- Etapa fallida, error observado y reintentos realizados.
- Etapas pendientes.
- Objetivo global y restricciones vigentes.
Qwen reorganiza el trabajo que falta. Las etapas completadas se
conservan como estado y evidencia; no se vuelven a ejecutar
automáticamente sin una razón explícita.

El replan se ejecuta automáticamente, sin solicitar una nueva aprobación
del usuario, de acuerdo con el comportamiento actual acordado. El plan
actualizado vuelve a ejecutarse etapa por etapa mediante el motor FAST.
7. Flujo general
Usuario solicita una tarea compleja
        ↓
Qwen genera el plan estructurado
        ↓
Usuario aprueba el plan
        ↓
PLAN activa la etapa actual
        ↓
FAST ejecuta:
  Decision #1 → ruta
  Decision #2 → herramienta
  Qwen → argumentos
  Guard → autorización
  MCP → ejecución
        ↓
Result Processor
        ↓
Decision #3 (Eos):
  verifica cumplimiento + clasifica el fallo si corresponde
        ↓
¿Se cumplió la etapa?
  ├─ Sí → PLAN activa la siguiente etapa o finaliza
  └─ No → recuperación local limitada
               ├─ Resuelto → verificar y continuar
               └─ No resuelto → Qwen en modo pensamiento
                                  recibe el plan completo
                                  y replantea lo pendiente
                                         ↓
                                  PLAN continúa por etapas
                                  con el motor FAST
8. Principios acordados
- Un único motor reactivo para FAST y PLAN.
- PLAN controla objetivos, etapas y progresión; no duplica la
  ejecución de herramientas.
- El plan se estructura por objetivos y resultados, no por
  asignaciones obligatorias de grupos de herramientas.
- FAST recibe una etapa por vez y selecciona dinámicamente las
  herramientas.
- El plan completo permanece disponible, pero el contexto normal de
  ejecución es selectivo.
- La recuperación local trata fallos acotados antes de replanificar.
- La replanificación usa Qwen en modo pensamiento, recibe el plan
  completo y reorganiza el trabajo pendiente.
- La verificación, la autorización y los límites de reintento son
  controles explícitos.
9. Pendiente de definición técnica
Este documento registra el diseño conceptual acordado; no implica
cambios de código. Antes de implementar deben definirse el esquema
exacto del plan, el contrato de entrada y salida de cada etapa, los
tipos de fallo, el límite de reintentos y las reglas para conservar o
invalidar resultados tras una replanificación.