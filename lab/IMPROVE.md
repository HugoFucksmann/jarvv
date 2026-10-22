# JARVIS `lab/` — Automejora de prompts: arquitectura y plan

**Estado:** BORRADOR v0.5 (revisión de v0.4; pendiente de verificación contra el código de `lab/`)

**Convenciones**
- `[VERIFICAR]`: supuesto que el agente de lab debe confirmar o corregir leyendo el código antes de implementar.
- `[DECIDIDO]` / `[ABIERTO]`: decisión ya tomada o pendiente (del usuario, o a calibrar con datos en la Fase M).
- `[v0.4]`: cambio introducido en v0.4 (ya aprobado).
- `[v0.5]`: texto cambiado o agregado en esta versión (todo lo demás es idéntico a v0.4).

---

## 0. Cambios respecto de v0.4 `[v0.5]`

1. **`promptVersion` (§14, §15, §12, §16):** se define como una **constante manual por etapa en `src/prompts.ts`**, que se incrementa al promover y que la traza copia en cada llamada; los casos grabados antes de que exista quedan `"unknown"`. Pasa de "requisito previo a la primera promoción de Eos" a **requisito previo a juntar casos reales**, junto con la Fase 0a. Sigue siendo un cambio mínimo en `src/`, a cargo del agente de ese lado.
2. **Fase 2 (§15):** nuevo entregable, el **prompt del director**, versionado en `lab/improve/` (instrucciones, esquema de salida, regla de datos de casos como no confiables, regiones que puede proponer) y probado con el director simulado antes de usar la API.
3. Ajustes de consistencia mínimos derivados de lo anterior: §17 (pregunta 11) y §18.

---

## 0b. Historial: cambios de v0.3 a v0.4

1. **§9, Z:** deja de ser una mejora exigida del margen. Es una **guarda de no deterioro**: el margen mediano de los casos correctos no cae más de Z. El margen sigue solo desempatando y marcando fragilidad.
2. **§9, definiciones:** se define cuándo una *tarea mejora* y cuándo *regresa*, `[ABIERTO]` a ajustar en la Fase M.
3. **§8, `test` chico:** si `test` tiene menos de N tareas (sugerido 5), el reporte lo avisa y la validación se apoya en el holdout temporal.
4. **§12 y §14, baseline de Eos:** el baseline es el prompt histórico guardado en los casos. Tras promover un candidato de Eos, los casos viejos de esa etapa quedan desactualizados y se renuevan con trazas nuevas. `promptVersion` en las trazas pasa a ser requisito previo a la primera promoción de Eos. El paso 2 del checklist distingue Eos de Qwen.
5. **§2, regla 9:** digest `null` en ambas corridas permite comparar con aviso; `null` contra un valor, o valores distintos, se rechaza.
6. Ajustes menores de consistencia: §15, §16, §17 y §18.

---

## 0c. Historial: cambios de v0.2 a v0.3

**Errores de v0.2 que se corrigen (reconocidos)**
1. **Contradicción sobre `test`:** la regla 4 decía "una sola vez" y §12 pedía volver a correrlo antes de promover. Ahora `test` admite usos registrados y nunca se usa para elegir (§2, regla 4).
2. **Criterio de "terminado" de la Fase 3:** exigía "ranking validado en `test`", lo que incentiva forzar un resultado. Ahora exige que el flujo funcione y que el reporte sea honesto, incluso con "ningún candidato superó al baseline" (§15).
3. **Split por id de caso:** reparte pasos de una misma tarea entre `dev` y `test` (fuga de datos). Ahora el split se asigna por **id de tarea** (§8).

**Cambios nuevos**
4. **Se cuentan tareas distintas, no solo casos**, en la compuerta de datos y al agrupar comparaciones (§3, §9).
5. **Holdout temporal:** tareas reales recolectadas después de la corrida, como confirmación previa a promover. Un `test` de ~10 casos solo detecta regresiones grandes (§8).
6. **Criterio de Eos:** el acierto con los umbrales de producción es la compuerta; el margen desempata y marca fragilidad, no se maximiza. Los valores X, Y, Z se calibran en la Fase M (§9).
7. **Más candidatos por ronda en Eos**, compensado con exigencias crecientes de mejora y el holdout (§9, §13).
8. **Versión de modelos** (digest de Ollama, versión de Eos) registrada por corrida; `evaluate` rechaza comparar entre modelos distintos (§2, regla 9; §7).
9. **Fase 0 partida en 0a y 0b:** el extractor y los metadatos se adelantan, antes de recolectar casos (§15).
10. **Fase M** usa un script mínimo de solo lectura que arma el informe provisional del director (§4).
11. **Compuerta de datos escalonada** (§3).
12. **Privacidad:** `allowExternal` se marca al aprobar el `expect`; se envían fallos completos, resumen de aciertos y ejemplos críticos; la redacción no es garantía; el diff se revisa al promover (§13, §12).
13. **Menores:** baseline invalidado (no solo avisado), validación de largo de variantes de Eos con el estimador de producción, bitácora con lo realmente enviado, modelo del director con override por etapa `[ABIERTO]`.

---

## 1. Objetivo y alcance

