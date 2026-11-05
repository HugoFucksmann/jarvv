# JARVIS: propuestas de mejora

**Abreviaturas:** D1 = decisión de ruta, D2 = decisión de herramienta, D3 = revisión de argumentos, D4 = verificación del resultado.

Las propuestas están ordenadas por prioridad dentro de cada categoría.

---

# 1. Mejoras del sistema actual

## 1.1 Medir y calibrar las decisiones con la traza

- **Problema:** D4 aprueba si `ok` y `cumple` superan 0.5 (CORE_FLOW §7). Es el único filtro entre "una llamada se ejecutó" y "el paso está hecho", con un umbral fijo sin calibración documentada sobre un modelo local. D3 puede descartar herramientas (`tool_rejected`, `info_missing`), con el anti-bucle como único freno. Esto puede producir falsos positivos (pasos "completados" sin cumplir el objetivo) o falsos negativos que consumen el tope de 8 llamadas y disparan escalaciones o replans. No hay ninguna medición documentada de la precisión de estas decisiones.
- **Propuesta:** aprovechar la traza, que se escribe pero nunca se lee y ya registra cada consulta con su etapa, entrada y salida. Instrumentarla para medir:
  1. Fracción de llamadas no ejecutadas que terminan en `args_invalid` y `tool_rejected`.
  2. Qué atrapa D3 en lecturas.
  3. Cuántas tareas terminan en `no_alternatives`.
  4. Cuántas veces cada etapa (D3, D4) cambió el resultado. Una etapa que casi nunca rechaza algo útil es candidata a volverse condicional.
  5. Si los `security_denied` provienen de errores del modelo o de ataques.
- **Valor:** es lo que permite decidir con datos sobre varias de las propuestas siguientes. Es barato y no toca el motor.
- **Verificar antes:** qué mide ya el laboratorio de evaluación externo. Si ya mide las Decisiones 1-4, la propuesta es menor de lo que parece.

## 1.2 Resiliencia ante fallos de modelo y de infraestructura

- **Problema:**
  - Un timeout se registra como `service_unavailable`, sin distinguirlo de una caída (CONTEXT §8).
  - Cualquier `service_unavailable` cierra la tarea con `unrecoverable` (CORE_FLOW §10). Solo hay un reintento de transporte tras 1 s, y no aplica a timeouts.
  - Una salida inválida tras un reintento de D1 a D4 también se trata como "servicio no disponible" y cierra la tarea (§7, §10).
  - Con modelos locales en Ollama, los timeouts por carga en frío o contexto grande son esperables. Una tarea larga (p. ej. deliberativa con 10 pasos hechos) puede morir por un episodio transitorio o una sola respuesta mal formada, y `unrecoverable` no indica si fue transitorio.
  - Si existe un modo degradado de verificación en el código, no está documentado.
- **Propuesta:**
  - Distinguir timeout de caída. Aporta valor diagnóstico y permite políticas distintas (p. ej. reintentar en el siguiente paso con una vista más corta).
  - Tratar un fallo persistente del modelo de decisión o de verificación en un paso como fallo de paso, con la recuperación del modo, y no como cierre inmediato. `unrecoverable` quedaría para fallos repetidos entre pasos o caída sostenida de un servicio.
- **Alternativas:** (a) fallback de verificación al modelo generativo cuando falla el de decisión (si ya existe, documentarlo); (b) reintento a nivel de paso, más simple y que mantiene los roles separados.
- **Riesgo:** un fallo que antes cerraba rápido ahora gasta más intentos. Conviene acompañarla del presupuesto global (2.4).

## 1.3 Política de pipeline por herramienta y atajos deterministas (D2, D3, D4)

- **Problema:** toda llamada pasa por el mismo pipeline pesado. Una llamada exitosa cuesta cuatro consultas al modelo de decisión (D1, D2, D3, D4, esta última con dos preguntas) más una generación de argumentos, y cada fallo vuelve al inicio del paso y repite casi todo (CORE_FLOW §4, §5). No hay diferencia de costo entre leer un archivo, escribir en disco o reintentar un timeout. Con modelos locales (contexto de 16k, timeouts de 30 s y 120 s), cada consulta innecesaria se paga en latencia.
- **Propuesta:** reducir etapas donde su valor es bajo, con una política expresada en el manifest del catálogo (que ya es la única fuente de políticas y distingue `read` de `write`), o bien como recortes fijos aplicados de uno en uno:

