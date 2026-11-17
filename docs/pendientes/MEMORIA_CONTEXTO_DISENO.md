# Diseño: contexto por eventos y memoria externa (v1)

> **Solo diseño. No hay nada implementado.** La implementación queda a cargo del agente. Este es el único documento de diseño de la memoria.

Documentos relacionados: `../arquitectura/CONTEXT_AND_MEMORY.md` (§1, §3, §4, §6, §7, §10), `../evaluacion/analisis/FRENTE_1_MEMORIA.md` (mediciones), `PENDIENTES_CODIGO.md` y `PENDIENTES_EVAL.md`.

---

## 1. Objetivo

1. Que el contexto de una tarea sea una **secuencia de eventos persistida** de la que se reconstruye el estado: auditable, reproducible y recuperable tras un reinicio.
2. Que lo que Jarvis trae de afuera (hechos del usuario y continuidad con la tarea anterior) entre al contexto por la misma puerta que todo lo demás, y quede en el log y en la traza.
3. Que el almacén de memoria sea un **paquete independiente** y que el contexto pueda crecer con capacidades nuevas sin tocar su núcleo.

## 2. Punto de partida

Verificado en `src/core/memory.ts`, `engine/services.ts` y `engine/callRunner.ts`.

- **Almacén:** `data/memory.json` (junto a `refsDir`, ignorado por git), con formato `[{ "key": "...", "value": "..." }]` o `{ "facts": [...] }`. Se edita a mano; no hay CRUD en HTTP, UI ni Telegram.
- **Lectura:** `createMemoryReader` relee el archivo solo si cambia su `mtimeMs`. Archivo ausente o inválido = memoria vacía, nunca un error de la tarea. Topes: 200 entradas, clave ≤ 80 caracteres, valor ≤ 300.
- **Matching** (`selectFacts`): por *stems* (`stemsOf` de `text.ts`: prefijo de 5 letras, sin palabras vacías). Un hecho coincide si **todas** las palabras distintivas de su clave aparecen en el texto. Orden del archivo, hasta `MAX_FACTS_PER_PROMPT = 3`. Sin modelos.
- **Inyección:** solo en `callRunner.ts` (paso 3), con el texto `request + instrucción del paso`. Los hechos entran como líneas `clave: valor` al prompt de argumentos y como fuentes válidas del pre-chequeo (`collectSources`). **No** entran a `pending`, `plan`, D3 ni a la respuesta final.
- **Hilo** (`engine/thread.ts`, guardado en `TaskManager.previous`): otra memoria, de RAM y 10 minutos (§7.4). A diferencia de los hechos, **sí** entra a la lista de pendientes (`pending`), a los argumentos (como líneas `previous request` / `previous answer`), a la respuesta final y al pre-chequeo. Llega por el motor (`env.follow.thread`), no por el contexto: hoy no queda en el log ni en `ctx`.
- **Retención actual** (`retention.ts`, `config.ts`): una sola pasada sobre refs **y trazas** (no existe log), 30 días y 500 MB en total entre ambas, y nunca borra las refs de una tarea retenida en RAM.
- **Guard** (`policy/guard.ts`, `engine/services.ts`): la regla B protege solo `refsDir` y solo para herramientas `FILE_WRITE`; no cubre `data/memory.json` (que vive en la carpeta padre de `refsDir`) ni `run_command`/`start_process`.
- **Contexto** (`ctx/apply.ts`): ids deterministas (`<prefijo><cantidad+1>`) y el instante sale de un reloj inyectado (`options.now`, una vez por `apply`). `apply` solo acepta `{op, target, value}`; no admite ids ni instantes de afuera.
- **Medido** (`evaluacion/analisis/FRENTE_1_MEMORIA.md`): con el hecho en el prompt, los argumentos pasan de 0/6 a 6/6; elegir por código acierta 14/14 y no contamina pedidos ajenos (0/8).

**Límites conocidos**
1. No hay forma cómoda de crear, ver o borrar hechos.
2. El matching es estricto: sinónimos, plurales irregulares o una clave de una palabra con otra raíz no coinciden.
3. Claves que comparten palabras (`carpeta jarvis`, `carpeta jarvis backup`) compiten por los 3 cupos, sin prioridad por especificidad.
4. Los hechos no llegan a `pending` ni a `plan`: si D0 divide el pedido en pasos, la ruta personal solo se resuelve al generar los argumentos.
5. Nada se aprende solo, a propósito: solo entra lo que escribió el usuario.

