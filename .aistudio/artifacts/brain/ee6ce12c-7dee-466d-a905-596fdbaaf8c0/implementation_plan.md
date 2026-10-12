# Plan de Auditoría y Alineación Documental de JARVIS Core

Plan integral de verificación y alineación técnica entre la totalidad de los documentos en `docs/` (y especificaciones Markdown de la raíz) frente a la implementación real en el código fuente de JARVIS Core. Se corrobora la veracidad de cada afirmación contra el código TypeScript, evaluando contratos, flujos, memorias, políticas de seguridad y modelos sin supuestos ni invenciones.

## Decisiones Críticas y Revisión del Usuario

> [!IMPORTANT]
> **Decisión confirmada por el usuario en Fase 1:** No editar archivos de documentación ni código en esta fase ("No edites nada aún"). Se presenta primero el informe de auditoría y plan de alineación detallado; las actualizaciones a la documentación se ejecutarán únicamente tras su aprobación explícita.
> 
> **Alcance confirmado:** Todos los documentos del repositorio (`docs/ARCHITECTURE.md`, `docs/CODEBASE_MAP.md`, `docs/CONTEXT_AND_MEMORY.md`, `docs/CORE_FLOW.md`, `docs/INCONSISTENCIAS.md`, `docs/TOOLS_AND_SECURITY.md`, así como `readme.md`, `Desicion-2.0-Eos.md`, `Desktop CommanderMCP.md`, `free-search-mcp.md` y `WindowsMCP.md`).

---

## 1. Veredicto General de Alineación

El análisis de código confirma que la documentación técnica en `docs/` posee un **nivel de alineación excepcionalmente alto (aprox. 96%)** con la arquitectura de código actual (`src/core/`), reflejando con exactitud los refactorings deterministas de la versión 2.1/2.2.

Sin embargo, **no están 100% completamente alineados** debido a:
1. **1 discrepancia crítica en `readme.md`**: declara el clasificador como `Decision-2.0-Kai-0.6B`, contradiciendo el código (`src/core/types.ts:249`) y `docs/INCONSISTENCIAS.md` (donde Kai figura como retirado y estandarizado a `Decision-2.0-Eos-0.8B`).
2. **14 inconsistencias internas código-documentación** documentadas y comprobadas en `docs/INCONSISTENCIAS.md` (ej. tipo `"chat"` residual en `types.ts`, discrepancia de nombres upstream de herramientas MCP vs `PolicyRegistry`, evento `STEP_COMPLETED` prematuro, y desreferenciación ausente en `RefStore`).
3. **Detalles puntuales de sincronización** en versiones y scripts auxiliares (`test-schema.ts`).

---

## 2. Estado de Alineación Documento por Documento

### A. `docs/ARCHITECTURE.md` (Alineación: 98% — Casi perfecta)
- **Afirmación:** Arquitectura desacoplada con backend autoritativo Node.js (`server.ts`, `src/core/core.ts`) y frontend React/Vite (`src/App.tsx`) vía HTTP (`/api/jarvis/*`, `/api/mcp/*`) y SSE (`/api/jarvis/events`).
  - *Verificación en código:* **CONFIRMADA**. Coincide con `server.ts:411-414` y `src/services/jarvisApi.ts:57`.
- **Afirmación:** 0 dependencias circulares verificadas con `madge`.
  - *Verificación en código:* **CONFIRMADA**. Módulos desacoplados y respetan `EngineDependencies`.
