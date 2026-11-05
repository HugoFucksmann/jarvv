# JARVIS: implementaciones a futuro

Capacidades nuevas y cambios estructurales o de semántica central que van más allá de ajustar lo existente. Las propuestas están ordenadas por prioridad.

**Abreviaturas:** D1 = decisión de ruta, D2 = decisión de herramienta, D3 = revisión de argumentos, D4 = verificación del resultado.

---

## 1. Verificación en dos niveles y pasos multi-llamada

- **Problema:** un paso termina `completed` apenas una llamada queda aprobada (CORE_FLOW §1.3, §4.4). El tope es de 15 pasos (por tarea en reactivo, por plan en deliberativo; en reactivo los pasos fallidos también cuentan), así que el sistema solo puede hacer unas 15 operaciones útiles por tarea. El tope se consume más rápido porque un resultado grande se lee por tramos (CONTEXT §5.3), y cada tramo es una llamada completa. Los planes quedan forzados a una llamada por paso: no existe "buscar hasta encontrar". Además, `cumple` se evalúa contra el paso (deliberativo) o contra la solicitud completa (reactivo) (§7), por lo que una llamada intermedia legítima tiene que "cumplir" un objetivo que todavía no le corresponde.
- **Propuesta:** separar dos preguntas que hoy son una:
  - *Nivel llamada:* ¿se ejecutó bien y devolvió algo útil? (hoy `ok`). Alimenta `calls`, efectos e intentos.
  - *Nivel objetivo:* ¿el paso (deliberativo) o la solicitud (reactivo) ya está cumplido con lo hecho hasta ahora? Decide cuándo termina el paso.
- **Funcionamiento:** un paso admite varias llamadas aprobadas. Al aprobarse una se consulta el nivel objetivo: si da sí, el paso se completa; si no, se sigue en el mismo paso. En reactivo, el objetivo reemplaza a `fin` de D1 como criterio de cierre (hoy `fin` no tiene una pregunta explícita de "¿está cumplida la solicitud?"). El tope de 15 pasos pasa a medir intención y el de 8 llamadas por paso sigue como freno.
- **Beneficios:** lectura de refs y secuencias como búsqueda más lectura dejan de consumir pasos; planes más cortos y coherentes; la verificación deja de exigirle a una llamada intermedia un objetivo que no le corresponde; se aclara `canFinish`.
- **Alternativas:** (a) mantener el diseño y exigir al planificador pasos atómicos (resuelve el caso deliberativo pero no el reactivo ni la lectura de refs); (b) dos niveles con el modelo de decisión, ya que el contrato de preguntas existe; (c) delegar el objetivo al modelo generativo (más caro y viola la separación de roles; solo como desempate).
- **Riesgos:** una consulta más por llamada aprobada (en reactivo reemplaza la decisión `fin`); un modelo pequeño puede ser poco fiable para decidir si el objetivo está cumplido, hay que calibrar el umbral con trazas; cambia `closure.ts`, `derive.ts` y los contadores por paso; el tope de 8 llamadas debe seguir funcionando.
- **Ganancia:** es el cambio con más efecto sobre la tasa de tareas completadas.

## 2. Presupuesto global por tarea

- **Problema:** los límites son contadores locales (15 pasos, 8 llamadas por paso, 2 replans, 2 escalaciones). No hay tope de tiempo total, de consultas a modelos ni de tokens por tarea. El peor caso es multiplicativo y, con modelos locales, puede ser de horas.
- **Propuesta:** un presupuesto global por tarea, con tope de consultas a modelos y de tiempo, que cierre con un motivo nuevo en la lista cerrada.
- **Relación:** mitiga el riesgo de tratar los fallos persistentes de modelo como fallos de paso (ver documento de mejoras del sistema actual, "Resiliencia ante fallos de modelo y de infraestructura"), por lo que conviene implementarlas juntas.

## 3. Lectura de refs como herramienta liviana

