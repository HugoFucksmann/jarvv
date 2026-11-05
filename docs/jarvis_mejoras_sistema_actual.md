# JARVIS: mejoras del sistema actual

Optimizaciones, correcciones y ajustes sobre los mecanismos y componentes que ya existen. Las propuestas están ordenadas por prioridad.

**Abreviaturas:** D1 = decisión de ruta, D2 = decisión de herramienta, D3 = revisión de argumentos, D4 = verificación del resultado.

---

## 1. Criterio de verificación de D4 en modo reactivo

- **Problema:** `cumple` se evalúa contra el paso (deliberativo) o contra la solicitud completa (reactivo) (CORE_FLOW §7). En reactivo no hay `expected` ni `instruction` por paso, así que una llamada intermedia legítima (listar una carpeta para luego leer un archivo, buscar antes de leer) tendría que "cumplir" la solicitud entera para quedar aprobada. Si no lo hace, queda como intento rechazado (`not_accomplished`) y el paso sigue gastando llamadas. Como `canFinish` exige al menos una llamada aprobada, el progreso real y el reconocido pueden divergir. Es una inferencia de las reglas documentadas. El diseño actual funciona bien para tareas de una acción y mal para tareas encadenadas.
- **Condición:** solo es un problema si la pregunta `cumple` de D4 está redactada literalmente así. Si ya pregunta algo como "¿aporta al objetivo?", no hay problema. Revisar primero el prompt de D4 reactivo.
- **Propuesta:** separar la pregunta según el modo. En reactivo, D4 verificaría `ok` más "pertinencia" (¿es relevante y útil para la solicitud?). La decisión de si la tarea está completa quedaría en D1 con la opción `fin`, que ya existe. Así cada decisión hace una sola cosa.
- **Ganancia:** menos falsos rechazos en tareas multi-salto, que son las más costosas en tiempo.
- **Costo:** muy bajo (un prompt). Confirma o descarta la hipótesis en minutos.
- **Nota:** existe una variante más estructural del mismo problema (verificación en dos niveles y pasos multi-llamada), incluida en el documento de implementaciones futuras.

## 2. Medir y calibrar las decisiones con la traza

- **Problema:** D4 aprueba si `ok` y `cumple` superan 0.5 (CORE_FLOW §7). Es el único filtro entre "una llamada se ejecutó" y "el paso está hecho", con un umbral fijo sin calibración documentada sobre un modelo local. D3 puede descartar herramientas (`tool_rejected`, `info_missing`), con el anti-bucle como único freno. Esto puede producir falsos positivos (pasos "completados" sin cumplir el objetivo) o falsos negativos que consumen el tope de 8 llamadas y disparan escalaciones o replans. No hay ninguna medición documentada de la precisión de estas decisiones.
- **Propuesta:** aprovechar la traza, que se escribe pero nunca se lee y ya registra cada consulta con su etapa, entrada y salida. Instrumentarla para medir:
  1. Fracción de llamadas no ejecutadas que terminan en `args_invalid` y `tool_rejected`.
  2. Qué atrapa D3 en lecturas.
  3. Cuántas tareas terminan en `no_alternatives`.
  4. Cuántas veces cada etapa (D3, D4) cambió el resultado. Una etapa que casi nunca rechaza algo útil es candidata a volverse condicional.
  5. Si los `security_denied` provienen de errores del modelo o de ataques.
- **Valor:** permite decidir con datos sobre varias de las propuestas de este documento y del de implementaciones futuras. Es barato y no toca el motor.
- **Verificar antes:** qué mide ya el laboratorio de evaluación externo. Si ya mide las Decisiones 1-4, la propuesta es menor de lo que parece.

## 3. Resiliencia ante fallos de modelo y de infraestructura

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
- **Riesgo:** un fallo que antes cerraba rápido ahora gasta más intentos. Conviene acompañarla de un presupuesto global por tarea (ver documento de implementaciones futuras).

## 4. Minibucle de reparación de argumentos en `runCall`

- **Problema:** cuando D3 devuelve `args_invalid`, o la generación de argumentos falla tras su reintento, la llamada vuelve al inicio del paso. Eso repite D1 y D2, que ya habían decidido bien (solo fallaron los argumentos), y consume uno de los 8 cupos de llamadas del paso. Una llamada completa puede encadenar hasta cinco consultas a modelos en serie, y con modelos locales de contexto chico el costo dominante es el número de saltos y reintentos.
- **Propuesta:** un lazo corto entre las fases 3 y 7. Si el fallo es de argumentos, se regeneran con el motivo (texto fijo, como exige el invariante §7.2) manteniendo la herramienta elegida, con un tope propio de 1 o 2 vueltas. Solo si se agota se registra la llamada fallida y se sale al inicio del paso.
- **Ganancia:** ahorra 2 consultas de decisión por fallo de argumentos y protege el cupo de 8 llamadas. Probablemente sea el cambio con mejor relación beneficio/costo.
- **Costo y riesgo:** es el único que toca la semántica "una llamada se registra una sola vez, al terminar el intento". El lazo debe ser interno a un intento, de modo que el contexto no vea las vueltas intermedias. `info_missing` no entra en el lazo, porque ahí falta información y regenerar no lo arregla.
- **Verificar antes:** medir qué fracción de las llamadas no ejecutadas termina en `args_invalid` y `tool_rejected`. Si es baja, la ganancia es marginal.

