# Pendientes Sujetos a Evaluación (`eval`) o Decisión de Producto (2026-11-15)

Durante la auditoría técnica del 2026-11-15 se identificaron **3 cambios que modifican texto o datos visibles por los modelos** y **1 decisión de contrato HTTP**. Siguiendo el criterio de no alterar prompts ni el comportamiento HTTP existente sin medición y aprobación explícita, ninguno fue aplicado en código de producción.

---

## 1. Cambios visibles por los modelos (requieren aprobación y corrida de `eval`)

### P-EVAL-01 (Recomendado priorizar) — Incluir la última lectura aprobada en `done` de `forRoute`

- **Ubicación:** `src/core/ctx/views/route.ts:22-27`
- **Problema observado:** Desde la actualización en que `route` y `tool` (D1 y D2) dejaron de renderizar `Last result` (`DecisionFrame.lastResult` se ignora en el prompt y `decisionFrame` en `src/core/engine/adapters.ts:149` emite `null`), `buildRouteView` sigue excluyendo la última lectura aprobada (`last`) de `done`:

```ts
// Actual (src/core/ctx/views/route.ts:22-27)
const last = reactive ? lastResultOf(data.calls) : null;
return {
  request: reactive ? data.task.request : null,
  step: step === null ? null : stepViewOf(step),
  lastResult: last === null ? null : callViewOf(data, last, false),
  done: reactive ? doneCalls(data.calls).filter((c) => c.id !== last?.id).map(lineViewOf) : [],
```

- **Impacto actual:** En modo reactivo, si la última llamada aprobada del paso anterior fue una lectura (`list_directory`, `read_file`, etc.), no aparece ni en `lastResult` (ya suprimido del prompt) ni en `Done:`: D1 y D2 quedan ciegos respecto de esa llamada aprobada.
- **Diff propuesto:**

```diff
--- a/src/core/ctx/views/route.ts
+++ b/src/core/ctx/views/route.ts
@@ -24,7 +24,7 @@ export function buildRouteView(data: ContextData, options: RouteViewOptions): R
     request: reactive ? data.task.request : null,
     step: step === null ? null : stepViewOf(step),
     lastResult: last === null ? null : callViewOf(data, last, false),
-    done: reactive ? doneCalls(data.calls).filter((c) => c.id !== last?.id).map(lineViewOf) : [],
+    done: reactive ? doneCalls(data.calls).map(lineViewOf) : [],
     // El último intento lleva su resumen (el porqué del fallo); los anteriores, solo la línea `L`.
```

- **Nota de impacto lateral:** Actualizaría la sección `done` de `reactive/running/routeInput` y `reactive/running/toolInput` (y `forRoute`) en `tests/__golden__/render.json` si se decide mantener o retirar `lastResult` de `RouteView`. Con el cambio mínimo propuesto arriba, `RouteView` conserva su forma (`lastResult` sigue existiendo para compatibilidad con quien la lea), pero D1/D2 vuelven a ver todas las llamadas aprobadas en `Done:`.

---

### P-EVAL-02 — Revisar mención del parámetro `shell` en `ARGUMENTS_VIEW.osLine("windows")`

- **Ubicación:** `src/core/models/prompts.ts:131-135`
- **Texto actual:**

```ts
    osLine(platform: Platform): string {
      return platform === "windows"
        ? `This computer runs Windows. Whenever you write a command, it runs in PowerShell: use PowerShell cmdlets or programs that exist on Windows, and Windows paths as ENV shows them. If the tool has a shell parameter, set it to "powershell". If TASK names a Linux command, write the Windows equivalent that gets the same result.`
        : ...
    },
```

- **Observación:** `run_command` (`jarvis_terminal`) ya no tiene parámetro `shell` (siempre usa `powershell.exe`); la frase `"If the tool has a shell parameter, set it to \"powershell\"."` solo aplicaba a `desktop_commander:start_process`, aunque hoy sigue inyectándose cada vez que `schema.properties` contiene `"command"`. Como el bloque completo `ARGUMENTS_VIEW` alcanzó `66/66` (`args_ps_perfect`, 2026-11-09), cualquier recorte sobre `osLine` debe medirse contra los datasets de `arguments`.
- **Diff propuesto:**

```diff
--- a/src/core/models/prompts.ts
+++ b/src/core/models/prompts.ts
@@ -130,7 +130,7 @@ Use {{ref:rX}} only with references listed in REFS when a full saved result is n
     /** Línea del sistema operativo: va tras la primera línea del SYSTEM. Sin ella el modelo escribe comandos de Linux en Windows. */
     osLine(platform: Platform): string {
       return platform === "windows"
-        ? `This computer runs Windows. Whenever you write a command, it runs in PowerShell: use PowerShell cmdlets or programs that exist on Windows, and Windows paths as ENV shows them. If the tool has a shell parameter, set it to "powershell". If TASK names a Linux command, write the Windows equivalent that gets the same result.`
+        ? `This computer runs Windows. Whenever you write a command, it runs in PowerShell: use PowerShell cmdlets or programs that exist on Windows, and Windows paths as ENV shows them. If TASK names a Linux command, write the Windows equivalent that gets the same result.`
         : `This computer runs ${platform === "macos" ? "macOS" : "Linux"}. Whenever you write a command, it runs in a POSIX shell (bash): use programs that exist on this system, and paths as ENV shows them. If TASK names a command of another operating system, write the equivalent for this one.`;
     },
```

---

### P-EVAL-03 — Traducir `retryNote` de español a inglés