## 3. Criterios de diseño

1. **Latencia mínima:** preferir diseños sin modelos extra. Los 8 GB de VRAM ya los ocupan `d3` y el modelo generativo; lo determinista cuesta microsegundos.
2. **Cero tokens sin coincidencia:** sin aportes no cambia ningún token del prompt.
3. **Nunca texto generado por un modelo guardado como hecho**, salvo confirmación explícita del usuario.

## 4. Decisiones tomadas

| # | Decisión | Consecuencia |
|---|---|---|
| 1 | Jarvis no corre en paralelo y su contexto es solo suyo. Otros agentes futuros tendrán contexto propio; Jarvis siempre recibe **una respuesta** al terminar | Un solo escritor por log, sin control de concurrencia. Un agente hijo será para Jarvis una llamada con una respuesta |
| 2 | Event sourcing como base del contexto | §5 y §6 |
| 3 | Instrucciones intermedias, trabajos en segundo plano, memoria a largo plazo, CRUD de hechos y «recordá que…» entran en v2 | §11. El log de v1 es aditivo, así que v2 no obliga a migrar |
| 4 | El log es obligatorio y cada registro se escribe apenas ocurre | §5. La política de reinicio depende de él, y diferir la escritura podría perder un efecto |
| 5 | La retención de logs y refs combina antigüedad máxima (10 días) y tamaño máximo (100 MB) | §5 |
| 6 | Sin CRUD en v1: los hechos se editan a mano en el archivo, desde la PC | El puerto solo expone `recall` (§7.1) |
| 7 | La confianza de un aporte se deriva de su fuente; no se guarda por entrada | Registro de fuentes en el core (§7.2) |
| 8 | Una tarea cortada por un reinicio se cierra con el motivo `restart` y un texto fijo | §6 |
| 9 | Las herramientas de Jarvis no pueden escribir en el archivo de memoria ni en el log: Guard lo deniega | §9 |
| 10 | Retención: 10 días para refs y trazas, 30 para el log; tope de 250 MB compartido entre refs, trazas y log | §5 |
| 11 | Si un modelo (LLM o decisión) no está disponible, la tarea **se pausa** y reintenta hasta un tope (10 min); vencido el tope, cierra como hoy. No hay degradación silenciosa | §6.1 |
| 12 | Tras un reinicio se avisa por Telegram de las tareas cortadas (si Telegram está activo) | §6 |
| 13 | En v1 `recalled` se lee en `forArgs` y `forFinal`; `pending` y `plan` quedan para después del eval | §8 |

## 5. Registro de eventos

- **Alcance:** un log por tarea, append-only. Cada `apply` exitoso (`CONTEXT_AND_MEMORY.md` §1) produce un registro: versión `n`, operaciones normalizadas e instante. Hoy ese contenido ya se emite como evento `change`; el cambio es persistirlo y tratarlo como fuente.
- **Contexto = pliegue del log.** El snapshot (`v: 1`) pasa a ser un punto de control opcional para acelerar la carga.
- **Qué entra:** solo lo que pasa por `apply`.
- **Qué no entra:** las entradas y salidas crudas de los modelos (siguen en la traza, con la lista blanca actual) ni los resultados voluminosos (siguen en refs; el log guarda su id).
- **Log ≠ traza.** La traza (`trace/recorder.ts`) es de consumo externo y el backend nunca la lee. El log lo lee el backend, así que vive aparte.
- **Integridad:** un registro por lote, escrito de forma atómica; un último registro incompleto se descarta al leer. Un registro inválido en cualquier otro punto hace que la tarea se marque como ilegible: no se carga y el archivo se conserva para inspeccionarlo (cargar solo hasta el punto roto podría ocultar efectos posteriores). Al reproducir, cada registro pasa por la misma validación de `apply`.
- **Versionado:** el log declara la versión de su esquema; los logs viejos se convierten al esquema vigente al reproducirlos. Un cambio aditivo mantiene válidos los logs anteriores.
- **Durabilidad:** el log siempre está activo y cada registro se escribe apenas ocurre, sin diferirlo. El costo es mínimo frente a una llamada al modelo y evita perder un efecto.
- **Retención** (log, refs y trazas, una sola pasada, `retention.ts`): refs y trazas, **10 días**; log, **30 días** (es liviano y permite consultar el historial). Tope de tamaño **compartido de 250 MB** entre las tres carpetas: al excederse se borra lo más antiguo primero. Reemplaza los valores por defecto actuales (30 días y 500 MB). Nunca borra el log ni las refs de una tarea retenida en memoria, como hoy, por eso el tope puede superarse mientras esas tareas existan. El log se borra solo si la tarea ya es terminal. Hay que agregar el patrón de nombre del log a `retention.ts` (solo se borran carpetas o archivos con el nombre que Jarvis les da).