Construir, dentro de `lab/`, un sistema donde un modelo grande (Claude, por API o endpoint local configurable) actúa como **director**: analiza los fallos de los prompts actuales, propone variantes y decide qué probar después. El lab las ejecuta contra los modelos locales con métricas mecánicas. Al final entrega un **ranking de los 5 mejores candidatos** para que el usuario decida si aprueba alguno.

**Qué hace**
- Optimiza prompts de las 8 etapas, con este orden de prioridad (§11): Eos 0.8B (`step_verification`, `decision_one`, `decision_two`) y Qwen 3.5 9B (`arguments`), luego el resto.
- Propone casos nuevos como borrador (siempre `ai_proposed`, sin efecto en métricas hasta que el usuario los apruebe).
- El director es configurable (API de Claude o modelo local) tras una interfaz única.

**Qué NO hace**
- No modifica `src/` ni los prompts de producción. Nunca.
- No promueve nada automáticamente: la promoción es manual.
- No hace fine-tuning ni LoRA.
- El director no ejecuta código ni herramientas: solo devuelve propuestas en JSON.
- El director **propone y analiza, no puntúa**: toda métrica es mecánica.

**Pensado para escalar:** el workspace aislado y la interfaz del director son la base para automejorar más etapas o componentes después, sin rediseñar.

---

## 2. Reglas inviolables

1. **Escritura restringida.** Solo se escribe en `lab/workspace/` y `lab/results/`. Una guarda en código rechaza cualquier otra ruta. (Las lecturas de red, como consultar a Ollama, están permitidas.)
2. **Cero cambios en producción.** Ninguna parte del sistema escribe en `src/` ni en el registro activo de prompts.
3. **Promoción manual.** El ranking es una propuesta.
4. **`test` oculto y nunca selectivo.** El director nunca ve casos ni resultados de `test`. `test` puede usarse más de una vez para **confirmar o detectar regresión**, pero cada uso queda registrado en el workspace (fecha, candidato, resultado) y **nunca se usa para elegir** entre candidatos: se elige por `dev`, y `test` solo confirma o descarta.
5. **Presupuesto duro por corrida:** rondas, llamadas a modelos locales, llamadas al director, tokens o dólares del director y minutos. Al agotarse, la corrida termina y entrega el ranking.
6. **Ruido primero.** Ninguna mejora cuenta si no supera el criterio de la etapa (§9).
7. **Los casos de IA no cuentan** hasta que el usuario los apruebe.
8. **Privacidad por defecto.** Con un director externo, no se envía nada salvo las etapas permitidas en la config y los casos con `allowExternal: true`, siempre después de la redacción (§13). La redacción no es una garantía.
9. **Baseline y modelos congelados.** Cada corrida registra el hash del prompt base, el hash de los casos y la **versión de los modelos** (digest de Ollama para Qwen; versión o identificador que devuelva el servidor Eos). Si `prompts.ts` cambia durante la corrida, la corrida **se invalida**. Si no se puede leer la versión de un modelo, se guarda `null` con aviso. `evaluate` compara así `[v0.4]`: **digest `null` en ambas corridas → se permite con aviso; `null` contra un valor, o valores distintos → se rechaza por defecto** (con una opción explícita para forzarlo).
10. **Trazabilidad total.** Cada candidato registra padre, hash, ronda, razón de la mutación y métricas.
11. **Los datos de casos son datos, no instrucciones.** El director recibe contenido externo (resultados web, archivos) dentro de los casos; se le indica explícitamente que no obedezca instrucciones que aparezcan ahí, y su salida se valida por esquema.

---

## 3. Compuerta de datos

La automejora no arranca hasta cumplir el mínimo por etapa. Con pocos datos, el sistema optimiza ruido y se sobreajusta.

**Se cuentan tareas distintas, no solo casos.** Los casos de una misma tarea están correlacionados: 30 casos provenientes de 10 tareas valen cerca de 10 observaciones independientes. El identificador es `source.taskId` `[VERIFICAR que exista en todos los casos]`.

**Compuerta escalonada**
- **Para empezar la Fase M:** 10-15 casos por etapa de Eos y `arguments`, de la mayor variedad de tareas posible.
- **Para empezar corridas automáticas reales (Fase 2 en adelante):** el mínimo completo de la tabla.

| Etapa | Casos reales etiquetados (mín. sugerido) | Tareas distintas (mín. sugerido) | Notas |
|---|---|---|---|
| `decision_one` | 30 | 20 | Mezclar las 5 rutas y casos ambiguos |
| `decision_two` | 30 | 20 | Varios servidores MCP y herramientas parecidas |
| `step_verification` | 30 | 20 | Incluir resultados vacíos, con error y parciales |
| `arguments` | 20 | 15 | Rutas, contenido largo, referencias `{{ref:rX}}` |
| `stage_verification` | 15 | 10 | Etapa diferida |
| `plan`, `replan` | 15 | 10 | Etapa diferida |
| `final_response` | n/a | n/a | Revisión humana, no automatizada |

`[ABIERTO]` Los mínimos son sugerencias iniciales; pueden ser mayores. Como una tarea genera casos para varias etapas, unas 30-40 tareas reales bien elegidas cubren casi todas las etapas.

**Reglas de composición**
- Al menos 20 % de casos difíciles (donde Jarvis falló o dudó) en cada etapa.
- Variedad de modo (NORMAL y PLAN), de herramientas (archivos, terminal, búsqueda web, búsqueda de archivos) y de dificultad (ambiguas, con rutas del escritorio, con errores).
- Los casos sintéticos (`example-*`) no cuentan para el mínimo ni para decidir promociones.

