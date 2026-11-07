# Pendientes

Lo que quedó abierto después del refactor del flujo (`PLAN_REFACTOR_FLUJO.md`) y de la preparación del eval (`PLAN_EVAL.md`). **[V]** = visto en el código o en una traza.

## Decisiones abiertas del flujo
- **Ofrecer al usuario las llamadas que D3 rechaza.** Hoy D3 corre antes de pedir la aprobación: una operación que requiere aprobación (por ejemplo `start_process`) y que D3 rechaza nunca llega al usuario. Propuesta pendiente de decisión: si la llamada requiere aprobación y D3 la rechaza, mostrarla igual con el aviso de D3; si el usuario acepta se ejecuta, si rechaza con instrucción queda como `user_rejected`. [V]
- **Quitar `tool_rejected` de D3 cuando la ruta no tiene otra herramienta usable.** Hoy se ofrece "elegí otra herramienta" aunque no exista otra. La variante `decision_opciones` del eval lo prueba. [V]
- **Candidato idéntico a uno ya rechazado por D3.** El anti-bucle solo compara llamadas ejecutadas; el tope de dos rechazos por paso (`maxReviewRejectionsPerStep`) lo acota, pero no lo bloquea antes de generar los argumentos. [V]
- **Reintento de la lista vacía.** Repite la misma consulta con temperatura 0.1: protege poco contra un vacío prematuro. Si hace falta, variar la entrada del reintento.
- **Pasar el sistema operativo y los shells disponibles al LLM de argumentos.** `ENV` solo trae rutas (`environment.ts`); en dos corridas reales generó comandos de Linux (`top`, `ps`) con `shell: "cmd"` en Windows. Requiere un cambio en `src` (entorno) además del prompt. [V]

## Prompts (los escribe otro agente; ver `PLAN_EVAL.md`)
- `PROMPTS.PENDING_VIEW` es un texto provisorio. En dos corridas reales inventó el comando (`…usando el comando ps`): no debe nombrar comandos ni herramientas. [V]
- D3: confunde `tool_rejected` con `args_invalid`, y en la sección "Failed attempts of this step" el estado `tool_rejected` de los intentos anteriores empuja a repetir la etiqueta (0.74 a 0.88 en cinco intentos). La pregunta `os_fit` (variante `decision_opciones`) acertó 2/2 en la comprobación. [V]
- `conclusiones.md`: d3 aprobaba casi todo en `args_review` y elegía `fin` de forma prematura (esto último ya no existe: `fin` salió de D1).
- Para que una variante agregue o quite partes de un prompt de forma autónoma, `prompts.ts` debe organizarse en partes con nombre (hoy son literales dentro de `buildX` y `SYSTEM`).
- `adapters.ts`: el comentario de cabecera dice que solo se usan `renderArgs`, `renderAsk` y `renderPending`, pero también importa `renderPlan`. [V]
- `ReviewView` es `ArgsView` sin `refs` ni `effects`; derivar con `Omit`. [V]

## d3 / decisiones
- `validateAnswer` (`decision.ts`): todo tipo distinto de `choice` se valida como `noul`. Hace falta un `switch` exhaustivo si se agrega `score`. [V]
- `score` está en el contrato pero no se implementa. [V]
- La traza queda con `input`/`output` en `null` cuando d3 responde algo inválido: `DecisionValidationError` no lleva el crudo (`llmTransport.ts`). [V]
- `buildDecisionRequest` (`decision.ts`) tipa `config` con `ReturnType<typeof import(...)>`; usar `JarvisConfig`. [V]
- Nombres: `Decision20Engine`, "Decision 2.0" en mensajes; los "D3/D4" de los comentarios son decisiones de diseño, no las decisiones d3. [V]
- `shortDesc` recorta a `MAX_TOOL_DESC_CHARS` pero el manifest ya rechaza descripciones más largas al arrancar: un solo mecanismo. [V]

## Configuración
- `qwenMaxTokens.verify`: ninguna etapa lo lee. Está en `config.ts`, `jarvis-config.json` y `ui/types/api.ts`. [V]
- `MAX_TOOL_DESC_CHARS`: el comentario de `limits.ts` dice que Decision recorta; ya no es así. [V]

## Eval
- Los **prompts y datasets nuevos** (casos por escenario de `args_review`, `arguments`, `pending` y reactivos con instrucción realista) los escriben otros agentes. Los fixtures `verificacion_corrida.jsonl`, `prompt_prueba.ts` y `decision_opciones.ts` son solo de comprobación y se pueden borrar.
- **Obsoleto por el cambio de flujo:** `ask_user` y `fin` ya no son opciones de D1 ni de D2. En el eval quedan `expectedAction` `ask_user` y `fin` (`case.ts`, `types.ts`, `oracle.ts`, `graders/label.ts`, `stages/decision.ts`, `variants/labels.ts`, `variants/route_example.ts`), los casos de los datasets fijos que los esperan (`agentic_30`, `agentic_hard_40`, `decision_combo_52`) y las variantes `jarvis_alt_v4` a `v6`. Las constantes `FIN` y `ASK_USER` quedaron sin uso en `src` (`routes.ts`) y solo las importa el eval: borrarlas al limpiar el eval. [V]
- Los casos reactivos por escenario existentes (`scenarios_chains`, `scenarios_messages`) no traen `instruction`: toman la solicitud como instrucción, que no es lo que produce la lista de pendientes.
- Los nombres de etapa difieren entre el eval (`tool_choice`, `args_review`, `result_verification`, `arguments`) y la traza (`tool`, `review`, `verify`, `args`). Falta la tabla de equivalencias con `STAGES` y `STAGE_KIND` (`src/core/types/stages.ts`). [V]
- El eval no corre el flujo: rearma los requests desde las vistas y los envía con clientes propios (`eval/core/client/*`). Es un riesgo de desvío respecto de producción, no un bloqueo. [V]
- Eval de segundo nivel (correr JARVIS entero): `runTask` con `EngineDeps` (modelos reales con prompts de la variante, descubrimiento falso con resultados guionados y un `TaskRuntime` guionado). Mide trayectorias: bucles, preguntas innecesarias, cierre. No reemplaza al eval por etapa.
- Los casos del eval se pueden construir a partir de `jarvis-traces.jsonl` (cada etapa guarda `input` y `output`).
- Comentarios obsoletos sobre `runVerification` en `labels.ts` (cabecera). `scenario.ts` escribe `facts.answer_<n>`; producción usa `answer_<paso>_<n>`: conviene igualarlos.
- `eval/core/contract.ts` define `MAX_STEPS` y `LLM_INVALID_OUTPUT_RETRIES` desde `BUDGET`: usar `BUDGET` directo en `runner.ts` y `stages/generative.ts` cuando se toque.
- Exponer el eval a un agente remoto (API con túnel): descartado, el agente corre en la nube de Anthropic y no llega a la máquina local. El agente trabaja con los resultados (`comparison.md`, `comparison.json`) que se le pasen.
