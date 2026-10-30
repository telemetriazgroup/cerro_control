# Sistema Cerro Prieto

Un solo proceso Python atiende el TCP de los equipos y el HTTP del panel. El navegador es otro proyecto: React, servido en `/cerroprieto/`. Los dos no se mezclan en la URL. La interfaz pide los datos a la API en la raíz del puerto 9986 (`/serial`, `/lecturas`, y el resto).

Hora de todo el sistema: America/Lima, UTC−5, sin horario de verano.

## Dónde está el código

No hay carpeta `backend/`. El backend son estos dos archivos en la raíz del repositorio:

| Archivo | Qué hace |
|---|---|
| `tcp_cerro_new.py` | Escucha el TCP, distingue atmósfera controlada de JSON, reenvía el JSON a los enlaces, sirve el HTTP y la sesión. |
| `panel_cerro.py` | Interpreta el serial, guarda lecturas, cola, histórico, reportes y el flujo de control. |

El frontend está en `frontend/`. El código fuente es React. `npm run build` deja el sitio en `frontend/dist`, y el proceso Python lo entrega bajo `http://<host>:9986/cerroprieto/`. La raíz del proyecto es `http://<host>:9986/cerroprieto/login`. Después de entrar, el navegador queda en `/cerroprieto/`. `/` redirige a esa puerta. `/login` no existe.

`interfaz.html` solo se usa si falta `frontend/dist/index.html`.

Arranque: `python tcp_cerro_new.py` desde esta carpeta. En Docker el directorio de trabajo es `/app` y los datos van a `/app/datos`.

## Puertos

| Puerto | Uso |
|---|---|
| 9985 | TCP de equipos. Variable `CERRO_TCP_PORT`. |
| 9986 | HTTP del panel y de la API. Variable `CERRO_API_PORT`. |

`GET /salud` responde `{"ok": true}` sin sesión. Es el chequeo del contenedor.

## Dos canales en el mismo TCP

Cada conexión entra por 9985. Lo primero que se reconoce decide el canal. Una IP puede tener varias conexiones; como máximo 30. A los 120 s sin datos se cierra.

### Atmósfera controlada (Cerro Prieto)

Si en la ventana de bytes aparece `RIPENER`, `STARCOOL`, `REEFER`, `INYECTOR` o `SERVIDOR`, esa conexión es el controlador de la cámara. No se reenvía a TermoKing ni a Datos.

El proceso guarda la IP. Los comandos del panel salen por ese socket, uno por hueco de unos 2 s entre respuestas completas, sin cortar una ráfaga partida de RIPENER o REEFER. Una línea de acuse (`STARCOOL_OK`, `INYECTOR_OK`, `REEFER_CAMBIO_OK`) no abre hueco.

Cada línea queda en el log del día y entra al panel: gases, humedad, reefer, bitmap del inyector, salidas, etileno y consigna `SERVIDOR`.

### JSON que sigue al enlace

Si el texto es un objeto JSON con campo `i` (el identificador del equipo), no es atmósfera controlada. El mismo objeto se publica en los dos enlaces:

- `CERRO_API_URL`, por defecto `http://161.132.53.51:9050/TermoKing/`
- `CERRO_API_URL2`, por defecto `http://161.132.206.104:9050/Datos/`

La respuesta de TermoKing se devuelve por el mismo socket. Si alguno de los dos POST falla, el JSON se anota en `cerro_api_pendiente.jsonl` y un hilo lo reintenta cada 30 s hasta que los dos acepten.

## Carpeta de datos

`CERRO_DIR` (si no está definida, el directorio desde el que se lanzó el proceso). `CERRO_LOGS` es la carpeta de los txt que se suben para incorporar; si no está definida, es `datos/` junto al código.