**Metadatos por caso:** `origin` (real | synthetic | ai_proposed), `critical`, `allowExternal`, `tags` (tipo de tarea), además de `source.taskId`. El extractor prellena `origin: real`, `taskId`, `split` y valores por defecto de `critical`, `allowExternal` y `tags` (§15, Fase 0a), de modo que etiquetar un caso sea, en la práctica, completar el `expect`.

**Verdad de referencia:** sale de las trazas reales y de la revisión manual del usuario. Un modelo puede sugerir `expect`, nunca aprobarlo. En `step_verification` el `state` ya incluye `Result:` y `Observation:`, por lo que se pueden etiquetar casos sin `resultPreview`; ese campo ayuda sobre todo a `arguments` y `decision_two`.

---

## 4. Fase M — Rondas manuales (antes de codear el orquestador)

Objetivo: aprender qué variantes y qué métricas funcionan antes de automatizar nada. Se usa el lab actual más un script mínimo de lectura.

1. **Fase 0a hecha** (§15): el extractor ya prellena metadatos y el split por tarea.
2. El usuario junta tareas y completa el `expect` de los casos (compuerta escalonada de §3).
3. **A/A corto en Eos:** correr el prompt estable varias veces para confirmar que repite exactamente en este hardware. En Qwen, correr con repeticiones para estimar el ruido de la etapa.
4. Corre `run.ts <etapa> stable` y genera el **informe de ronda** con un **script mínimo de solo lectura** que lo arma desde `results/`. El formato es provisional y el script no debe crecer hasta convertirse en un orquestador. Su propósito es validar si ese informe da suficiente señal.
5. El usuario pega el informe a Claude en el chat; Claude analiza fallos y propone 3-5 variantes en el formato actual de `lab/prompts/variants/`.
6. El usuario corre cada variante y `evaluate.ts`; comparte los informes.
7. Se repite 2-3 rondas por etapa (empezando por Eos).
8. **Calibración:** con lo observado se fijan los valores X, Y, Z del criterio de Eos (§9), por tarea, y se documenta qué patrones funcionaron, qué métricas engañaron y qué regiones del prompt conviene proteger.

*Terminado cuando:* hay al menos una mejora medida en una etapa de Eos (o evidencia de por qué no la hay), los valores del criterio están calibrados y el formato del informe de ronda está ajustado.

---

## 5. Arquitectura

```
                 ┌─────────────────────────────┐
                 │  Director (Claude)          │
                 │  endpoint configurable      │
                 │  (API o modelo local)       │
                 └──────────────┬──────────────┘
                                │  informe de ronda (entrada)
                                │  propuestas JSON (salida)
                 ┌──────────────▼──────────────┐
                 │  lab/improve/  (orquestador)│
                 │  - bucle de rondas          │
                 │  - presupuesto, guardas     │
                 │  - validación de variantes  │
                 │  - registro de candidatos   │
                 └───────┬─────────────┬───────┘
                         │             │
          ┌──────────────▼───┐   ┌─────▼──────────────┐
          │ Runner/Evaluador │   │ Workspace aislado  │
          │ (run, evaluate   │   │ lab/workspace/<id>/│
          │  como funciones) │   │ candidatos, ranking│
          └───────┬──────────┘   └────────────────────┘
                  │
        ┌─────────▼─────────┐
        │ adapter.ts        │  único punto que importa de src/
        │ Eos 0.8B / Qwen 9B│
        └───────────────────┘
```

**Componentes**
- **Director:** interfaz única `DirectorClient` con una operación (recibe el informe de ronda, devuelve propuestas). Una implementación al inicio (API de Claude); la local se agrega después sin tocar el orquestador.
- **Orquestador (`lab/improve/`):** ejecuta el bucle, aplica presupuesto, valida propuestas y es el único que escribe en el workspace.
- **Runner/Evaluador:** el código actual de `run.ts` y `evaluate.ts`, expuesto como funciones importables `[VERIFICAR: hoy son CLI]`. El CLI queda como capa fina.
- **Workspace:** una carpeta por corrida con candidatos, resultados, ranking, casos borrador, registro de usos de `test` y bitácora del director.
- **Adaptador:** sigue siendo el único archivo de `lab/` que importa de `src/`. Se le agrega la lectura de versión de modelos (GET a Ollama, p. ej. `/api/show` o `/api/tags`; y la versión que exponga Eos) `[VERIFICAR que el adaptador pueda hacerlo]`.

---

## 6. Protocolo de ronda

**Entrada al director (informe de ronda, armado por el orquestador):**
- Etapa, región editable del prompt y regiones bloqueadas.
- Prompt base y métricas del baseline en `dev`, con el criterio de ruido de la etapa.
- **Fallos completos** del baseline y del mejor candidato: caso (redactado), salida cruda, probabilidades, check que falló.
- **Resumen de aciertos** (qué categorías de casos ya funcionan) y **algunos ejemplos críticos**, para que el director sepa qué preservar.
- Casos frágiles: correctos pero con margen bajo o en caída.
- Ranking actual y lista corta de candidatos ya probados con su resultado (para no repetir).
- Presupuesto restante.