| Recorte | Descripción | Salvedad |
|---|---|---|
| **D4 con resultado ya conocido** | El procesador de resultados calcula el estado (`no_data`, `not_found`) de forma determinista antes de consultar. Si el estado ya indica que no hay datos, omitir la pregunta `ok` y dejar solo `cumple`. Hoy solo `tool_error` y `exception` se rechazan sin consultar (§7). | No rechazar automáticamente `not_found`: puede ser justo la respuesta buscada ("¿existe este archivo?"). La política debe ser por herramienta o tipo de pregunta, no global. |
| **D3 asimétrica según `kind`** | Revisar siempre en escrituras y en operaciones que Guard marcó como sensibles. Opcional o ninguna en lecturas (idempotentes, con esquema validado y ya filtradas por Guard): el error es barato, D4 lo atrapa después y el anti-bucle impide repetirlo. Elimina una consulta en la mayoría de las llamadas de exploración y evita los bucles que D3 puede crear (`tool_rejected`, `info_missing` vuelven al inicio y consumen el tope de 8). | Es el recorte más agresivo: los errores de argumentos se descubren después de ejecutar. Medir antes cuánto atrapa D3 en lecturas (1.1). |
| **D2 con una sola herramienta** | CORE_FLOW §4 documenta el atajo "una sola opción, no se consulta" para D1. Aplicarlo también a D2. | Confirmar si D2 ya lo aplica. |

- **Alternativas:** eliminar etapas globalmente (más simple, pero pierde la protección en escrituras); cascada con verificación barata primero y modelo después (añade un tercer mecanismo).
- **Riesgo:** cada atajo o flag desplaza trabajo de los modelos a reglas fijas, que fallan en los casos no previstos, y cada flag nuevo en el manifest es una combinación más para probar. Aplicar de a uno y medir.

## 1.4 Reintento automático de lecturas ante fallos transitorios

- **Problema:** los fallos de transporte a modelos se reintentan una vez, pero los de herramientas no. Un timeout de lectura dispara el pipeline completo. Además, el anti-bucle puede bloquear la repetición idéntica porque `tool_error` cuenta como "ejecutada"; si el bloqueo aplica al reintento, la única salida es variar los argumentos artificialmente (deducción de las reglas documentadas, no comportamiento observado).
- **Propuesta:** reintento automático solo para lecturas, nunca para escrituras. Evita cuatro consultas por falla transitoria.

## 1.5 Lectura de refs como herramienta liviana

- **Problema:** un resultado grande se lee "por tramos" con la herramienta de archivos (CONTEXT §5.3), y cada tramo es una llamada completa, o sea un paso del tope de 15.
- **Propuesta:** registrar la lectura de refs como herramienta del catálogo, solo lectura y acotada a la tarea, para pedir un rango o buscar texto dentro de una ref sin D3 ni verificación de modelo. Mantiene la invariante de que todo pasa por `runCall` y Guard.

## 1.6 Presupuesto de contexto y compactación de efectos

- **Problema:** varios elementos interactúan y son el origen probable de los cierres `unrecoverable` en tareas largas:
  - Contexto de 16 384 tokens para ambos modelos (CORE_FLOW §10): poco margen para prompts con 12 000 caracteres solo de efectos, más plan, historial y refs.
  - Estimación de 3 caracteres/token (CONTEXT §4): heurística que, para español, código o rutas, puede subestimar o sobreestimar. El riesgo es rechazar llamadas válidas o desbordar el contexto real.
  - Los efectos y posibles efectos comparten una reserva de 12 000 caracteres y nunca se recortan; si no caben, la tarea cierra `unrecoverable` (CONTEXT §4). Es un acantilado, no una degradación: una tarea con muchas escrituras exitosas se cortaría justo cuando más ha avanzado (si ya hubo efectos queda `partial`).
- **Propuesta:**
  - Revisar el presupuesto de contexto (tamaño de 16 384 tokens, estimación de 3 car/token, reserva de efectos).
  - Forma compacta de una línea por efecto (herramienta, objetivo, estado), con el detalle completo en la llamada o la ref. Mantiene la invariante de no ocultar efectos y aleja el acantilado.
- **Verificar antes:** medir antes de cambiar.

## 1.7 Retroalimentación enriquecida tras un rechazo