```
CERRO_DIR/
  cerro_DD_MM_YYYY.txt          log crudo del día, todas las IP
  cerro_emergencia_DD_MM_YYYY.txt   solo si el log del día no se pudo escribir
  registros/<ip>/cerro_DD_MM_YYYY.txt   el mismo serial, separado por IP
  cerro_api_pendiente.jsonl     JSON que todavía no llegó a los dos enlaces
  usuarios.json                 cuentas del panel
  panel_config.json             objetivos, catálogo, salidas, etileno
  cola_comandos.json            comandos pendientes y en vuelo
  estado_vivo.json              último estado por IP, para un reinicio
  flujos.json                   pares, secuencias, reglas y corridas
  lecturas/YYYY-MM-DD.jsonl     un registro por STARCOOL_CONSULTA
  historial_cmd/YYYY-MM-DD.jsonl  comandos que no son el ciclo fijo
```

Los txt de incorporación (`cerro_DD_MM_YYYY.txt` o con `_extra`) viven en `CERRO_LOGS`, no dentro de `lecturas/`.

### `lecturas/YYYY-MM-DD.jsonl`

Una línea JSON por consulta. Se conserva 62 días en las búsquedas.

```json
{"t":"2026-10-28T14:32:38-05:00","ip":"10.0.0.8","v":[8.1,10.0,11.8,4.2,4.1,7.9],"r":[1,8.0,7.6,11.7,10.3,43.9]}
```

`v` son los seis gases, en este orden: CO₂ zona 1, 2, 3 y O₂ zona 1, 2, 3. Un `0` o un `25.5` es reinicio: no pisa el último valor válido y no dispara una regla.

`r` aparece solo si el `REEFER_QUEST` de ese ciclo llegó como máximo 15 s antes. Son hasta 16 campos, en este orden:

1. power (0 apagado, 1 encendido)
2. set point °C
3. suministro °C
4. retorno °C
5. evaporador °C
6. condensador °C
7. sensor 1
8. sensor 2
9. sensor 3
10. sensor 4
11. humedad
12. ventilación CFM
13. CO₂ del sensor del reefer
14. O₂ del sensor del reefer
15. setpoint de humedad
16. setpoint de CO₂

Temperaturas válidas de −50 a 60. El condensador en 35 °C o más se marca caliente. Una humedad usable está entre más de 50 y 100; el 0 también es reinicio.

El visible de cada zona es el último valor que no fue reinicio. Los objetivos de fábrica, mientras nadie los guarde, son CO₂ 8 / 10 / 12 y O₂ 4 / 4 / 8. Si llega `SERVIDOR` con consigna y el panel no tiene objetivos fijados, se usan los del equipo.

### `panel_config.json`

Objetivos por zona, si están fijados, el catálogo de comandos (`id`, `grupo`, `titulo`, `trama`, `descripcion`), el significado de cada campo de `STARCOOL_SALIDAS` y el nombre del etileno.

### `cola_comandos.json`

`seq` e `items`. Cada ítem tiene `id` (`qN`), trama, estado, IP y, si viene de un flujo, `disponible_desde`, `par`, `rol`, `corrida` y `paso`.

Estados: 1 pendiente, 4 en vuelo, 0 enviado, 2 error tras 3 fallos, 3 cancelado. Un paso de flujo que no se pudo escribir se queda en 1, para no perder un apagado. El apagado armado de una corrida no se cancela.

### `flujos.json`

`pares` (comando de encendido y de apagado), `secuencias` (pasos del catálogo con espera en segundos), `reglas` (zona, gas, rango, modo `entrar` o `seguir`, secuencia, activa) y `corridas` (la ejecución, con la hora real de cada salida). Una regla nueva nace desactivada. Hacen falta dos consultas seguidas dentro del rango. El modo seguir espera 60 s después de cerrar la corrida anterior.

La espera de un par o de un paso se cuenta desde que la trama anterior salió por el serial, no desde que se pulsó el botón. El número que queda en la corrida es el que realmente pasó entre las dos salidas.

### `historial_cmd/YYYY-MM-DD.jsonl`

Comandos de starcool, inyector y válvulas que no forman el ciclo fijo (QUEST, SALIDAS, PLATAFORMA, ESTADO? y el bitmap). `origen` es `serial` o `interfaz`. La línea de respuesta se agrega después, con `respuesta` y `respuesta_en`.

### `usuarios.json`

