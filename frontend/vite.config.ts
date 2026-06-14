import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // En dév, le backend FastAPI tourne sur l'hôte (uv run fastapi dev).
      // ws: true → proxifie aussi le WebSocket LSP clangd (/api/lsp/...).
      '/api': { target: 'http://localhost:8000', ws: true },
    },
  },
});
