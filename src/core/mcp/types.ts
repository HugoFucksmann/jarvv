import type { ToolProvider } from "../tools/provider.ts";

/**
 * Lo que el núcleo consume para ejecutar herramientas. Es `ToolProvider` (`tools/provider.ts`): un servidor MCP por stdio o un módulo nativo.
 * El nombre se conserva para los adaptadores MCP y los tests existentes.
 */
export type IMCPServer = ToolProvider;
