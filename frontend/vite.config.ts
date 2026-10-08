import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = "http://127.0.0.1:8000";

// Keep the browser's Host header (localhost:5173). The string shorthand
// would rewrite it to the API's host, so the backend's CSRF check would see
// Origin (5173) != Host (8000) and reject every POST as cross-site.
const proxy = { target: API, changeOrigin: false };

// Served by FastAPI at /app after `npm run build`.
// In dev, Vite proxies API calls to uvicorn, so no CORS setup is needed.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": proxy,
      "/health": proxy,
    },
  },
});
