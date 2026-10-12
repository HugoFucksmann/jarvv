# JARVIS

> Última revisión: **2026-10-11**

JARVIS es un sistema de asistente inteligente determinista full-stack que orquesta la ejecución autónoma y supervisada de tareas complejas en sistemas operativos locales y entornos web mediante Decision 2.0, Qwen 3.5 9B y servidores de herramientas bajo el protocolo Model Context Protocol (MCP).

## Propósito

JARVIS permite a usuarios y operadores ejecutar flujos de trabajo sobre el sistema operativo Windows, la línea de comandos, el sistema de archivos y la web a partir de instrucciones en lenguaje natural, garantizando seguridad, verificabilidad y control humano.

- **Qué hace:** Recibe instrucciones en lenguaje natural, planifica y enruta acciones a través de Decision 2.0 y Qwen 3.5 9B, ejecuta herramientas locales MCP (Windows, Desktop Commander y Free Search) y solicita aprobación humana explícita antes de cualquier acción destructiva o mutación.
- **Qué no hace:** No ejecuta comandos destructivos sobre el sistema operativo raíz sin autorización ni salta las compuertas de seguridad de Guard; no opera como un chatbot meramente generativo sin validación determinista.

## Tecnologías

| Área | Tecnología | Versión |
|------|-----------|---------|
| Lenguaje | TypeScript | 7.0.2 / ES2022 |
| Runtime | Node.js (con tsx) | 20+ |
| Backend & Host | Express | 4.21.2 |
| Frontend UI | React + Vite + Tailwind CSS | React 19 / Vite 8 / Tailwind 4 |
| Modelo Razonador LLM | Qwen 3.5 9B (vía Ollama/vLLM) | qwen3.5:9b |
| Modelo Clasificador | Decision 2.0 (Eos-0.8B) | Decision-2.0-Eos-0.8B |
| Protocolo de Herramientas | Model Context Protocol (MCP) | JSON-RPC 2.0 sobre stdio |
| Servidores MCP | windows-mcp, DesktopCommanderMCP, free-search-mcp | 1.3.27 / 2.1.0 / 0.13.1 |
| Almacenamiento / Estado | JSON local persistido (`jarvis-tasks.json`) | — |

## Requisitos

- Node.js >= 20 y npm
- Servidor Ollama o vLLM con el modelo `qwen3.5:9b` en ejecución (por defecto `http://127.0.0.1:11434`)
- Endpoint HTTP para Decision 2.0 (local o túnel ngrok, por defecto `http://127.0.0.1:8765`)
- Herramientas `uvx` (de `uv` / Python) y `npx` instaladas en el sistema para la ejecución de servidores MCP
- En Windows: permisos adecuados para automatización de interfaz de usuario mediante UI Automation

## Configuración

| Variable / archivo | Descripción | Default |
|--------------------|-------------|---------|
| `PORT` | Puerto HTTP para el servidor Express autoritativo | `3000` |
| `qwenUrl` (`jarvis-config.json`) | URL del servicio Ollama/vLLM para Qwen 3.5 9B | `http://127.0.0.1:11434` |
| `qwenModel` (`jarvis-config.json`) | Nombre del modelo LLM de razonamiento | `qwen3.5:9b` |
| `decisionUrl` (`jarvis-config.json`) | URL del servicio Decision 2.0 | `http://127.0.0.1:8765` |
| `windowsMcp` (`jarvis-config.json`) | Comando y argumentos para iniciar Windows MCP | `uvx windows-mcp serve` |
| `desktopCommanderMcp` (`jarvis-config.json`) | Comando y argumentos para Desktop Commander MCP | `npx -y @wonderwhy-er/desktop-commander` |
| `freeSearchMcp` (`jarvis-config.json`) | Comando y argumentos para Free Search MCP | `uvx --from free-search-mcp==0.13.1 --with selectolax==0.3.34 free-search-mcp` |
| `timeoutMs` (`jarvis-config.json`) | Timeout general por defecto para operaciones | `30000` (30 s) |
| `decisionTimeoutMs` (`jarvis-config.json`) | Timeout para inferencias de Decision 2.0 | `30000` (30 s) |
| `qwenTimeoutMs` (`jarvis-config.json`) | Timeout para inferencias de Qwen 3.5 9B | `120000` (120 s) |
| `mcpTimeoutMs` (`jarvis-config.json`) | Timeout para ejecuciones de herramientas MCP | `30000` (30 s) |

## Inicio rápido

```bash
# Instalar dependencias
npm install

# Iniciar servidor autoritativo de desarrollo (Express + Vite middlewares en puerto 3000)
npm run dev

# Compilar para producción
npm run build
```

## Estructura del proyecto

```
src/
├── components/   # Componentes modulares de interfaz React (TopBar, CommandSection, GuardBanner, ProcessFlow, ContextInspector)
├── core/         # Núcleo determinista autoritativo
│   ├── mcp/      # Transporte stdio JSON-RPC, adaptadores y motor de descubrimiento
│   ├── policy/   # Compuerta de seguridad Guard y registro inmutable de políticas
│   ├── processor/# Procesamiento y extracción de resultados MCP y almacén RefStore
│   └── reasoner/ # Clientes y constructores de prompts para Qwen y Decision 2.0
├── hooks/        # Hook useJarvis para suscripción reactiva y consumo de API
├── services/     # Cliente jarvisApi para comunicación REST con el backend
└── utils/        # Utilidades de resolución de URL de API
```

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Componentes, responsabilidades y dependencias |
| [CORE_FLOW](docs/CORE_FLOW.md) | Flujo de la instrucción a la respuesta final |
| [CONTEXT_AND_MEMORY](docs/CONTEXT_AND_MEMORY.md) | Contexto, prompts, memoria y datos al modelo |
| [TOOLS_AND_SECURITY](docs/TOOLS_AND_SECURITY.md) | Herramientas, MCP, permisos y aprobaciones |
| [INCONSISTENCIAS](docs/INCONSISTENCIAS.md) | Registro de discrepancias e inconsistencias técnicas detectadas |
| [CODEBASE_MAP](docs/CODEBASE_MAP.md) | Árbol de archivos, mapa de imports y diagrama de módulos |