- **Ubicación:** `src/core/models/prompts.ts:86-89`
- **Texto actual:**

```ts
export const retryNote = (previousError?: string): string =>
  previousError
    ? `\n\nERROR_PREVIO: tu respuesta anterior fue inválida (${safe(clip(previousError, MAX_ERROR_NOTE_CHARS))}). Corrígela y responde de nuevo.`
    : "";
```

- **Observación:** Todos los prompts de sistema del modelo generativo (`PLAN`, `ARGUMENTS_VIEW`, `PENDING_VIEW`, `QUESTION`, `FINAL`) están redactados en inglés, pero el sufijo inyectado en el reintento por salida inválida mezcla español (`ERROR_PREVIO: tu respuesta anterior fue inválida...`). Los mensajes de error de validación (`parseJson`, Zod/JSON schema, etc.) suelen venir mezclados o en español/inglés; pasar la frase marco al inglés homogeneiza el idioma del prompt en reintentos.
- **Diff propuesto:**

```diff
--- a/src/core/models/prompts.ts
+++ b/src/core/models/prompts.ts
@@ -85,7 +85,7 @@ export const ROUTE_LIST = EXECUTABLE_ROUTES.map((r) => `"${r}"`).join(", ");
 /** Nota de corrección que se añade al prompt en el reintento por salida inválida. */
 export const retryNote = (previousError?: string): string =>
   previousError
-    ? `\n\nERROR_PREVIO: tu respuesta anterior fue inválida (${safe(clip(previousError, MAX_ERROR_NOTE_CHARS))}). Corrígela y responde de nuevo.`
+    ? `\n\nPREVIOUS_ERROR: your previous response was invalid (${safe(clip(previousError, MAX_ERROR_NOTE_CHARS))}). Fix it and answer again.`
     : "";
```

---

## 2. Protocolo de evaluación sugerido antes de mergear

Requisitos previos: Ollama activo con `qwen3.5:4b-text` y `d3:2b-text` (según `jarvis-config.json`).

### Paso A — Verificar P-EVAL-01 (`route` y `tool_choice`)

Comparar línea base actual (`--variant=prod` o variante temporal A/B en `eval/variants/` sin alterar `eval/` permanente) sobre todos los datasets de ruteo y elección de herramienta:

```bash
npx tsx eval/cli.ts \
  --stages=route,tool_choice \
  --dataset=eval/datasets/route_D1/,eval/datasets/tool_choice_D2/ \
  --repeat=3
```

*Criterio de aceptación:* mejora o empate neto en los casos con lecturas previas recientes, 0 regresiones en `route_16_cases.jsonl`, `route_gemai.jsonl` y `tool_choice_16_cases.jsonl`. Tras confirmar y aplicar, actualizar `tests/__golden__/render.json` (solo los `done` de `forRoute` / `routeInput` / `toolInput`).

### Paso B — Verificar P-EVAL-02 (`arguments` + validez PowerShell)

```bash
npx tsx eval/cli.ts \
  --stages=arguments \
  --dataset=eval/datasets/arguments/ \
  --repeat=3
```

Y luego verificar sintaxis PowerShell sobre la carpeta resultante de esa corrida:

```bash
npm run eval:psvalid -- <carpeta_de_la_corrida>
```

*Criterio de aceptación:* mantener `100%` en `llm_arguments_cmd.jsonl`, `>= baseline` en `llm_arguments_hard.jsonl` y `lllm_extra_hard.jsonl`, y 0 nuevos parámetros `shell` alucinados ni comandos POSIX en Windows.

### Paso C — Verificar P-EVAL-03 (`retryNote` en etapas generativas)

Evaluar el conjunto generativo completo (especialmente si hay respuestas que disparen el reintento o en `--source=real-task`):

```bash
npx tsx eval/cli.ts \
  --stages=plan,arguments,final,question,pending \
  --dataset=eval/datasets/plan/,eval/datasets/arguments/,eval/datasets/final/,eval/datasets/question/,eval/datasets/pending/ \
  --repeat=2
```

Y corrida encadenada de extremo a extremo:

```bash
npx tsx eval/cli.ts --source=real-task
```

*Criterio de aceptación:* tasa de recuperación en reintento igual o superior a la línea base actual, sin incremento en `unrecoverable` ni en `args_invalid`.

---

## 3. Decisión HTTP sin cambios: cuerpos de error con status `200` en `src/server/mcpRouter.ts`

- **Ubicación:** `src/server/mcpRouter.ts:20-22,36-38,77-83,96-98`
- **Comportamiento actual:**
  - `GET /discover-all` devuelve HTTP `200` con `{ desktop_commander: [], free_search: [], error }`.
  - `GET /:server/tools` devuelve HTTP `200` con `{ error, tools: [] }`.
  - `POST /:server/call` ante excepción de transporte responde HTTP `200` con `{ isError: true, success: false, content: [...] }`.
  - `POST /:server/reconnect` ante error devuelve HTTP `200` con `{ error, ok: false }`.
- **Motivo para NO tocarlo en esta auditoría:** La UI de desarrollo y diagnóstico (`/api/mcp/*`) consume directamente esos JSON en respuestas `200` (por ejemplo, mostrando herramientas caídas sin lanzar error HTTP en consola del navegador), y cambiarlos a `500`/`502` altera contrato HTTP externo. Si en el futuro se desea unificar convenciones REST con `jarvisRouter.ts`, debe coordinarse junto con el cliente frontend.
