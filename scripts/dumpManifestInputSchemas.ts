import fs from 'node:fs';
import path from 'node:path';
import { ConfigManager } from '../src/core/config.ts';
import { FreeSearchMCPServer } from '../src/core/mcp/freeSearchMcp.ts';
import { DiscoveryEngine } from '../src/core/mcp/discovery.ts';
import { SYSTEM_TOOL_MANIFEST, isKnownTool } from '../src/core/tools/manifest.ts';
import { FilesProvider } from '../src/tools/files/filesProvider.ts';
import { TerminalProvider } from '../src/tools/terminal/terminalProvider.ts';
import { WebSearchProvider } from '../src/tools/web/webSearchProvider.ts';
import type { MCPTool } from '../src/core/types.ts';

async function generateManifestMarkdown() {
  console.log('[Script] Inicializando proveedores y DiscoveryEngine...');
  const filesProvider = new FilesProvider({ allowedDirectories: () => ConfigManager.getConfig().allowedDirectories ?? [] });
  const terminalProvider = new TerminalProvider({ allowedDirectories: () => ConfigManager.getConfig().allowedDirectories ?? [] });
  const webProvider = new WebSearchProvider();
  const fsServer = new FreeSearchMCPServer(() => ConfigManager.getConfig());
  const discovery = new DiscoveryEngine([filesProvider, terminalProvider, webProvider, fsServer]);

  try {
    console.log('[Script] Descubriendo tools de proveedores nativos y free_search...');
    const discovered = await discovery.discoverAll(true);

    const serverNames = ['jarvis_files', 'jarvis_terminal', 'jarvis_web', 'free_search'] as const;
    const servers: [string, MCPTool[]][] = serverNames.map((name) => [
      name,
      (discovered[name] || []).filter((t) => isKnownTool(name, t.name)),
    ]);

    console.log(`[Script] Total manifest: ${SYSTEM_TOOL_MANIFEST.length} tools.`);
    for (const [name, tools] of servers) {
      console.log(`[Script] Filtradas ${tools.length} tools de ${name}.`);
    }

    const formatServerTools = (serverName: string, tools: MCPTool[]): string => {
      let section = `# Provider / MCP Server: ${serverName}\n\n`;
      section += `Total de herramientas en manifest: ${tools.length}\n\n`;

      for (const tool of tools) {
        section += `## Tool: \`${tool.name}\`\n\n`;
        if (tool.description) {
          section += `### Descripción\n\`\`\`\n${tool.description.trim()}\n\`\`\`\n\n`;
        }
        section += `### inputSchema\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\`\n\n`;
        section += `---\n\n`;
      }
      return section;
    };

    let mdContent = `# Input Schemas — Herramientas del Manifest de Jarvis\n\n`;
    mdContent += `Documento generado automáticamente con los esquemas de entrada (\`inputSchema\`) de las herramientas declaradas en \`SYSTEM_TOOL_MANIFEST\`.\n\n`;
    mdContent += `---\n\n`;

    for (const [name, tools] of servers) {
      mdContent += formatServerTools(name, tools);
    }

    const outPath = path.resolve('inputSchemaManifest.md');
    fs.writeFileSync(outPath, mdContent.trimEnd() + '\n', 'utf8');
    console.log(`[Script] Guardado exitosamente en: ${outPath}`);
  } catch (error) {
    console.error('[Script] Error generando inputSchemaManifest.md:', error);
    process.exitCode = 1;
  } finally {
    console.log('[Script] Cerrando conexiones de transporte MCP...');
    await Promise.allSettled([terminalProvider.close(), fsServer.close()]);
    console.log('[Script] Finalizado.');
    process.exit(process.exitCode || 0);
  }
}

generateManifestMarkdown();

