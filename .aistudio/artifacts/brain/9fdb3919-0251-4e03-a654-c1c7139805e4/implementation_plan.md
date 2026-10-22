# Plan de Separación Arquitectónica: Frontend a `ui/` y Backend en `src/`

**Verificación de docs:** `grep` confirma 0 identificadores de estado en mayúsculas y 0 constantes o valores numéricos operativos en `docs/ARCHITECTURE.md`, `docs/CORE_FLOW.md` y `docs/CONTEXT_AND_MEMORY.md`.

---

## 1. Inventario de Archivos en `src/`

### A. Archivos y Carpetas de Frontend (a mover a `ui/`)

| Archivo / Carpeta | Tipo | Evidencia de Clasificación |
|---|---|---|
| `src/App.tsx` | Componente raíz | Importa React (`useState`, `useEffect`), JSX y componentes visuales de interfaz. |
| `src/main.tsx` | Punto de entrada DOM | Importa `createRoot` de `react-dom/client`, monta en `#root` y carga `index.css`. |
| `src/index.css` | Hoja de estilos global | Directiva `@import "tailwindcss";` y estilos tipográficos de navegador. |
| `src/components/` (25 archivos) | Componentes React | Todos son componentes visuales con JSX, Tailwind CSS y eventos de usuario (DOM). |
| `src/hooks/useClipboardCopy.ts` | React Hook | Usa `useState`, `useCallback` y la API de navegador `navigator.clipboard`. |
| `src/hooks/useFocusShortcut.ts` | React Hook | Usa `useEffect` y escucha eventos de teclado en `window.addEventListener`. |
| `src/hooks/useJarvis.ts` | React Hook | Gestiona estado cliente con `useState`/`useEffect` y conexión `EventSource` a SSE. |
| `src/services/jarvisApi.ts` | Cliente HTTP cliente | Cliente del navegador que utiliza `fetch` global para interactuar con `/api/jarvis/*`. |
| `src/types/ui.ts` | Tipos de interfaz | Define `ExecutionMode` y `McpInitStatus`, consumidos únicamente por componentes UI. |
| `src/utils/apiUrl.ts` | Utilidad web | Resuelve URLs relativas o absolutas mediante `import.meta.env.VITE_API_URL`. |
| `src/utils/platform.ts` | Utilidad web | Detecta entorno macOS mediante `navigator.userAgent` para renderizar atajos (⌘K / Ctrl+K). |
| `src/utils/routeLabels.ts` | Utilidad visual | Traduce identificadores de ruta a etiquetas legibles en español para la UI. |
| `src/utils/taskStatus.ts` | Utilidad visual | Traduce estados de tarea a variantes visuales para el componente `StatusDot` y textos de interfaz. |

### B. Archivos y Carpetas de Backend (permanecen en `src/`)

| Archivo / Carpeta | Responsabilidad | Evidencia de Clasificación |
|---|---|---|
| `src/core/core.ts` | Orquestador principal | Instancia motores, almacena tareas en memoria y gestiona ciclo de vida. |
| `src/core/modeEngines.ts` | Motores FAST y PLAN | Bucles de ejecución de pasos, escalación y replanificación. |
| `src/core/callExecutor.ts` | Ejecutor atómico | Pipeline indivisible de herramientas, Guard y verificación. |
| `src/core/decision.ts` | Cliente HTTP Decision 2.0 | Conexión con modelo discriminativo Eos-0.8B. |
| `src/core/reasoner/qwen.ts` | Cliente HTTP Qwen | Inferencia OpenAI-compatible para planes y argumentos. |
| `src/core/reasoner/prompts.ts` | Plantillas de prompts | Construcción y sanitización de prompts para LLM. |
| `src/core/policy/guard.ts` | Seguridad | Evaluación determinista de permisos y patrones prohibidos. |
| `src/core/tools/manifest.ts` | Catálogo de herramientas | Definiciones inmutables de herramientas y capacidades. |
| `src/core/processor/resultProcessor.ts` | Procesamiento y RefStore | Extracción de resultados y aislamiento de referencias en RAM. |
| `src/core/processor/refResolver.ts` | Resolutor | Sustitución de tokens de referencias en argumentos. |
| `src/core/context.ts` | Contexto de tareas | Ensamblado de bloques históricos y de memoria. |
| `src/core/taskTrace.ts` | Trazabilidad | Volcado append-only en JSONL al finalizar tareas. |
| `src/core/taskWire.ts` | Serialización | Adaptador de tarea para envío por SSE sin cargas pesadas. |
| `src/core/types.ts` | Contratos del núcleo | Interfaces de tarea, pasos, eventos y estados. |
| `src/core/config.ts` | Configuración operativa | Lectura y validación de `jarvis-config.json`. |
| `src/core/environment.ts` | Entorno del sistema | Lectura de paths del usuario y shell mediante Node.js. |
| `src/core/llmTransport.ts` | Transporte HTTP | Cliente con reintentos y control de aborto para inferencia. |
| `src/core/persistence.ts` | Persistencia inactiva | Archivo huérfano sin uso activo (fuera de alcance). |
| `src/core/mcp/*` (6 archivos) | Servidores MCP y transporte | Conexión stdio con procesos de herramientas y descubrimiento. |
| `src/server/jarvisRouter.ts` | Router Express | Rutas de API `/api/jarvis/*` y emisión SSE. |
| `src/server/mcpRouter.ts` | Router Express | Rutas de API `/api/mcp/*`. |

