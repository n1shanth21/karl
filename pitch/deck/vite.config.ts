import { defineConfig } from "vite";

// Live traction numbers: the deck calls /karl-api/api/stats and Vite forwards it to the
// real server (its CORS rules only allow the dashboard, so the browser can't call it directly).
const proxy = {
  "/karl-api": {
    target: "https://karl-production.up.railway.app",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/karl-api/, ""),
  },
};

// Relative base so the built deck (dist/) works from any folder.
export default defineConfig({
  base: "./",
  server: { fs: { allow: [".."] }, proxy }, // brand tokens live in ../brand
  preview: { proxy },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { main: "index.html", presenter: "presenter.html" } }, // two pages
  },
});
