import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const allowedHosts = (process.env.NG_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(rootDir, 'index.html'),
          launcher: path.resolve(rootDir, 'launcher.html'),
        },
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'react-vendor';
            }
          },
        },
      },
    },
    server: {
      // `DISABLE_HMR=true` apaga la recarga en caliente y la vigilancia de archivos: para sandboxes donde un agente edita archivos con el servidor corriendo
      // (cada edición recargaría la página y gastaría CPU).
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      ...(allowedHosts.length > 0 ? {allowedHosts} : {}),
    },
  };
});
