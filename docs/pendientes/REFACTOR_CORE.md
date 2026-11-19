# Refactor del core de Jarvis — Estado cerrado (2026-11-18)

> **Estado: completado.** Los cuatro puntos del refactor ya quedaron implementados y cubiertos por tests (`tests/approval_matrix.test.ts`, `tests/authorize.test.ts`, `tests/tool_specs.test.ts`, `tests/reactive_list.test.ts`, `tests/architecture.test.ts`). Las correcciones posteriores de flujo y chequeos siguen en [`REVISION_CHEQUEOS.md`](REVISION_CHEQUEOS.md) y [`PENDIENTES_CODIGO.md`](PENDIENTES_CODIGO.md).

## Lo implementado

1. **`runCall` en lista de pasos (`src/core/engine/callRunner.ts`):** reducido a 76 líneas encadenando `callPrepare` → anti-bucle → `callAuthorize` → `callConfirm` → `callExecute`.
2. **Tablas por herramienta:** `tools/toolTargets.ts`, `TIER_RULES` (`policy/tiers.ts`), `POSTCONDITIONS` (`engine/postcondition.ts`) y `PATH_KIND_CHECKS` (`engine/precheck.ts`), validados contra el catálogo por `tests/tool_specs.test.ts`.
3. **Estado de ejecución (`engine/state.ts` y `engine/reactiveList.ts`):** `TaskExecutionState` (`thread`, `lastCompletion`, `llmDown`) en `env.state` y `ReactiveList` con transiciones explícitas.
4. **Dependencias en una sola dirección:** `tools/host.ts` recibe el wrapper de captura desde afuera (`CaptureCall`), `engine/services.ts` recibe `MemoryProvider` desde el arranque, y `policy/homeDirs.ts` centraliza el fallback de `os.homedir()`.

## Qué quedó fuera a propósito

- Las ramas por argumento de `read_file` (`isUrl`) y `run_command` (`cwd`) en `callAuthorize.ts`, y el plazo de `run_command` en `timeouts.ts` (comportamiento de un argumento concreto, no clasificación de herramientas).
- La caché de `getUserEnvironment()` (`environment.ts`), que es caché de proceso inyectable por `deps.environment` y no estado de una tarea.