**Salida del director (JSON validado por esquema):**
```json
{
  "analysis": "patrones de error observados",
  "candidates": [
    {
      "id": "r3-a",
      "stage": "decision_two",
      "variant": { "...": "mismo formato que lab/prompts/variants/<etapa>/" },
      "hypothesis": "qué se espera mejorar y por qué"
    }
  ],
  "proposed_cases": [],
  "stop": false
}
```

**Validación del orquestador (antes de ejecutar):** respeta regiones bloqueadas; esquema de la variante por etapa; límite de longitud (en Eos, con el **mismo estimador y los mismos límites de producción**, p. ej. `estimateTokens` contra `decisionMaxContext`); no copia literalmente texto de casos (anti-sobreajuste); no excede el máximo de candidatos por ronda de la etapa.

---

## 7. Flujo de una corrida

1. **Preparación:** carga casos de `dev`, congela baseline y versiones de modelos (hash), mide ruido si no hay medición reciente y fija presupuesto.
2. **Informe** de ronda y envío al director (con redacción y respetando `allowExternal`).
3. **Propuestas** del director; validación.
4. **Ejecución** de los candidatos sobre `dev` (N repeticiones según etapa).
5. **Comparación** pareada por caso, agrupada por tarea, contra el baseline y contra el mejor actual (§9); actualiza el ranking.
6. Repetir desde 2 hasta agotar presupuesto, `stop`, o M rondas sin mejora.
7. **Validación final:** los finalistas se corren sobre `test` (uso registrado) y sobre los casos críticos; los que regresan se descartan o se marcan. Si hay holdout temporal disponible, también se corre allí (§8).
8. **Reporte** (§12). Un resultado válido incluye "ningún candidato superó al baseline".

---

## 8. Datos: estados y splits

- **Estados de un caso:** `real` (de trazas, revisado), `ai_proposed` (en `_drafts/`, sin efecto), `approved`, `synthetic` (ejemplos; solo prueban el sistema).
- **Splits:** `dev` (visible) y `test` (oculto). **Se asignan por hash del `taskId`**, nunca por caso: todos los casos de una tarea caen del mismo lado. Hoy `split` es un campo manual con valor por defecto `dev`; el extractor pasa a prellenarlo de forma determinista `[VERIFICAR]`. Ni el director ni el usuario eligen el split caso a caso.
- **Agrupación por tarea:** al comparar candidatos, las mejoras y regresiones se cuentan por tarea (una tarea cuenta una vez), no por caso.
- **Tamaño de `test`:** con pocos casos (~10), `test` solo detecta regresiones grandes. Sirve como filtro grueso, no como prueba fina.
- **`test` con pocas tareas `[v0.4]`:** si `test` tiene menos de **N tareas distintas** (sugerido N = 5, `[ABIERTO]`), el reporte lo avisa de forma explícita y la validación final se apoya en el **holdout temporal**; `test` queda como chequeo secundario.
- **Holdout temporal:** tareas reales recolectadas **después** de iniciada la corrida (por fecha de la traza). Se usan como confirmación previa a promover. Son baratas porque las trazas siguen llegando. Un candidato que mejora en `dev`, confirma en `test` y no regresa en el holdout es el único que se recomienda promover con confianza `[VERIFICAR cómo marcarlo: campo o fecha de corte]`.
- **Casos críticos:** marcados por el usuario; ningún candidato puede regresar en ellos.
- **Cobertura:** el reporte indica cobertura por tipo de tarea (`tags`) para evitar optimizar solo lo fácil de medir.

---

## 9. Métricas y criterio de victoria

**Ruido**
- **Eos:** se asume casi determinista (repetición = 1), pero se **confirma con un A/A corto** antes de fiarse (§4). Si es determinista, el "ruido" es de selección de casos, no del modelo.
- **Qwen:** se mide con repeticiones y sirve de piso.

**Eos — compuerta y desempate**
- **Compuerta dura:** **acierto con los umbrales de producción** (en `step_verification`: `ok` y `cumple` > 0,5, y el resto de reglas actuales).
- **Desempate:** margen de probabilidad de la opción correcta.
- **Guarda de no deterioro `[v0.4]`:** el margen mediano de los casos correctos no cae más de **Z** respecto del baseline. Z no es una mejora exigida.
- **Fragilidad:** el margen también marca casos correctos cuyo margen cae respecto del baseline. No se maximiza el margen, para evitar que el optimizador empuje probabilidades a extremos en los casos fáciles sin arreglar los difíciles.
- Secundarias: latencia y aprobación de paso.

**Qwen:** tasa de acierto con N repeticiones. Restricciones duras: JSON válido, esquema, tokens, latencia máxima.

**Criterio de victoria v1 (todos deben cumplirse)**
1. Mejora en al menos **X tareas distintas** de `dev` (una tarea *mejora* según las definiciones de abajo), y **cero regresiones en casos críticos**.
2. Regresiones netas no críticas **≤ Y tareas** (una tarea *regresa* según las definiciones de abajo) y, en Eos `[v0.4]`, **guarda de no deterioro**: el margen mediano de los casos correctos no cae más de **Z** respecto del baseline. No se exige que el margen mejore; solo desempata y marca fragilidad.
3. No viola restricciones duras.
4. Costo de latencia dentro del límite por etapa.
5. Confirmado en `test` (y holdout si hay); `test` confirma, no elige.