## 6. Reinicio y restauración

- **La RAM pasa a ser caché.** Hoy se retienen 20 tareas y no hay restauración (§6 de `CONTEXT_AND_MEMORY.md`). Una tarea expulsada o anterior a un reinicio se reconstruye bajo demanda para consultar su historial.
- **Arranque:** las 20 tareas más recientes se reproducen completas; las demás, si están cerradas y con respuesta, se listan leyendo solo la cabecera y los dos últimos registros (`result` solo se escribe tras el `finish`). Un log con la cola cortada se repara (se quita el registro incompleto) antes de volver a escribir en él.
- **Una tarea no terminal no se reanuda.** Tenía llamadas en vuelo y posibles efectos. Al arrancar se cierra como interrumpida por reinicio, con el motivo `restart` y el texto fijo «El servidor se reinició mientras la tarea corría», y conserva visibles sus efectos y posibles efectos. Si Telegram está activo, se envía un mensaje por cada tarea cortada (incluidas las que esperaban una aprobación o una respuesta), para que el usuario no siga esperando algo que ya no existe. El estado terminal sale de `terminalStateFor`, igual que `unrecoverable`: `partial` si hubo efectos, `failed` si no. `restart` se agrega a `STOP_REASONS`, a `STOP_REASON_NOTES` de las vistas y al aviso de Telegram.
- **Refs:** si la retención borró un archivo, la ref queda ilegible y el pre-chequeo la cuenta como fuente incompleta (`complete = false`, no rechaza) y la API de depuración informa que no se puede leer. (`refs_unresolved` ya no existe.)
- **Memoria:** lo recordado está en el log, así que editar `data/memory.json` no altera tareas pasadas.

### 6.1 Pausa cuando un modelo no está disponible

Sin LLM o sin modelo de decisión Jarvis no puede avanzar: los pasos que hoy degradan (D0, continuación, respuesta final con plantilla) solo posponen el fallo, y pueden dejarlo después de ejecutar efectos. Por eso **todo fallo de disponibilidad se trata igual: pausar y reintentar**.

- **Dónde:** en `queryModel` (`failures.ts`), por donde pasan todas las consultas a modelos (D0, continuación, pendientes, plan, argumentos, verificación, D5). Si el fallo es `unavailable`, no devuelve el fallo: espera y repite **la misma consulta**, con reintentos espaciados (propuesta: de 2 s a 30 s), hasta que responda, venza el tope o el usuario cancele (la señal de cancelación existente corta la espera).
- **Tope:** 10 minutos de pausa acumulada por consulta, configurable. Vencido, el comportamiento es el de hoy: `service_unavailable` en el paso (si hay paso), cierre `unrecoverable` y, si el LLM era el caído, respuesta de reserva (`forFallback`).
- **Qué se pausa:** conexión rechazada, timeout y HTTP de error. **No se pausa** (cierra de inmediato, como hoy): URL no configurada y desborde de contexto, porque esperar no los arregla. Una respuesta inválida sigue con su reintento propio. En D0, la consulta de continuación y D5 (atajos que se pueden omitir), una respuesta **inválida o un desborde** no es un modelo caído: la tarea sigue por el flujo de siempre (sin clasificación, sin hilo, o con la confirmación del LLM). Solo «no disponible», agotada la pausa, cierra.
- **Seguridad del punto de pausa:** es *entre* consultas, con el estado ya aplicado; se reintenta la consulta y no se rehace nada, así que no hay riesgo de duplicar efectos.
- **Contexto y log:** la pausa es estado de ejecución, no pasa por `apply` y no entra al log ni a `recalled`. Sí queda en la traza. Si el servidor se reinicia durante la pausa, la tarea cierra con `restart` (§6).
- **Visibilidad mínima:** un campo `paused` (desde cuándo y qué modelo) en el DTO de la tarea y un evento al pausar y al retomar; un banner en la UI; un mensaje de Telegram al pausar y otro al retomar o rendirse. Sin más acciones del usuario que cancelar.
- **Fuera de v1:** reanudar tareas cortadas o terminadas por falta de modelos (§11).

