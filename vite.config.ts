import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' — чтобы сборка открывалась из file:// (Electron) и внутри Android WebView
export default defineConfig({ plugins: [react()], base: './', build: { chunkSizeWarningLimit: 700 } });