**Valores de X, Y y Z `[ABIERTO]`:** la estructura está definida, los números se calibran en la Fase M, por tarea y por etapa. Con pocos datos no se fijan a priori.

**Definiciones `[v0.4]` `[ABIERTO]` (a ajustar en la Fase M)**
- **Tarea que mejora:** al menos un caso de la tarea pasa de fallo a acierto **y ninguno** de sus casos regresa.
- **Tarea que regresa:** algún caso de la tarea pasa de acierto a fallo.
- Una tarea con un caso que mejora y otro que regresa **cuenta como regresión**, no como mejora.

**Corrección por selección múltiple:** cuantos más candidatos se prueban en una etapa, mayor es la chance de que uno gane por suerte. Por eso **X crece con la cantidad de candidatos evaluados** (regla concreta a calibrar en la Fase M) y se mantiene el holdout como defensa final.

`[ABIERTO]` Con muchos casos (varias decenas de tareas por etapa) se puede agregar bootstrap pareado por tarea e intervalos de confianza. Con pocos, no es informativo y se evita.

---

## 10. Dimensiones de variación

**Versión 1 (no requiere cambios en `src/`)**
- Eos: redacción de `instructions` y de las descripciones de `criteria` (por pregunta u opción); en `decision_two`, descripción base de herramientas (el sufijo `[last attempt failed]` es una región bloqueada).
- Qwen: reemplazo del `SYSTEM` completo o de partes editables.

**Regiones bloqueadas:** contrato JSON y esquemas, placeholders, claves de preguntas y opciones de `choice`, tipo de pregunta (`choice`/`noul`), sufijos dinámicos, parámetros de generación `[VERIFICAR dónde marcar regiones sin tocar prompts.ts]`.

**Diferidas (requieren cambios en `src/` o amplían mucho el espacio de búsqueda)**
- Cantidad y tipo de preguntas por etapa de Eos.
- Umbrales de decisión (`noul_approved`).
- Selección de few-shots.
- Parámetros de generación (temperatura, `reasoning_effort`, tokens): por defecto se mantienen los de producción para preservar fidelidad.

**Fidelidad:** cada candidato corre con los parámetros exactos de producción salvo la dimensión que se varía. Se mantienen visibles los `fidelityWarnings`.

---

## 11. Orden de etapas, costo y tiempo

| Etapa | Modelo | Costo de evaluar un candidato (orden de magnitud) | Candidatos por ronda | Automatizable en el MVP |
|---|---|---|---|---|
| `step_verification`, `decision_one`, `decision_two` | Eos | ~0,1 s por caso (30 casos ≈ pocos segundos) | 10-20 | Sí |
| `arguments` | Qwen sin pensamiento | ~0,5 s por llamada (20 casos × 3 rep ≈ 30 s) | ~5 | Sí |
| `stage_verification` | Qwen sin pensamiento | similar a `arguments` | ~5 | Después |
| `plan`, `replan` | Qwen con pensamiento | decenas de segundos por llamada (timeout 180 s): 15 casos × 2 rep puede tomar decenas de minutos por candidato | 2-3 | Después |
| `final_response` | Qwen | rápido, pero se mide mal con reglas | n/a | Solo con revisión humana |

En Eos el cuello de botella es el director, no la evaluación, por eso se permiten más candidatos por ronda; el costo es mayor riesgo de ganar por suerte, que se compensa con la regla de selección múltiple (§9) y el holdout.

`[VERIFICAR]` Las cifras son estimaciones a partir de corridas previas; medirlas con los modelos reales antes de fijar presupuestos.

---

## 12. Ranking y promoción

**Ranking:** top 5 por etapa, con ID, hash, padre, ronda y razón de la mutación; prompt completo y diff contra producción; métricas `dev`, `test` y holdout (si se validó); versión de modelos; latencia; casos que mejoran y que empeoran; casos frágiles; advertencias de fidelidad; cobertura por tipo de tarea.

**Checklist de promoción (manual)**
1. Revisar el reporte y el **diff de la variante buscando instrucciones inesperadas o ajenas a la tarea** en el texto.
2. **`[v0.4]` Re-verificar según la etapa:**
   - **Qwen:** volver a correr baseline y candidato con el `prompts.ts` actual (comparar hash de baseline y versiones de modelos), sobre `dev` y `test`, sin regresión en críticos.
   - **Eos:** comparar el candidato contra el **baseline histórico guardado en los casos**; confirmar con `promptVersion` que los casos fueron grabados con la versión vigente de la etapa (los `"unknown"` no se pueden confirmar) `[v0.5]`; sobre `dev` y `test`, sin regresión en críticos.
3. Confirmar en holdout temporal si hay tareas nuevas.
4. Aplicar el cambio **y subir en uno el `promptVersion` de la etapa en `prompts.ts`** `[v0.5]`:
   - **Eos:** el prompt es el resultado de un builder. Un candidato aprobado se expresa como **parche a strings concretos de `prompts.ts`** (instrucciones y descripciones de criterios), no como texto para copiar entero. El reporte lo presenta así.
   - **Qwen:** el `SYSTEM` aprobado reemplaza el de `prompts.ts`.
5. Este paso es manual y queda fuera del sistema de automejora.

