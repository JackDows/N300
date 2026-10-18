import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 开发时固定端口；浏览器预览同样使用该端口。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