- **Problema:** tras un rechazo, el modelo ve solo `no_usable_data` o `not_accomplished`, más el estado de la llamada. Las claves cerradas protegen contra inyección, pero pierden información útil.
- **Propuesta:** enriquecerla sin prosa de modelo, con datos derivados del propio contexto: cuántas veces se intentó la misma ruta con resultados vacíos, qué argumentos ya se probaron.

## 1.8 Anti-bucle más robusto

- **Problema:**
  - Variaciones leves: en reactivo solo hay 2 escalaciones y la herramienta fallida "no se bloquea" (CORE_FLOW §6). El anti-bucle solo detecta repeticiones idénticas, así que un modelo que varíe ligeramente los argumentos puede eludirlo sin progresar.
  - Ciclos: compara solo con "la última llamada ejecutada idéntica", por lo que un ciclo A-B-A-B de lecturas distintas no se detecta. Queda acotado por el tope de 8 llamadas, pero se paga entero.
- **Propuesta:**
  - Contemplar repeticiones "casi idénticas".
  - Comparar contra las llamadas del paso actual, o desde la última escritura (más robusto, barato y determinista).
- **Verificar antes:** confirmar con datos de traza.

## 1.9 Retención y limpieza de refs

- **Problema:** los archivos de refs nunca se borran (CONTEXT §5.2 y §8). Hay crecimiento ilimitado en disco y archivos huérfanos tras expulsar tareas o reiniciar. Pueden contener contenido sensible de lo leído, por lo que también es un tema de privacidad en disco.
- **Propuesta:** política de limpieza ligada a la expulsión de tareas.

## 1.10 Detección de fallos de configuración

- **Problema:** `qwenNumCtx` y `decisionMaxContext` se configuran a mano y "deben coincidir con el contexto real" (ARCHITECTURE §6). Una discrepancia produce fallos difíciles de diagnosticar, y nada documentado la detecta.
- **Propuesta:** un mecanismo de detección de la discrepancia entre contexto declarado y real, para evitar fallos silenciosos tras cambios de modelo.

## 1.11 Orden de las vistas para reutilizar caché

- **Propuesta:** cada consumidor recibe una vista distinta (§4). Si el servidor local reutiliza prefijos de prompt, poner primero lo estable (solicitud, plan, completados) y al final lo variable podría reducir latencia entre consultas consecutivas.
- **Verificar antes:** depende de cómo el endpoint de decisión maneja la caché. Medir antes de reordenar.

## 1.12 Persistencia incremental de la traza

- **Problema:** la traza se escribe como una línea al terminar la tarea y el estado vive solo en RAM (CONTEXT §6). Si el servidor cae durante una tarea, se pierden el registro y el conocimiento de los efectos ya aplicados al entorno.
- **Propuesta:** como la traza ya se suscribe a los eventos `change`, escribirla de forma incremental permitiría auditar tareas interrumpidas, sin reintroducir lectura ni restauración.

## 1.13 Revisión de Guard DENY (condicional)

- **Situación:** un DENY de Guard cierra toda la tarea. Es una decisión deliberada, fail-closed y defendible, sobre todo ante inyección vía contenido externo. Pero un modelo pequeño que propone un argumento mal formado mata una tarea larga.
- **Propuesta:** revisarlo solo si las trazas muestran que los `security_denied` vienen de errores del modelo y no de ataques. Si no, dejarlo como está.

---

# 2. Mejoras del flujo y la arquitectura

## 2.1 Criterio de verificación y cierre de paso (D4)

- **Problema:** `cumple` se evalúa contra el paso (deliberativo) o contra la solicitud completa (reactivo) (§7). En reactivo no hay `expected` ni `instruction` por paso, así que una llamada intermedia legítima (listar una carpeta para luego leer un archivo, buscar antes de leer) tendría que "cumplir" la solicitud entera para quedar aprobada. Si no lo hace, queda como intento rechazado (`not_accomplished`) y el paso sigue gastando llamadas. Como `canFinish` exige al menos una llamada aprobada, el progreso real y el reconocido pueden divergir. Es una inferencia de las reglas documentadas. El diseño actual funciona bien para tareas de una acción y mal para tareas encadenadas.
- **Condición:** solo es un problema si la pregunta `cumple` de D4 está redactada literalmente así. Si ya pregunta algo como "¿aporta al objetivo?", no hay problema. Revisar primero el prompt de D4 reactivo.
- **Problema adicional (pasos = llamadas):** un paso termina `completed` apenas una llamada queda aprobada (CORE_FLOW §1.3, §4.4). El tope es de 15 pasos (por tarea en reactivo, por plan en deliberativo; en reactivo los pasos fallidos también cuentan), así que el sistema solo puede hacer unas 15 operaciones útiles por tarea. El tope se consume más rápido porque un resultado grande se lee por tramos (CONTEXT §5.3). Los planes quedan forzados a una llamada por paso: no existe "buscar hasta encontrar".

