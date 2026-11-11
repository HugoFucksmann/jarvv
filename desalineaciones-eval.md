# Desalineaciones detectadas en el eval

Estado: revisión de todos los archivos recibidos. Solo se listan puntos confirmados contra el código recibido o contra lo informado por el usuario. No se propone ni se aplica ninguna corrección.

Fuente de verdad: el código de `src`. Si el desacuerdo es entre el eval y `src`, es el eval el que está desalineado. Si es entre la documentación (README, `INSTRUCCIONES.md`, comentarios) y el código del eval, es la documentación. Los puntos donde esa regla no decide quedan marcados "decidir" en el índice.

Archivos revisados: `src` (`qwen.ts`, `stageRequests.ts`, `precheck.ts`, `adapters.ts`, `budget.ts`, `config.ts`, `verify.ts`, `contracts.ts`, `prompts.ts`, `refResolver.ts`, `models/decision.ts`, `models/transport.ts`, `engine/failures.ts`, y la línea de llamada a `precheckCall` en `engine/callRunner.ts`) y el eval completo salvo variantes y datasets (ver "Cobertura").

## Índice

Prioridad: **A** cambia lo que el eval mide o impide ejecutarlo; **M** produce resultados engañosos o difíciles de rastrear; **B** documentación o comentario. "Qué lado" indica qué artefacto está desalineado según la regla de arriba.

| ID | Prio | Resumen | Qué lado |
|---|---|---|---|
| D10 | A | Falta `eval/variants/prod.ts`; todo el flujo lo exige | Eval (archivo) |
| D1 | A | Temperatura del reintento fija en 0.3 | Eval (`runner.ts`) |
| D7 | A | Pre-chequeo de `arguments` con `kind`, fuentes y args distintos de producción | Eval (`runner.ts`, `Case.meta`) |
| D15 | A | Payload sobre `decisionMaxContext`: producción no envía, el eval sí | Eval (`runner.ts`); decidir |
| D16 | A | El eval no reintenta decisiones inválidas | Eval (`runner.ts`) |
| D24 | A | Umbral de aprobación 0.5 en `cross.ts`, docs y comentario; producción usa 0.6 | `cross.ts` + docs + comentario |
| D12 | A | Body generativo sin reserva de contexto de producción | Eval (`client/generative.ts`) |
| D18 | A | El asistente no permite concurrencia 1 (aplica 3) | Eval (`wizard.ts`) |
| D2 | M | Textos de error del reintento distintos de producción | Eval (`stages/generative.ts`, `contract.ts`) |
| D8 | M | `scenario.ts` descarta `temperature` y `retryThinking` de `StageRequest` | Eval (`scenario.ts`, `runner.ts`) |
| D22 | M | `cross.ts` fija baseline `prod` y muestra `p=1.00` sin datos | Eval (`cross.ts`) |
| D21 | M | `forbiddenHardcodedValues` por subcadena | Grader o docs; decidir |
| D29 | M | `oracle` con variantes distintas de `prod` no se rechaza | CLI/config o docs; decidir |
| D3 | M | Hash, `rawInput` y `requestParams` de un run reintentado describen requests distintos | Eval o `types.ts`; decidir |
| D5 | M | `oracle.ts`: cabecera contradice el código y usa claves que producción no tiene | Eval (cabecera o código); decidir |
| D9 | M | `stageConfigHash` no incluye tokens de `pending` | Eval (`scenario.ts`) |
| D11 | M | Timeouts y `DECISION_MAX_CONTEXT` fijados a mano | Eval (`config.ts`, `client/decision.ts`) |
| D13 | M | `resolveUrl` y cliente de decisión sin las comprobaciones de producción | Eval (`client/*`) |
| D14 | M | El runner no usa `isTransportError` | Eval (`runner.ts`) |
| D23 | M | `cross.ts` resuelve `--dataset` distinto de la CLI | `cross.ts` o docs; decidir |
| D4 | B | README: carpetas de resultados | Docs (README) |
| D6 | B | Comentarios sobre quién importa `src/` | Comentarios y `INSTRUCCIONES.md` |
| D17 | B | "prod siempre se incluye" vs `--no-baseline` | Docs (`INSTRUCCIONES.md`) |
| D19 | B | Numeración de pasos del asistente y ayuda de `--menu` | Comentarios y ayuda |
| D20 | B | Comentario de `gradeExtraQuestions` | Comentario |
| D25 | B | `cross.ts`, `psvalid.ts`, `gen/` y `_cross/` sin documentar | Docs |
| D26 | B | `tool_rejected` en `args_review` | Docs (`INSTRUCCIONES.md`) |
| D27 | B | `filters.source` en `meta.json` | Docs (`INSTRUCCIONES.md`) |
| D28 | B | Comentario sobre `prod+x` | Comentario (`config.ts`) |
| D30 | B | Fallo de variante por run vs error de carga | Docs (`INSTRUCCIONES.md`) |

Los puntos están numerados por orden de hallazgo, no de prioridad.

---

## D10. La variante `prod` no existe como archivo, pero todo el flujo la exige (bloqueante)

- **Dónde:** `eval/variants/prod.ts` (inexistente, según lo informado) vs `eval/README.md`, `eval-tree.md`, `eval/core/variants/load.ts`, `eval/core/config.ts`, `eval/cli.ts`.
- **Qué pasa:**
  - El árbol (`eval-tree.md`) lista `variants/prod.ts`, el README lo da como baseline y `load.ts` documenta que "`prod.ts` es la variante de producción".
  - `parseVariantSpecs` agrega `prod` a toda corrida (salvo `--no-baseline`) y `config.ts` fija `baseline = "prod"`.
  - `loadVariant("prod")` busca el archivo con `requireVariantFile` y, al no existir, lanza `Variante 'prod' no encontrada (…/eval/variants/prod.ts)`.
  - `cli.ts` carga las variantes antes del `--dry-run` y antes de correr, y ante ese error termina con código 2.
  - `INSTRUCCIONES.md` §8 lista `prod` dentro de `variants/`, y §6 dice que "`prod` no define nada: cada etapa usa el prompt de `src/` tal cual", sin aclarar que igual necesita su archivo.
  - `package.json`: `eval:smoke` (`--client=mock … --dry-run`) no usa `--no-baseline`, así que también carga `prod`.