- **Problema:** un resultado grande se lee "por tramos" con la herramienta de archivos (CONTEXT §5.3), y cada tramo es una llamada completa, o sea un paso del tope de 15.
- **Propuesta:** registrar la lectura de refs como herramienta del catálogo, solo lectura y acotada a la tarea, para pedir un rango o buscar texto dentro de una ref sin D3 ni verificación de modelo. Mantiene la invariante de que todo pasa por `runCall` y Guard.
- **Relación:** la verificación en dos niveles con pasos multi-llamada (propuesta 1) también ataca el consumo de pasos por lectura de refs, por otra vía.

## 4. Compactación de efectos

- **Problema:** los efectos y posibles efectos comparten una reserva de 12 000 caracteres y nunca se recortan. Si no caben, la tarea cierra `unrecoverable` (CONTEXT §4). Es un acantilado, no una degradación. Bajo el uso actual probablemente no se alcanza, pero crece con los pasos multi-llamada (propuesta 1).
- **Propuesta:** una forma compacta de una línea por efecto (herramienta, objetivo, estado), con el detalle completo en la llamada o la ref. Mantiene la invariante de no ocultar efectos y aleja el acantilado.

## 5. Persistencia incremental de la traza

- **Problema:** la traza se escribe como una línea al terminar la tarea y el estado vive solo en RAM (CONTEXT §6). Si el servidor cae durante una tarea, se pierden el registro y el conocimiento de los efectos ya aplicados al entorno.
- **Propuesta:** como la traza ya se suscribe a los eventos `change`, escribirla de forma incremental permitiría auditar tareas interrumpidas, sin reintroducir lectura ni restauración (el backend sigue sin leerla).

## 6. Puente del modo reactivo al deliberativo al agotar las escalaciones

- **Problema:** en reactivo, la tercera escalación cierra con `no_alternatives`, aunque la tarea podría ser descomponible. Es el único punto donde el sistema se rinde sin intentar un cambio de estrategia, mientras el modo deliberativo tiene replan autónomo.
- **Propuesta:** en vez de cerrar, generar un plan con trigger `step_failure` (tipo que ya existe en el esquema de plans) y continuar en modo deliberativo sin pedir confirmación, con lo ya hecho a la vista.
- **Ganancia:** rescata tareas que hoy terminan en `partial`. Es la mejora de mayor impacto potencial en tasa de éxito, pero la más cara.
- **Riesgo:**
  - Es la única propuesta que cambia las semánticas centrales.
  - Mezcla un contexto sin plan con pasos que sí lo tienen (`planId` es `null` en reactivo).
  - Obliga a decidir qué hace el cierre deliberativo con pasos reactivos previos.
  - Rompe la limpieza de "un modo por tarea".
  - No hay evidencia de que las tareas fallidas sean descomponibles. Si se resuelve antes el criterio de verificación y cierre (propuesta 1), puede resultar innecesaria.
- **Verificar antes:** considerarla solo si la traza muestra muchos `no_alternatives` donde un plan habría funcionado.

## 7. Persistencia de tareas y timeouts de espera de usuario

- **Situación:** todo es volátil (sin restauración tras reinicio, máximo 20 tareas retenidas, la traza no se vuelve a leer). Una tarea en curso se pierde al reiniciar, y una deliberativa con confirmaciones humanas pendientes también. Es una decisión deliberada y coherente con "reiniciar limpio". Solo importa si JARVIS se usa para tareas largas.
- **Propuestas opcionales:**
  - Persistencia y restauración de tareas. La complejidad es alta (serialización, reanudación segura de efectos parciales) y no hay evidencia de necesidad. Es distinta de la persistencia incremental de la traza (propuesta 5), que no implica restauración.
  - Timeout para tareas en espera del usuario. Hoy solo se cancela la más antigua al exceder 20, por lo que pueden acumularse tareas bloqueadas.