## 5. Política de pipeline por herramienta y atajos deterministas (D2, D3, D4)

- **Problema:** toda llamada pasa por el mismo pipeline pesado. Una llamada exitosa cuesta cuatro consultas al modelo de decisión (D1, D2, D3, D4, esta última con dos preguntas) más una generación de argumentos, y cada fallo vuelve al inicio del paso y repite casi todo (CORE_FLOW §4, §5). No hay diferencia de costo entre leer un archivo, escribir en disco o reintentar un timeout. Con modelos locales (contexto de 16k, timeouts de 30 s y 120 s), cada consulta innecesaria se paga en latencia.
- **Propuesta:** reducir etapas donde su valor es bajo, con una política expresada en el manifest del catálogo (que ya es la única fuente de políticas y distingue `read` de `write`), o bien como recortes fijos aplicados de uno en uno:

| Recorte | Descripción | Salvedad |
|---|---|---|
| **D4 con resultado ya conocido** | El procesador de resultados calcula el estado (`no_data`, `not_found`) de forma determinista antes de consultar. Si el estado ya indica que no hay datos, omitir la pregunta `ok` y dejar solo `cumple`. Hoy solo `tool_error` y `exception` se rechazan sin consultar (§7). | No rechazar automáticamente `not_found`: puede ser justo la respuesta buscada ("¿existe este archivo?"). La política debe ser por herramienta o tipo de pregunta, no global. |
| **D3 asimétrica según `kind`** | Revisar siempre en escrituras y en operaciones que Guard marcó como sensibles. Opcional o ninguna en lecturas (idempotentes, con esquema validado y ya filtradas por Guard): el error es barato, D4 lo atrapa después y el anti-bucle impide repetirlo. Elimina una consulta en la mayoría de las llamadas de exploración y evita los bucles que D3 puede crear (`tool_rejected`, `info_missing` vuelven al inicio y consumen el tope de 8). | Es el recorte más agresivo: los errores de argumentos se descubren después de ejecutar. Medir antes cuánto atrapa D3 en lecturas. |
| **D2 con una sola herramienta** | CORE_FLOW §4 documenta el atajo "una sola opción, no se consulta" para D1. Aplicarlo también a D2. | Confirmar si D2 ya lo aplica. |

- **Alternativas:** eliminar etapas globalmente (más simple, pero pierde la protección en escrituras); cascada con verificación barata primero y modelo después (añade un tercer mecanismo).
- **Riesgo:** cada atajo o flag desplaza trabajo de los modelos a reglas fijas, que fallan en los casos no previstos, y cada flag nuevo en el manifest es una combinación más para probar. Aplicar de a uno y medir.

## 6. Reintento automático de lecturas ante fallos transitorios

- **Problema:** los fallos de transporte a modelos se reintentan una vez, pero los de herramientas no. Un timeout de lectura dispara el pipeline completo. Además, el anti-bucle puede bloquear la repetición idéntica porque `tool_error` cuenta como "ejecutada"; si el bloqueo aplica al reintento, la única salida es variar los argumentos artificialmente (deducción de las reglas documentadas, no comportamiento observado).
- **Propuesta:** reintento automático solo para lecturas, nunca para escrituras. Evita cuatro consultas por falla transitoria.

## 7. Revisión del presupuesto de contexto

- **Problema:** varios elementos interactúan y son el origen probable de los cierres `unrecoverable` en tareas largas:
  - Contexto de 16 384 tokens para ambos modelos (CORE_FLOW §10): poco margen para prompts con 12 000 caracteres solo de efectos, más plan, historial y refs.
  - Estimación de 3 caracteres/token (CONTEXT §4): heurística que, para español, código o rutas, puede subestimar o sobreestimar. El riesgo es rechazar llamadas válidas o desbordar el contexto real.
  - Los efectos y posibles efectos comparten una reserva de 12 000 caracteres y nunca se recortan; si no caben, la tarea cierra `unrecoverable` (CONTEXT §4). Es un acantilado, no una degradación: una tarea con muchas escrituras exitosas se cortaría justo cuando más ha avanzado (si ya hubo efectos queda `partial`).