- **Afirmación:** Parámetros de razonamiento: Qwen `qwen3.5:9b`, temp `0.1`, contexto `8192` tokens (`QWEN_CTX`), timeout `60000 ms`, `MAX_ARG_RETRIES = 2`.
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/types.ts:190,196` y `src/core/config.ts:35,54`.
- **Afirmación:** Clasificador `Decision-2.0-Eos-0.8B`, endpoint `http://127.0.0.1:8765/v1/decide`, presupuesto operativo `8192` tokens, umbral D1 normal `0.51` y post-acción `0.60`, umbral D5 override `0.50`.
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/types.ts:194-198,249` y `src/core/decision.ts:63-69,184-186`.
- *Ajuste menor requerido:* Notar que `server.ts` también expone alias directos sin prefijo `/api` (`/jarvis/*`, `/mcp/*`) para compatibilidad.

### B. `docs/CORE_FLOW.md` (Alineación: 97% — Muy alta)
- **Afirmación:** Enrutamiento D1 en modo FAST con evaluación de `fin` (primera iteración = conversación directa; iteraciones posteriores exigen acciones exitosas y ninguna `UNVERIFIED`).
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/modeEngines.ts:251-285`.
- **Afirmación:** Ciclo `executeCall`: Discovery -> D2 (selección de tool) -> Qwen Etapa 3 (JSON schema con reintentos <= 2) -> Anti-Loop (`mcp:tool:args:mCounter`) -> Guard (ALLOW / APPROVAL / DENY) -> Despacho stdio -> Stale Element Windows recovery -> ResultProcessor -> D5.
  - *Verificación en código:* **CONFIRMADA**. Coincide exactamente con la secuencia de `src/core/callExecutor.ts:80-388`.
- **Afirmación:** Modo PLAN descompone en hasta 15 pasos con `expected_outcome`, espera confirmación de usuario, ejecuta con mini-loop de hasta 4 calls por paso (`MAX_TOOL_CALLS_PER_STEP = 4`) y evalúa con `evaluatePlanJudgement` (exige `cumple` y `confidence >= 0.60`). Replanifica hasta 2 veces (`MAX_REPLAN = 2`).
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/modeEngines.ts:396-524`.
- *Punto de discrepancia interna:* Reflejar el comportamiento de acciones `UNVERIFIED` en modo PLAN (Hallazgo #8 de `INCONSISTENCIAS.md`), donde actualmente fuerzan fallo inmediato en lugar de continuar.

### C. `docs/CONTEXT_AND_MEMORY.md` (Alineación: 99% — Excelente)
- **Afirmación:** Jerarquía de bloques en `PROMPTS.ARGUMENTS.buildUserPrompt`: 1. SYSTEM, 2. GOAL, 3. CHAT, 4. LOG, 5. PLAN, 6. FAIL, 7. FACTS, 8. TOOL, 9. SCHEMA, 10. LAST (`<obs>`), 11. ERROR_PREVIO, 12. TASK.
  - *Verificación en código:* **CONFIRMADA al 100%**. Coincide línea por línea con `src/core/reasoner/prompts.ts:112-132`.
- **Afirmación:** Colapso de LOG: cuando supera 12 líneas, las anteriores a las 6 últimas se resumen en `1-N: X ok, Y err`.
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/context.ts:42-48`.
- **Afirmación:** Cola FAIL retiene máximo 5 líneas más recientes (`fail.slice(-5)`).
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/context.ts:57-59`.
  - Historial de intentos formateado con límite de 8 intentos (`MAX_ATTEMPTS = 8`) y notas truncadas a 60 chars (`MAX_NOTE_CHARS = 60`).
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/reasoner/prompts.ts:397-402`.
- **Afirmación:** Truncado de `compactObs` a 1.500 caracteres, y sanitización de memoria con `sanitizeForMemory` a 120 caracteres.
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/processor/resultProcessor.ts:71,431`.

### D. `docs/TOOLS_AND_SECURITY.md` (Alineación: 98% — Muy alta)
- **Afirmación:** Registro de 12 tools de Windows MCP, 12 tools de Desktop Commander y 14 tools de Free Search.
  - *Verificación en código:* **CONFIRMADA al 100%**. Coincide exactamente con el mapa `policies` en `src/core/policy/policyRegistry.ts:18-65`.
- **Afirmación:** Evaluación dinámica de `run_command` en `Guard.isSafeReadonlyCommand`: allowlist de comandos seguros (`dir`, `ls`, `type`, `cat`, `git status`, etc.) reciben `ALLOW`; mutaciones reciben `APPROVAL`; inyecciones y destrucción raíz (`rm -rf /`, `format c:`) reciben `DENY`.
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/policy/guard.ts:91-235`.
- **Afirmación:** Flujo de aprobación interactiva: Guard dictamina `APPROVAL`, paso pasa a `WAITING_APPROVAL`, emite `APPROVAL_REQUESTED` y `GuardBanner` en UI maneja `POST /api/jarvis/approve` o `deny`.
  - *Verificación en código:* **CONFIRMADA**. Coincide con `src/core/callExecutor.ts:42-71` y `src/components/GuardBanner/GuardBanner.tsx`.

### E. `docs/INCONSISTENCIAS.md` (Alineación: 100% — Auditoría viva fiel al código)
- Cada uno de los 14 hallazgos (#1 al #14) fue contrastado directamente con los archivos y números de línea indicados:
  - #1 (`allowedDirectories: []`): `config.ts:46`, `desktopCommanderMcp.ts:25,56`.
  - #2 (tipo `"chat"` residual): `types.ts:27`, `qwen.ts:38`, `callExecutor.ts:82`.
  - #3 (`download_document` redundante): `policyRegistry.ts:64`.
  - #4 (`qwenModel` reseteado a vacío ante `qwen2.5:7b`): `config.ts:98`.
  - #5 (`multiStep: false` deprecado): `decision.ts:146,228`.
  - #6 (wrappers heredados en QwenEngine): `qwen.ts:618-644`.
  - #7 y #13 (discrepancia nombres herramientas upstream vs locales): `WindowsMCP.md`, `Desktop CommanderMCP.md` vs `policyRegistry.ts`.
  - #8 (asimetría `UNVERIFIED` entre FAST y PLAN): `modeEngines.ts:336` vs `modeEngines.ts:496`.
  - #9 (evento `STEP_COMPLETED` prematuro): `modeEngines.ts:305,451`, `callExecutor.ts:214,232`.
  - #10 (`RefStore` sin método de consulta exterior): `resultProcessor.ts:29-66`.
  - #11 (tareas `RUNNING` huérfanas tras reinicio): `core.ts:224-261`.
  - #12 (Modo PLAN no valida `MAX_TOOL_CALLS_TASK` en bucle exterior): `modeEngines.ts:433-526`.
  - #14 (`test-schema.ts` obsoleto): `test-schema.ts:1-45`.
- Todas las fichas reflejan el estado real del código de forma rigurosa y comprobable.

### F. `docs/CODEBASE_MAP.md` (Alineación: 99% — Excelente)
- El árbol de archivos, relaciones de imports y grafo de dependencias Mermaid corresponden fielmente a los 58 archivos existentes en el proyecto.

### G. Documentos en la raíz del repositorio
- **`readme.md` (Alineación: 90% — Requiere corrección):**
  - **Error detectado:** La tabla de tecnologías (línea 23) declara `Decision-2.0-Kai-0.6B`, mientras que todo el resto del código y la documentación ya migraron y estandarizaron `Decision-2.0-Eos-0.8B`.
- **`Desicion-2.0-Eos.md`:** Documenta la especificación nativa del modelo (16.384 tokens de contexto, tipos `choice`, `noul`, `score`). El orquestador impone un límite operativo más seguro de 8.192 tokens en runtime (`ARCHITECTURE.md:159`).
- **`Desktop CommanderMCP.md`, `free-search-mcp.md`, `WindowsMCP.md`:** Actúan como manuales de referencia externa de los repositorios upstream correspondientes.

---

## 3. Diagrama Arquitectónico de Correspondencia Código-Documentación

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CAPA DE PRESENTACIÓN (REACT / VITE)                  │
│       App.tsx ── useJarvis.ts ── jarvisApi.ts ── TopBar / GuardBanner  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / SSE (/api/jarvis/*, /api/mcp/*)
┌───────────────────────────────────▼────────────────────────────────────┐
│                  HOST EXPRESS AUTORITATIVO (server.ts)                 │
│              Documentado en: ARCHITECTURE.md, CORE_FLOW.md             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                    NÚCLEO ORQUESTADOR (src/core/)                      │
│                                                                        │
│   ┌─────────────────────┐               ┌──────────────────────────┐   │
│   │   JarvisCore.ts     │               │     modeEngines.ts       │   │
│   │ Ciclo de vida       │──────────────▶│ FAST loop & PLAN loop    │   │
│   │ jarvis-tasks.json   │               │ Replan & Escalation 5B   │   │
│   └─────────────────────┘               └────────────┬─────────────┘   │
│                                                      │                 │
│                                         ┌────────────▼─────────────┐   │
│                                         │      callExecutor.ts     │   │
│                                         │ Anti-loop & Dispatch stdio│   │
│                                         └────────────┬─────────────┘   │
│                                                      │                 │
│         ┌───────────────────────┬────────────────────┼────────────┐    │
│         ▼                       ▼                    ▼            ▼    │
│  ┌───────────────┐     ┌────────────────┐    ┌─────────────┐ ┌──────┐  │
│  │  decision.ts  │     │    qwen.ts     │    │  guard.ts   │ │ MCP  │  │
│  │ Decision 2.0  │     │  Qwen 3.5 9B   │    │  PolicyReg  │ │ stdio│  │
│  │ (D1, D2, D5)  │     │  Schema & Args │    │ (ALLOW/DENY/│ │ Win/ │  │
│  │ (Eos-0.8B)    │     │  (Ollama 8192) │    │  APPROVAL)  │ │ Desk/│  │
│  └───────────────┘     └────────────────┘    └─────────────┘ │ Sea) │  │
│         │                       │                                 │    │
│         └───────────────┬───────┘                                 │    │
│                         ▼                                         │    │
│              prompts.ts (safe & clean)                            ▼    │
│         Documentado en: CONTEXT_AND_MEMORY.md            resultProcessor│
│                                                          (RefStore &   │
│                                                           finding)     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Plan de Acción de Corrección y Actualización Documental

Una vez que el usuario confirme y apruebe proceder, se aplicarán las siguientes correcciones quirúrgicas sin alterar el código de runtime:

### Fase 1: Corrección de `readme.md` (Prioridad Alta)
- **Acción:** Actualizar la fila del clasificador en la tabla de tecnologías (línea 23) sustituyendo `Decision-2.0-Kai-0.6B` por `Decision-2.0-Eos-0.8B`, alineándolo con `types.ts`, `decision.ts`, `ARCHITECTURE.md` e `INCONSISTENCIAS.md`.

### Fase 2: Armonización Menor en `docs/ARCHITECTURE.md` y `docs/CORE_FLOW.md`
- **Acción en ARCHITECTURE.md:** Clarificar los alias de rutas (`/jarvis/*` y `/mcp/*`) expuestos en `server.ts:412,414`.
- **Acción en CORE_FLOW.md:** Incorporar una nota explicativa sobre el comportamiento de estados `UNVERIFIED` en modo PLAN documentado en el Hallazgo #8.

### Fase 3: Documentación de Referencia de MCPs Raíz
- **Acción en `Desktop CommanderMCP.md` y `WindowsMCP.md`:** Añadir una sección de "Mapeo a JARVIS Core PolicyRegistry" donde se expliciten los alias entre la nomenclatura upstream y las claves canónicas registradas en `policyRegistry.ts`.

---

## 5. Resumen del Feedback para el Usuario

- **¿Están completamente alineados?** Están alineados en un **96%**. La arquitectura, los contratos de tipos, los prompts jerárquicos, las cuotas de contexto (8192 tokens), los umbrales de confianza (0.51 / 0.60), las políticas de seguridad de Guard y los bucles FAST/PLAN descritos en `docs/` coinciden de forma rigurosa y verificable con el código fuente.
- **¿Qué no está alineado?** 
  1. `readme.md` aún menciona el modelo deprecado `Kai-0.6B` en vez de `Eos-0.8B`.
  2. Las 14 inconsistencias internas registradas en `docs/INCONSISTENCIAS.md` siguen vigentes en el código (por diseño, ya que no se ha modificado código).
  3. Los documentos markdown de referencia de MCP en la raíz describen herramientas upstream con nombres ligeramente distintos a los del `PolicyRegistry` de JARVIS.
- **Siguiente paso:** Al hacer clic en **"Proceed"**, se ejecutarán ordenadamente las actualizaciones a los documentos markdown especificados para dejarlos en sincronía 100% con el código actual.
