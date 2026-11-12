import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcssPostcss from "@tailwindcss/postcss";
import path from "node:path";

// Vite bundle for the Tauri desktop build — reuses the existing web app
// components from src/ unchanged. Tailwind runs through @tailwindcss/postcss
// (same version as the web build) via the inline PostCSS config below.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcssPostcss()],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "../src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome110",
  },
  // Keep the console clean during `tauri dev`.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
});