### C. Archivos Ambiguos / Compartidos

| Archivo | Uso en Backend | Uso en Frontend |
|---|---|---|
| `src/types/debug.ts` | `src/core/types.ts:6` importa `ModelIteration` para el campo `Task.modelIterations`. Utilizado por `taskTrace.ts` y `core.ts`. | Importado por `useJarvis.ts`, `DecisionStream.tsx`, `ModelIterationCard.tsx` y `StepIterationGroup.tsx`. Define además `StepIterationGroupData` (exclusivo de UI). |
| `src/utils/debugAccumulator.ts` | `src/core/core.ts:28` importa `createIterationFromEvent` para construir y almacenar iteraciones de modelos al emitir eventos de núcleo. | `src/hooks/useJarvis.ts` importa `createIterationFromEvent` y `reconstructIterationsFromTask`; `DecisionStream.tsx` importa `groupIterationsByStep`. |

---

## 2. Dependencias Cruzadas

### A. Dependencias Indebidas: Backend hacia Frontend
1. **`src/core/types.ts` (Línea 6)**:
   - Código: `import type { ModelIteration } from "../types/debug.ts";`
   - Causa: El tipo `Task` del backend incluye `modelIterations?: ModelIteration[]`.
2. **`src/core/core.ts` (Línea 28)**:
   - Código: `import { createIterationFromEvent } from "../utils/debugAccumulator.ts";`
   - Causa: Al emitir cada evento interno, `JarvisCore` invoca `createIterationFromEvent` para mantener la lista viva en la tarea.

**Propuesta de resolución:**
- Trasladar las definiciones de datos de auditoría de modelos (`ModelType`, `ModelStage`, `ModelIterationMetrics`, `ModelIteration`) al backend dentro de `src/core/types.ts` o `src/core/debug.ts`.
- Trasladar la función pura `createIterationFromEvent` a `src/core/debugAccumulator.ts` (backend).
- Las funciones y tipos puramente de interfaz (`StepIterationGroupData`, `groupIterationsByStep`, `reconstructIterationsFromTask`) se ubican en `ui/utils/debugAccumulator.ts` y consumen los tipos del backend.
- Con esto, **el backend tiene 0 imports hacia `ui/`**.

### B. Dependencias: Frontend hacia Backend
El frontend consume legítimamente los contratos canónicos exportados por el backend:
- `ui/components/**`, `ui/hooks/useJarvis.ts`, `ui/services/jarvisApi.ts` importan `Task`, `Step`, `PendingApproval`, `CoreEvent`, `MCPTool`, `ExecutableRoute`, `isTerminalState` desde `src/core/types.ts` y `JarvisConfig` desde `src/core/config.ts`.
- **Propuesta de resolución:** Se actualizan las rutas de importación en el frontend hacia `@/src/core/types.ts` y `@/src/core/config.ts`.

---

## 3. Configuración Afectada

1. **`index.html`**:
   - Línea 18: Cambiar `<script type="module" src="/src/main.tsx"></script>` por `<script type="module" src="/ui/main.tsx"></script>`.
2. **`vite.config.ts`**:
   - El alias `@` apunta a la raíz `path.resolve(__dirname, '.')`, lo que permite importar tanto `@/src/...` como `@/ui/...`.
   - Se mantiene la raíz en el directorio principal para preservar la compatibilidad con `server.ts` y las herramientas de empaquetado.
3. **`tsconfig.json`**:
   - Mantiene `"paths": { "@/*": ["./*"] }`, permitiendo resolución limpia de módulos en ambas carpetas.
   - Preserva `DOM` y `DOM.Iterable` en `lib` para soportar tanto backend Node.js como frontend React sin requerir tsconfigs fragmentados en este paso.
4. **`server.ts`**:
   - No requiere cambios en la lógica de proxy de Vite ni en estáticos: en desarrollo sigue sirviendo `index.html` de la raíz (que apuntará a `/ui/main.tsx`) y en producción sirve `dist/`.
   - Ningún endpoint del backend importa componentes del frontend.