Lista de cuentas. La clave no se guarda en claro: PBKDF2-SHA256, 120000 iteraciones, sal por usuario. Roles exactos: `administrador` y `monitoreo`. En pantalla se leen Superadmin y Monitor. Si el archivo no existe, se crea `zgroup` como administrador. No se puede borrar ni degradar al último administrador.

La cookie `cerro_sesion` dura 12 h, HttpOnly, SameSite=Strict. Ocho fallos por IP en 10 minutos cierran el ingreso.

### `estado_vivo.json`

Copia del último estado por IP (gases, reefer, paso del ciclo) para que un reinicio del proceso no borre lo que ya se estaba mostrando.

## Quién ve qué

Monitor: En vivo e Histórico. En vivo ve las tarjetas del reefer, el estado de los objetivos y las zonas de CO₂ y O₂. En el histórico ve las gráficas, la tabla (lo más reciente arriba) y puede bajar Excel o PDF. No llama a comandos, catálogo, archivos, usuarios ni flujo: esas rutas responden 403.

Superadmin: además Serial, Comandos, Usuarios y Flujo de control, el análisis del histórico y la incorporación de un txt.

## API que usa el frontend

El navegador las pide bajo `/cerroprieto/` para que el proxy inverso las reenvíe. El puerto 9986 también las atiende en la raíz, para un script o un acceso directo. La cookie de sesión vale para todo el host. El detalle del proxy está en `caso_proxy.md`.

| Método y ruta | Uso |
|---|---|
| POST `/cerroprieto/login`, POST `/salir` | Entrar y salir. La puerta visible es `/cerroprieto/login` |
| GET `/sesion` | Usuario y rol |
| GET `/serial?desde=&equipo=` | Estado en vivo, cada segundo. Al monitor se le vacían las líneas y la cola |
| GET `/lecturas?desde=&hasta=` | Puntos, tabla y análisis del rango |
| GET `/reporte?desde=&hasta=&formato=xlsx\|pdf` | Archivo del rango completo |
| GET `/historial-comandos` | Solo superadmin |
| GET y POST `/flujo`, `/flujo/par`, `/flujo/secuencia`, `/flujo/regla`, `/flujo/proceso` y sus acciones | Flujo de control. El proceso de corrección espera dos lecturas y después cada comando hasta que el anterior salió. |
| POST `/intervencion` y `/intervencion/quitar` | Ajuste que solo ve el monitor, en una hora, una zona y un gas. El administrador sigue viendo el dato principal y la diferencia. |
| POST `/comando`, POST `/cola/cancelar`, POST `/comandos`, POST `/config` | Cola, catálogo y objetivos |
| GET y POST `/usuarios`, POST `/usuarios/quitar` | Cuentas |
| POST `/archivos`, POST `/archivos/incorporar` | Subir un txt e incorporarlo. Tope 20 MB. Si ese día ya tiene lecturas, hace falta `reemplazar: true` |

Un script puede usar la API como administrador si existe `CERRO_API_TOKEN` y manda la cabecera `X-Token`.

## Histórico anterior al serial

El serial guardado en este equipo empieza el 24/10/2026 a las 00:00, hora America/Lima. Si el rango de `/lecturas` o del reporte empieza antes, esa parte se pide a TermoKing y se une a las lecturas locales en una sola serie, ordenada por hora. Del 24/10/2026 en adelante sigue valiendo solo el serial.

Las dos consultas comparten la misma fecha. `st_1` … `st_6` son el CO₂ y el O₂ de las tres zonas, en el orden de `STARCOOL_CONSULTA`. `ac_1` … `ac_16` son los 16 campos de `REEFER_QUEST`. El IMEI es `860389053949943`.

- `GET http://161.132.53.51:9051/TermoKing/CerroPrietoSeries/860389053949943/starcool_cerro_prieto?start_date=23-10-2026_22-00-00&end_date=23-10-2026_23-00-00`
- `GET http://161.132.53.51:9051/TermoKing/CerroPrietoSeries/860389053949943/atmosfera_controlada?start_date=23-10-2026_22-00-00&end_date=23-10-2026_23-00-00`

La fecha va como `dd-mm-aaaa_HH-MM-SS`, en GMT-5. Si TermoKing no responde, el aviso lo dice y el rango local se muestra igual.
