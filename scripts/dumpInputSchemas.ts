import fs from 'node:fs';
import path from 'node:path';
import { ConfigManager } from '../src/core/config.ts';
import { DesktopCommanderMCPServer } from '../src/core/mcp/desktopCommanderMcp.ts';
import { FreeSearchMCPServer } from '../src/core/mcp/freeSearchMcp.ts';
import { DiscoveryEngine } from '../src/core/mcp/discovery.ts';
import type { MCPTool } from '../src/core/types.ts';

async function generateMarkdown() {
  console.log('[Script] Inicializando servidores MCP y DiscoveryEngine...');
  const dcServer = new DesktopCommanderMCPServer(() => ConfigManager.getConfig());
  const fsServer = new FreeSearchMCPServer(() => ConfigManager.getConfig());
  const discovery = new DiscoveryEngine([dcServer, fsServer]);

  try {
    console.log('[Script] Descubriendo tools de desktop_commander y free_search...');
    const discovered = await discovery.discoverAll(true);

    const dcTools = discovered['desktop_commander'] || [];
    const fsTools = discovered['free_search'] || [];

    console.log(`[Script] Obtenidas ${dcTools.length} tools de desktop_commander y ${fsTools.length} tools de free_search.`);

    const formatServerTools = (serverName: string, tools: MCPTool[]): string => {
      let section = `# MCP Server: ${serverName}\n\n`;
      section += `Total de herramientas: ${tools.length}\n\n`;

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

    let mdContent = `# Input Schemas — Herramientas MCP de Jarvis\n\n`;
    mdContent += `Documento generado automáticamente con los esquemas de entrada (\`inputSchema\`) de las herramientas provistas por los servidores MCP configurados en Jarvis: **desktop_commander** y **free_search**.\n\n`;
    mdContent += `---\n\n`;

    mdContent += formatServerTools('desktop_commander', dcTools);
    mdContent += formatServerTools('free_search', fsTools);

    const outPath = path.resolve('inputSchemaMCP.md');
    fs.writeFileSync(outPath, mdContent.trimEnd() + '\n', 'utf8');
    console.log(`[Script] Guardado exitosamente en: ${outPath}`);
  } catch (error) {
    console.error('[Script] Error generando inputSchemaMCP.md:', error);
    process.exitCode = 1;
  } finally {
    console.log('[Script] Cerrando conexiones de transporte MCP...');
    await Promise.allSettled([dcServer.close(), fsServer.close()]);
    console.log('[Script] Finalizado.');
    process.exit(process.exitCode || 0);
  }
}

generateMarkdown();