- **Por qué es desalineación:** todos los comandos de "Inicio rápido" del README que no usan `--no-baseline` (`--client=oracle --dataset=smoke`, `--dataset=smoke`, `--variant=prod,mi_variante …`), los ejemplos de `INSTRUCCIONES.md` §5, `npm run eval:smoke` y los comandos que arma `--menu` con prod incluida (opción por defecto) y `--dry-run` terminan con error mientras falte el archivo. La baseline, la comparación, `--min-pass-rate` y el hash de variante dependen de él. El README tampoco menciona `--no-baseline` como alternativa.

## D1. Temperatura del reintento distinta de la de producción

- **Dónde:** `eval/core/runner.ts` (`runGenerative`, construcción de `curReq`) vs `src/core/models/qwen.ts` (`dispatchValidated`).
- **Qué pasa:**
  - Producción reintenta con `Math.max(RETRY_TEMPERATURE, o.temperature ?? 0)`.
  - El eval reintenta siempre con `RETRY_TEMPERATURE` (0.3).
- **Alcance real:** el request que arma `scenario.ts` lleva siempre `BASE_TEMPERATURE` (0.1) (ver D8), así que la diferencia solo aparece cuando una variante fija `params.temperature` mayor a 0.3. En ese caso el reintento del eval baja la temperatura y el de producción la conserva.
- **Por qué es desalineación:** contradice el "mismos reintentos" del README y el título "Reintentos (iguales a producción)" de `INSTRUCCIONES.md` §3, que además fija "temperatura 0.3" sin mencionar el `max` de producción.

## D2. El texto del error que viaja en el reintento no es el de producción

- **Dónde:** `eval/core/stages/generative.ts` (`parseOutput` de cada etapa) + `eval/core/contract.ts` (`parsePlanSteps`, `validateArgs`) vs `src/core/models/qwen.ts` (`validate` de cada etapa y `parsePlanSteps`).
- **Qué pasa:** el error de validación se inyecta en el prompt del segundo intento con `retryNote(error)`. El eval produce textos propios:

| Etapa | Producción | Eval |
|---|---|---|
| `plan`, `arguments`, `pending` (JSON no extraíble) | `la respuesta no es un objeto JSON válido` | `No se pudo extraer un objeto JSON del plan.` / `…de argumentos.` / `…de la lista de pendientes.` |
| `plan` (steps inválidos) | Error específico de `parsePlanSteps` (`'steps' debe ser un arreglo`, `paso N: 'goal' vacío`, `paso N: suggested_mcp … inválido; debe ser uno de …`, `paso N: 'expected_outcome' vacío`, `máximo N pasos; se recibieron M`) | `El plan no tiene steps válidos (mcp, goal, expected_outcome).` (el adaptador `parsePlanSteps` descarta el `{ error }` y devuelve `null`) |
| `plan` (demasiados pasos) | `máximo N pasos; se recibieron M` | `El plan tiene M pasos pero el schema permite hasta N.` |
| `arguments` (schema) | `problem` tal cual | `Argumentos inválidos: ` + problemas |
| `final` (vacío) | `salida vacía` | `La respuesta final está vacía después de stripThink.` |
| `question` (vacío) | `salida vacía` | `La pregunta está vacía después de stripThink.` |

- **Orden de las comprobaciones (`plan`):** producción valida primero cada paso (y el tope `BUDGET.maxSteps`) y después el tope `input.maxSteps`; el eval comprueba primero el `maxItems` del schema enviado. Con un plan que viola ambas cosas, el error que se le devuelve al modelo es distinto.
- **Por qué es desalineación:** el modelo recibe un segundo prompt distinto del de producción, y el resultado de los reintentos deja de ser comparable. El tipo de falla y el tope de intentos sí coinciden.
- **Lo que la documentación ya admite:** `INSTRUCCIONES.md` §3 dice que los mensajes del reintento "pueden diferir en el texto" de los de producción, pero el título de esa sección sigue siendo "iguales a producción" y el README afirma "mismos reintentos".

## D3. Un mismo run describe intentos distintos cuando hubo reintento

- **Dónde:** `eval/core/runner.ts` (`runGenerative`) vs la documentación de `RunRecord` en `eval/core/types.ts`.
- **Qué pasa:**
  - `requestHash` se calcula sobre `prepared.body`, el primer request.
  - `rawInput` guarda `usedBody`, el body del último intento (con `retryNote`, tokens y temperatura de reintento).
  - `requestParams` (temperatura, thinking, `maxTokens`, `timeoutMs`) describe el primer intento.
- **Por qué es desalineación:** `types.ts` documenta `requestHash` como "sha256 del request ya transformado" y `rawInput` como "lo que se envió". En runs reintentados, hash, `rawInput` y `requestParams` corresponden a requests distintos, y el hash no identifica lo que está en `rawInput`.

## D4. README vs `results.ts`: ubicación y nombre de las carpetas de resultados

- **Dónde:** `eval/README.md` (sección "Cómo funciona") vs `eval/core/results.ts` (`runRootDir`, `timestampDir`).
- **Qué pasa:**
  - El README documenta `eval/results/<modelo>/<fecha>/`.
  - El código manda las corridas `--client=oracle` y `--client=mock` a `eval/results/_oracle/<ts>` y `eval/results/_mock/<ts>`, no a `<modelo>/`.
  - `<fecha>` es `YYYY-MM-DD_HHmmss`.
  - Se agregan sufijos `_<label>` (con `--label`) y `-2`, `-3` (colisión en el mismo segundo).
- **Por qué es desalineación:** el README no describe dónde queda realmente una corrida `oracle`/`mock` ni el formato real de la carpeta. `INSTRUCCIONES.md` §3 sí lo describe bien (`_oracle`, `_mock`, `-2`, `-3`, `<YYYY-MM-DD_HHmmss>[_<label>]`); la desalineación es solo del README.

