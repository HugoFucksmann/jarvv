# Flujo de Ejecución y Orquestación

## 1. Ciclo de Vida
1. **Recepción e inicio**: La instrucción del usuario ingresa al sistema y se registra una tarea activa en memoria.
2. **Selección de estrategia**: Según la modalidad seleccionada, el sistema activa la orquestación reactiva directa o la orquestación deliberativa por etapas.
3. **Planificación previa (solo modalidad deliberativa)**: El razonador formula una secuencia de etapas con criterios observables de éxito y la tarea se suspende a la espera de confirmación, ajuste o rechazo humano. Si la solicitud no requiere herramientas, el plan queda vacío y la tarea concluye con respuesta directa.
4. **Ejecución iterativa de pasos**: Cada acción individual atraviesa el pipeline indivisible del ejecutor atómico de herramientas.
5. **Evaluación de resultados**: Se contrasta el resultado técnico observable mediante el clasificador factual y, en modalidad deliberativa, mediante el supervisor semántico.
6. **Resolución de contingencias**: Los fallos recuperables activan escalación con cambio de ruta o replanificación autónoma; las dudas sobre información esencial suspenden la tarea para consultar al usuario.
7. **Conclusión y síntesis**: Al completarse los objetivos o alcanzarse un límite operativo, el sistema sintetiza una respuesta final con la evidencia acumulada y asienta la traza de la tarea. Si el razonador no puede redactarla (sin respuesta a tiempo, no disponible o salida inutilizable), se entrega una respuesta de respaldo determinista con contenido fijo (estado de la tarea, motivo de detención, fallos registrados, cambios aplicados al entorno, datos registrados y últimas acciones) y la traza marca su origen. El estado terminal no depende de cómo se redactó la respuesta.

## 2. Bucle Principal
En cada ciclo de ejecución, el sistema realiza la siguiente secuencia:
1. **Determinación de acción**: En modo reactivo, el clasificador evalúa el historial para elegir el destino operativo o declarar el fin. En modo deliberativo, se toma la etapa pendiente del plan vigente.
2. **Validación de fin**: La finalización reactiva requiere que exista al menos una acción productiva previa comprobada y que no existan pasos no verificados sin observar. De no cumplirse, la finalización se deniega y se fuerza a continuar con la ruta más adecuada.
3. **Pipeline atómico del paso**:
   - Selección de herramienta dentro del destino asignado; las que dependen de un proceso en ejecución o de una búsqueda iniciada solo se ofrecen mientras existan.
   - Generación de argumentos estructurados conforme al esquema.
   - Sustitución determinista de tokens por contenidos del almacén de referencias.
   - Control anti-bucle: bloqueo de lecturas idénticas o acciones repetidas sin lecturas intermedias de confirmación.
   - Evaluación en la compuerta de seguridad: denegación terminal ante comandos destructivos o suspensión interactiva ante mutaciones sensibles.
   - Despacho hacia el servidor de herramientas bajo control de cancelación cooperativa.
   - Procesamiento de la salida cruda, extracción de hechos y aislamiento de cargas masivas.
4. **Verificación y memoria**: Verificación factual del resultado observable. Consolidación de hechos si la acción fue validada, si no hubo veredicto o si produjo una mutación física en el entorno.
5. **Corte o continuación**: El bucle prosigue mientras existan etapas pendientes o alternativas viables, y se detiene ante objetivo cumplido, cancelación del usuario, agotamiento de cotas operativas de pasos o bloqueos de seguridad.

## 3. Rol del Plan en el Flujo
- **Generación**: El razonador descompone la solicitud en etapas secuenciales con ruta asignada y criterio observable de éxito.
- **Intervención humana previa**: La tarea suspende su ejecución hasta que el usuario confirma el plan, solicita ajustes o lo cancela.
- **Ejecución y doble juez**: Cada etapa del plan se envía al ejecutor atómico. La verificación técnica factual es evaluada primero por el clasificador; si este no aprueba o no está disponible, el razonador evalúa semánticamente si la evidencia satisface el objetivo de la etapa.
- **Clarificación interactiva**: Si el razonador dictamina falta de información esencial del usuario, la tarea se suspende formulando una pregunta puntual. Al recibir la respuesta, esta se asienta íntegra como hecho, se incorpora a la instrucción de la etapa y la ejecución se reanuda. Si se alcanza el límite de preguntas permitidas, la situación se procesa como desviación y se activa replanificación.
- **Replanificación autónoma**: Ante una desviación técnica o semántica, el razonador reestructura exclusivamente las etapas pendientes. Las etapas completadas jamás se repiten y el registro completo de mutaciones consolidadas se transmite sin recorte para no duplicar acciones destructivas. El plan ajustado prosigue de manera autónoma sin requerir confirmación interactiva.

## 4. Estados y Transiciones