**Opción A: separar la pregunta según el modo**
- En reactivo, D4 verificaría `ok` más "pertinencia" (¿es relevante y útil para la solicitud?). La decisión de si la tarea está completa quedaría en D1 con la opción `fin`, que ya existe. Cada decisión hace una sola cosa.
- Costo muy bajo (un prompt). Reduce los falsos rechazos en tareas multi-salto.

**Opción B: verificación en dos niveles y pasos multi-llamada**
- Separar dos preguntas que hoy son una:
  - *Nivel llamada:* ¿se ejecutó bien y devolvió algo útil? (hoy `ok`). Alimenta `calls`, efectos e intentos.
  - *Nivel objetivo:* ¿el paso (deliberativo) o la solicitud (reactivo) ya está cumplido con lo hecho hasta ahora? Decide cuándo termina el paso.
- Un paso admite varias llamadas aprobadas. Al aprobarse una se consulta el nivel objetivo: si da sí, el paso se completa; si no, se sigue en el mismo paso. En reactivo, el objetivo reemplaza a `fin` de D1 como criterio de cierre (hoy `fin` no tiene una pregunta explícita de "¿está cumplida la solicitud?"). El tope de 15 pasos pasa a medir intención y el de 8 llamadas por paso sigue como freno.
- **Beneficios:** lectura de refs y secuencias como búsqueda más lectura dejan de consumir pasos; planes más cortos y coherentes; la verificación deja de exigirle a una llamada intermedia un objetivo que no le corresponde; se aclara `canFinish`.
- **Alternativas:** (a) mantener el diseño y exigir al planificador pasos atómicos (resuelve el caso deliberativo pero no el reactivo ni la lectura de refs); (b) dos niveles con el modelo de decisión, ya que el contrato de preguntas existe; (c) delegar el objetivo al modelo generativo (más caro y viola la separación de roles; solo como desempate).
- **Riesgos:** una consulta más por llamada aprobada (en reactivo reemplaza la decisión `fin`); un modelo pequeño puede ser poco fiable para decidir si el objetivo está cumplido, hay que calibrar el umbral con trazas; cambia `closure.ts`, `derive.ts` y los contadores por paso; el tope de 8 llamadas debe seguir funcionando.

## 2.2 Minibucle de reparación de argumentos en `runCall`

- **Problema:** cuando D3 devuelve `args_invalid`, o la generación de argumentos falla tras su reintento, la llamada vuelve al inicio del paso. Eso repite D1 y D2, que ya habían decidido bien (solo fallaron los argumentos), y consume uno de los 8 cupos de llamadas del paso. Una llamada completa puede encadenar hasta cinco consultas a modelos en serie, y con modelos locales de contexto chico el costo dominante es el número de saltos y reintentos.
- **Propuesta:** un lazo corto entre las fases 3 y 7. Si el fallo es de argumentos, se regeneran con el motivo (texto fijo, como exige el invariante §7.2) manteniendo la herramienta elegida, con un tope propio de 1 o 2 vueltas. Solo si se agota se registra la llamada fallida y se sale al inicio del paso.
- **Ganancia:** ahorra 2 consultas de decisión por fallo de argumentos y protege el cupo de 8 llamadas. Probablemente sea el cambio con mejor relación beneficio/costo.
- **Costo y riesgo:** es el único que toca la semántica "una llamada se registra una sola vez, al terminar el intento". El lazo debe ser interno a un intento, de modo que el contexto no vea las vueltas intermedias. `info_missing` no entra en el lazo, porque ahí falta información y regenerar no lo arregla.
- **Verificar antes:** medir qué fracción de las llamadas no ejecutadas termina en `args_invalid` y `tool_rejected`. Si es baja, la ganancia es marginal.

## 2.3 Presupuesto global por tarea