## D5. Encabezado de `oracle.ts` contradice su propio código y usa claves que producción no tiene

- **Dónde:** `eval/core/client/oracle.ts`, comentario de cabecera vs `oracleDecisionResponder` y `targetChoice`; `src/core/models/prompts.ts` (`DECISION_PROMPTS`).
- **Qué pasa:**
  - El encabezado dice que con una variante que cambia preguntas u opciones el oráculo "cae a la primera opción".
  - El código trae mapeos explícitos para `args_grounded`, `args_invalid`, `needs_user`, `effect_ok`, `target_ok`, `content_ok`, y para la pregunta `choice` de `result_verification` con `matches` / `mismatch` / `failed` / `unconfirmed`.
  - Producción tiene una sola pregunta `choice` (`review`: `approved`, `args_invalid`, `info_missing`) en `args_review` y dos `noul` (`ok`, `cumple`) en `result_verification`. Ninguna de esas claves existe en producción.
  - `INSTRUCCIONES.md` se contradice en el mismo punto: §2 (`--client`) dice que `oracle` "solo vale con la variante `prod`", pero §3 ("Oráculo") dice que "responde las preguntas adicionales según `expect.answers`". Con `prod` no hay preguntas adicionales: `MAIN_QUESTIONS` cubre todas las de producción, y `questions.ts` solo trata como `extra` las que trae una variante.
- **Por qué es desalineación:** la limitación documentada no describe lo que el código hace, y el código atiende preguntas que solo podría traer una variante (las descartadas, según el README, ya se eliminaron).

## D6. Los comentarios sobre qué archivos importan `src/` no coinciden con los imports reales

- **Dónde:** `eval/core/types.ts` (cabecera), `eval/core/scenario.ts` (cabecera) vs los imports de `types.ts`, `runner.ts`, `config.ts`.
- **Qué pasa:**
  - `types.ts` dice "Solo importa tipos de `contract.ts` (que los toma de `src/`)", pero importa `UserEnvironment` de `../../src/core/environment.ts`.
  - `scenario.ts` dice "Esto es lo único del eval que importa `src/` (el resto sigue aislado; ver `contract.ts`)". Además de `contract.ts` (la vía declarada), importan `src/` directamente `runner.ts` (`engine/precheck.ts`), `config.ts` (`core/config.ts`) y `types.ts`.
  - `INSTRUCCIONES.md` §8 repite la regla: "Importan `src/` solo `core/scenario.ts` y `core/contract.ts` … el resto del eval pasa por ellos". `cross.ts` importa `src/core/engine/precheck.ts` y `src/core/tools/manifest.ts` directamente, y `psvalid.ts` importa `src/core/engine/precheck.ts`.
- **Por qué es desalineación:** la regla de aislamiento que declaran los comentarios y `INSTRUCCIONES.md` no es la que cumple el código.

## D7. El pre-chequeo de `arguments` no repite el de producción como dice la documentación

- **Dónde:** `eval/core/runner.ts` (`runGenerative`, llamada a `precheckCall`) vs `eval/core/types.ts` (`Case.meta`), `eval/core/scenario.ts` (`scenarioPrecheck`) y `src/core/engine/precheck.ts`.
- **Qué pasa:**
  - `types.ts` dice que el runner "repite el pre-chequeo de producción (6b) sobre la salida".
  - El runner llama a `precheckCall` con `kind: "write"` fijo y `sources: { text: "", complete: false }`.
  - Con `complete: false`, `checkSources` retorna `null` siempre: nunca se comprueban URLs ni rutas de lectura sin origen. Solo corren valores vacíos/`N/A`, marcadores, rutas de otro usuario y análisis de comandos.
  - El propio eval ya tiene otra construcción en `scenario.ts` (`scenarioPrecheck`, para `args_review`): calcula `kind` con `getToolPolicy(serverOf(route), tool.name).mutates` y las fuentes con `collectSources(ctx)`, y la documenta como "el mismo código que corre `runCall`".
  - El caso `arguments` no conserva el contexto del escenario: `Case.meta` solo lleva `toolSchema`, `toolName` y `environment`, de modo que el runner no puede calcular `sources`.
  - El encabezado de `precheck.ts` dice que las reglas se aplican "sobre los argumentos ya resueltos"; el runner le pasa la salida cruda del modelo (`parsed.args`), con los tokens `{{ref:rX}}` sin resolver.
- **Producción (`src/core/engine/callRunner.ts`, línea 361):** `precheckCall({ tool: tool.name, kind, args: resolved, sources: collectSources(ctx), environment })`: argumentos con las refs ya resueltas, `kind` de la política de la herramienta y las fuentes reales del contexto.
- **Por qué es desalineación:** el pre-chequeo de `arguments` corre un subconjunto del de producción, mientras la documentación y el README ("fiel a producción") lo presentan como el de producción, y el eval usa otro criterio en `scenarioPrecheck`.
## D8. `generative()` descarta campos del `StageRequest` de producción y el runner los redefine por nombre de etapa

- **Dónde:** `eval/core/scenario.ts` (`generative`, llamada a `argsInput`) y `eval/core/runner.ts` (`runGenerative`) vs `src/core/models/stageRequests.ts` (`StageRequest`, `argumentsStageRequest`, `finalStageRequest`) y `src/core/engine/adapters.ts` (`argsInput`).
- **Qué pasa:**
  - `StageRequest` trae `temperature` (en `arguments`: `argsTemperature(priorAttempts)`) y `retryThinking` (en `final`: `false`). `generative()` no lee ninguno: fija `temperature: BASE_TEMPERATURE` y no copia `retryThinking`.
  - El runner repone el equivalente de `retryThinking` con una regla propia: `thinking: fc.stage === "final" ? false : req.thinking`.
  - `argsInput(tool, environment, view, priorAttempts = 0)` de producción acepta `priorAttempts`; `scenario.ts` lo llama con tres argumentos y `ScenarioAt` no tiene ese campo, así que un caso `arguments` siempre se arma como primer intento.
