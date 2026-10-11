import { defineConfig } from "vite";

// Relative base so the built deck (dist/) opens from any folder or a USB stick.
export default defineConfig({
  base: "./",
  server: { fs: { allow: [".."] } }, // brand tokens live in ../brand
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
});
