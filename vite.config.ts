import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // This starter template may mention GEMINI_API_KEY, but the current app does not call Gemini.
    // Keep the key optional so local dev works even without `.env.local`.
    const geminiApiKey = env.GEMINI_API_KEY ?? '';
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    return {
      // GitHub Pages deploy under repo subpath (keep dev at '/')
      base: mode === 'production' ? '/Lets-go-parkouring/' : '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(geminiApiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiApiKey)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