- **Por qué es desalineación:** `scenario.ts` afirma que los "parámetros de cada etapa llegan al modelo tal como en producción" y el README, que "si `src` cambia, el eval se actualiza solo". Hoy los valores coinciden (primer intento = 0.1; `final` sin thinking al reintentar), pero lo que cambie en `temperature` o `retryThinking` dentro de `src` no llega al eval, y la política de temperatura de `arguments` con intentos previos (0.3 / 0.5) no se puede ejercitar.

## D9. `stageConfigHash` incluye los tokens de `ask` pero no los de `pending`

- **Dónde:** `eval/core/scenario.ts` (`promptEnvironment`) vs `src/core/budget.ts`, `src/core/models/stageRequests.ts` y `eval/core/types.ts` (`RunMeta.promptEnv`).
- **Qué pasa:**
  - El hash se calcula sobre `{ qwenMaxTokens, thinking, askMaxTokens: BUDGET.ask.maxTokens }`.
  - `pendingStageRequest` toma su `maxTokens` de `BUDGET.pending.maxTokens` (1024), que no entra en el hash.
- **Por qué es desalineación:** el comentario dice que el hash cubre "la configuración que fija tokens y thinking por etapa" y que sirve para explicar por qué cambió un `requestHash`. Un cambio en los tokens de `pending` cambia el request sin cambiar `stageConfigHash`.

## D11. Timeouts y contexto máximo de decisión fijados en el eval, aunque `config.ts` dice que no puede divergir de producción

- **Dónde:** `eval/core/config.ts` (`TIMEOUT_GENERATIVE`, `TIMEOUT_THINKING`, `TIMEOUT_DECISION`) y `eval/core/client/decision.ts` (`DECISION_MAX_CONTEXT`) vs `src/core/config.ts` (`qwenTimeoutMs`, `qwenThinkingTimeoutMs`, `decisionTimeoutMs`, `decisionMaxContext`).
- **Qué pasa:**
  - El comentario de `eval/core/config.ts` dice que los defaults salen de la configuración de producción "así el eval mide por defecto lo que corre Jarvis y no puede divergir en silencio". Eso se cumple para modelos y URLs (`PROD.qwenModel`, `PROD.qwenUrl`, `PROD.decisionUrl`, `PROD.decisionModel`).
  - Los timeouts son constantes propias (120 000, 180 000, 30 000 ms) y `DECISION_MAX_CONTEXT` es 16384 escrito a mano ("`decisionMaxContext` de producción").
  - En producción los cuatro valores son configurables (`jarvis-config.json`).
- **Por qué es desalineación:** hoy coinciden con los defaults de `DEFAULT_CONFIG`, pero un cambio en `jarvis-config.json` o en los defaults de `src` no llega al eval, que es justo la divergencia silenciosa que el comentario dice evitar.

## D12. El body generativo no replica la reserva de contexto de producción

- **Dónde:** `eval/core/client/generative.ts` (`buildGenerativeBody`, cabecera) vs `src/core/models/qwen.ts` (`reserveCompletionTokens`, `dispatchPrompt`).
- **Qué pasa:**
  - La cabecera dice que el cliente "envía exactamente el body que envía producción".
  - Producción envía `max_tokens = min(maxTokens, qwenNumCtx − tokens estimados del prompt)` y, si ese margen es menor a 256, no envía nada y lanza `LLMValidationError`.
  - El eval envía siempre `req.maxTokens` y no rechaza prompts sin margen (solo las decisiones tienen un aviso de contexto, `decision_context_ok`).
- **Por qué es desalineación:** con prompts largos el body del eval difiere del de producción (`max_tokens` mayor) y casos que producción rechazaría antes de enviar se miden como llamadas normales.

## D13. Los clientes del eval no replican las comprobaciones de URL de producción

- **Dónde:** `eval/core/client/generative.ts` (`resolveUrl`) vs `src/core/models/qwen.ts` (`resolveUrl`).
- **Qué pasa:** el comentario dice "`resolveUrl` de producción", pero producción hace `trim()` de la URL y lanza un error de configuración si queda vacía; el eval no hace ninguna de las dos cosas. Con una URL vacía (por ejemplo `qwenUrl: ""` en `jarvis-config.json`, que `normalize` admite) el eval construye `/v1/chat/completions` y falla recién al llamar, como error de red.
- **Cliente de decisión:** `Decision20Engine.systemOne` lanza `DecisionServiceUnavailableError` ("La URL de Decision 2.0 no está configurada") si `decisionUrl` está vacía. `createDecisionClient` (`eval/core/client/decision.ts`) no lo comprueba: construye `/v1/systemone` y falla al llamar, como error de red.
- **Por qué es desalineación:** la copia de `resolveUrl` no es equivalente a lo que dice copiar, y en ambos clientes el error de configuración de producción se convierte en un fallo de transporte.

## D14. El runner no usa `isTransportError`, que `generative.ts` declara como contrato

- **Dónde:** `eval/core/runner.ts` (`runDataset`, detección de fallo de red) vs `eval/core/client/generative.ts` (`isTransportError`).
- **Qué pasa:** `isTransportError` se documenta como "el contrato entre los clientes y el runner" y pide que quien clasifique un error la use "en vez de comparar textos". El runner compara los textos a mano (`err.startsWith("network:") || err === "timeout" || err.startsWith("http_")`).
- **Por qué es desalineación:** hoy los textos coinciden, pero la regla declarada no se cumple y un cambio en los textos de `postJson` rompería la detección de `allNetworkFailed` sin aviso.

## D15. Un payload que excede el contexto de decisión: producción no lo envía, el eval sí

- **Dónde:** `eval/core/runner.ts` (`runDecision`, `collector.soft("decision_context_ok", …)`) y `eval/core/client/decision.ts` (`estimateDecisionPromptTokens`) vs `src/core/models/decision.ts` (`systemOne`).
- **Qué pasa:**
  - Producción estima los tokens de `JSON.stringify({ state, questions })` y, si superan `decisionMaxContext`, lanza `DecisionValidationError` con `overflow = true` sin enviar nada.
  - El eval hace la misma estimación, pero solo registra una advertencia (`soft`) y envía la consulta igual. La advertencia no afecta `pass`.
