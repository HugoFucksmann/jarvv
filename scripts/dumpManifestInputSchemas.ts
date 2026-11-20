import fs from 'node:fs';
import path from 'node:path';
import { ConfigManager } from '../src/core/config.ts';
import { FreeSearchMCPServer } from '../src/core/mcp/freeSearchMcp.ts';
import { DiscoveryEngine } from '../src/core/mcp/discovery.ts';
import { SYSTEM_TOOL_MANIFEST, isKnownTool } from '../src/core/tools/manifest.ts';
import type { MCPTool } from '../src/core/types.ts';

async function generateManifestMarkdown() {
  console.log('[Script] Inicializando servidores MCP y DiscoveryEngine...');
  const fsServer = new FreeSearchMCPServer(() => ConfigManager.getConfig());
  const discovery = new DiscoveryEngine([fsServer]);

  try {
    console.log('[Script] Descubriendo tools de free_search...');
    const discovered = await discovery.discoverAll(true);

    const allFsTools = discovered['free_search'] || [];

    // Filtrar solo las herramientas catalogadas en SYSTEM_TOOL_MANIFEST
    const manifestFsTools = allFsTools.filter((t) => isKnownTool('free_search', t.name));

    console.log(`[Script] Total manifest: ${SYSTEM_TOOL_MANIFEST.length} tools.`);
    console.log(`[Script] Filtradas ${manifestFsTools.length} tools de free_search.`);

    const formatServerTools = (serverName: string, tools: MCPTool[]): string => {
      let section = `# MCP Server: ${serverName}\n\n`;
      section += `Total de herramientas en manifest: ${tools.length}\n\n`;

      for (const tool of tools) {
        section += `## Tool: \`${tool.name}\`\n\n`;
        if (tool.description) {
          section += `### Descripción MCP\n\`\`\`\n${tool.description.trim()}\n\`\`\`\n\n`;
        }
        section += `### inputSchema\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\`\n\n`;
        section += `---\n\n`;
      }
      return section;
    };

    let mdContent = `# Input Schemas — Herramientas del Manifest de Jarvis\n\n`;
    mdContent += `Documento generado automáticamente con los esquemas de entrada (\`inputSchema\`) de las herramientas declaradas en \`SYSTEM_TOOL_MANIFEST\` (las que Jarvis realmente utiliza en sus rutas: files, locate, terminal y web).\n\n`;
    mdContent += `---\n\n`;

    mdContent += formatServerTools('free_search', manifestFsTools);

    const outPath = path.resolve('inputSchemaManifest.md');
    fs.writeFileSync(outPath, mdContent.trimEnd() + '\n', 'utf8');
    console.log(`[Script] Guardado exitosamente en: ${outPath}`);
  } catch (error) {
    console.error('[Script] Error generando inputSchemaManifest.md:', error);
    process.exitCode = 1;
  } finally {
    console.log('[Script] Cerrando conexiones de transporte MCP...');
    await Promise.allSettled([fsServer.close()]);
    console.log('[Script] Finalizado.');
    process.exit(process.exitCode || 0);
  }
}

generateManifestMarkdown();

