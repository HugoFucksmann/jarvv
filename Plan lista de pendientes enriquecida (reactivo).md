# Plan: lista de pendientes enriquecida (reactivo)

JARVIS · consulta `pending` del flujo reactivo · estado: decidido, pendiente de implementar

## 1. Punto de partida

- La consulta de pendientes **no** se ejecuta en cada paso. `runReactive` la llama al empezar, tras un paso `failed` y al vaciarse la lista. Entre medio el código promueve `pending.slice(1)`.
- Caso feliz hoy: 2 llamadas generativas por tarea (la inicial y la confirmación final).
- El modelo del pending es de 4B. Regenerar la lista completa en cada vuelta hacía que borrara ítems pendientes y re-agregara los cumplidos, por eso la lista la mantiene el código (`pendingList.ts`).
- Hoy `pending[0]` se convierte en `step.instruction` y `step.expected` es `null` en reactivo.

## 2. Decisiones tomadas

1. **Enriquecer todos los ítems** en la generación inicial. Una sola llamada, sin costo extra de consultas.
2. **Objeto general** que sirva para web, filesystem, terminal, etc.
3. **Eliminar la llamada generativa de confirmación final.** El cierre lo decide D4 con una tercera pregunta.
4. **Mantener la llamada de reescritura tras un fallo.**
5. **`goal` como pregunta solo cuando `kind = search`**; para el resto, `goal` imperativo.
6. **`kind` va primero en el schema** (el modelo escribe en orden, así ya decide el estilo del goal).
7. **`hints` viaja como texto dentro de `expected`**, sin cambios de esquema en `ctx`.
8. **Umbral de `request_done` más estricto que 0.6** (propuesta inicial: 0.75, a ajustar con trazas).
9. **Descartados:** campo `status` (el código ya resuelve la lista vacía con `canFinish()`), campo `needs`, y cualquier consulta LLM adicional.

## 3. Objeto de cada ítem

| Campo | Qué es | Quién lo consume |
| --- | --- | --- |
| `kind` | `search`, `read`, `write`, `execute` u `other`. Pista, no orden. | Solo la traza al principio. Luego D1/D2 si conviene. |
| `goal` | Qué obtener o cambiar. Pregunta si `kind = search`, acción en los demás. | `step.instruction` y `reconcileList` |
| `done_when` | Condición verificable sobre el resultado, no una acción. Describe la forma de la respuesta, no repite la pregunta. | `step.expected`, que lee D4 |
| `hints` | 0 a 4 términos concretos que un resultado correcto contendría. Puede venir vacío. Nunca la respuesta esperada. | Texto dentro de `expected` |

### Ejemplo

```json
{
  "pending": [
    {
      "kind": "search",
      "goal": "¿Cuál es el precio actual del Bitcoin en USD?",
      "done_when": "El resultado trae un valor numérico en USD con fecha o fuente actual",
      "hints": ["Bitcoin", "USD"]
    },
    {
      "kind": "write",
      "goal": "Guardar el precio obtenido en precio.txt",
      "done_when": "El archivo precio.txt existe y contiene el precio",
      "hints": ["precio.txt"]
    },
    {
      "kind": "execute",
      "goal": "Listar los archivos de la carpeta actual",
      "done_when": "Se obtuvo el listado de archivos",
      "hints": []
    }
  ]
}
```

## 4. Reglas para el prompt

- Si `kind` es `search`, `goal` es una pregunta en el idioma de REQUEST; si no, una acción: qué obtener o cambiar, nunca el cómo (sin comandos, herramientas ni código).
- Mantener las restricciones del usuario.
- `done_when`: una condición verificable sobre el resultado, no una acción.
- `hints`: 0-4 términos concretos (entidades, unidades, nombres de archivo, cadenas de salida). Nunca la respuesta que se espera encontrar ni datos inventados. Vacío si hay duda.
- Se conservan las reglas actuales: mantener la redacción de los pendientes no cumplidos, reemplazar los que FAIL muestra como fallidos, lista vacía solo si DONE ya cumple REQUEST o es un saludo o pregunta respondible sin la computadora.

## 5. Cierre de tarea con D4 (reemplaza la confirmación final)

- Nueva pregunta `noul` en D4: `request_done` ("con lo hecho hasta ahora, ¿la solicitud completa queda cumplida?").
- Se agrega solo cuando el ítem verificado es el **último** de la lista, y con `REQUEST` en la vista (con su tope).
- **No entra en `verdictOf`**: el veredicto del paso sigue siendo `ok` y `cumple` ≥ 0.6. `request_done` viaja aparte en `VerifyDecision.answers`.
- Si el paso queda `approved` y `request_done` supera el umbral, `runReactive` cierra `completed` sin llamar al generador. Si no, cae al generador como hoy.
- Se mantienen las reglas existentes: si `abandoned > 0` el cierre es `no_alternatives`, y `canFinish()` sigue mandando.
- **Asimetría de errores:** un falso "sí" cierra la tarea incompleta en silencio; un falso "no" solo cuesta la llamada que se paga hoy. Por eso el umbral más alto.