- **Por qué es desalineación:** un caso que producción rechazaría como desborde (en la verificación, `verify.ts` cierra la tarea con `unrecoverable`) se mide en el eval como una decisión normal y puede pasar.

## D16. El eval no repite una respuesta de decisión inválida; producción sí

- **Dónde:** `eval/core/runner.ts` (`runDecision`) vs `src/core/engine/failures.ts` (`queryModel`) y `src/core/engine/verify.ts` (`verifyCall`).
- **Qué pasa:**
  - `queryModel` repite una vez (`BUDGET.invalidResponseRetries`) la consulta cuando falla con un `DecisionValidationError` sin `overflow` (respuesta que no es JSON, sin `answers`, opción fuera de `criteria`, `noul` fuera de [0, 1]). `failures.ts` lo declara para "Decision y el verificador", y `verifyCall` usa el valor por defecto.
  - El eval hace una sola llamada por run de decisión: una respuesta inválida queda como `output_parse_ok: false` y el caso falla.
  - `INSTRUCCIONES.md` §3, bajo el título "Reintentos (iguales a producción)", dice que "las etapas de decisión no tienen este reintento". Describe lo que hace el eval, pero no menciona que producción sí repite la decisión.
- **Por qué es desalineación:** en producción una respuesta malformada se vuelve a consultar y puede terminar bien; en el eval cuenta como fallo. Contradice el "mismos reintentos" del README y el título de la sección de `INSTRUCCIONES.md`. Confirmado de forma directa para la verificación; para `route`, `tool_choice` y `args_review` no se vio el llamador, pero `failures.ts` declara la política para Decision en general.

## D17. La documentación dice que `prod` siempre se incluye; el código permite excluirla

- **Dónde:** `INSTRUCCIONES.md` §2 (fila `--variant` y fila `--menu`) vs `INSTRUCCIONES.md` §2 (fila `--no-baseline`) y `eval/wizard.ts` (paso 3).
- **Qué pasa:**
  - La fila `--variant` dice "`prod` siempre se incluye como baseline de comparación" y la fila `--menu` dice "variantes (prod siempre se incluye)".
  - La fila `--no-baseline` dice lo contrario: no agrega `prod`. El asistente ofrece esa opción (`¿Incluir prod como baseline?`) y, si se responde que no, arma `--variant=<elegidas> --no-baseline`.
- **Por qué es desalineación:** dos filas de la misma tabla se contradicen, y la descripción de `--menu` no corresponde al flujo del asistente.

## D18. El asistente muestra una concurrencia por defecto distinta de la de la CLI y no permite elegir 1

- **Dónde:** `eval/wizard.ts` (`positiveInt("Concurrencia", "1", "concurrency", …)`) vs `eval/core/config.ts` (`int(flags, "concurrency", 1) ?? 3`) e `INSTRUCCIONES.md` §2 (default `3`).
- **Qué pasa:**
  - El asistente propone `[1]` y solo agrega `--concurrency=<v>` cuando el valor difiere de ese `"1"`.
  - Si se acepta el default o se escribe `1`, el comando no lleva el flag y `parseConfig` aplica `3`.
  - El comando equivalente que muestra el asistente tampoco lleva el flag, de modo que el valor aplicado no se ve.
- **Por qué es desalineación:** quien pide concurrencia 1 en el asistente (por ejemplo, para medir latencias, como el propio asistente sugiere) corre con 3 y las latencias dejan de ser comparables. La documentación y `config.ts` coinciden entre sí; el desalineado es el asistente.

## D19. La numeración de pasos del asistente quedó desactualizada

- **Dónde:** `eval/wizard.ts` (comentario de `step`, `TOTAL_STEPS`, comentario "// 7. Resumen y confirmación").
- **Qué pasa:** el comentario de `step` dice "Paso 2/6" y el resumen se numera como paso 7, pero `TOTAL_STEPS = 5` y hay cinco llamadas a `step(...)`.
  - La ayuda de `cli.ts` (`--help`) describe `--menu` como "elige modo, modelos, datasets, variantes y opciones": el asistente no tiene un paso de modo y sí uno de etapas.
- **Por qué es desalineación:** los comentarios y la ayuda describen un asistente de seis o siete pasos y el código tiene cinco.

## D20. El comentario de `gradeExtraQuestions` dice un check por pregunta; el código registra hasta dos

- **Dónde:** `eval/core/questions.ts` (comentario de `gradeExtraQuestions`) vs el cuerpo de la función y `INSTRUCCIONES.md` §3.
- **Qué pasa:** el comentario dice "Un check por pregunta (`q_<clave>_match`)". Con `minProbability` el código registra además `q_<clave>_min_probability`, y `INSTRUCCIONES.md` sí lista los dos.
- **Por qué es desalineación:** el comentario no describe lo que la función hace.

## D21. `forbiddenHardcodedValues` usa una coincidencia distinta de la regla documentada para los textos

