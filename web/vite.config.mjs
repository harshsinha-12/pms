import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function normalizeOrigin(value = "") {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

const siteOrigin = normalizeOrigin(
  process.env.VITE_SITE_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL,
);

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [
    {
      name: "quiet-capital-social-meta",
      transformIndexHtml(html) {
        return html.replaceAll("__SITE_ORIGIN__", siteOrigin);
      },
    },
    react(),
  ],
});