## 7. Memoria externa

### 7.1 Almacén independiente

Es dueño de su formato, matching y topes. No conoce `TaskContext`. Contrato mínimo en v1:

```ts
interface MemoryProvider {
  recall(text: string, limit?: number): Recalled[]   // determinista, sin modelos
}
type Recalled = { key: string; value: string }
```

- En v1 el puerto solo expone `recall`. Sin CRUD, los hechos se editan a mano en el archivo, desde la PC; cuando llegue el CRUD (v2) se agregan `list`, `put` y `remove` sin cambiar el core.
- El matching mejorado vive dentro del paquete (§10).
- `memory.ts` debe dejar de depender de `stemsOf` de `text.ts`; esa función viaja con el paquete.
- Firma asíncrona propuesta aunque la implementación sea inmediata, para que otro backend no obligue a cambiar el core.

### 7.2 Sección `recalled` del contexto

```jsonc
"recalled": [{
  "id": "m1",
  "at": number,
  "stepId": string | null,                // null = al iniciar la tarea
  "source": "user_memory" | "thread",
  "key": string,                          // "carpeta jarvis" | "previous_request" | "previous_answer"
  "value": string,
  "from": string | null                   // auditoría: tarea de origen (hilo)
}]
```

- Solo agrega, sin duplicar fuente y clave; los valores quedan congelados durante la tarea.
- Es distinta de `facts` (`process`, `answer_*`), que es lo que la tarea va aprendiendo.
- **Registro de fuentes en el core:** una tabla por `source` con su nivel de confianza, las vistas donde se muestra, su tope y si puede ser fuente del pre-chequeo. El core conoce las fuentes por configuración. La confianza **no se guarda por entrada: se deriva de `source`** con esta tabla. Así la política se cambia en un solo lugar, un proveedor no puede declararse más confiable de lo que es y una fuente nueva (v2) es una fila más. El log no guarda la política vigente en cada momento; los efectos de la tarea quedan en `calls`.
- Los topes actuales (clave ≤ 80, valor ≤ 300, hasta 3 hechos por prompt) se validan por esquema y vista, sin recortar (regla 7 de `apply`).

### 7.3 Cuándo se escribe

1. **Al iniciar la tarea:** hechos que coinciden con el `request` y el hilo, si la consulta `follow` a `d3` dice que continúa.
2. **En cada paso:** nuevo `recall` con el texto del paso; solo se agregan los aportes nuevos.

Así la ruta personal está en el contexto desde el primer paso y deja de resolverse solo al generar argumentos (límite 4).

### 7.4 El hilo

Es la memoria de la **tarea anterior** (`engine/thread.ts`): la última tarea `completed` con respuesta del modelo, con su pedido y 500 caracteres de la respuesta, en RAM durante 10 minutos. Es otra fuente de `recalled`:

- Su contenido **se copia** al log; reproducir una tarea no puede depender de que la anterior exista. `from` guarda el vínculo para auditoría.
- La decisión de si continúa sigue siendo del motor (consulta `noul` a `d3`, `follow`, umbral 0,3); al contexto solo entra el resultado.
- Se decide una sola vez, al iniciar, cuando `detectContinuation` responde que continúa, y se escribe como dos entradas: `previous_request` y `previous_answer`, con `from`.
- **Si el modelo de decisión no está disponible** al consultar la continuación, rige la pausa de §6.1 (no se sigue sin hilo). Hoy `classify.ts` avisa por consola y sigue; eso cambia, igual que con D0.

## 8. Vistas