- **Dónde:** `eval/core/graders/arguments.ts` (`no_hardcoded_<i>`) vs `INSTRUCCIONES.md` §4 y §7, y `eval/core/graders/common.ts` (`containsTerm`).
- **Qué pasa:**
  - `INSTRUCCIONES.md` documenta que los textos de `expect` se buscan "por palabra o frase completa, sin distinguir mayúsculas ni acentos", que un número no coincide dentro de otro (`12` no está en `120`) y que `|` admite alternativas.
  - Los graders de `plan`, `final`, `question` y `pending` usan `containsTerm`, que cumple esa regla.
  - `arguments.ts` busca `forbiddenHardcodedValues` con `includes` sobre `normValue` (minúsculas y `\` → `/`): sin límite de palabra, sin quitar acentos y sin alternativas con `|`. Un valor prohibido `12` aparece prohibido en `120`.
- **Por qué es desalineación:** la documentación presenta una sola regla de coincidencia para los textos y no aclara que este campo usa otra. El comentario del grader justifica la normalización de rutas, pero ni él ni `INSTRUCCIONES.md` dicen que el resto de la regla no se aplica.

## D22. `cross.ts` fija `prod` como baseline, aunque el eval permite otra o ninguna

- **Dónde:** `eval/cross.ts` (`crossReport`, `const baseline = "prod"`) vs `INSTRUCCIONES.md` §2 (`--baseline`, `--no-baseline`).
- **Qué pasa:** la comparación pareada se hace contra `outcome("prod", "d3")`. Si la corrida usada en `--runs` no tiene la celda `prod` (por ejemplo, se corrió con `--no-baseline`), ese mapa queda vacío. Entonces cada caso se salta (`y === undefined`), todas las filas muestran `0/0, p=1.00` y no hay ninguna advertencia.
- **Por qué es desalineación:** el eval documenta que la baseline es configurable y que puede no haber `prod`; `cross.ts` lo ignora y presenta como comparación lo que es ausencia de datos.

## D23. `cross.ts` resuelve `--dataset` distinto de la CLI

- **Dónde:** `eval/cross.ts` (`loadCases`) vs `INSTRUCCIONES.md` §2 (`--dataset`) y `eval/README.md`.
- **Qué pasa:**
  - La CLI acepta nombres, nombres con `.jsonl`, rutas, carpetas y globs.
  - `cross.ts` solo lee `eval/datasets/<nombre>.jsonl`: `--dataset=smoke.jsonl` busca `smoke.jsonl.jsonl` y falla, y no entra a subcarpetas, aunque el README ubica los datasets cargados a mano en `eval/datasets/<etapa>/`.
- **Por qué es desalineación:** el mismo flag, en el mismo conjunto de herramientas, tiene otra semántica y no está documentada.

## D24. El umbral de aprobación que documenta el eval y usa `cross.ts` (0.5) no es el de producción (0.6)

- **Dónde:** `eval/cross.ts` (`d4Report`), `eval/core/types.ts` (comentario de `QuestionResult.answer`) e `INSTRUCCIONES.md` §3 ("`answer` es `yes` o `no` (> 0.5)") vs `src/core/engine/verify.ts:30` (`NOUL_APPROVE = 0.6`) y `eval/core/questions.ts` (`r >= NOUL_APPROVE`).
- **Qué pasa:**
  - Producción aprueba una pregunta `noul` con probabilidad `>= 0.6`, y `questions.ts` usa esa constante.
  - `types.ts` e `INSTRUCCIONES.md` describen el umbral como "> 0.5".
  - `cross.ts` no importa la constante: cuenta "aprobados" y "falsos aprobados" con `p > 0.5` literal (columnas "Buenos aprobados (> 0,5)" y "Falsos aprobados (> 0,5)"). El `>= 0.9` de "auto-aprobados" es otro literal propio.
- **Por qué es desalineación:** una respuesta con probabilidad entre 0.5 y 0.6 que producción rechaza figura como aprobada en el informe de `cross.ts`, y la documentación y el comentario de `types.ts` describen un umbral que el código no aplica.

## D25. `cross.ts`, `eval:cross`, `eval:psvalid` y `eval/results/_cross/` no figuran en la referencia, que se presenta como completa

- **Dónde:** `eval/README.md` ("Toda la referencia está en `INSTRUCCIONES.md`: flags, formato de casos…, estructura del código"), `INSTRUCCIONES.md` §1, §3 y §8 vs `package.json` y `eval/cross.ts`.
- **Qué pasa:**
  - `package.json` define `eval:cross` (`eval/cross.ts`) y `eval:psvalid` (`eval/psvalid.ts`). `INSTRUCCIONES.md` §1 menciona solo `eval` y `eval:smoke` (y `eval:menu` en la fila de `--menu`). El README nombra `eval:cross` pero no `eval:psvalid`.
  - El árbol de §8 no incluye `cross.ts`, `psvalid.ts` ni `gen/`, que el README sí nombra.
  - `cross.ts` escribe en `eval/results/_cross/<YYYY-MM-DD-HH-mm>[_label]/` (`cross.md`, `cross.json`); §3 describe `_oracle` y `_mock`, pero no `_cross`.
  - Los flags de `cross.ts` (`--dataset`, `--runs`, `--label`) y el uso de `psvalid.ts` (recibe la carpeta de la corrida y mide cuántos `command` de `arguments` son PowerShell válido) solo están en el comentario de cabecera de cada archivo.
- **Por qué es desalineación:** el README remite a `INSTRUCCIONES.md` como referencia total, y esa referencia no cubre parte de las herramientas y salidas del eval.

## D26. `INSTRUCCIONES.md` lista `tool_rejected` como etiqueta de `args_review`; producción no la tiene

- **Dónde:** `INSTRUCCIONES.md` §1 (tabla de etapas, fila `args_review`) vs `src/core/models/prompts.ts` (`REVIEW_OPTIONS`, `buildArgsReview`).
- **Qué pasa:**
  - La tabla dice `approved`, `args_invalid`, `tool_rejected` o `info_missing`.
  - `REVIEW_OPTIONS` está tipado como `Record<ArgsReview, string>` y tiene tres claves: `approved`, `args_invalid`, `info_missing`. `buildArgsReview` arma las opciones de la pregunta `review` con `ARGS_REVIEWS` y esos textos.
  - `tool_rejected` aparece en `prompts.ts` solo como estado de una llamada ya registrada, en la guía de `FINAL_VIEW` ("tool_rejected, info_missing, user_rejected o refs_unresolved nunca se ejecutó"), no como respuesta de la revisión.
  - `src/core/contracts.ts` lo dice expresamente: "No hay `tool_rejected`: la herramienta la elige Decisión 2" (`ARGS_REVIEWS = ["approved", "args_invalid", "info_missing"]`).
  - El propio eval coincide con producción: `ArgsReviewExpect.expectedReview` en `types.ts` es `"approved" | "args_invalid" | "info_missing"`.
- **Por qué es desalineación:** como el código de `src` es la fuente de verdad, la documentación enumera una etiqueta que el modelo nunca puede devolver en esta etapa.

## D27. `INSTRUCCIONES.md` documenta `filters.source` en `meta.json`; el tipo no lo tiene

- **Dónde:** `INSTRUCCIONES.md` §3 (`meta.json`: "`filters` (`tags`, `ids`, `source`, `limit`)") vs `eval/core/types.ts` (`RunMeta.filters`).
- **Qué pasa:** `RunMeta.filters` es `{ tags: string[]; ids: string[]; limit: number | null }`. No existe `source`.
- **Por qué es desalineación:** la documentación describe un campo que `meta.json` no guarda.

## D28. Un comentario de `config.ts` habla de variantes compuestas (`prod+x`), que ya no existen

- **Dónde:** `eval/core/config.ts` (comentario sobre `variantSpecs`: "la comparación usa spec exacta, `prod+x` no cuenta") vs `INSTRUCCIONES.md` §2 y §6 y `types.ts` (`Variant`).
- **Qué pasa:** `INSTRUCCIONES.md` dice que "la composición con `+` ya no existe y da error", y `Variant` documenta que no hay composición de variantes. El comentario sigue describiendo el caso `prod+x`.
- **Por qué es desalineación:** el comentario describe una función que el resto del eval declara eliminada.

## D29. `--client=oracle` solo vale con `prod` según la documentación, pero nada lo exige

- **Dónde:** `INSTRUCCIONES.md` §2 (`--client`) vs `eval/core/config.ts` (`parseConfig`), `eval/cli.ts` (`makeClients`, `main`) y `eval/wizard.ts` (pasos 3 y 5).
- **Qué pasa:** `INSTRUCCIONES.md` dice que `oracle` "solo vale con la variante `prod`" y que con él "debe dar 100 %: si un caso falla, el bug está en el caso, un grader o el parseo". Ninguno de los tres archivos comprueba la combinación `--client=oracle` con variantes distintas de `prod`, y el asistente permite elegirla.
- **Por qué es desalineación:** según `oracle.ts` (D5), con una variante que cambia preguntas u opciones el oráculo no las entiende. La corrida sigue sin aviso y los fallos que produce contradicen la regla "100 % o el bug está en el caso" que documenta `INSTRUCCIONES.md`.

## D30. La documentación describe un fallo de variante por run; el código lo trata como error de carga

- **Dónde:** `INSTRUCCIONES.md` §3 (`scores.json`: "cuya variante no se pudo aplicar cuentan como falla"; "Qué cuenta como pasó": "Si la variante no se puede aplicar, el run falla sin llamar al modelo"; códigos de salida: "`--dry-run` con alguna variante que no se pudo aplicar") vs `eval/cli.ts` (`main`) y `INSTRUCCIONES.md` §4 y §6.
- **Qué pasa:**
  - `cli.ts` arma los casos de cada variante antes de correr (`loadDatasets(…, vr.variant)`, "el runner solo envía"). Si falla, escribe "Error de dataset con la variante…" y sale con `2`, tanto en corrida real como en `--dry-run`; no se genera ningún run.
  - `INSTRUCCIONES.md` §6 y §4 dicen lo mismo: un error en el constructor o un request mal formado "es error de carga, con el caso y la línea".
  - En el `runner.ts` revisado, la rama de `--dry-run` de `runDecision` y `runGenerative` solo imprime el request y devuelve el run con `passed: false` y sin errores; `cli.ts` ignora ese resultado y termina con `0`. No hay en esas ramas ningún fallo por variante no aplicada.
- **Por qué es desalineación:** §3 describe runs que fallan por variante y un código `2` propio de `--dry-run`, pero el código aborta toda la invocación al cargar, en cualquier modo, antes de crear runs. El código `2` sí se produce, pero por la vía de carga y no por la que describe §3.

## Por confirmar

Ninguno.

---

## Sin desalineación en lo revisado

- Registro de etapas: nueve, coherente con README, `types.ts` y `case.ts` (`ALL_STAGES`).
- Tope de reintentos generativos (`BUDGET.invalidResponseRetries`), factor de tokens (1.5x) y `final` sin thinking en el reintento.
- Regla de truncado: JSON nunca acepta salida truncada; `final`/`question` la aceptan en el último intento.
- Reglas de `pass` estricto, scoring, comparación, prueba de signos y reporte por tipo de modelo.
- `schemaName`: `scenario.ts` lo pasa explícito para `plan` y `pending`, igual que el nombre de etapa de producción.
- Orden de claves y campos del body generativo (`model`, `messages`, `temperature`, `max_tokens`, `stream`, `reasoning_effort`, `response_format`).
- Prefijos de error de transporte (`timeout`, `network:`, `http_`): coinciden entre `postJson` y el runner.
- Modelos por defecto del README (`qwen3.5:4b`, `d3:2b`): coinciden con `DEFAULT_CONFIG` de producción.
- Claves de `MAIN_QUESTIONS` (`route`, `selected_tool`, `review`, `ok`/`cumple`), union `expectedReview` y `ARGS_REVIEWS`: coinciden con las preguntas de `DECISION_PROMPTS`. El umbral `NOUL_APPROVE` y `reviewOutcome` se reutilizan de producción.
- Carga de datasets: `datasets.ts` rechaza `request` y exige `scenario`, como dicen `types.ts` y el README; `case.ts` valida `expect` con claves cerradas y toma `ARGS_REVIEWS` de producción.
- Cliente de decisión: URL `/v1/systemone`, body `{ model, state, questions }` (mismo orden de claves) y estimación de tokens sobre el mismo payload que `systemOne`.
- Atajo de una sola opción: producción omite la consulta en `chooseRoute` y `chooseTool`, y el eval etiqueta esos casos `prod_shortcut` solo para esas dos etapas.
- Validación de la respuesta de decisión: el eval usa `parseAnswersObject` y `validateAnswer` de producción; `NOUL_APPROVE` y el mapeo de `ok`/`cumple` coinciden con `verdictOf`.
- Graders `arguments`, `plan`, `final`, `question`, `pending`, `label` y `common`: los checks coinciden con lo que describe la tabla de etapas de `INSTRUCCIONES.md`. Las claves de `expect` de `pending` (`expectEmpty`, `maxItems`, `requiredKeywordsInFirst`, `forbiddenKeywords`) coinciden con las documentadas, y `containsTerm` implementa la regla de coincidencia documentada (palabra completa, sin acentos, `|`, números), salvo el caso de D21.
- `core/questions.ts`: `role` principal/extra, parseo por pregunta, `q_<clave>_match`, `q_<clave>_min_probability`, warning `q_<clave>_sent`, la principal fuera de `expect.answers` y "pregunta sin expectativa: se registra pero no se evalúa" coinciden con "Decisiones con varias preguntas" de `INSTRUCCIONES.md`.
- `package.json`: `eval`, `eval:menu`, `eval:smoke` (mock + `--dry-run` sobre `smoke.jsonl`) y `eval:cross` coinciden con README e `INSTRUCCIONES.md`.
- `wizard.ts`: todos los flags que arma (`--model`, `--dataset`, `--variant`, `--no-baseline`, `--stages`, `--client`, `--repeat`, `--concurrency`, `--limit`, `--thinking`, `--label`, `--dry-run`) existen en `INSTRUCCIONES.md`, con las mismas opciones y la misma sintaxis `--flag=valor`; la exigencia de terminal interactiva coincide.
- `INSTRUCCIONES.md` §6: los helpers y tablas que dice exportados (`frameLines`, `listBlock`, `lastFailedBy`, `REVIEW_OPTIONS`, `VERIFY_QUESTIONS`, `join`, `todayLine`), `PROMPTS` (`PLAN_VIEW`, `ARGUMENTS_VIEW`, `FINAL_VIEW`, `QUESTION`, `PENDING_VIEW`) y los cuatro constructores de `DECISION_PROMPTS` existen en `prompts.ts` con esos nombres.
- Grader de `question`: la regla de producción es de prompt ("do not mention tools, ids or internal steps"; en `final`, ids como c1/s2/r3 y estados como `loop_blocked`). `INTERNAL_LEAK_RE` la aplica con ids y snake_case sin contradecirla; no hay un filtro de código en `prompts.ts` que replicar.
- `refResolver.ts` vs `arguments.ts`: las formas de ref coinciden (`{{ref:rN}}` embebido, y `{{ref:rN}}` o `ref:rN` como valor completo; `r1` desnudo no cuenta; ids en minúsculas). Son copias de las expresiones de producción: hoy equivalentes.
- `RunRecord` (`types.ts`) vs `cross.ts` y `psvalid.ts`: existen `stage`, `caseId`, `iteration` (1..repeat), `predictedLabel`, `expectedLabel` y `parsedOutput`. `expectedLabel` de `result_verification` se arma como `ok=<bool>,cumple=<bool>`, igual que la comparación de `cross.ts`, y `ResultVerificationOutput` trae `okProbability` y `cumpleProbability`; `ArgumentsOutput` trae `args`.
- `config.ts` vs `INSTRUCCIONES.md` §2: los flags conocidos, los errores de sintaxis (desconocido, repetido, sin valor, vacío, número no simple, CSV vacío), `--no-baseline` (exige `--variant`; baseline = primera variante), `--baseline` entre las variantes, `--min-pass-rate` en 0–1, `--model` (un solo modelo por tipo) y los defaults (`repeat 1`, `concurrency 3`, `thinking auto`, `client real`, `eval/datasets/`) coinciden. Todos los flags que arma el asistente están en `KNOWN_FLAGS`.
- `stages/decision.ts` y `stages/generative.ts` vs `INSTRUCCIONES.md`: graders por etapa, `NotTruncatedGrader` solo en las generativas, `read.args_review` y `read.result_verification` como únicas lecturas configurables, y la validación de `pending` con `parsePendingList` de producción.
- `cli.ts` vs `INSTRUCCIONES.md`: `--help`, `-h` y `--menu` se atienden antes de `parseConfig` (por eso no están en `KNOWN_FLAGS`); códigos de salida `0`, `1` (celdas bajo `--min-pass-rate`, incluida la regla "todas las no baseline, o la baseline si corrió sola", y las celdas sin runs) y `2` (configuración, dataset, filtros sin casos, variante que no carga, todas las llamadas fallaron, ninguna corrida canónica); el bloque de configuración no se imprime en `--dry-run`; `meta.json` se cierra aunque el runner lance.
- `contracts.ts` vs `eval/core/types.ts`: las tres opciones de `ARGS_REVIEWS` coinciden con `ArgsReviewExpect.expectedReview`, y las dos preguntas de `VERIFY_CHECKS` (`ok`, `cumple`) con las de `result_verification`.
- Transporte (`postJson`): un reintento en red o 503 tras `LLM_TRANSPORT_BACKOFF_MS`, timeout como presupuesto total que incluye el reintento y sin reintento de timeout; coincide con `models/transport.ts`.

---

## Cobertura

Revisado: núcleo del eval (`cli`, `config`, `runner`, `results`, `report`, `scoring`, `scenario`, `case`, `datasets`, `contract`, `types`, `stages/*`, `clients/*`, `variants/load|labels|types`, `questions`, todos los `graders/*`), `wizard.ts`, `cross.ts`, `psvalid.ts`, `README.md`, `INSTRUCCIONES.md`, `package.json` (sección `scripts`) y los archivos de `src` de los que depende, incluidos `prompts.ts`, `refResolver.ts` y `contracts.ts`; del `runner.ts` se vieron `runDecision`, `runGenerative` y el bucle de `runDataset` (ramas de `--dry-run`).

Sin revisar: `eval/gen/*` (el README los nombra; no se documentan en `INSTRUCCIONES.md`, ver D25). Las variantes y los datasets quedan fuera por decisión del usuario.
