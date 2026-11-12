import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080";

  return {
    plugins: [react()],
    // Images in /public/ are served at the root URL path:
    //   /beans.jpg, /maize.webp, /tomatoes.jpg, etc.
    server: {
      proxy: {
        "/api": apiTarget,
        "/media": apiTarget
      }
    }
  };
});
