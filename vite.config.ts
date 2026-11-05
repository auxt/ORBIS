import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build (like Bedrock Math): the app, its data, fonts and the simulation worker in one HTML file.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  worker: { format: 'es' },
  build: { target: 'es2020', cssCodeSplit: false, assetsInlineLimit: 100000000, chunkSizeWarningLimit: 4000 }
});