- En v1 leen `recalled` solo `forArgs` y `forFinal` (el hilo ya llega a esos dos prompts hoy, §2). `forPlan` y `forPending` leen `recalled` solo cuando se habilite cada una, con eval. El pre-chequeo sigue sin cambios. El bloque `MEMORY` se arma desde ahí y `collectSources` (pre-chequeo) lee de la misma sección.
- **Escribir y mostrar son decisiones separadas.** Mostrar hechos en `pending` y `plan` suma tokens a prompts de 2B y ya hubo regresiones en `pending` (`PENDING_FACTS_LOOKUP`), así que cada vista se habilita por separado, con eval.
- `recalled` necesita su tope en `caps` de `budget.ts`.
- **Orden del prompt (optimización posterior):** si el servidor de modelos reutiliza el prefijo del prompt, conviene poner el bloque `MEMORY` en la parte estable y lo que cambia por paso al final. Falta medir si el servidor lo hace y cuánto ahorra con el modelo de 2B; si no lo hace, el orden da lo mismo.

## 9. Invariantes

Siguen vigentes los de `CONTEXT_AND_MEMORY.md` §7, con estas precisiones y tres nuevos:

1. **Escritura solo por el motor**, por `apply`, incluidos los aportes de proveedores.
2. **Sin prosa nueva de un modelo.** Los aportes son texto escrito por el usuario o una respuesta final ya mostrada, marcada con su origen. Redacción sugerida: «Lo que un modelo razona o justifica solo viaja en eventos y trazas; las respuestas finales ya mostradas al usuario se guardan marcadas con su origen».
3. **Efectos permanentes:** `calls` nunca se borra; ni un replan ni un reinicio ocultan efectos o posibles efectos.
4. **Aislamiento por tarea:** un log por tarea; las refs se resuelven solo contra la tarea activa.
5. **Estado terminal cerrado:** tras el registro terminal, el log no admite escrituras.
6. **Pliegue puro (nuevo):** el mismo log produce siempre el mismo contexto. Los ids salen de la cantidad de elementos y el instante `at` viene en cada registro (la reproducción usa un reloj que lo devuelve), no del reloj real.
7. **Reconstruir no ejecuta (nuevo):** reproducir un log no llama a modelos, herramientas ni al almacén de memoria.
8. **Memoria, log y proyecto protegidos (nuevo):** las herramientas de Jarvis no pueden escribir en `data/memory.json`, en la carpeta del log ni dentro de la carpeta del proyecto de Jarvis. Guard deniega esas escrituras, como hoy con `refsDir` (`CONTEXT_AND_MEMORY.md` §5), y la denegación vale también para `run_command` y `start_process` cuando el comando no es de solo lectura y nombra esas rutas. Ninguna de estas rutas se puede aprobar. Las demás carpetas se rigen por `allowedDirectories`: las aprueba el usuario y la aprobación queda guardada para no volver a preguntar. Así no entra a la memoria nada que no haya escrito el usuario y el log no se altera desde las tareas.

## 10. Alcance de v1 y orden de trabajo

1. **Log de eventos:** formato, versionado, persistencia y reproducción, con pruebas de que el pliegue reconstruye un contexto idéntico.
2. **Política de reinicio:** tareas no terminales cerradas como interrumpidas.
3. **Puerto `MemoryProvider` y sección `recalled`;** mover `memory.ts` al paquete.
4. **Matching mejorado,** dentro del paquete (límites 2 y 3): alias por hecho (`"aliases": ["mi repo", "proyecto"]`), prioridad por cantidad de stems de la clave (más específica primero) y stemming mínimo de plurales. Hay que re-medir la contaminación de pedidos ajenos.
5. **Habilitar vistas con referencias** (`pending`, `plan`), una por una, con eval (límite 4).

6. **Pausa por modelo no disponible** (§6.1): paso independiente y final; si se complica, se saca sin afectar a los anteriores.

Fuera de alcance de v1: el CRUD de hechos (límite 1), que pasa a v2; los hechos se siguen editando a mano en `data/memory.json`, desde la PC.

Descartada: recuperación semántica con embeddings. Exige un modelo extra (VRAM y latencia) y contradice el criterio 1, salvo que el matching léxico resulte insuficiente con datos reales.
Al implementar hay que actualizar `CONTEXT_AND_MEMORY.md`: §1 (esquema), §6 (hoy dice «sin restauración»), §7 (invariantes) y §10 (hoy dice que la memoria entra «por el motor, no por `apply`», y deja de ser así; además enlaza al plan anterior, que debe apuntar a este documento).

## 11. Queda para v2