**Baseline de Eos y casos desactualizados `[v0.4]`**
- En Eos, el baseline es el **prompt histórico guardado en los casos** (el que realmente se usó cuando se grabó la traza), no el que arma hoy el builder de `prompts.ts`.
- Tras promover un candidato de Eos, el prompt de producción cambia y los casos viejos de esa etapa dejan de representar el comportamiento actual: quedan **desactualizados**. Hay que **renovarlos con trazas nuevas** (generadas ya con el prompt promovido) antes de seguir optimizando esa etapa, y el sistema debe avisarlo.
- `[v0.5]` Cada caso lleva el `promptVersion` con el que se grabó (constante manual por etapa, §14), requisito previo a juntar casos reales. Un caso con `promptVersion` distinto del vigente está desactualizado. Los casos `"unknown"` no se pueden verificar: se aceptan como baseline solo hasta la primera promoción de esa etapa y después se renuevan.

---

## 13. Director configurable y privacidad

`lab/improve/config.json` (ejemplo):
```json
{
  "director": {
    "provider": "anthropic | local",
    "baseUrl": "...",
    "model": "...",
    "modelByStage": {},
    "apiKeyEnv": "NOMBRE_VARIABLE_ENTORNO",
    "maxTokens": 4096
  },
  "privacy": {
    "allowedStages": [],
    "redact": ["userHomePath", "userName", "emails", "tokens"],
    "defaultAllowExternal": false
  },
  "budget": {
    "maxRounds": 15,
    "maxDirectorTokens": 400000,
    "maxDirectorUsd": 5,
    "maxModelCalls": 2000,
    "maxMinutes": 120,
    "stopAfterNoImprovement": 3
  },
  "validation": {
    "repetitionsDev": 3,
    "finalists": 5,
    "maxCandidatesPerRound": { "eos": 15, "qwen": 5, "qwenThinking": 3 }
  }
}
```
- La clave nunca se guarda en archivos: se lee de una variable de entorno.
- `director.model` define el modelo; `modelByStage` permite un override por etapa `[ABIERTO]`.
- **`allowExternal` se marca en el mismo pase en que se aprueba el `expect`** de un caso, para que no sea una tarea aparte.
- **Qué se envía:** fallos completos, resumen de aciertos y algunos ejemplos críticos (el director necesita saber qué preservar), todo redactado y solo de etapas y casos permitidos.
- **La redacción automática no es una garantía.** Cubre rutas de usuario, nombre de usuario de Windows, correos y tokens, pero no detecta datos personales dentro del contenido de archivos o resultados web. La protección real es no enviar por defecto y el `allowExternal` aprobado por el usuario.
- **Bitácora del director:** se guarda lo que **realmente se envió** (ya redactado) y lo que se recibió, para auditar propuestas raras sin duplicar datos sensibles.
- El mismo informe y esquema sirven para un director local, que no tiene restricción de envío.
- `[ABIERTO]` Valores de presupuesto: son iniciales.

---

## 14. Qué cambia en `src/`

**MVP: nada en `src/`, con una única excepción `[v0.5]`: `promptVersion` (abajo).** Todo lo demás ocurre en `lab/`.

**`promptVersion` `[v0.5]` — requisito previo a juntar casos reales (junto con la Fase 0a):**
- **Qué es:** una **constante manual por etapa** en `src/prompts.ts` (un entero o etiqueta simple para cada una de las 8 etapas). No es un hash ni un registro.
- **Cuándo cambia:** se **incrementa al promover** un candidato. Subirla es un paso explícito del checklist de promoción (§12).
- **Cómo se registra:** la traza copia el valor vigente de la etapa **en cada llamada**.
- **Casos anteriores:** los casos grabados antes de que exista se marcan `promptVersion: "unknown"`.
- **Alcance:** cambio mínimo en `src/`, **a cargo del agente que mantiene `src/`** (no del agente de `lab/`). No implica el registro de prompts versionado ni cambia el comportamiento de producción.
- **Por qué va antes de juntar casos:** sin ella no se sabe con qué prompt se grabó cada caso ni se detectan casos desactualizados tras promover (§12). Cada caso que se junte antes de que exista queda `unknown`.
- `[VERIFICAR dónde se escribe la traza por llamada]`

**Fase posterior, solo si se aprueba:** registro de prompts versionado (`prompts/active/` + `manifest.json`) con `prompts.ts` como baseline y fallback y rollback por puntero (`promptVersion` en las trazas se adelanta, ver arriba). También habilitaría variar preguntas y umbrales de Eos (hoy fijos en los builders). Ninguna de las dos cosas es requisito del MVP.

**Pendientes de trazas** (independientes de este plan): que el replan salga como `REPLAN` (hoy comparte `PLAN_GENERATION`) y que `toolRuns` incluya `callSeq` y `resultPreview`. Son necesarios para buenos casos de `plan` y `replan`, y útiles para `arguments` y `decision_two`. No bloquean `step_verification`.

---

## 15. Plan de implementación

Cada fase tiene criterio de "terminado" y se audita antes de pasar a la siguiente.