5. **`package.json`**:
   - Scripts (`dev`, `build`, `lint`) se mantienen idénticos (`tsx server.ts`, `vite build`, `tsc --noEmit`).

---

## 4. Plan de Movimiento

### Paso 1: Resolver archivos compartidos en el backend
1. Crear `src/core/debugTypes.ts` (o incorporar en `src/core/types.ts`) las interfaces `ModelType`, `ModelStage`, `ModelIterationMetrics` y `ModelIteration`.
2. Crear `src/core/debugAccumulator.ts` que contenga `createIterationFromEvent`, consumiendo `src/core/types.ts`.
3. Actualizar `src/core/core.ts` para importar `createIterationFromEvent` desde `./debugAccumulator.ts`.
4. Eliminar `src/types/debug.ts` y `src/utils/debugAccumulator.ts` de `src/`.

### Paso 2: Crear estructura `ui/` y mover archivos de frontend
1. Crear carpetas: `ui/components/`, `ui/hooks/`, `ui/services/`, `ui/types/`, `ui/utils/`.
2. Mover archivos:
   - `src/App.tsx` ──► `ui/App.tsx`
   - `src/main.tsx` ──► `ui/main.tsx`
   - `src/index.css` ──► `ui/index.css`
   - `src/components/*` ──► `ui/components/*`
   - `src/hooks/*` ──► `ui/hooks/*`
   - `src/services/*` ──► `ui/services/*`
   - `src/types/ui.ts` ──► `ui/types/ui.ts`
   - `src/utils/apiUrl.ts` ──► `ui/utils/apiUrl.ts`
   - `src/utils/platform.ts` ──► `ui/utils/platform.ts`
   - `src/utils/routeLabels.ts` ──► `ui/utils/routeLabels.ts`
   - `src/utils/taskStatus.ts` ──► `ui/utils/taskStatus.ts`
3. Crear `ui/utils/debugAccumulator.ts` y `ui/types/debug.ts` con las utilidades y tipos exclusivos de presentación (`StepIterationGroupData`, `groupIterationsByStep`, `reconstructIterationsFromTask`), importando los contratos base desde `@/src/core/types.ts` o `@/src/core/debugAccumulator.ts`.

### Paso 3: Actualizar imports del frontend
- Actualizar imports relativos dentro de `ui/` (ej. `import App from './App.tsx'`, `import './index.css'`).
- Actualizar imports de contratos de backend a `@/src/core/types.ts` y `@/src/core/config.ts`.

### Paso 4: Actualizar `index.html`
- Actualizar la referencia del script de `/src/main.tsx` a `/ui/main.tsx`.

### Paso 5: Limpieza de directorios vacíos en `src/`
- Remover carpetas vacías en `src/`: `src/components/`, `src/hooks/`, `src/services/`, `src/types/`, `src/utils/`.
- `src/` contendrá exclusivamente: `src/core/` y `src/server/`.

---

## 5. Impacto en Documentación (`docs/`)
- **Impacto nulo:** Las secciones "Archivos Base" de `docs/ARCHITECTURE.md`, `docs/CORE_FLOW.md` y `docs/CONTEXT_AND_MEMORY.md` referencian exclusivamente rutas de `server.ts`, `src/core/*` y `src/server/*`.
- Ningún archivo base documentado cambia de ruta ni se ve afectado por la extracción del frontend.

---

## 6. Verificación
1. **Compilación estricta de TypeScript**: Ejecutar `./node_modules/.bin/tsc --noEmit` confirmando 0 errores en backend y frontend.
2. **Build de producción de Vite**: Ejecutar `npm run build` para asegurar que Rollup empaquete correctamente `ui/main.tsx` y sus componentes hacia `dist/`.
3. **Verificación de aislamiento de backend**: Ejecutar un escaneo `grep` comprobando que ningún archivo en `src/` contenga imports con `"ui/"` o dependencias de React/DOM.
4. **Verificación de directorios**: Confirmar que en `src/` solo existan archivos y carpetas del backend.

---

## 7. Riesgos y Preguntas Abiertas

1. **Ubicación de `createIterationFromEvent`**:
   - Actualmente alimenta tanto el almacenamiento de trazas del backend (`JarvisCore.emitEvent`) como la reactividad del cliente (`useJarvis`).
   - Propuesta del plan: Dejar la función generadora en el backend (`src/core/debugAccumulator.ts`) y consumirla desde el hook de la UI para mantener una única fuente de verdad lógica.
   - Alternativa: Duplicar la función en `ui/` para aislamiento total a nivel de código si se prefiere cero imports entre `ui/` y utilidades de backend.
2. **Ubicación de `index.html`**:
   - El plan mantiene `index.html` en la raíz del repositorio cambiando el entry point a `/ui/main.tsx`, lo que evita tocar la configuración de Express en `server.ts`.
