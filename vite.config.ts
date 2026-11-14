import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // One chunk for all libraries, so it changes less often than the app code. Do not
          // split React out of it: the two library chunks then import each other (they share
          // Rollup's CommonJS helpers), React is still undefined when the other chunk runs,
          // and the production page stays blank.
          if (id.includes("node_modules") || id.startsWith("\0")) {
            return "vendor";
          }
          return;
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