- Instrucciones intermedias a una tarea en curso (`inbox`, con canal explícito).
- Trabajos en segundo plano con aviso de fin.
- Interrupción de llamadas en vuelo.
- Memoria a largo plazo (acumulación, propuestas del sistema confirmadas por el usuario, `scope`, compactación).
- CRUD de hechos (endpoints, pantalla en la UI y comando de Telegram), incluida su convivencia con la edición manual del archivo.
- «Recordá que…» con confirmación.
- Decidir si `answer_*` y las instrucciones dadas al rechazar una operación se unifican con el `inbox`.
- Decidir si se reanudan las tareas interrumpidas por un reinicio o cerradas por falta de modelos (volver a correrlas sin duplicar efectos).
- Futuro, sin versión asignada: agentes con contexto propio y en paralelo.

## 12. Decisiones cerradas y detalles para quien implementa

### 12.1 Cerrado (no reabrir sin motivo)

**Log**
- **Contenido del registro:** las operaciones tal como entraron a `apply` (no las normalizadas: `apply` rechaza `id` y `at` de afuera), más `at` y `meta`. Reproducir = re-aplicar cada lote con un reloj que devuelve el `at` del registro. Los ids salen de la cantidad de elementos, así que coinciden solos.
- **Cabecera:** primer registro con `id`, `mode`, `request`, `startedAt`, la versión del esquema del log y los límites vigentes (`ContextLimits`). Al reproducir se usan los límites de la cabecera, no los actuales: subir un tope no debe dejar ilegibles tareas viejas.
- **Ubicación:** `data/tasks/<id>.jsonl`, derivada de la carpeta padre de `refsDir` (como `memory.json`). Se agrega a `.gitignore` (hoy solo están `data/refs/` y `data/memory.json`).
- **Versión del esquema:** va en la cabecera; la conversión de logs viejos vive en el módulo del log.
- **Traza:** sigue independiente del log (§5).
- **Alcance del tope y de los días:** §5.

**Reinicio:** §6 (motivo `restart`, estado por `terminalStateFor`, aviso por Telegram).

**Pausa por modelo no disponible:** §6.1 (tope de 10 min, qué casos no se pausan, visibilidad mínima).

**Memoria**
- Hilo: dos entradas con `from`, escritas una vez al iniciar (§7.4). Un modelo de decisión caído pausa la tarea (§6.1).
- Lectura en v1: `forArgs` y `forFinal` (§8).
- Un hecho de memoria sigue siendo fuente válida del pre-chequeo en v1: sin CRUD solo lo edita quien tiene acceso a la PC. Se revisa cuando llegue el CRUD (v2).

**Seguridad:** invariante 8 (§9). Incluye `run_command` y `start_process`, y la carpeta del proyecto.

### 12.2 A criterio de quien implementa (sin decisión de producto)

- Nombre final de la sección (`recalled` es provisorio).
- Tope de aportes por tarea y por vista (empezar con los topes actuales: 3 hechos por prompt, clave ≤ 80, valor ≤ 300).
- Qué texto se usa para `recall` en cada paso (hoy: pedido más instrucción; mantenerlo salvo que la medición diga otra cosa).
- Prioridad cuando varias claves compiten por los 3 cupos: más específica primero (§10, paso 4).
- Firma asíncrona del puerto y si hace falta `scope` desde v1 (propuesta: asíncrona; `scope` no).
- Cómo detectar en `run_command` que un comando nombra una ruta protegida (analizador existente de `commandRules.ts` y `readOnly.ts`), y cómo se resuelven las rutas relativas.
- Valores exactos de la espera entre reintentos de la pausa y nombre del evento y del campo `paused`.
- Cómo se detecta al arrancar una tarea no terminal (último registro del log no terminal) y cómo se expone una tarea ilegible.

### 12.3 Medición (después, con el eval)

- Qué casos re-medir al habilitar `pending` y `plan`, y tras el matching mejorado. Criterio de aceptación: no empeorar el 14/14 de selección ni la contaminación de pedidos ajenos (hoy 0/8).
- Orden del prompt para reutilizar el prefijo (§8): medir antes de cambiar nada.

### 12.4 Pendiente para v2

- Si un hecho puede ser fuente válida del pre-chequeo cuando lo escribe otro proceso local sin autenticación. Vuelve a pesar con el CRUD.
