# Cerro Prieto

Atmósfera controlada. El controlador se conecta por TCP, el panel muestra el último estado al entrar, y el histórico junta gases y temperaturas del mismo ciclo.

## Estructura

El proceso Python sigue siendo uno solo: el TCP y la cola de comandos comparten memoria. El navegador es otro proyecto.

- `frontend/` — interfaz en React. Al compilar queda en `frontend/dist` y el puerto 9986 la sirve en `/cerroprieto/`. El funcionamiento del backend y de los datos está en `sistema_cerro.md`.
- `tcp_cerro_new.py` — TCP `9985` y HTTP `9986`. Detecta la IP del controlador, guarda el serial y suelta un comando por hueco de unos 2 s.
- `panel_cerro.py` — lecturas, objetivos, histórico, reportes y flujo de control.
- Los equipos que llegan en JSON siguen saliendo a TermoKing y a Datos. Esos enlaces no pasan por la interfaz.

`interfaz.html` queda de respaldo si no existe `frontend/dist`.

## Quién ve qué

Los roles guardados siguen siendo `administrador` y `monitoreo`. En pantalla se leen Superadmin y Monitor.

Al iniciar sesión se abre el estatus en vivo: tarjetas del reefer y las tres zonas de CO₂ y O₂.

- Monitor: En vivo e Histórico. En el histórico ve las dos gráficas, la tabla con lo más reciente arriba, y Excel o PDF.
- Superadmin: además Serial, Comandos, Usuarios y Flujo de control. En el histórico también ve el análisis y puede incorporar un txt del serial.

## Puertos

- `9985` — controladores.
- `9986` — sesión, panel y archivos estáticos de la interfaz.
