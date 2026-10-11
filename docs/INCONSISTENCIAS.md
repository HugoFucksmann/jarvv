# Inconsistencias detectadas

> Última revisión: **2026-10-11**

> Archivo de trabajo. Registra hallazgos confirmados en el código durante la documentación. Solo hechos con evidencia, sin propuestas de refactor. Se puede convertir en issues o borrar al terminar.

## Tipos

`SIN_REFERENCIAS` · `DUPLICACIÓN` · `NOMBRE_VS_COMPORTAMIENTO` · `CONTRADICCIÓN` · `SEGURIDAD`

## Severidad

**Alta:** riesgo de seguridad o comportamiento incorrecto · **Media:** confunde o duplica lógica · **Baja:** orden o nomenclatura

## Hallazgos

| # | Tipo | Severidad | Ubicación | Hallazgo | Impacto | Estado |
|---|------|-----------|-----------|----------|---------|--------|
| 1 | SEGURIDAD | Media | `jarvis-config.json` (omitido) y `src/core/config.ts` (línea 46) | `allowedDirectories` en Desktop Commander no se especifica en `jarvis-config.json` y se inicializa como array vacío `[]` en `DEFAULT_CONFIG`. En `src/core/mcp/desktopCommanderMcp.ts` (líneas 25 y 56), la validación de contención de rutas solo se activa si `this.allowedDirectories.length > 0`. | Al estar vacío por defecto, el adaptador MCP no restringe carpetas, permitiendo acceso a cualquier ruta del sistema de archivos a menos que se configure explícitamente (delegando toda la contención a Guard). | Confirmado |
| 2 | CONTRADICCIÓN | Media | `src/core/types.ts` (línea 27) vs `src/core/reasoner/qwen.ts` (línea 38) y `src/core/callExecutor.ts` (línea 82) | `StepRoute` incluye `"chat"` como valor permitido (`"fin" \| "windows" \| "desktop_commander" \| "free_search" \| "chat"`), pero `VALID_STEP_ROUTES` en `qwen.ts` lo excluye. En `callExecutor.ts`, si una ruta llega como `"chat"`, se redirige forzadamente a `"desktop_commander"`. | Discrepancia entre tipos y validación en runtime; si una acción se tipara como `"chat"`, se despacharía de forma inesperada al servidor de terminal/archivos locales. | Confirmado |
| 3 | NOMBRE_VS_COMPORTAMIENTO | Media | `Desicion-2.0-Eos.md` (línea 1) vs `src/core/types.ts` (línea 249) y `src/core/decision.ts` (línea 3) | El documento raíz describe `Decision-2.0-Eos-0.8B` (~0,8B parámetros), mientras que en `types.ts` (`model: "Decision-2.0-Kai-0.6B"`) y en `decision.ts` se referencia y tipa `Decision-2.0-Kai-0.6B` (~0,6B parámetros). | Confusión respecto a la variante exacta del modelo Decision 2.0 esperada por el endpoint HTTP `/v1/decide`. | Confirmado |
| 4 | CONTRADICCIÓN | Media | `docs/CONTEXT_AND_MEMORY.md` (mock inicial) vs `src/core/reasoner/prompts.ts` y `src/core/context.ts` | El mock previo referenciaba rutas inexistentes: `prompts/system.md`, `src/context/builder.ts` y `src/memory/store.ts`. En el proyecto real no existen archivos `.md` de prompts ni esos módulos. | Desorientaba a desarrolladores que buscasen archivos externos de prompts o almacenes de contexto en esas rutas. | Confirmado |
| 5 | CONTRADICCIÓN | Media | `docs/ARCHITECTURE.md` (mock inicial) vs entorno de ejecución | El mock documentaba la generación de `docs/assets/deps.svg` con `npx madge --image`. En el entorno real, falla con `spawn gvpr ENOENT` por ausencia de Graphviz en el sistema, y la carpeta `docs/assets/` no existe. La comprobación circular `madge --circular` sí se ejecuta con éxito (0 dependencias circulares). | El comando de generación de SVG no es reproducible de forma autónoma en el entorno sin instalar utilidades adicionales del SO. | Confirmado |
| 6 | SIN_REFERENCIAS | Baja | `src/core/policy/policyRegistry.ts` (línea 64) vs `free-search-mcp.md` (líneas 26-40) | `policyRegistry.ts` registra una política para `free_search:download_document`, pero el contrato oficial del servidor MCP upstream solo expone la herramienta `download`. | Declaración de política estática para una herramienta redundante o inexistente en el servidor original. | Confirmado |
| 7 | NOMBRE_VS_COMPORTAMIENTO | Baja | `src/core/config.ts` (líneas 97-99) | `loadConfig()` comprueba si `parsed.qwenModel === "qwen2.5:7b"` y lo resetea a cadena vacía `""`, en lugar de migrarlo al default `"qwen3.5:9b"`. Si queda vacío, se omite el campo `model` en el payload a Ollama. | Comportamiento oculto no documentado al procesar archivos de configuración de versiones anteriores. | Confirmado |
| 8 | DUPLICACIÓN | Baja | `src/core/decision.ts` (líneas 146, 228) | `evaluateDecisionOne()` retorna `{ multiStep: false }` marcado explícitamente como deprecado en v2.1. No se realiza ninguna pregunta de este tipo a Decision 2.0. | Campo residual mantenido únicamente por compatibilidad hacia atrás en la firma del objeto. | Confirmado |
| 9 | DUPLICACIÓN | Baja | `src/core/reasoner/qwen.ts` (líneas 618-644) | Métodos `generateChatResponse()` y `synthesizeFinalResponse()` marcados como wrappers heredados ("legacy") que delegan directamente en `generateFinalResponse()`. | Métodos redundantes en la clase `QwenEngine` que no forman parte del bucle de ejecución actual. | Confirmado |
| 10 | CONTRADICCIÓN | Media | `Desicion-2.0-Eos.md` (línea 5) vs `src/core/decision.ts` (líneas 12 y 65) | El documento de referencia indica una ventana de contexto de `16.384 tokens`, mientras que la implementación en `decision.ts` impone y valida un límite estricto de `8.192 tokens` (`estimatedTokens > 8192` lanza `DecisionValidationError`). | Discrepancia entre la especificación teórica del modelo y el límite operativo enforcing en el runtime del orquestador. | Confirmado |
| 11 | NOMBRE_VS_COMPORTAMIENTO | Baja | `WindowsMCP.md` (línea 45) vs `src/core/policy/policyRegistry.ts` (línea 18) y `src/core/callExecutor.ts` (línea 264) | En `WindowsMCP.md` la herramienta de snapshot de UI se documenta como `ui_snapshot`, mientras que `PolicyRegistry` registra `ui_get_window_tree` y en `callExecutor.ts` se utiliza una heurística regex (`/tree\|snapshot\|window.*tree/i`) con fallback a `ui_get_window_tree`. | Diferencia de nomenclatura entre la referencia upstream y las herramientas mapeadas internamente. | Confirmado |