| Estado Inicial | Transición | Estado Destino | Condición |
|---|---|---|---|
| Ninguno | Inicialización | En ejecución | Se crea la tarea y comienza la orquestación. |
| En ejecución | Suspensión interactiva | En espera de intervención | El plan inicial requiere aprobación, una herramienta sensible exige confirmación de seguridad, o se requiere una respuesta aclaratoria del usuario. |
| En espera de intervención | Reanudación interactiva | En ejecución | El usuario autoriza la mutación, confirma el plan, remite ajustes o provee la aclaración requerida. |
| En ejecución | Conclusión exitosa | Completada | Se cumplen los criterios observables de la tarea con todas las etapas vigentes verificadas. |
| En ejecución | Conclusión parcial | Parcial | Se alcanza la cota máxima de pasos permitidos, persisten bloqueos reiterados de bucle, o el plan concluye con etapas no verificadas. |
| En ejecución | Fallo terminal | Fallida | Acción denegada por patrón prohibido, rechazo expreso del usuario en la compuerta de seguridad, agotamiento de intentos de replanificación o error no recuperable. |
| En ejecución o En espera | Cancelación | Cancelada | El usuario interrumpe la tarea explícitamente en cualquier momento. |

## 5. Errores y Límites
- **Transporte hacia modelos**: Los fallos transitorios de red o saturación temporal se reintentan una vez con espera progresiva antes de catalogar el servicio como no disponible. El agotamiento de tiempo de espera y la cancelación nunca se reintentan.
- **Salidas inválidas de modelos**: Si la respuesta de un modelo no respeta el esquema esperado o se corta, se efectúa un reintento correctivo inyectando el motivo del desvío en la siguiente invocación.
- **Servicio no disponible durante un paso**: El fallo se asienta en el registro de fallos y no se atribuye a la herramienta elegida; el paso se marca como fallido y se aplica el tratamiento de desviación.
- **Escalación reactiva**: Ante un fallo de herramienta en modo reactivo, la herramienta fallida se excluye de la siguiente iteración, se amplía el contexto recuperado y el clasificador arbitra una ruta alternativa. Si el clasificador determina fin de alternativas o se agotan las cotas de escalación, la tarea concluye.
- **Tratamiento de incertidumbre**:
  - En modo reactivo, una acción sin veredicto no permite concluir la tarea de forma exitosa a menos que una acción posterior de lectura confirme el estado del entorno.
  - En modo deliberativo, una acción sin veredicto permite continuar con las etapas siguientes, pero si al finalizar persisten acciones sin verificar, la tarea concluye como parcial y no como completada.
- **Seguridad**: Toda denegación por política prohibida o rechazo humano en la compuerta de seguridad detiene la tarea de inmediato; está prohibido escalar o replanificar para evadir un bloqueo de seguridad.
- **Cupo de tareas**: Al crear una tarea por encima del cupo se expulsan las terminales más antiguas y, si aún se supera, se cancela la tarea en espera más antigua.
- **Cancelación cooperativa**: La cancelación del usuario propaga una señal de aborto a todas las capas, descarta respuestas en vuelo y concluye la tarea inmediatamente sin catalogarse como error.

Límites vigentes (definidos en `types.ts` y `config.ts`; los tiempos y el contexto son valores por defecto):

| Límite | Valor |
|---|---|
| Pasos máximos | 15 (reactivo: detiene la tarea como parcial; deliberativo: máximo por plan) |
| Replanificaciones | 2 |
| Escalaciones (reactivo) | 2 |
| Preguntas al usuario por paso | 2 |
| Tareas retenidas | 20 |
| Reintentos de transporte | 1, tras 1 s |
| Reintentos por salida inválida | 1 |
| Tiempo de espera | Razonador 120 s (180 s con razonamiento extendido); clasificador 30 s; herramientas 30 s |
| Contexto configurado | 16 384 tokens para razonador y clasificador |

## 6. Invariantes del Flujo
1. **Unicidad de ejecución**: Todo comando o acceso a herramientas opera exclusivamente a través del ejecutor atómico (ver principio en `ARCHITECTURE.md`).
2. **Invarianza de etapas completadas**: Las etapas concluidas y verificadas nunca se vuelven a ejecutar durante una replanificación.
3. **Permanencia de efectos**: Las alteraciones físicas consolidadas no se revierten ante desvíos posteriores (ver detalle en `CONTEXT_AND_MEMORY.md`).
4. **Cierre de estados terminales**: Una vez alcanzado un estado terminal (completada, parcial, fallida o cancelada), ninguna respuesta demorada ni evento tardío puede modificar dicho estado.

## 7. Archivos Base
- `src/core/core.ts`
- `src/core/modeEngines.ts`
- `src/core/callExecutor.ts`
- `src/core/decision.ts`
- `src/core/llmTransport.ts`
- `src/core/reasoner/qwen.ts`
- `src/core/policy/guard.ts`
- `src/core/types.ts`