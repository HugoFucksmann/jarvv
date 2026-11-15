# Plan de Implementación: Extensión del Eval al Modo Jarvis Real

Este plan extiende el laboratorio de evaluación de JARVIS con dos capacidades nuevas —evaluación **por etapa sobre entradas reales** y evaluación **encadenada de extremo a extremo** (`runTask`)— manteniendo **100 % intactos el modo dataset actual (mismo CLI, resultados, formatos y `eval/core/client/*`)** y conectando los modos nuevos directamente con el flujo del núcleo.

---

## Decisiones Confirmadas y Restricciones

- **Modo dataset y `eval/core/client/*` intactos:** Las corridas de dataset mantienen exactamente el mismo CLI, resultados y formatos actuales. No se modifica `eval/core/client/*`.
- **Sandbox aislado:** Cada corrida encadenada dispone de un directorio temporal aislado (`home`, `desktop`, `documents`, `downloads`, carpeta protegida de referencias y herramientas de disco acotadas a ese entorno).
- **Auto-aprobación con prohibición de borrados peligrosos:** El modo encadenado corre con `autoMode: true`, compilando reglas explícitas en nivel `blocked` (y fijando `homeDirs` al sandbox) para rechazar de forma determinista comandos y herramientas de eliminación peligrosas sin delegarlos al modelo de decisión.
- **Doble fuente de verdad para modo real por etapa:** Se soportan tanto **trazas reales** (reconstruyendo el estado al momento `n` de la consulta objetivo) como **escenarios ejecutables** (corriendo el motor real hasta un punto de parada y congelando su contexto).
- **Limpieza de variantes viejas:** Se eliminan las 7 variantes heredadas con lectores custom o esquemas de objeto (`d4_keys_a`, `pending2`, `pending2_obj`, `pending2_exp`, `fragment_judge_ranking`, `fragment_judge_ternary`, `fragment_judge_classifier`) junto con el código especial que solo existía para ellas.
- **Incorporación de `fragment_judge`:** Se integra el juez de fragmentos al catálogo único de etapas del núcleo y a la captura en trazas reales.
- **Bug de colisión en `pendingList.ts`:** Se corrige `sameItem` para que rutas largas con carpetas capitalizadas no colisionen falsamente al conciliar pendientes.
- **Fidelidad de `VerifyDecisionInput.request`:** En modo real (aislado y encadenado) no se inyecta sintéticamente `request` en verificación de resultados, respetando la firma real de producción.

---

## Checklist por Etapas

- [x] **Etapa 0 — Resguardo del plan, limpieza de variantes viejas y corrección de `pendingList`**
  - [x] Guardar esta hoja de ruta en `eval/PLAN_EVAL_V2.md` para marcar avances con `[x]`.
  - [x] Eliminar las 7 variantes antiguas (`d4_keys_a`, `pending2*`, `fragment_judge_{ranking,ternary,classifier}`).
  - [x] Quitar `DecisionReaders`, `ReadAnswer`, `Variant.read`, `PendingOutput.rich` y su despacho en `eval/core/`.
  - [x] Corregir `sameItem` en `src/core/engine/pendingList.ts` y agregar tests en `tests/logic.test.ts`.
  - *Verificación:* `npm run lint`, `npm test` y smoke run en modo dataset.

- [x] **Etapa 1 — Costuras genéricas en el núcleo (`disk`, `analyzeCommand`, `now`, helpers)**
  - [x] Agregar `disk?: DiskView` y `analyzeCommand?: CommandAnalyzer` opcionales en `EngineDeps` y propagarlos a `verify.ts`, `callRunner.ts` y `precheck.ts` (incluyendo lectura de refs sin romper defaults).
  - [x] Reexportar `parseSnapshot` en `src/core/ctx/index.ts` e inyectar reloj opcional (`now`) para constructores de prompts dependientes de fecha (`TODAY`).
  - [x] Exportar helpers puros (`MIN_COMPLETION_TOKENS`, `reserveCompletionTokens`, `buildGenerativeBody`) y soporte opcional de parámetros por etapa (`StageParamsOverride`) sin alterar comportamiento por defecto ni tocar `eval/core/client/*`.
  - *Verificación:* `npm run lint` y `npm test` (incluyendo `tests/architecture.test.ts`).

- [x] **Etapa 2 — Integración de `fragment_judge` y etapas faltantes (`probe`, `continuation`, `completion`)**
  - [x] Incorporar `fragment_judge` a `STAGES`/`STAGE_KIND` y cablear un receptor opcional en `WebSearchProvider` para capturar sus llamadas en `TaskTraceRecorder` respetando las fronteras de arquitectura.
  - [x] Registrar `probe`, `continuation` y `completion` en `eval/core/` (tipos, registro, parsers, extractores de etiquetas y graders base).
  - *Verificación:* Compilación exhaustiva de etapas (`npm run lint`) y prueba dedicada de captura de `fragment_judge` + etapas nuevas en `npm test`.

- [x] **Etapa 3 — Fusión unificada de variantes y pruebas de paridad (sin tocar `eval/core/client/*`)**
  - [x] Extraer helper compartido de fusión de prompts (`applyVariantPrompts`) consumido por `scenario.ts` y por los motores reales del modo real.
  - [x] Agregar pruebas deterministas de paridad (sin red) entre los builders/validadores de `eval/` y los motores reales `QwenEngine` / `Decision20Engine` de `src/`.
  - *Verificación:* Tests de paridad en verde y cero cambios en `eval/core/client/*`.

- [x] **Etapa 4 — Modo real aislado por etapa (`--source=real-stage`)**
  - [x] Implementar cargador dual para trazas reales (reconstrucción al evento `n`) y escenarios ejecutables (ejecución controlada hasta un punto de captura).
  - [x] Materializar casos reales usando las vistas y adaptadores reales de `src/`, ejecutarlos sin alterar el comportamiento por defecto del CLI de datasets y emitir `RunRecord` / reportes bajo `--source=real-stage`.
  - *Verificación:* Smoke tests del modo real por etapa y comprobación de salida idéntica en modo dataset.

- [x] **Etapa 5 — Modo real encadenado (`--source=real-task`) con Sandbox y Seguridad**
  - [x] Implementar sandbox temporal auto-limpiable (`home`, `desktop`, `documents`, `downloads`, `DiskView` acotado, `guardScope` y registro de los 3 servidores MCP con fixtures).
  - [x] Configurar `autoMode: true` con lista negra reforzada en nivel `blocked` prohibiendo determinísticamente eliminaciones peligrosas.
  - [x] Implementar ejecutor encadenado con `QwenEngine`, `Decision20Engine`, `TaskTraceRecorder` y graders/métricas de tarea completa bajo `--source=real-task`.
  - *Verificación:* Smoke tests end-to-end en `tests/` (reactivo multi-paso con refs, deliberativo en sandbox y rechazo determinista de borrados peligrosos con `autoMode: true`).

- [x] **Etapa 6 — Documentación de uso y verificación integral final**
  - [x] Documentar los modos `--source=real-stage` y `--source=real-task` en `eval/README.md` y marcar este checklist completo en `[x]`.
  - [x] Correr verificación final: `npm run lint`, `npm test`, dry-run/smoke del modo dataset clásico y smoke de ambos modos reales.
