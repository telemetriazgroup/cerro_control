# Proxy inverso de Cerro Prieto

## Qué se observó

El panel público está en `https://ztrack.app/cerroprieto/`. Apache solo reenvía ese prefijo:

```
ProxyPass /cerroprieto/ http://161.132.53.51:9986/cerroprieto/
ProxyPassReverse /cerroprieto/ http://161.132.53.51:9986/cerroprieto/
```

La página sí cargaba. Los datos no. En la consola del navegador, `GET https://ztrack.app/serial?desde=0` respondía 404 y el panel mostraba «no se pudo completar».

La causa: el navegador pedía la API en la raíz del dominio (`/serial`, `/lecturas`, `/salir`, `/reporte`). Ese Apache no reenvía esas rutas al puerto 9986. Las responde el sitio principal de `ztrack.app`, que no tiene el panel, y por eso el 404. El mismo fallo alcanzaba salir, el histórico, los reportes y la subida de un txt.

## Qué se hizo

El navegador ahora pide todo bajo `/cerroprieto/`:

- `GET /cerroprieto/serial`
- `GET /cerroprieto/lecturas` y `GET /cerroprieto/reporte`
- `POST /cerroprieto/salir`, `POST /cerroprieto/comando` y el resto de la API

Apache ya reenvía ese prefijo, así que la petición llega a `http://161.132.53.51:9986/cerroprieto/serial`. El proceso de Cerro Prieto reconoce la API bajo `/cerroprieto/` y la atiende igual que en la raíz del puerto. Un script que llama `http://161.132.53.51:9986/serial` sigue funcionando.

La puerta sigue siendo `/cerroprieto/login`. `/login` no existe. `/` solo redirige a `/cerroprieto/login`.

Las redirecciones del proceso son rutas (`Location: /cerroprieto/login`), no una URL con el IP interno. El navegador las resuelve en `ztrack.app` y Apache las vuelve a reenviar. No hace falta publicar el puerto 9986 ni agregar otro `ProxyPass` para `/serial`.

## Cómo dejarlo en Apache

Hace falta republicar el proceso del puerto 9986 para que acepte la API bajo `/cerroprieto/` y sirva el frontend nuevo. El bloque de Apache se queda así:

```
ProxyPass /cerroprieto/ http://161.132.53.51:9986/cerroprieto/
ProxyPassReverse /cerroprieto/ http://161.132.53.51:9986/cerroprieto/
```

Después de recargar Apache, `https://ztrack.app/cerroprieto/` debe pedir `https://ztrack.app/cerroprieto/serial?desde=0` y esa llamada no debe ser 404.
