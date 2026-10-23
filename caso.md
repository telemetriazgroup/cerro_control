# Caso: separar equipos por IP y comandar el controlador cerro

## Qué hace el programa hoy

`tcp_cerro_new.py` escucha TCP en `0.0.0.0:9985`. Cada cliente entra en un hilo, se anota por IP (máximo 30 sockets por IP, inactividad 120 s) y todo lo que llega se agrega al mismo archivo `cerro_DD_MM_YYYY.txt`.

Solo hay respuesta hacia el socket cuando el texto trae un JSON. Ese JSON se reenvía a:

- `http://161.132.53.51:9050/TermoKing/`
- `http://161.132.206.104:9050/Datos/`

El cuerpo que devuelve TermoKing se escribe de vuelta en el mismo TCP. Si alguna de las dos APIs falla, el JSON queda en `cerro_api_pendiente.jsonl` y un hilo lo reintenta cada 30 s.

Ese camino corresponde a los equipos de telemetría. El controlador de la cámara no habla JSON y hasta ahora el servidor solo lo archivaba: no había forma de devolverle una trama de comando por su conexión.

## Tres comunicaciones distintas en el mismo archivo

`cerro_23_10_2026.txt` (133644 líneas) mezcla todo porque el registro no guardaba la IP ni el puerto. Un mismo minuto puede intercalar equipos que no comparten protocolo.

### 1. Controlador cerro (la trama de las líneas 14-86)

Firma, cualquiera de estas cadenas identifica la conexión:

`RIPENER:`, `RIPENER_`, `STARCOOL:`, `STARCOOL_`, `REEFER:`, `REEFER_`, `INYECTOR:`, `INYECTOR_`, `SERVIDOR:`

En el día del log hay un ciclo estable, del orden de 3500 repeticiones (una vuelta cada unos 18–20 s):

| Orden | Llega del equipo | Qué es |
| --- | --- | --- |
| 1 | `SERVIDOR:CO2_1:6.00,CO2_2:...,O2_1:...,H_1:95.00,...` | consignas de CO2, O2 y humedad |
| 2 | `RIPENER:QUEST` y luego `RIPENER:` con líneas `0,20.0,27.1,...` | consulta del madurador |
| 3 | `RIPENER:ETILENO` y `RIPENER_ETILENO:0.2` | lectura de etileno |
| 4 | `REEFER:QUEST` y `REEFER_QUEST:` con `1,3.8,4.0,...` | consulta del reefer |
| 5 | `STARCOOL:QUEST` y `STARCOOL_CONSULTA:6.2,3.7,...` | consulta Starcool |
| 6 | `STARCOOL:SALIDAS` y `STARCOOL_SALIDAS:1,1,0,0,0,1` | estado de salidas |
| 7 | `INYECTOR:ESTADO?` y `INYECTOR:0000111110100010,1` | estado del inyector |
| 8 | `RIPENER:PLATAFORMA` | plataforma madurador |
| 9 | `STARCOOL:PLATAFORMA` | plataforma Starcool |

Esa secuencia es la huella del equipo. Puede haber una sola IP que la emite; el programa se queda con el socket de esa IP para poder escribirle.

Los comandos hacia el equipo son otra cosa: salen poco y el equipo contesta con un OK. En el log aparecen mezclados con el ciclo porque cualquier cliente TCP se escribía en el mismo archivo:

| Comando observado | Respuesta del equipo | Veces en el día |
| --- | --- | --- |
| `STARCOOL:ZONA111`, `ZONA222`, `ZONA333` | `STARCOOL_OK` | 88 / 57 / 36, y 195 OK |
| `STARCOOL:SLEEP`, `STARCOOL:CMP222_ON`, `STARCOOL:CMP222_OFF` | `STARCOOL_OK` | 11 / 1 / 2 |
| `INYECTOR:VALCO200`, `VALNITRO00`, `VALNITRO22`, `VALNITRO33`, `VALCO211`, `VALCO222`, `VALCO233` | `INYECTOR_OK` | pocas unidades, 24 OK |
| `INYECTOR:&O1`, `INYECTOR:&O0` | `INYECTOR_OK` | 2 y 2 |
| `REEFER:Trama_Write(0,3.5,100)`, `REEFER:Trama_Write(10,0,1)` | `REEFER_CAMBIO_OK` | 1 y 1, 2 OK |

La API acepta cualquiera de esas líneas, u otra trama del mismo estilo. No hay una lista cerrada: el texto que entra por HTTP sale tal cual por el TCP, con un salto de línea al final.