- **Propuesta:** revisar el presupuesto de contexto (tamaño de 16 384 tokens, estimación de 3 car/token, reserva de efectos).
- **Verificar antes:** medir antes de cambiar.

## 8. Quitar D1 en deliberativo y unificar `ask_user`

- **Problema:** en deliberativo, D1 ofrece solo la ruta fija del paso y `ask_user` (CORE_FLOW §4.2), así que el modelo se consulta en cada iteración para casi siempre elegir la ruta. Además `ask_user` ya tiene otras dos puertas: D2 e `info_missing` de D3 (§5, §6). Son tres accesos a lo mismo.
- **Propuesta:** en deliberativo, ir directo a D2 con `ask_user` como opción. D1 queda solo en reactivo, donde la elección de ruta es necesaria.
- **Ganancia:** una consulta menos por iteración de llamada. Sin riesgo de diseño, solo ajustar el flujo del paso.

## 9. Validación determinista del plan antes de confirmar

- **Problema:** un plan deliberativo se genera, se muestra al usuario y se confirma, y recién al ejecutarlo se descubre que una ruta no tiene herramientas utilizables (`no_tools`) o no es válida. Ese fallo gasta una escalación hacia un replan, con las dos oportunidades limitadas que hay.
- **Propuesta:** un chequeo barato, sin modelos, entre la generación del plan y la confirmación humana:
  - ¿Cada ruta existe en el catálogo?
  - ¿Tiene al menos una herramienta utilizable?
  - ¿Se respeta el tope de pasos?

  Si falla, reintentar la generación una vez con el motivo, igual que ya hace el planificador con planes inválidos.
- **Ganancia:** menos replans malgastados y menos confirmaciones de planes que nunca podrían ejecutarse.
- **Verificar antes:** cuánto de lo documentado como "plan inválido" ya cubre esto. El documento solo dice "plan inválido tras reintento", sin definir qué lo hace inválido.

## 10. Retroalimentación enriquecida tras un rechazo

- **Problema:** tras un rechazo, el modelo ve solo `no_usable_data` o `not_accomplished`, más el estado de la llamada. Las claves cerradas protegen contra inyección, pero pierden información útil.
- **Propuesta:** enriquecerla sin prosa de modelo, con datos derivados del propio contexto: cuántas veces se intentó la misma ruta con resultados vacíos, qué argumentos ya se probaron.

## 11. Anti-bucle más robusto

- **Problema:**
  - Variaciones leves: en reactivo solo hay 2 escalaciones y la herramienta fallida "no se bloquea" (CORE_FLOW §6). El anti-bucle solo detecta repeticiones idénticas, así que un modelo que varíe ligeramente los argumentos puede eludirlo sin progresar.
  - Ciclos: compara solo con "la última llamada ejecutada idéntica", por lo que un ciclo A-B-A-B de lecturas distintas no se detecta. Queda acotado por el tope de 8 llamadas, pero se paga entero.
- **Propuesta:**
  - Contemplar repeticiones "casi idénticas".
  - Comparar contra las llamadas del paso actual, o desde la última escritura (más robusto, barato y determinista).
- **Verificar antes:** confirmar con datos de traza.

## 12. Retención y limpieza de refs

- **Problema:** los archivos de refs nunca se borran (CONTEXT §5.2 y §8). Hay crecimiento ilimitado en disco y archivos huérfanos tras expulsar tareas o reiniciar. Pueden contener contenido sensible de lo leído, por lo que también es un tema de privacidad en disco.
- **Propuesta:** política de limpieza ligada a la expulsión de tareas.

## 13. Detección de fallos de configuración

- **Problema:** `qwenNumCtx` y `decisionMaxContext` se configuran a mano y "deben coincidir con el contexto real" (ARCHITECTURE §6). Una discrepancia produce fallos difíciles de diagnosticar, y nada documentado la detecta.
- **Propuesta:** un mecanismo de detección de la discrepancia entre contexto declarado y real, para evitar fallos silenciosos tras cambios de modelo.

## 14. Orden de las vistas para reutilizar caché

- **Propuesta:** cada consumidor recibe una vista distinta (§4). Si el servidor local reutiliza prefijos de prompt, poner primero lo estable (solicitud, plan, completados) y al final lo variable podría reducir latencia entre consultas consecutivas.
- **Verificar antes:** depende de cómo el endpoint de decisión maneja la caché. Medir antes de reordenar.

## 15. Revisión de Guard DENY (condicional)

- **Situación:** un DENY de Guard cierra toda la tarea. Es una decisión deliberada, fail-closed y defendible, sobre todo ante inyección vía contenido externo. Pero un modelo pequeño que propone un argumento mal formado mata una tarea larga.
- **Propuesta:** revisarlo solo si las trazas muestran que los `security_denied` vienen de errores del modelo y no de ataques. Si no, dejarlo como está.
