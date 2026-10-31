import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  base: "./",
  build: { target: "es2020", outDir: "dist", sourcemap: false },
  server: { port: 5173, strictPort: true },
});
