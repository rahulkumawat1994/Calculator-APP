import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Production `vite build` must not import `vitest/config` (Vitest is not installed
// in some environments, and it is unnecessary for bundling).
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