### 2. Telemetría JSON (otro estilo de equipo)

Unos 1315 mensajes de `NEWY1001` y 1314 de `NEWY2001`, con campos `i`, `d1`…`d8` y `d4` = `UNIT111`. Siguen el camino anterior: se publican en TermoKing y Datos, y la respuesta de TermoKing vuelve por el mismo TCP. Esos sockets no reciben los comandos del controlador cerro.

### 3. Texto que no es el ciclo ni la telemetría

En el archivo también hay `HOLA LUIS` (151 veces) y bloques `+HTTPREAD` con `{"comando":"sin comandos pendientes"}`. No traen la firma cerro ni el campo `i`. Quedan registrados por IP y no se reenvían a TermoKing. Antes, cualquier `{...}` —incluido ese JSON de “sin comandos”— se publicaba en las dos APIs y la respuesta se devolvía al socket que lo había mandado.

## Casos de la conexión

1. **Llega el ciclo cerro.** La primera trama con firma marca la sesión como `cerro`, la asocia a su IP y a partir de ahí `POST /comando` escribe en ese socket. Cada trama nueva de esa IP refresca cuál es el socket vivo, por si el equipo reconecta.
2. **Hay una sola IP cerro.** El POST puede omitir `ip`. La trama se escribe en el acto con `sendall` y la llamada HTTP responde cuando los bytes ya salieron al TCP.
3. **Hay varias IP con la misma firma.** El POST sin `ip` responde `409` y devuelve la lista. Hay que indicar la IP para no comandar el equipo equivocado.
4. **El controlador no está conectado, o el socket muere al escribir.** La API responde `409` o `502`. El comando no se encola: o sale en esa llamada, o no sale.
5. **Llega JSON con `i`.** La sesión queda como `json`, con el nombre del equipo (`NEWY1001`, `NEWY2001`). Aunque más tarde el texto coincidiera con una firma, no se reinterpreta como cerro.
6. **Misma IP, muchas conexiones.** Se mantienen 30. Al pasar el cupo se cierra otra conexión de esa IP y se deja la que ya es cerro, para no perder el canal de comandos.
7. **120 s sin datos.** El socket se cierra y, si era el canal de comandos, `GET /cerro` deja de mostrarlo. El ciclo real llega cada ~20 s, así que el controlador activo no cae por inactividad.

## Registro

Cada línea del archivo diario lleva la IP:

```
[00:00:14] [10.0.0.8] STARCOOL:QUEST
```

Además se copia en `registros/<ip>/cerro_DD_MM_YYYY.txt`, sin repetir la IP. Un comando aceptado por la API queda en ambos con el prefijo `>>`:

```
[12:01:00] >> STARCOOL:ZONA111
```

Los archivos anteriores no tienen IP; no se reescriben. La separación empieza con el proceso nuevo.

## API local

Escucha en `0.0.0.0:9986` (variable `CERRO_API_PORT`). El TCP de los equipos sigue en `9985`.

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/salud` | el proceso responde y cuántos TCP hay abiertos |
| GET | `/dispositivos` | todas las sesiones: IP, puerto, tipo, equipo, última muestra |
| GET | `/cerro` | solo las sesiones con la firma del controlador |
| POST | `/comando` | trama que se escribe ya en el TCP cerro |

`comando_activo: true` en el listado es el socket que va a recibir el comando de esa IP.

Ejemplos:

```bash
curl -s http://127.0.0.1:9986/cerro

curl -s -X POST http://127.0.0.1:9986/comando \
  -H 'Content-Type: application/json' \
  -d '{"trama":"STARCOOL:ZONA111"}'

curl -s -X POST 'http://127.0.0.1:9986/comando?ip=10.0.0.8' \
  -H 'Content-Type: text/plain' \
  --data 'INYECTOR:VALCO200'
```

También vale la clave `comando` en lugar de `trama`. La respuesta queda así cuando el TCP ya recibió los bytes:

```json
{"ok": true, "ip": "10.0.0.8", "puerto": 54321, "bytes": 18, "trama": "STARCOOL:ZONA111\n"}
```

Si se define `CERRO_API_TOKEN`, todas las rutas exigen la cabecera `X-Token`. Sin esa variable la API queda abierta en el puerto 9986: quien llegue a ese puerto puede mandar una trama al controlador.

Arranque, desde esta carpeta:

```bash
python3 tcp_cerro_new.py
```
