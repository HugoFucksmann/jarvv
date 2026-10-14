# JARVIS — Asistente Determinista Full-Stack

> Última revisión: **13 de octubre de 2026** (Fase 6 — Cierre y Calibración)

JARVIS es un sistema de asistente inteligente determinista full-stack que orquesta la ejecución autónoma y supervisada de tareas complejas en sistemas operativos locales y la web mediante **Decision 2.0**, **Qwen 3.5 9B** y servidores de herramientas bajo el protocolo **Model Context Protocol (MCP)**.

---

## Propósito y Alcance

JARVIS permite a usuarios y operadores ejecutar flujos de trabajo sobre el sistema operativo Windows, la línea de comandos, el sistema de archivos y la web a partir de instrucciones en lenguaje natural, garantizando seguridad, verificabilidad y control humano.

- **Qué hace:**
  - Recibe instrucciones en lenguaje natural en modos **FAST** (iterativo directo) o **PLAN** (planificación estructurada y revisión humana).
  - Enruta y selecciona herramientas mediante el modelo clasificador **Decision 2.0 (Eos-0.8B)**.
  - Resuelve referencias entre pasos con **RefResolver** (`${stepId.ref}`) y aísla salidas completas en **RefStore**.
  - Genera argumentos conforme a esquemas JSON estrictos con **Qwen 3.5 9B**.
  - Ejecuta herramientas locales vía transporte stdio en **Windows MCP**, **Desktop Commander MCP** y **Free Search MCP**.
  - Somete cada acción a la compuerta determinista **Guard**, exigiendo confirmación humana interactiva en **GuardBanner** ante cualquier mutación del sistema.
  - Verifica el cumplimiento de criterios mediante juicios **Eos** (`ok` y `cumple`).
  - Sincroniza el estado de ejecución en tiempo real mediante **Server-Sent Events (SSE)** hacia una interfaz web reactiva en **React 19** y **Tailwind CSS**.
- **Qué no hace:**
  - No ejecuta comandos destructivos sobre el sistema operativo raíz sin autorización ni permite saltar las políticas de seguridad de Guard.
  - No opera como un chatbot meramente generativo sin validación determinista ni ejecución auditable.

---

## Tecnologías

| Área | Tecnología | Versión / Modelo |
|------|-----------|------------------|
| **Lenguaje** | TypeScript | 5.7+ / ES2022 |
| **Runtime** | Node.js (con `tsx`) | 20+ |
| **Backend & Host** | Express | 4.21.2 |
| **Frontend UI** | React + Vite + Tailwind CSS | React 19 / Vite 8 / Tailwind 4 |
| **Modelo Razonador LLM** | Qwen 3.5 9B (vía Ollama/vLLM) | `qwen3.5:9b` |
| **Modelo Clasificador** | Decision 2.0 (Eos-0.8B) | `Decision-2.0-Eos-0.8B` |
| **Protocolo de Herramientas** | Model Context Protocol (MCP) | JSON-RPC 2.0 sobre stdio |
| **Servidores MCP** | Windows MCP, Desktop Commander, Free Search | 1.3.27 / 2.1.0 / 0.13.1 |
| **Sincronización en Tiempo Real**| Server-Sent Events (SSE) | EventSource nativo |
| **Persistencia de Tareas** | JSON local persistido | `jarvis-tasks.json` |

---

## Configuración y Variables

Las conexiones y comportamientos se configuran en `jarvis-config.json`:

| Propiedad | Descripción | Valor por Defecto |
|-----------|-------------|-------------------|
| `PORT` | Puerto HTTP para el servidor Express | `3000` |
| `qwenUrl` | URL del servicio Ollama/vLLM para Qwen 3.5 9B | `http://127.0.0.1:11434` |
| `qwenModel` | Nombre del modelo LLM de razonamiento | `qwen3.5:9b` |
| `decisionUrl` | URL del servicio Decision 2.0 | `http://127.0.0.1:8765` |
| `windowsMcp` | Comando y argumentos para Windows MCP | `uvx windows-mcp serve` |
| `desktopCommanderMcp`| Comando para Desktop Commander MCP | `npx -y @wonderwhy-er/desktop-commander` |
| `freeSearchMcp` | Comando para Free Search MCP | `uvx --from free-search-mcp==0.13.1 --with selectolax==0.3.34 free-search-mcp` |
| `timeoutMs` | Timeout general para operaciones | `30000` (30 s) |
| `decisionTimeoutMs` | Timeout para inferencias de Decision 2.0 | `30000` (30 s) |
| `qwenTimeoutMs` | Timeout para inferencias de Qwen 3.5 9B | `120000` (120 s) |
| `mcpTimeoutMs` | Timeout para ejecuciones de herramientas MCP | `30000` (30 s) |