- **Problema:** los límites son contadores locales (15 pasos, 8 llamadas por paso, 2 replans, 2 escalaciones). No hay tope de tiempo total, de consultas a modelos ni de tokens por tarea. El peor caso es multiplicativo y, con modelos locales, puede ser de horas.
- **Propuesta:** un presupuesto global por tarea, con tope de consultas a modelos y de tiempo, que cierre con un motivo nuevo en la lista cerrada. Mitiga el riesgo de la propuesta 1.2, por lo que conviene implementarlas juntas.

## 2.4 Quitar D1 en deliberativo y unificar `ask_user`

- **Problema:** en deliberativo, D1 ofrece solo la ruta fija del paso y `ask_user` (CORE_FLOW §4.2), así que el modelo se consulta en cada iteración para casi siempre elegir la ruta. Además `ask_user` ya tiene otras dos puertas: D2 e `info_missing` de D3 (§5, §6). Son tres accesos a lo mismo.
- **Propuesta:** en deliberativo, ir directo a D2 con `ask_user` como opción. D1 queda solo en reactivo, donde la elección de ruta es necesaria.
- **Ganancia:** una consulta menos por iteración de llamada. Sin riesgo de diseño, solo ajustar el flujo del paso.

## 2.5 Validación determinista del plan antes de confirmar

- **Problema:** un plan deliberativo se genera, se muestra al usuario y se confirma, y recién al ejecutarlo se descubre que una ruta no tiene herramientas utilizables (`no_tools`) o no es válida. Ese fallo gasta una escalación hacia un replan, con las dos oportunidades limitadas que hay.
- **Propuesta:** un chequeo barato, sin modelos, entre la generación del plan y la confirmación humana:
  - ¿Cada ruta existe en el catálogo?
  - ¿Tiene al menos una herramienta utilizable?
  - ¿Se respeta el tope de pasos?

  Si falla, reintentar la generación una vez con el motivo, igual que ya hace el planificador con planes inválidos.
- **Ganancia:** menos replans malgastados y menos confirmaciones de planes que nunca podrían ejecutarse.
- **Verificar antes:** cuánto de lo documentado como "plan inválido" ya cubre esto. El documento solo dice "plan inválido tras reintento", sin definir qué lo hace inválido.

## 2.6 Puente del modo reactivo al deliberativo al agotar las escalaciones

- **Problema:** en reactivo, la tercera escalación cierra con `no_alternatives`, aunque la tarea podría ser descomponible. Es el único punto donde el sistema se rinde sin intentar un cambio de estrategia, mientras el modo deliberativo tiene replan autónomo.
- **Propuesta:** en vez de cerrar, generar un plan con trigger `step_failure` (tipo que ya existe en el esquema de plans) y continuar en modo deliberativo sin pedir confirmación, con lo ya hecho a la vista.
- **Ganancia:** rescata tareas que hoy terminan en `partial`. Es la mejora de mayor impacto potencial en tasa de éxito, pero la más cara.
- **Riesgo:**
  - Es la única propuesta que cambia las semánticas centrales.
  - Mezcla un contexto sin plan con pasos que sí lo tienen (`planId` es `null` en reactivo).
  - Obliga a decidir qué hace el cierre deliberativo con pasos reactivos previos.
  - Rompe la limpieza de "un modo por tarea".
  - No hay evidencia de que las tareas fallidas sean descomponibles. Si se resuelve antes el criterio de verificación y cierre (2.1), esta propuesta puede resultar innecesaria.
- **Verificar antes:** considerarla solo si la traza muestra muchos `no_alternatives` donde un plan habría funcionado.

## 2.7 Persistencia de tareas y timeouts de espera de usuario

- **Situación:** todo es volátil (sin restauración tras reinicio, máximo 20 tareas retenidas, la traza no se vuelve a leer). Una tarea en curso se pierde al reiniciar, y una deliberativa con confirmaciones humanas pendientes también. Es una decisión deliberada y coherente con "reiniciar limpio". Solo importa si JARVIS se usa para tareas largas.
- **Propuestas opcionales:**
  - Persistencia y restauración de tareas. La complejidad es alta (serialización, reanudación segura de efectos parciales) y no hay evidencia de necesidad. Es distinta de la persistencia incremental de la traza (1.12), que no implica restauración.
  - Timeout para tareas en espera del usuario. Hoy solo se cancela la más antigua al exceder 20, por lo que pueden acumularse tareas bloqueadas.
