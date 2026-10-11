# JARVIS

> Última revisión: **[COMPLETAR: AAAA-MM-DD]**

> **[COMPLETAR]** Una frase: qué es JARVIS y qué problema resuelve.
> *Ej: Asistente de IA que ejecuta instrucciones en lenguaje natural usando herramientas locales y servidores MCP.*

## Propósito

> **[COMPLETAR]** 2-3 líneas: objetivo, usuarios, alcance (y qué NO hace).

- **Qué hace:** *Ej: recibe una instrucción, planifica, usa herramientas y responde.*
- **Qué no hace:** *Ej: no ejecuta acciones destructivas sin aprobación.*

## Tecnologías

> **[COMPLETAR]** Lenguaje, frameworks, modelos y servicios clave.

| Área | Tecnología | Versión |
|------|-----------|---------|
| Lenguaje | TypeScript | *Ej: 5.x* |
| Runtime | Node.js | *Ej: 20+* |
| Modelo LLM | *Ej: Claude* | *—* |
| Herramientas | *Ej: MCP* | *—* |
| Almacenamiento | *Ej: SQLite* | *—* |

## Requisitos

> **[COMPLETAR]** Software, cuentas, claves y variables de entorno necesarias.

- *Ej: Node.js >= 20*
- *Ej: `ANTHROPIC_API_KEY` en `.env`*

## Configuración

> **[COMPLETAR]** Variables de entorno y archivos de config con su valor por defecto.

| Variable / archivo | Descripción | Default |
|--------------------|-------------|---------|
| `ANTHROPIC_API_KEY` | *Ej: clave del proveedor del modelo* | — (obligatoria) |
| `MAX_ITERATIONS` | *Ej: límite del bucle del agente* | `10` |
| `mcp.json` | *Ej: servidores MCP configurados* | — |

## Inicio rápido

> **[COMPLETAR]** Comandos reales para instalar y ejecutar.

```bash
# Ej:
git clone <repo> && cd JARVIS
npm install
npm run dev
```

## Estructura del proyecto

> **[COMPLETAR]** Árbol de carpetas con una línea por módulo.

```
src/
├── core/     # Ej: bucle principal del agente
├── tools/    # Ej: herramientas y cliente MCP
└── memory/   # Ej: historial y memoria
```

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Componentes, responsabilidades y dependencias |
| [CORE_FLOW](docs/CORE_FLOW.md) | Flujo de la instrucción a la respuesta final |
| [CONTEXT_AND_MEMORY](docs/CONTEXT_AND_MEMORY.md) | Contexto, prompts, memoria y datos al modelo |
| [TOOLS_AND_SECURITY](docs/TOOLS_AND_SECURITY.md) | Herramientas, MCP, permisos y aprobaciones |