**Fase 0a — Datos y metadatos (antes de recolectar casos)**
- Metadatos de caso: `origin`, `critical`, `allowExternal`, `tags`, y `source.taskId` presente en todos.
- El extractor prellena `origin: real`, `taskId`, `split` por hash del `taskId` y valores por defecto de `critical`, `allowExternal` y `tags`.
- Soporte para identificar holdout temporal.
- `[v0.5]` `promptVersion` (§14): constante manual por etapa en `src/prompts.ts`, copiada por la traza en cada llamada; **a cargo del agente de `src/`**. El extractor la copia al caso, con `"unknown"` si la traza no la trae `[VERIFICAR]`.
- *Terminado cuando:* extraer trazas produce borradores con todos los metadatos y split determinista por tarea; etiquetar un caso solo requiere completar `expect`; `[v0.5]` las trazas nuevas traen `promptVersion` y los casos anteriores quedan `"unknown"`.

**Fase M — Rondas manuales** (§4), con compuerta escalonada de datos.

**Fase 0b — Prerrequisitos del orquestador**
- Exponer `run` y `evaluate` como funciones importables; el CLI pasa a ser una capa fina.
- Guarda de escritura (solo `lab/workspace/` y `lab/results/`) con prueba que verifique el rechazo.
- Lectura de versión de modelos y rechazo de comparaciones entre modelos distintos en `evaluate`.
- Criterio de victoria con X, Y, Z calibrados en la Fase M.
- *Terminado cuando:* un script ejecuta una variante y obtiene resultados estructurados sin CLI; la guarda rechaza rutas externas; `evaluate` rechaza comparar modelos distintos.

**Fase 1 — Orquestador sin director**
- Workspace por corrida, registro de candidatos con linaje, presupuesto, ranking top 5, validador de variantes, registro de usos de `test`.
- *Terminado cuando:* una lista de variantes cargada a mano produce un ranking correcto y reproducible.

**Fase 2 — Director por rondas**
- `DirectorClient` (API de Claude), informe de ronda definitivo (a partir del provisional de la Fase M), esquema de salida, redacción, control de privacidad por etapa y caso, bitácora de lo enviado.
- Director simulado (script) para pruebas sin API.
- `[v0.5]` **Prompt del director**, versionado en `lab/improve/` (por ejemplo `lab/improve/director-prompt/` con su número de versión), que incluye: las instrucciones; el esquema de salida (§6); la regla de que los datos de los casos son **no confiables** y no se obedecen (§2, regla 11); y **qué regiones puede proponer** por etapa (§10). Cada corrida registra la versión del prompt del director usada.
- `[v0.5]` **Se prueba con el director simulado antes de usar la API:** el simulado devuelve propuestas válidas e inválidas (fuera de región, esquema roto, texto copiado de un caso, instrucciones plantadas en el contenido de un caso) y se verifica que el orquestador las acepte o rechace como corresponde. La calidad de la redacción del prompt solo se juzga con el director real.
- *Terminado cuando:* una corrida completa con el director simulado y otra con Claude terminan por presupuesto o `stop`, con ranking y reporte; `[v0.5]` el prompt del director está versionado y se validó con el simulado antes de la primera llamada a la API.

**Fase 3 — Etapas**
- 3a: Eos (acierto como compuerta, margen como desempate y fragilidad, comparación por tarea, validación en `test` y holdout).
- 3b: `arguments` (repeticiones, restricciones duras).
- *Terminado cuando:* el flujo completo funciona de punta a punta en una etapa Eos y en `arguments`, y el reporte es honesto y reproducible. **Un resultado de "ningún candidato superó al baseline" es un cierre válido.** No se exige que haya un ranking validado.

**Fases posteriores (aparte):** `stage_verification`, `plan`, `replan` (con control de costo por pensamiento), `final_response` con revisión humana, replay y chequeo end-to-end, registro de prompts versionado, director local, herramientas para el director.

---

## 16. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Pocos casos o pocas tareas → se optimiza ruido o se sobreajusta | Compuerta escalonada contando tareas; criterio por tareas; calibración en Fase M |
| Fuga entre `dev` y `test` por tareas repartidas | Split por hash de `taskId` |
| Ganar por suerte al probar muchos candidatos | X creciente con candidatos probados; holdout temporal |
| Optimizar margen sin arreglar casos difíciles | Acierto con umbrales de producción como compuerta; margen solo desempata |
| Mejora en una etapa aislada que no mejora tareas completas | Fase posterior de replay end-to-end; casos críticos |
| Optimizar lo fácil de medir (Goodhart) | Cobertura por tipo de tarea; revisión humana en texto libre |
| Quemar `test` | Usos registrados; nunca se elige con `test`; holdout aparte |
| Datos personales enviados a un servicio externo | Default de no enviar; `allowedStages`; `allowExternal`; la redacción es ayuda, no garantía |
| Inyección de instrucciones desde contenido de casos | Datos marcados como no confiables; salida solo JSON validado; el director no ejecuta nada; revisión del diff al promover |
| Resultados no comparables por cambio de modelo | Versión de modelos en el hash; `evaluate` rechaza comparar modelos distintos |
| Sobrecosto de API o tiempo local | Presupuesto en tokens/USD y minutos; etapas lentas diferidas; candidatos por ronda según etapa |
| Cambio de `prompts.ts` durante la corrida | Baseline congelado por hash; la corrida se invalida |
| Divergencia con producción (parámetros, SYSTEM) | `fidelityWarnings` visibles en el reporte |
| Casos de Eos desactualizados tras promover un candidato `[v0.4]` | `promptVersion` manual por etapa, copiado por las trazas desde antes de juntar casos `[v0.5]`; casos previos marcados `"unknown"`; renovar casos con trazas nuevas; aviso del sistema |
| Olvidar subir `promptVersion` al promover `[v0.5]` | Paso explícito del checklist de promoción (§12); `[ABIERTO]` un chequeo automático queda fuera de alcance por ahora |
| `test` con muy pocas tareas `[v0.4]` | Aviso explícito en el reporte; validación apoyada en el holdout temporal |
| Sesgo del director (propone casos o evalúa a su favor) | El director no puntúa; los casos de IA no cuentan hasta aprobación |

