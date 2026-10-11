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
| 3 | SIN_REFERENCIAS | Baja | `src/core/policy/policyRegistry.ts` (línea 64) vs `free-search-mcp.md` (líneas 26-40) | `policyRegistry.ts` registra una política para `free_search:download_document`, pero el contrato oficial del servidor MCP upstream solo expone la herramienta `download`. | Declaración de política estática para una herramienta redundante o inexistente en el servidor original. | Confirmado |
| 4 | NOMBRE_VS_COMPORTAMIENTO | Baja | `src/core/config.ts` (líneas 97-99) | `loadConfig()` comprueba si `parsed.qwenModel === "qwen2.5:7b"` y lo resetea a cadena vacía `""`, en lugar de migrarlo al default `"qwen3.5:9b"`. Si queda vacío, se omite el campo `model` en el payload a Ollama. | Comportamiento oculto no documentado al procesar archivos de configuración de versiones anteriores. | Confirmado |
| 5 | DUPLICACIÓN | Baja | `src/core/decision.ts` (líneas 146, 228) | `evaluateDecisionOne()` retorna `{ multiStep: false }` marcado explícitamente como deprecado en v2.1. No se realiza ninguna pregunta de este tipo a Decision 2.0. | Campo residual mantenido únicamente por compatibilidad hacia atrás en la firma del objeto. | Confirmado |
| 6 | DUPLICACIÓN | Baja | `src/core/reasoner/qwen.ts` (líneas 618-644) | Métodos `generateChatResponse()` y `synthesizeFinalResponse()` marcados como wrappers heredados ("legacy") que delegan directamente en `generateFinalResponse()`. | Métodos redundantes en la clase `QwenEngine` que no forman parte del bucle de ejecución actual. | Confirmado |
| 7 | NOMBRE_VS_COMPORTAMIENTO | Baja | `WindowsMCP.md` (línea 45) vs `src/core/policy/policyRegistry.ts` (línea 18) y `src/core/callExecutor.ts` (línea 264) | En `WindowsMCP.md` la herramienta de snapshot de UI se documenta como `ui_snapshot`, mientras que `PolicyRegistry` registra `ui_get_window_tree` y en `callExecutor.ts` se utiliza una heurística regex (`/tree\|snapshot\|window.*tree/i`) con fallback a `ui_get_window_tree`. | Diferencia de nomenclatura entre la referencia upstream y las herramientas mapeadas internamente. | Confirmado |

## Resumen priorizado

Hallazgos pendientes de revisión en código:

1. **#1 — `allowedDirectories` vacío por defecto en Desktop Commander (Media):** Desactiva la comprobación de contención de rutas en el adaptador MCP, haciendo que la seguridad de acceso a disco dependa enteramente de la compuerta Guard.
2. **#2 — Tipo `StepRoute` incluye `"chat"` con redirección a `desktop_commander` (Media):** Incongruencia de tipos con `VALID_STEP_ROUTES` y redirección implícita a un servidor de terminal local en lugar de gestión conversacional.
3. **#3 — Herramienta `download_document` en PolicyRegistry (Baja):** Declaración estática redundante no expuesta por el servidor oficial upstream de Free Search.
4. **#4 — Reseteo de `qwenModel` a cadena vacía ante `"qwen2.5:7b"` (Baja):** Oculta la configuración del modelo por defecto ante migraciones de configuración previa.
5. **#5 — Campo `multiStep: false` deprecado en Decision #1 (Baja):** Propiedad residual en el contrato de respuesta.
6. **#6 — Wrappers heredados en QwenEngine (Baja):** Métodos legacy delegados sin uso en el bucle principal.
7. **#7 — Nomenclatura `ui_snapshot` vs `ui_get_window_tree` (Baja):** Divergencia entre contrato de referencia de Windows MCP y nombres registrados.

## Inconsistencias resueltas

* **Discrepancia de modelo Decision 2.0 (Kai-0.6B vs Eos-0.8B):** Resuelto. Se eliminó cualquier referencia a Kai en el código (`types.ts`, `decision.ts`), en los componentes de la interfaz de usuario (`DecisionStream`, `DecisionOneView`, `SystemStatus`, `SettingsModal`) y en la documentación técnica (`ARCHITECTURE.md`). Se estandarizó el uso exclusivo de `Decision-2.0-Eos-0.8B`.
* **Límite de ventana de Decision 2.0 (16.384 en doc vs 8.192 en código):** Resuelto. Se clarificó en `ARCHITECTURE.md` y `CONTEXT_AND_MEMORY.md` que 8.192 tokens es el presupuesto operativo asignado por el orquestador en tiempo de ejecución, distinguiendo la capacidad teórica del modelo de la cuota operativa del sistema.
* **Mocks ilustrativos de prompts y memoria:** Resuelto. Se validó que en toda la documentación técnica de `docs/` no existen rutas ficticias ni mocks ilustrativos; todos los archivos referenciados existen y se corresponden exactamente con la implementación.
* **Generación de gráfico de dependencias SVG:** Resuelto. Se retiró la dependencia de Graphviz y la referencia al archivo SVG `docs/assets/deps.svg` en `ARCHITECTURE.md`, manteniendo la verificación formal de dependencias circulares mediante `madge` (0 ciclos).