## Resumen priorizado

Hallazgos de severidad Media ordenados por impacto:

1. **#1 — `allowedDirectories` vacío por defecto en Desktop Commander (Media):** Desactiva la comprobación de contención de rutas en el adaptador MCP, haciendo que la seguridad de acceso a disco dependa enteramente de la compuerta Guard.
2. **#2 — Tipo `StepRoute` incluye `"chat"` con redirección a `desktop_commander` (Media):** Incongruencia de tipos con `VALID_STEP_ROUTES` y redirección implícita a un servidor de terminal local en lugar de gestión conversacional.
3. **#3 — Discrepancia de modelo Decision 2.0 (Kai-0.6B vs Eos-0.8B) (Media):** Confunde sobre la variante exacta del modelo requerido en la documentación de entrada frente a los tipos de TypeScript.
4. **#10 — Límite de ventana de Decision 2.0 (16.384 en doc vs 8.192 en código) (Media):** El orquestador rechaza consultas que superen los 8.192 tokens aunque el documento upstream declare 16.384 tokens.
5. **#4 — Mocks de prompts y memoria apuntaban a archivos inexistentes (Media):** Discrepancia entre la documentación inicial y la implementación real en `src/core/reasoner/prompts.ts` y `src/core/context.ts`.
6. **#5 — Generación de gráfico de dependencias SVG requiere Graphviz no instalado (Media):** El comando documentado falla en el contenedor por falta de `gvpr`, aunque la verificación de dependencias circulares fue validada exitosamente con 0 ciclos.