import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/cerroprieto/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries([
      "/serial", "/lecturas", "/reporte", "/flujo", "/comando", "/comandos",
      "/config", "/cola", "/usuarios", "/cuenta", "/sesion", "/salir",
      "/archivos", "/historial-comandos", "/salud",
      "/cerroprieto/login", "/cerroprieto/serial", "/cerroprieto/lecturas",
      "/cerroprieto/reporte", "/cerroprieto/flujo", "/cerroprieto/comando",
      "/cerroprieto/comandos", "/cerroprieto/config", "/cerroprieto/cola",
      "/cerroprieto/usuarios", "/cerroprieto/cuenta", "/cerroprieto/sesion",
      "/cerroprieto/salir", "/cerroprieto/archivos", "/cerroprieto/historial-comandos",
    ].map(ruta => [ruta, "http://127.0.0.1:9986"])),
  },
});