---

## 17. Preguntas para el agente de lab (responder antes de implementar)

1. ¿`run.ts` y `evaluate.ts` pueden invocarse como función? ¿Cuánto cuesta separar la lógica del CLI y qué parte de `evaluate.ts` es reutilizable para comparar sin imprimir?
2. ¿Cómo se asigna `split` hoy (campo manual, valor por defecto `dev`)? ¿`source.taskId` está presente en **todos** los casos, también los sintéticos y los extraídos de trazas legacy?
3. ¿Qué campos tiene hoy un caso y qué habría que agregar para `origin`, `critical`, `allowExternal`, `tags` y la marca de holdout?
4. En los prompts de Eos: ¿qué parte es fija y cuáles son las preguntas y criterios? ¿Cómo se marcan las regiones editables y bloqueadas sin tocar `prompts.ts`?
5. ¿Qué se guarda hoy por resultado (salida cruda, probabilidades, latencia, tokens)? ¿Alcanza para armar el informe de ronda, incluida la detección de casos frágiles (margen)?
6. ¿Se puede garantizar por código que el workspace escriba solo dentro de `lab/`?
7. ¿El adaptador puede hacer el GET extra a Ollama (`/api/show` o `/api/tags`) para leer el digest? ¿Qué versión o identificador expone el servidor Eos? ¿Puede `evaluate` rechazar comparaciones entre modelos distintos?
8. ¿Cómo se define hoy una variante por etapa y qué se puede sobrescribir? ¿Qué cambiaría para permitir partes editables en Qwen?
9. ¿Cuánto tarda hoy una corrida típica por etapa con los modelos reales? (El usuario puede medirlo.)
10. ¿Es Eos realmente determinista en este hardware (A/A corto)? ¿Qué valores razonables tendrían X, Y, Z con los casos disponibles?
11. `[v0.5]` Para el agente de `src/`: ¿dónde se escribe hoy la traza por llamada y cuál es el cambio mínimo para definir `promptVersion` como constante por etapa en `prompts.ts` y copiarla en cada llamada? Para el agente de `lab/`: ¿cómo marca el extractor `"unknown"` en trazas sin ese campo?

---

## 18. Decisiones

**Decididas**
- `[DECIDIDO]` Promoción siempre manual; `src/` no cambia en el MVP.
- `[DECIDIDO]` El director corre con Claude por API con endpoint configurable; la interfaz permite sumar un modelo local.
- `[DECIDIDO]` Split por tarea; `test` con usos registrados y nunca selectivo; holdout temporal como confirmación.
- `[DECIDIDO]` Acierto con umbrales de producción como compuerta en Eos; margen solo desempata.
- `[DECIDIDO]` Se juntan casos reales (más de los mínimos si es posible) antes de las corridas automáticas.
- `[DECIDIDO]` Se parte con Eos y `arguments`.
- `[DECIDIDO]` La corrida se invalida si cambia el baseline; `evaluate` rechaza comparar modelos distintos, salvo digest `null` en ambas corridas (se permite con aviso). `[v0.4]`
- `[DECIDIDO]` `[v0.4]` Z es una guarda de no deterioro, no una mejora exigida.
- `[DECIDIDO]` `[v0.4]` El baseline de Eos es el prompt histórico de los casos; tras promover, los casos de esa etapa se renuevan; `promptVersion` en trazas es requisito previo a la primera promoción de Eos. *(Reemplazado en v0.5: ahora es requisito previo a juntar casos reales.)*
- `[DECIDIDO]` `[v0.5]` `promptVersion` es una constante manual por etapa en `prompts.ts`, subida al promover, copiada por la traza en cada llamada; casos previos `"unknown"`; cambio a cargo del agente de `src/`.
- `[DECIDIDO]` `[v0.5]` El prompt del director se versiona en `lab/improve/` y se prueba con el director simulado antes de usar la API.

**Abiertas**
- `[ABIERTO]` Valores de X, Y, Z y la regla de crecimiento de X con los candidatos probados (se calibran en Fase M).
- `[ABIERTO]` `[v0.4]` Definiciones de "tarea mejora" y "tarea regresa" (§9) y mínimo N de tareas de `test` (sugerido 5): se ajustan en la Fase M.
- `[ABIERTO]` Mínimos de casos y de tareas por etapa (§3).
- `[ABIERTO]` Casos críticos y `allowExternal`.
- `[ABIERTO]` Presupuesto inicial por corrida, margen de latencia tolerado y candidatos por ronda.
- `[ABIERTO]` Override del modelo del director por etapa.
- `[ABIERTO]` Cómo marcar el holdout (campo explícito o fecha de corte).
- `[ABIERTO]` Si el director corre con API externa, local o ambos según la etapa.