---

## Inicio Rápido y Verificación

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor autoritativo de desarrollo (puerto 3000)
npm run dev

# 3. Validar tipado y dependencias circulares
npx tsc --noEmit
npx -y madge --extensions ts,tsx --ts-config tsconfig.json --circular src/

# 4. Compilar para producción
npm run build
```

---

## Estructura del Código Fuente

```
src/
├── components/          # Interfaz React modular y reactiva
│   ├── CommandSection/  # Entrada de instrucciones y selector de modo
│   ├── ContextInspector/# Inspección de Scratchpad, Memory, Evidence y Catálogo
│   ├── DecisionStream/  # Trazabilidad en vivo de Decision 1, Decision 2 y Verificación Eos
│   ├── GuardBanner/     # Compuerta visual para autorización humana interactiva
│   ├── ProcessFlow/     # Línea de tiempo, revisión de planes y respuesta final
│   ├── SettingsModal/   # Modal de configuración de URLs y endpoints
│   ├── Shared/          # Renderizador Markdown y estados
│   └── TopBar/          # Barra superior, historial y estado del sistema
├── core/                # Núcleo determinista de orquestación
│   ├── callExecutor.ts  # Ejecución de pasos y orquestación de herramientas
│   ├── config.ts        # Gestor de configuración persistente
│   ├── context.ts       # Contexto de tarea, memoria y recorte
│   ├── core.ts          # Orquestador JarvisCore y persistencia
│   ├── decision.ts      # Cliente Decision 2.0 y juicios Eos
│   ├── modeEngines.ts   # Motores de bucle FAST y PLAN
│   ├── mcp/             # Transporte stdio JSON-RPC y adaptadores MCP
│   ├── policy/          # Guard y PolicyRegistry
│   ├── processor/       # ResultProcessor y RefResolver
│   ├── reasoner/        # Cliente Qwen 3.5 9B y prompts centralizados
│   ├── tools/           # Manifest y catálogo consolidado
│   └── types.ts         # Contratos de tipos y constantes globales
├── hooks/               # Hook useJarvis con suscripción a SSE
├── services/            # Cliente API jarvisApi
└── utils/               # Utilidades de red y URLs
```

---

## Documentación Técnica Completa

| Documento | Descripción |
|-----------|-------------|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Arquitectura full-stack, responsabilidades de componentes y límites modulares |
| [CORE_FLOW](docs/CORE_FLOW.md) | Flujo paso a paso desde el prompt hasta la síntesis de la respuesta final |
| [CONTEXT_AND_MEMORY](docs/CONTEXT_AND_MEMORY.md) | Manejo de memoria, RefStore, presupuestos de tokens y ensamble de prompts |
| [TOOLS_AND_SECURITY](docs/TOOLS_AND_SECURITY.md) | Catálogo de herramientas MCP, políticas deterministas de Guard y flujo de aprobación |
| [INCONSISTENCIAS](docs/INCONSISTENCIAS.md) | Diagnóstico técnico y estado de calibración de los 7 hallazgos detectados |
| [CODEBASE_MAP](docs/CODEBASE_MAP.md) | Árbol completo de archivos, grafo de dependencias e importaciones |
| [MCP_TOOLS_SNAPSHOT](docs/MCP_TOOLS_SNAPSHOT.md) | Snapshot de las herramientas descubiertas en runtime por protocolo stdio |
| [FASE_6_PREPARACION_AUDITORIA_INTEGRAL](docs/FASE_6_PREPARACION_AUDITORIA_INTEGRAL.md) | Informe exhaustivo de auditoría técnica y preparación de la Fase 6 |