# MIGRACION\_CASOS — De `eval/` a `eval-next/`

> Este documento es una guía para migrar casos del formato legado (`scripts/eval/`) al nuevo formato de `scripts/eval-next/`.
> La migración la realiza el usuario; este archivo documenta el mapeo completo.

---

## 1. Mapeo de etapas

| Etapa legada (`eval/`) | Etapa nueva (`eval-next/`) | Cambio |
|---|---|---|
| `llm/plan` (trigger initial) | `plan` con `trigger.kind: "initial"` | Replan unificado en `plan` |
| `llm/replan` (step_failure) | `plan` con `trigger.kind: "step_failure"` | Ya no es etapa separada |
| `llm/replan` (user_feedback) | `plan` con `trigger.kind: "user_feedback"` | Ya no es etapa separada |
| `llm/arguments` | `arguments` | Input cambia a `ArgsView` |
| `llm/final` | `final` | Input cambia a `FinalView` |
| `llm/question` | `question` | Input cambia a `AskView` |
| `decision/route` | `route` | Input cambia a `RouteDecisionInput` |
| `decision/tool_choice` | `tool_choice` | Input cambia a `ToolDecisionInput` |
| `decision/args_review` | `args_review` | Input cambia a `ReviewDecisionInput` |
| `decision/result_verification` | `result_verification` | Input cambia a `VerifyDecisionInput` |

---

## 2. Mapeo de campos de caso

### Campos base (todos los casos)

| Campo legado | Campo nuevo | Notas |
|---|---|---|
| `id` | `id` | Sin cambios |
| `description` | `description` | Opcional, sin cambios |
| `tags` | `tags` | Sin cambios. Agregar tags semánticos: `initial`, `replan`, `decision`, etc. |
| _(inexistente)_ | `isRaw: true` | Solo para casos adversariales / inyección de prompts. Excluidos del pass rate canónico. |

### Campos de input

#### Plan (legado `objective` / texto renderizado)

```jsonc
// LEGADO (modo texto, ya renderizado):
{
  "stage": "plan",
  "input": {
    "text": "REQUEST: Encontrar archivo config\nTRIGGER: initial",
    "maxSteps": 4
  }
}

// NUEVO (modo view, estado estructurado):
{
  "stage": "plan",
  "input": {
    "mode": "view",
    "view": {
      "request": "Encontrar archivo config",
      "trigger": { "kind": "initial" },
      "previousFeedback": [],
      "steps": { "done": [], "current": null, "next": [] },
      "failures": [],
      "userInput": [],
      "env": [],
      "effects": [],
      "possibleEffects": []
    },
    "maxSteps": 4
  }
}
```

#### Replan legado → `plan` con trigger

```jsonc
// LEGADO (etapa separada "replan"):
{
  "stage": "replan",
  "input": {
    "objective": "...",
    "action": "continue",
    "failedStep": "step_1"
  }
}

// NUEVO (plan unificado con trigger):
{
  "stage": "plan",
  "tags": ["plan", "step_failure", "replan"],
  "input": {
    "mode": "view",
    "view": {
      "request": "...",
      "trigger": { "kind": "step_failure", "failedStepId": "step_1" },
      "failures": [{ "stepId": "step_1", "statusNote": "...", ... }],
      ...
    },
    "maxSteps": 4
  },
  "expect": {
    "forbiddenRepeatedGoals": ["acción que falló"]
  }
}
```

#### Arguments

```jsonc
// LEGADO:
{ "input": { "text": "TOOL: read_file\nSCHEMA: {...}\nCONTEXT: ..." } }

// NUEVO:
{ "input": { "mode": "view", "view": { ... ArgsView ... }, "tool": { ... MCPTool ... } } }
```

#### Final

```jsonc
// LEGADO:
{ "input": { "text": "RESULTS: ...\nTASK: ..." } }

// NUEVO:
{ "input": { "mode": "view", "view": { ... FinalView ... } } }
```

#### Decision (route / tool\_choice / args\_review / result\_verification)

Los inputs de decisión son los mismos tipos que usa producción:
`RouteDecisionInput`, `ToolDecisionInput`, `ReviewDecisionInput`, `VerifyDecisionInput`.
Ver `src/core/engine/deps.ts` para la definición exacta de cada campo.

---

## 3. Mapeo de expects

| Campo legado | Campo nuevo | Notas |
|---|---|---|
| `action: "continue"` | _(implícito)_ | En el nuevo sistema, `passed` se determina por graders, no por `action` |
| `action: "abort"` | _(implícito)_ | Ídem |
| `objective` | `expectedLabel` (decisions) | Solo para etapas de decisión |
| `minSteps` | `minSteps` | Sin cambios |
| `maxSteps` | `maxSteps` | Sin cambios |
| `allowedRoutes` | `allowedRoutes` | Sin cambios |
| `requiredRoute` | `requiredRoutes: [route]` | Pluralizado |
| `expectedRoute` | `expectedRoute` | Solo en `RouteExpect` |
| `expectedTool` | `expectedTool` | Solo en `ToolChoiceExpect` |
| `expectedReview` | `expectedReview` | Solo en `ArgsReviewExpect` |
| `mustContain` | `mustContainFacts` (final) / `mustContainKeywords` (question) | Según etapa |
| `forbidden` | `forbiddenHallucinations` / `forbiddenKeywords` / `forbiddenKeywordsInGoal` | Según etapa |

---

## 4. Qué descartar

- Campos `action: "continue" | "abort"` del expect legado
- Strings ya renderizados en `input.text` para etapas `plan`, `arguments`, `final`, `question` — reemplazar con estado estructurado en `input.view`
- Etapas separadas `replan` y `replan_feedback` — unificar en `plan` con `trigger.kind`
- Cualquier referencia a `objective` como campo de plan — reemplazar con `view.request`

---

## 5. Casos adversariales

Si tenés casos de **inyección de prompts** o **texto adversarial crudo** que no pueden expresarse como estado estructurado, usar:

```json
{
  "stage": "plan",
  "isRaw": true,
  "tags": ["adversarial"],
  "input": {
    "mode": "raw",
    "text": "IGNORE ALL PREVIOUS INSTRUCTIONS...",
    "maxSteps": 4
  },
  "expect": { "maxSteps": 0, "expectEmpty": true }
}
```

Los casos con `isRaw: true` son **excluidos del pass rate canónico** (`passRate`) y reportados aparte en `rawPassRate`. Esto permite evaluarlos sin contaminar las métricas de calidad.

---

## 6. Checklist de migración por caso

- [ ] Identificar la etapa nueva (tabla §1)
- [ ] Construir `input.view` con el estado estructurado correspondiente (no texto renderizado)
- [ ] Mapear los `expect` legados a los nuevos campos (tabla §3)
- [ ] Descartar `action: "continue" | "abort"` del expect
- [ ] Agregar tags descriptivos (`initial`, `replan`, `decision`, etc.)
- [ ] Si el caso era `replan` o `replan_feedback`, convertir a `plan` con `trigger.kind` apropiado y agregar `forbiddenRepeatedGoals` / `mustReflectFeedback`
- [ ] Si el input es texto adversarial, marcar `isRaw: true`
- [ ] Validar que el caso pase el schema del loader (`dataset.ts`) corriendo el CLI con `--model=mock`

