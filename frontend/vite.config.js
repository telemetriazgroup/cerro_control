import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/cerroprieto/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/serial": "http://127.0.0.1:9986",
      "/lecturas": "http://127.0.0.1:9986",
      "/reporte": "http://127.0.0.1:9986",
      "/flujo": "http://127.0.0.1:9986",
      "/comando": "http://127.0.0.1:9986",
      "/comandos": "http://127.0.0.1:9986",
      "/config": "http://127.0.0.1:9986",
      "/cola": "http://127.0.0.1:9986",
      "/usuarios": "http://127.0.0.1:9986",
      "/sesion": "http://127.0.0.1:9986",
      "/salir": "http://127.0.0.1:9986",
      "/login": "http://127.0.0.1:9986",
      "/archivos": "http://127.0.0.1:9986",
      "/historial-comandos": "http://127.0.0.1:9986",
      "/salud": "http://127.0.0.1:9986",
    },
  },
});