## 6. Cambios por archivo

| Archivo | Cambio |
| --- | --- |
| `reasoner/stageRequests.ts` | Schema `pending` como array de objetos `{kind, goal, done_when, hints}`, en ese orden |
| `reasoner/prompts.ts` | `PENDING_VIEW.SYSTEM` con las reglas de la sección 4. `buildResultVerification` suma `request_done` y `REQUEST` en el último ítem |
| `reasoner/qwen.ts` | `parsePendingList` valida el objeto, recorta `hints` a 4, descarta ítems sin `goal`. Devuelve `pending: string[]` (compatibilidad) más `items` |
| `engine/pending.ts` | `PendingOutcome.next` suma `items`. El fallback `[ctx.task.request]` queda sin detalle |
| `engine/runTask.ts` | `Map<goal, expected>` que se mezcla en cada generación. Al abrir el paso se pasa `expected`. Cierre por `request_done` |
| `engine/stepLoop.ts` | `StepSeed` reactivo suma `expected`; el paso se crea con ese valor. `StepOutcome` `completed` propaga `requestDone` |
| `engine/verify.ts` | `verifyCall` devuelve `requestDone` |

`reconcileList` y `sameItem` siguen trabajando sobre strings (`goal`). Si el modelo reescribe un ítem y no hay detalle en el mapa, ese paso corre con `expected: null`, como hoy. La degradación es segura.

## 7. Riesgos y vigilancia

- **El 4B inventa en `hints`.** Se permite vacío y se prohíbe la respuesta esperada. Si las trazas muestran datos inventados, se deja solo `done_when`.
- **Falsos negativos de D4.** Con `expected` presente, `cumple` se vuelve más estricta. Probar con tareas de filesystem y terminal; un `done_when` vago puede consumir `maxCallsPerStep` y `maxItemFailures`.
- **Detalle obsoleto.** El detalle de los ítems 2 en adelante se decide antes de ver el resultado del 1. Un fallo reescribe y reemplaza el detalle; aun así, un `done_when` viejo puede hacer fallar un paso que sí cumplía.
- **Preguntas en `reconcileList`.** `sameItem` debería tolerarlas (palabras interrogativas en `STOP`, `proper()` salta la primera palabra), pero hay que probarlo con preguntas reales.
- **Tokens.** `BUDGET.pending.maxTokens = 1024` alcanza para unos 5-6 ítems con detalle; una respuesta truncada cae en `invalidResponseRetries`. Evaluar subirlo.
- **Falso "sí" en `request_done`.** Ver sección 5.

## 8. Pendientes por resolver

1. **Nombre de `hints`.** En el código ya existen `ROUTE_HINTS` (pistas fijas para D1) y `BLOCKED_HINT` (pista tras un bloqueo de lista negra). Son un concepto distinto: texto estático escrito a mano, no generado por el modelo. Para evitar confusión en código y trazas conviene renombrar el campo (por ejemplo `expect_terms`).
2. **Revisar `eval/variants/d4_*_hints`.** Existen variantes de D4 (`d4_recent_hints`, `d4_concise_hints`, `d4_fewshot_hints`) que probaron pistas en la pregunta `cumple`. Mirar sus resultados antes de decidir cómo se redacta el texto de `expected`, y si hay que sumar ese tipo de pista.
3. **`kind` y D1.** `ROUTE_HINTS` muestra que D1 ya tiene ambigüedades de ruta resueltas a mano (abrir aplicaciones va a `terminal`; `locate` tras un archivo no encontrado). Si `kind` se usara como pista para D1 podría chocar con esas reglas. Por eso queda solo en la traza hasta tener datos.
4. **`BLOCKED_HINT` y la reescritura.** Tras un bloqueo, el hint llega al LLM por `FAIL`. Verificar que la consulta de reescritura del pending lo vea, para que el nuevo `goal` no vuelva a empujar al mismo comando.
5. **Medición.** Registrar en la traza cuántos pasos corrieron con `expected` y cuántos sin él, y cuántas veces `request_done` cerró la tarea correctamente frente a falsos sí/no.
6. **Pruebas de `Decision`.** Confirmar que sumar una pregunta condicional no altera el formato de `rawInput` y `answers` que usan las evals.

## 9. Orden sugerido de implementación

1. Schema, prompt y parser con el objeto enriquecido, más el mapa `goal → expected` y `expected` en `StepSeed`. Es aditivo y degrada seguro.
2. Medir con trazas: ¿`expected` mejora la verificación o genera falsos negativos?
3. `request_done` en D4 y cierre en `runReactive`, con el umbral ajustable.
4. Más adelante, si los datos lo justifican: `hints` como campo propio de `StepRecord` con conteo determinístico, y `kind` hacia D1/D2.
