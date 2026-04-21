import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Production `vite build` must not import `vitest/config` (Vitest is not installed
// in some environments, and it is unnecessary for bundling).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react/")
          ) {
            return "react-vendor";
          }
          if (
            id.includes("node_modules/firebase") ||
            id.includes("node_modules/@firebase")
          ) {
            return "firebase-vendor";
          }
          if (id.includes("node_modules/react-toastify")) {
            return "toastify-vendor";
          }
        },
      },
    },
  },
});
