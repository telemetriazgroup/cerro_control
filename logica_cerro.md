## 2. JSON que manda el equipo

Ejemplo real de los dos campos que el panel interpreta. El resto de claves (`ip`, `d00`, `d01`, `d03`…, `gps`, `val`, `c`, `r`) se guardan y se muestran tal cual en **Datos total**. No se decodifican para Cerro Prieto.

```json
{
  "i": "868428044554560",
  "ip": "10.81.213.33,17,0",
  "d02": "8.6,9.1,10.0,3.1,8.4,2.9,87.8,88.6,100.0,1,0,1,0,1,1",
  "rs": "RIPENER:0,20.0,26.8,27.3,27.1,29.2,0.0,0.0,0.0,0.0,90,0,0.0,0.0,95.0,2.0,0,0.0&REEFER_QUEST:1,5.0,5.1,6.5,2.2,36.3,0.0,0.0,0.0,0.0,82,10,1.2,19.2,254.0,1.0&INYECTOR:0000111101100010,1&",
  "estado": 1
}
```

Al persistir, el servidor agrega `fecha`, `received_at`, `secured` y `tipo_dispositivo: "TermoKing"`. Esas claves también salen en **Datos total**.

| Campo del JSON | Uso en Cerro Prieto | Dónde se ve |
|----------------|---------------------|-------------|
| `i` | Debe ser `868428044554560`. Otro IMEI no entra a este panel. | Cabecera, “IMEI” |
| `fecha` / `received_at` | Momento de la trama. El panel usa la más nueva. | “Último dato: …” |
| `d02` | CSV de gases, humedad, control y compresores. | Sensores, zonas, compresores, estados |
| `rs` | Tres bloques de texto separados por `&`. | Canal `rs` e Inyectores |
| `estado` de la trama | Estado de recepción TermoKing. No es el control de zona ni el estado del comando. | Solo dentro de **Datos total** |
| Resto (`d00`, `d01`, `d03`…, `gps`, `ip`, `c`, `r`, `val`) | Se conserva. | **Datos total** (JSON crudo) |

---

## 3. Campo `d02`

Texto CSV. La posición se cuenta desde 1, de izquierda a derecha.

```
 1    2    3     4    5    6    7     8     9      10 11 12 13 14 15
8.6, 9.1, 10.0, 3.1, 8.4, 2.9, 87.8, 88.6, 100.0, 1, 0, 1, 0, 1, 1
```

### 3.1 Gases y humedad (posiciones 1–9)

| Pos. | Significado | Ejemplo | Interfaz |
|------|-------------|---------|----------|
| 1 | CO₂ zona 1 (%) | 8.6 | Tarjeta Zona 1, celda CO₂ |
| 2 | CO₂ zona 2 (%) | 9.1 | Tarjeta Zona 2, celda CO₂ |
| 3 | CO₂ zona 3 (%) | 10.0 | Tarjeta Zona 3, celda CO₂ |
| 4 | O₂ zona 1 (%) | 3.1 | Tarjeta Zona 1, celda O₂ |
| 5 | O₂ zona 2 (%) | 8.4 | Tarjeta Zona 2, celda O₂ |
| 6 | O₂ zona 3 (%) | 2.9 | Tarjeta Zona 3, celda O₂ |
| 7 | Humedad zona 1 (%) | 87.8 | Bloque Humedad |
| 8 | Humedad zona 2 (%) | 88.6 | Bloque Humedad |
| 9 | Humedad zona 3 (%) | 100.0 | Bloque Humedad |

El color de CO₂ y O₂ compara la lectura **visible** con el setpoint guardado en el panel (no con un objetivo que venga dentro de `d02`):

| Diferencia absoluta | Color |
|---------------------|--------|
| ≤ 1 % | Verde |
| ≤ 2 % | Naranja |
| > 2 % | Rojo |

Setpoints de fábrica, si todavía no se guardó ninguno: CO₂ 8 / 10 / 12 y O₂ 4 / 4 / 8.

Debajo del valor se muestra `Obj` (setpoint) y `Δ` (desviación).

### 3.2 Reinicio de lectura: 0 y 25.5

En **CO₂ y O₂** (posiciones 1–6), el valor `0` o `25.5` no es una medición. El sensor reinició la lectura.

Qué hace el sistema:

1. Guarda el número crudo en `cerro_prieto_panel` (`tipo: "lectura_gas"`).
2. No lo usa como medición.
3. En la tarjeta muestra el **último valor distinto de 0 y de 25.5**.
4. Al lado pone la flecha de la última variación real: `↑` subida, `↓` bajada. Si el valor se repite, la flecha se mantiene. Si nunca hubo un valor válido anterior, se muestra `—`.
5. La celda lleva la nota “Último válido · reinicio”.
6. El color se calcula con ese último valor válido, no con 0 ni con 25.5.

La humedad no usa esta regla: un `0` de humedad se muestra como 0 %. Tampoco aplica a los estados 10–15: ahí `0` significa apagado o control inactivo.

### 3.3 Estados (posiciones 10–15)

A partir de la posición 10 el panel numera **Estado 10, Estado 11, …** (el número de estado es igual a la posición).

| Pos. | Etiqueta | Significado | Valor | Interfaz |
|------|----------|-------------|-------|----------|
| 10 | Estado 10 | Sin uso asignado | se muestra el número | **Estados adicionales** |
| 11 | Estado 11 | Control de la zona 1 | `1` activo, `0` inactivo | Badge de la Zona 1 |
| 12 | Estado 12 | Control de la zona 2 | `1` activo, `0` inactivo | Badge de la Zona 2 |
| 13 | Estado 13 | Control de la zona 3 | `1` activo, `0` inactivo | Badge de la Zona 3 |
| 14 | Estado 14 | Compresor 1 | `1` encendido, `0` apagado | Tarjeta Compresor 1 |
| 15 | Estado 15 | Compresor 2 | `1` encendido, `0` apagado | Tarjeta Compresor 2 |

Con el ejemplo `…,1,0,1,0,1,1`:

- Estado 10 = 1 → queda en Estados adicionales.
- Zona 1 control inactivo, zona 2 control activo, zona 3 control inactivo.
- Compresor 1 encendido, compresor 2 encendido.

Los estados 11 a 15 no se repiten en la lista de Estados adicionales.

---

## 4. Campo `rs`

Varios bloques unidos por `&`. Cada bloque es `NOMBRE:datos`.

```
RIPENER:0,20.0,26.8,...&
REEFER_QUEST:1,5.0,5.1,...&
INYECTOR:0000111101100010,1&
```

| Bloque | Qué hace el panel | Interfaz |
|--------|-------------------|----------|
| `RIPENER` | No se parte campo a campo. Se muestra el texto completo. | Canal `rs` |
| `REEFER_QUEST` | Igual: texto completo. | Canal `rs` |
| `INYECTOR` | Se separa el bitmap de 16 bits (lo que va antes de la coma). | Sección **Inyectores** |

El `1` que viene después de la coma en `INYECTOR:0000111101100010,1` no se interpreta. Solo entran los 16 caracteres `0`/`1`.

Esos nombres de `rs` no son las lecturas de gas del contenedor. Las lecturas de CO₂, O₂ y humedad salen de `d02`.

### 4.1 Bitmap `INYECTOR`

16 bits, letras A–P. **`0` = encendido, `1` = apagado.**

```
posición  A B C D E F G H I J K L M N O P
índice    0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
ejemplo   0 0 0 0 1 1 1 1 0 1 1  0  0  0  1  0
```

| Letra | Índice | Uso | En el ejemplo |
|-------|--------|-----|----------------|
| A B C D | 0–3 | Sin uso | — |
| E | 4 | Válvula CO₂ zona 1 | `1` apagada |
| F | 5 | Válvula CO₂ zona 2 | `1` apagada |
| G | 6 | Válvula CO₂ zona 3 | `1` apagada |
| H | 7 | Válvula N₂ zona 3 | `1` apagada |
| I | 8 | Válvula N₂ zona 2 | `0` encendida |
| J | 9 | Válvula N₂ zona 1 | `1` apagada |
| K L M N | 10–13 | Sin uso | — |
| O | 14 | Bypass de oxígeno | `1` apagado |
| P | 15 | Sin uso | — |

La interfaz agrupa las válvulas en CO₂, Nitrógeno y Bypass, con el bitmap completo arriba. Verde = encendido (`0`), rojo = apagado (`1`).

---

## 5. Qué muestra cada parte de la interfaz

Pestaña **En vivo**

| Bloque de pantalla | Origen |
|--------------------|--------|
| IMEI y “Último dato” | `i` y `fecha` de la última trama |
| Enviar comando al equipo | Lista fija de acciones. No sale del JSON. Al confirmar, encola en `TK_control_*` |
| Objetivos CO₂ / O₂ | Documento del panel, no de la trama. Ver sección 6 |
| Tarjetas Zona 1–3 | `d02` posiciones 1–6 y 11–13, más la flecha del histórico de lecturas |
| Compresores | `d02` posiciones 14 y 15 |
| Humedad | `d02` posiciones 7–9 |
| Estados adicionales | `d02` desde la posición 10, excepto 11–15 |
| Canal `rs` | Bloques `RIPENER` y `REEFER_QUEST` en texto |
| Inyectores | Bitmap de `INYECTOR` |
| Datos total | JSON completo de la última trama, sin interpretar |
| Verificación de comandos | Último comando registrado y el que sigue pendiente (`estado` 1) |
| Historial de comandos | Últimos 10 de `TK_control_*` |

Pestaña **Histórico O₂ / CO₂**

`GET /api/cerro-prieto/lecturas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`

Lee las tramas del rango en `TK_868428044554560_{MM}_{YYYY}`, aplica la misma regla de 0 y 25.5, y arma la tabla (fecha, CO₂ y O₂ de las 3 zonas, flecha y marca “reinicio”). Tope: 62 días y 1000 lecturas, las más recientes. Esas filas también se copian a `cerro_prieto_panel`.

---

## 6. Objetivos (setpoints)

No viajan en el JSON del equipo. Viven en `cerro_prieto_panel`, documento `objetivos_868428044554560`.

| Botón | Qué hace | Comandos al equipo |
|-------|----------|--------------------|
| Guardar objetivos | Actualiza el panel y el historial (`motivo: "guardar"`). Sirve para los colores. | Ninguno |
| Enviar al equipo | Guarda igual (`motivo: "aplicar"`) y encola 6 comandos | Sí |

Comandos de envío, uno por zona:

```
PANTALLA:OBJ_CO2_Z1:8*
PANTALLA:OBJ_CO2_Z2:10*
PANTALLA:OBJ_CO2_Z3:12*
PANTALLA:OBJ_O2_Z1:4*
PANTALLA:OBJ_O2_Z2:4*
PANTALLA:OBJ_O2_Z3:8*
```

El número es el que está escrito en el formulario, entre 0 y 100. Estos seis textos no están en la lista manual de “Enviar comando”; salen solo por **Enviar al equipo**.

---

## 7. Comandos manuales

Lista blanca. Cualquier otro texto se rechaza.

| Acción en pantalla | Comando encolado |
|--------------------|------------------|
| Encender Nitrógeno zona 1 | `PANTALLA:NITRO1*` |
| Encender Nitrógeno zona 2 | `PANTALLA:NITRO2*` |
| Encender Nitrógeno zona 3 | `PANTALLA:NITRO3*` |
| Apagar todos los nitrógenos | `PANTALLA:NITRO0*` |
| Encender CO₂ zona 1 | `PANTALLA:CO2_1*` |
| Encender CO₂ zona 2 | `PANTALLA:CO2_2*` |
| Encender CO₂ zona 3 | `PANTALLA:CO2_3*` |
| Apagar todas las zonas de CO₂ | `PANTALLA:CO2_0*` |
| Encender Compresor 1 | `PANTALLA:COMP_1_ON*` |
| Apagar Compresor 1 | `PANTALLA:COMP_1_OFF*` |
| Encender Compresor 2 | `PANTALLA:COMP_2_ON*` |
| Apagar Compresor 2 | `PANTALLA:COMP_2_OFF*` |
| Activar bypass (pase oxígeno) | `PANTALLA:INYECTOR:&O0*` |
| Desactivar bypass de oxígeno | `PANTALLA:INYECTOR:&O1*` |
| Encender Madurador | `PANTALLA:MADURADOR_ENCENDER*` |
| Apagar Madurador | `PANTALLA:MADURADOR_APAGAR*` |

En verificación e historial del panel: **1 = pendiente** (aún no se entregó en un POST), **0 = ejecutado** (ya se devolvió al equipo). El `3` es cancelado y no se envía; el panel lo muestra como cancelado si aparece en el historial.

Antes de encolar, el modal muestra la acción, el comando exacto y el `d02` crudo de la última trama.

---

#tenemos esta interpretacion de otro programa  haremos las equivalencias de los datos  :
{
  d02: '6.2,5.0,8.3,4.1,10.4,12.0,89.8,91.7,100.0,1,0,1,0,0,0',
  rs: 'RIPENER:0,20.0,25.1,25.7,25.8,26.6,27.6,0.0,0.0,0.0,66,0,0.0,20.7,90.0,38.5,0,0.2&REEFER_QUEST:1,4.0,4.2,6.7,0.6,43.4,28.3,0.0,0.0,0.0,80,0,4.4,0.0,254.0,-38.5&INYECTOR:0000111101100000,1&',

}
RIPENER:0,20.0,25.1,25.6,25.7,26.4,27.6,0.0,0.0,0.0,66,0,0.0,20.7,90.0,38.5,0,0.3


15:12:35  190.223.54.2  RIPENER:PLATAFORMA
15:12:37  190.223.54.2  STARCOOL:PLATAFORMA
15:12:37  190.223.54.2  +HTTPREAD: 37
15:12:37  190.223.54.2  {"comando":"sin comandos pendientes"}
15:12:37  190.223.54.2  OK


15:12:39  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:12:41  190.223.54.2  RIPENER:QUEST
15:12:41  190.223.54.2  RIPENER:
15:12:41  190.223.54.2  0,20.0,25.1,25.6,25.7,26.4
15:12:41  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:12:41  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.3
15:12:43  190.223.54.2  RIPENER:ETILENO
15:12:43  190.223.54.2  RIPENER_ETILENO:0.4
15:12:45  190.223.54.2  REEFER:QUEST
15:12:45  190.223.54.2  REEFER_QUEST:
15:12:45  190.223.54.2  1,4.0,3.9,6.6,0.6,38.0
15:12:45  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:12:46  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:12:47  190.223.54.2  STARCOOL:QUEST
15:12:48  190.223.54.2  STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,0.0,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:12:49  190.223.54.2  STARCOOL:SALIDAS
15:12:49  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:12:51  190.223.54.2  INYECTOR:ESTADO?
15:12:51  190.223.54.2  INYECTOR:0000111111100000,1
15:12:53  190.223.54.2  RIPENER:PLATAFORMA
15:12:55  190.223.54.2  STARCOOL:PLATAFORMA
15:12:58  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00


0,20.0,25.1,25.6,25.7,26.4,
27.6,0.0,0.0,0.0,66,0,
0.0,20.7,90.0,38.5,0,
0.3


1,4.0,3.9,6.6,0.6,
38.0,28.3,0.0,0.0,0.0,
81,0,4.4,0.0,254.0,
-38.5

power , set point, suministro ,retorno , evaporador,condensador , Sensor 1 , Sensor2 , Sensor 3 , Sensor 4 , Humedad , ventilacion ,co2 sensor , o2 sensor , sp humedad , sp co2 . 

los rangos de datos validos power es 0 apagado , 1 encendido , set point ,suministro , retorno , evaporador , condensador  de -50 a 60 . humedad y sp humedad de 50 a 99 . co2 sensor , o2 sensor y sp co2 sensor de 0 a 24.9

La seccion de REEFER_QUEST contiene informacion de las temperaturas del reefer que funciona en la atmosfera controlada





15:12:59  190.223.54.2  RIPENER:QUEST
15:13:00  190.223.54.2  RIPENER:
15:13:00  190.223.54.2  0,20.0,25.1,25.6,25.7,26.4
15:13:00  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:13:00  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:13:01  190.223.54.2  RIPENER:ETILENO
15:13:02  190.223.54.2  RIPENER_ETILENO:0.4
15:13:03  190.223.54.2  REEFER:QUEST
15:13:04  190.223.54.2  REEFER_QUEST:
15:13:04  190.223.54.2  1,4.0,3.9,6.6,0.6,38.0
15:13:04  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:13:04  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:13:06  190.223.54.2  STARCOOL:QUEST
15:13:06  190.223.54.2  STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,10.3,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:13:08  190.223.54.2  STARCOOL:SALIDAS
15:13:08  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:13:10  190.223.54.2  INYECTOR:ESTADO?
15:13:10  190.223.54.2  INYECTOR:0000111111100000,1
15:13:12  190.223.54.2  RIPENER:PLATAFORMA
15:13:14  190.223.54.2  STARCOOL:PLATAFORMA
15:13:16  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:13:18  190.223.54.2  RIPENER:QUEST
15:13:18  190.223.54.2  RIPENER:
15:13:18  190.223.54.2  0,20.0,25.1,25.6,25.7,26.4
15:13:18  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:13:18  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:13:20  190.223.54.2  RIPENER:ETILENO
15:13:20  190.223.54.2  RIPENER_ETILENO:0.4
15:13:22  190.223.54.2  REEFER:QUEST
15:13:22  190.223.54.2  REEFER_QUEST:
15:13:22  190.223.54.2  1,4.0,3.9,6.6,0.6,38.0
15:13:22  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:13:22  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:13:24  190.223.54.2  STARCOOL:QUEST
15:13:24  190.223.54.2  STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,10.3,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:13:26  190.223.54.2  STARCOOL:SALIDAS
15:13:26  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:13:28  190.223.54.2  INYECTOR:ESTADO?
15:13:28  190.223.54.2  INYECTOR:0000111111100000,1
15:13:30  190.223.54.2  RIPENER:PLATAFORMA
15:13:32  190.223.54.2  STARCOOL:PLATAFORMA
15:13:34  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:13:36  190.223.54.2  RIPENER:QUEST
15:13:36  190.223.54.2  RIPENER:
15:13:36  190.223.54.2  0,20.0,25.1,25.6,25.7,26.4
15:13:36  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:13:36  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:13:38  190.223.54.2  RIPENER:ETILENO
15:13:38  190.223.54.2  RIPENER_ETILENO:0.4
15:13:40  190.223.54.2  REEFER:QUEST
15:13:40  190.223.54.2  REEFER_QUEST:
15:13:40  190.223.54.2  1,4.0,4.2,6.6,0.7,39.9
15:13:40  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:13:40  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:13:42  190.223.54.2  STARCOOL:QUEST
15:13:42  190.223.54.2  STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,10.3,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:13:44  190.223.54.2  STARCOOL:SALIDAS
15:13:44  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:13:46  190.223.54.2  INYECTOR:ESTADO?
15:13:46  190.223.54.2  INYECTOR:0000111111100000,1
15:13:48  190.223.54.2  RIPENER:PLATAFORMA
15:13:50  190.223.54.2  STARCOOL:PLATAFORMA
15:13:52  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:13:54  190.223.54.2  RIPENER:QUEST
15:13:54  190.223.54.2  RIPENER:
15:13:54  190.223.54.2  0,20.0,25.1,25.6,25.7,26.4
15:13:54  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:13:54  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:13:56  190.223.54.2  RIPENER:ETILENO
15:13:56  190.223.54.2  RIPENER_ETILENO:0.4
15:13:58  190.223.54.2  REEFER:QUEST
15:13:58  190.223.54.2  REEFER_QUEST:
15:13:58  190.223.54.2  1,4.0,4.2,6.6,0.7,39.9
15:13:58  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:13:58  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:14:00  190.223.54.2  STARCOOL:QUEST
15:14:00  190.223.54.2  STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,10.3,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:14:02  190.223.54.2  STARCOOL:SALIDAS
15:14:02  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:14:04  190.223.54.2  INYECTOR:ESTADO?
15:14:04  190.223.54.2  INYECTOR:0000111111100000,1
15:14:06  190.223.54.2  RIPENER:PLATAFORMA
15:14:08  190.223.54.2  STARCOOL:PLATAFORMA
15:14:10  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:14:12  190.223.54.2  RIPENER:QUEST
15:14:12  190.223.54.2  RIPENER:
15:14:12  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:14:12  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:14:12  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:14:14  190.223.54.2  RIPENER:ETILENO
15:14:14  190.223.54.2  RIPENER_ETILENO:0.5
15:14:16  190.223.54.2  REEFER:QUEST
15:14:16  190.223.54.2  REEFER_QUEST:
15:14:16  190.223.54.2  1,4.0,4.2,6.6,0.7,39.9
15:14:16  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:14:16  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:14:18  190.223.54.2  STARCOOL:QUEST
15:14:18  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.3,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:14:20  190.223.54.2  STARCOOL:SALIDAS
15:14:20  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:14:22  190.223.54.2  INYECTOR:ESTADO?
15:14:22  190.223.54.2  INYECTOR:0000111111100000,1
15:14:24  190.223.54.2  RIPENER:PLATAFORMA
15:14:26  190.223.54.2  STARCOOL:PLATAFORMA
15:14:28  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:14:30  190.223.54.2  RIPENER:QUEST
15:14:30  190.223.54.2  RIPENER:
15:14:30  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:14:30  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:14:30  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.5
15:14:32  190.223.54.2  RIPENER:ETILENO
15:14:32  190.223.54.2  RIPENER_ETILENO:0.3
15:14:34  190.223.54.2  REEFER:QUEST
15:14:34  190.223.54.2  REEFER_QUEST:
15:14:34  190.223.54.2  1,4.0,4.1,6.7,0.6,42.3
15:14:34  190.223.54.2  ,28.3,0.0,0.0,0.0,80
15:14:34  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:14:36  190.223.54.2  STARCOOL:QUEST
15:14:36  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.3,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:14:38  190.223.54.2  STARCOOL:SALIDAS
15:14:38  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:14:40  190.223.54.2  INYECTOR:ESTADO?
15:14:40  190.223.54.2  INYECTOR:0000111111100000,1
15:14:42  190.223.54.2  RIPENER:PLATAFORMA
15:14:44  190.223.54.2  STARCOOL:PLATAFORMA
15:14:46  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:14:48  190.223.54.2  RIPENER:QUEST
15:14:48  190.223.54.2  RIPENER:
15:14:48  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:14:48  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:14:48  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.3
15:14:50  190.223.54.2  RIPENER:ETILENO
15:14:50  190.223.54.2  RIPENER_ETILENO:0.4
15:14:52  190.223.54.2  REEFER:QUEST
15:14:52  190.223.54.2  REEFER_QUEST:
15:14:52  190.223.54.2  1,4.0,4.1,6.7,0.6,42.3
15:14:52  190.223.54.2  ,28.3,0.0,0.0,0.0,80
15:14:53  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:14:54  190.223.54.2  STARCOOL:QUEST
15:14:55  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.3,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:14:56  190.223.54.2  STARCOOL:SALIDAS
15:14:56  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:14:58  190.223.54.2  INYECTOR:ESTADO?
15:14:58  190.223.54.2  INYECTOR:0000111111100000,1
15:15:00  190.223.54.2  RIPENER:PLATAFORMA
15:15:02  190.223.54.2  STARCOOL:PLATAFORMA
15:15:05  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:15:06  190.223.54.2  RIPENER:QUEST
15:15:07  190.223.54.2  RIPENER:
15:15:07  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:15:07  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:15:07  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:15:08  190.223.54.2  RIPENER:ETILENO
15:15:09  190.223.54.2  RIPENER_ETILENO:0.4
15:15:10  190.223.54.2  REEFER:QUEST
15:15:11  190.223.54.2  REEFER_QUEST:
15:15:11  190.223.54.2  1,4.0,4.1,6.7,0.6,42.3
15:15:11  190.223.54.2  ,28.3,0.0,0.0,0.0,80
15:15:11  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:15:13  190.223.54.2  STARCOOL:QUEST
15:15:13  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:15:15  190.223.54.2  STARCOOL:SALIDAS
15:15:15  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:15:17  190.223.54.2  INYECTOR:ESTADO?
15:15:17  190.223.54.2  INYECTOR:0000111111100000,1
15:15:19  190.223.54.2  RIPENER:PLATAFORMA
15:15:21  190.223.54.2  STARCOOL:PLATAFORMA
15:15:23  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:15:25  190.223.54.2  RIPENER:QUEST
15:15:25  190.223.54.2  RIPENER:
15:15:25  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:15:25  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:15:25  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:15:27  190.223.54.2  RIPENER:ETILENO
15:15:27  190.223.54.2  RIPENER_ETILENO:0.4
15:15:29  190.223.54.2  REEFER:QUEST
15:15:29  190.223.54.2  REEFER_QUEST:
15:15:29  190.223.54.2  1,4.0,4.1,6.7,0.6,42.3
15:15:29  190.223.54.2  ,28.3,0.0,0.0,0.0,80
15:15:29  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:15:31  190.223.54.2  STARCOOL:QUEST
15:15:31  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:15:33  190.223.54.2  STARCOOL:SALIDAS
15:15:33  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:15:35  190.223.54.2  INYECTOR:ESTADO?
15:15:35  190.223.54.2  INYECTOR:0000111111100000,1
15:15:37  190.223.54.2  RIPENER:PLATAFORMA
15:15:39  190.223.54.2  STARCOOL:PLATAFORMA
15:15:41  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:15:43  190.223.54.2  RIPENER:QUEST
15:15:43  190.223.54.2  RIPENER:
15:15:43  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:15:43  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:15:43  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:15:45  190.223.54.2  RIPENER:ETILENO
15:15:45  190.223.54.2  RIPENER_ETILENO:0.5
15:15:47  190.223.54.2  REEFER:QUEST
15:15:47  190.223.54.2  REEFER_QUEST:
15:15:47  190.223.54.2  1,4.0,3.8,6.6,0.4,39.8
15:15:47  190.223.54.2  ,28.3,0.0,0.0,0.0,80
15:15:47  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:15:49  190.223.54.2  STARCOOL:QUEST
15:15:49  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:15:51  190.223.54.2  STARCOOL:SALIDAS
15:15:51  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:15:53  190.223.54.2  INYECTOR:ESTADO?
15:15:53  190.223.54.2  INYECTOR:0000111111100000,1
15:15:55  190.223.54.2  RIPENER:PLATAFORMA
15:15:57  190.223.54.2  STARCOOL:PLATAFORMA
15:15:59  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:16:01  190.223.54.2  RIPENER:QUEST
15:16:01  190.223.54.2  RIPENER:
15:16:01  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:16:01  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:16:01  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.5
15:16:03  190.223.54.2  RIPENER:ETILENO
15:16:03  190.223.54.2  RIPENER_ETILENO:0.5
15:16:05  190.223.54.2  REEFER:QUEST
15:16:05  190.223.54.2  REEFER_QUEST:
15:16:05  190.223.54.2  1,4.0,3.8,6.6,0.4,39.8
15:16:05  190.223.54.2  ,28.3,0.0,0.0,0.0,80
15:16:05  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:16:07  190.223.54.2  STARCOOL:QUEST
15:16:07  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:16:09  190.223.54.2  STARCOOL:SALIDAS
15:16:09  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:16:11  190.223.54.2  INYECTOR:ESTADO?
15:16:11  190.223.54.2  INYECTOR:0000111111100000,1
15:16:13  190.223.54.2  RIPENER:PLATAFORMA
15:16:15  190.223.54.2  STARCOOL:PLATAFORMA
15:16:17  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:16:19  190.223.54.2  INYECTOR:VALNITRO22
15:16:19  190.223.54.2  INYECTOR_OK
15:16:21  190.223.54.2  STARCOOL:SALIDAS
15:16:21  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:16:23  190.223.54.2  INYECTOR:ESTADO?
15:16:23  190.223.54.2  INYECTOR:0000111101100000,1
15:16:26  190.223.54.2  STARCOOL:ZONA222
15:16:26  190.223.54.2  STARCOOL_OK
15:16:27  190.223.54.2  RIPENER:PLATAFORMA
15:16:29  190.223.54.2  STARCOOL:PLATAFORMA
15:16:31  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:16:33  190.223.54.2  RIPENER:QUEST
15:16:33  190.223.54.2  RIPENER:
15:16:33  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:16:33  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:16:33  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.5
15:16:35  190.223.54.2  RIPENER:ETILENO
15:16:35  190.223.54.2  RIPENER_ETILENO:0.3
15:16:37  190.223.54.2  REEFER:QUEST
15:16:37  190.223.54.2  REEFER_QUEST:
15:16:37  190.223.54.2  1,4.0,3.9,6.6,0.5,38.4
15:16:37  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:16:37  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:16:39  190.223.54.2  STARCOOL:QUEST
15:16:39  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:16:41  190.223.54.2  STARCOOL:SALIDAS
15:16:41  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:16:43  190.223.54.2  INYECTOR:ESTADO?
15:16:43  190.223.54.2  INYECTOR:0000111101100000,1
15:16:46  190.223.54.2  RIPENER:PLATAFORMA
15:16:47  190.223.54.2  STARCOOL:PLATAFORMA
15:16:49  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:16:51  190.223.54.2  RIPENER:QUEST
15:16:51  190.223.54.2  RIPENER:
15:16:51  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:16:51  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:16:51  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.3
15:16:53  190.223.54.2  RIPENER:ETILENO
15:16:53  190.223.54.2  RIPENER_ETILENO:0.4
15:16:55  190.223.54.2  REEFER:QUEST
15:16:55  190.223.54.2  REEFER_QUEST:
15:16:55  190.223.54.2  1,4.0,3.9,6.6,0.5,38.4
15:16:55  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:16:55  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:16:57  190.223.54.2  STARCOOL:QUEST
15:16:57  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:16:59  190.223.54.2  STARCOOL:SALIDAS
15:16:59  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:17:01  190.223.54.2  INYECTOR:ESTADO?
15:17:01  190.223.54.2  INYECTOR:0000111101100000,1
15:17:03  190.223.54.2  RIPENER:PLATAFORMA
15:17:05  190.223.54.2  STARCOOL:PLATAFORMA
15:17:06  190.223.54.2  +HTTPREAD: 37
15:17:06  190.223.54.2  {"comando":"sin comandos pendientes"}
15:17:06  190.223.54.2  OK
15:17:08  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:17:09  190.223.54.2  RIPENER:QUEST
15:17:09  190.223.54.2  RIPENER:
15:17:10  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:17:10  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:17:10  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:17:11  190.223.54.2  RIPENER:ETILENO
15:17:12  190.223.54.2  RIPENER_ETILENO:0.6
15:17:13  190.223.54.2  REEFER:QUEST
15:17:14  190.223.54.2  REEFER_QUEST:
15:17:14  190.223.54.2  1,4.0,3.9,6.6,0.5,38.4
15:17:14  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:17:14  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:17:15  190.223.54.2  STARCOOL:QUEST
15:17:16  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:17:18  190.223.54.2  STARCOOL:SALIDAS
15:17:18  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:17:20  190.223.54.2  INYECTOR:ESTADO?
15:17:20  190.223.54.2  INYECTOR:0000111101100000,1
15:17:22  190.223.54.2  RIPENER:PLATAFORMA
15:17:24  190.223.54.2  STARCOOL:PLATAFORMA
15:17:26  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:17:28  190.223.54.2  RIPENER:QUEST
15:17:28  190.223.54.2  RIPENER:
15:17:28  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:17:28  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:17:28  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.6
15:17:30  190.223.54.2  RIPENER:ETILENO
15:17:30  190.223.54.2  RIPENER_ETILENO:0.5
15:17:32  190.223.54.2  REEFER:QUEST
15:17:32  190.223.54.2  REEFER_QUEST:
15:17:32  190.223.54.2  1,4.0,3.9,6.6,0.5,38.4
15:17:32  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:17:32  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:17:34  190.223.54.2  STARCOOL:QUEST
15:17:34  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:17:36  190.223.54.2  STARCOOL:SALIDAS
15:17:36  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:17:38  190.223.54.2  INYECTOR:ESTADO?
15:17:38  190.223.54.2  INYECTOR:0000111101100000,1
15:17:40  190.223.54.2  RIPENER:PLATAFORMA
15:17:42  190.223.54.2  STARCOOL:PLATAFORMA
15:17:44  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:17:46  190.223.54.2  RIPENER:QUEST
15:17:46  190.223.54.2  RIPENER:
15:17:46  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:17:46  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:17:46  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.5
15:17:48  190.223.54.2  RIPENER:ETILENO
15:17:48  190.223.54.2  RIPENER_ETILENO:0.4
15:17:50  190.223.54.2  REEFER:QUEST
15:17:50  190.223.54.2  REEFER_QUEST:
15:17:50  190.223.54.2  1,4.0,4.2,6.6,0.7,38.7
15:17:50  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:17:50  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:17:52  190.223.54.2  STARCOOL:QUEST
15:17:52  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:17:54  190.223.54.2  STARCOOL:SALIDAS
15:17:54  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:17:56  190.223.54.2  INYECTOR:ESTADO?
15:17:56  190.223.54.2  INYECTOR:0000111101100000,1
15:17:58  190.223.54.2  RIPENER:PLATAFORMA
15:18:00  190.223.54.2  STARCOOL:PLATAFORMA
15:18:02  190.223.54.2  SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00
15:18:04  190.223.54.2  RIPENER:QUEST
15:18:04  190.223.54.2  RIPENER:
15:18:04  190.223.54.2  0,20.0,25.1,25.6,25.8,26.5
15:18:04  190.223.54.2  ,27.6,0.0,0.0,0.0,66
15:18:04  190.223.54.2  ,0,0.0,20.7,90.0,38.5,0,0.4
15:18:06  190.223.54.2  RIPENER:ETILENO
15:18:06  190.223.54.2  RIPENER_ETILENO:0.3
15:18:08  190.223.54.2  REEFER:QUEST
15:18:08  190.223.54.2  REEFER_QUEST:
15:18:08  190.223.54.2  1,4.0,4.2,6.6,0.7,38.7
15:18:08  190.223.54.2  ,28.3,0.0,0.0,0.0,81
15:18:08  190.223.54.2  ,0,4.4,0.0,254.0,-38.5
15:18:10  190.223.54.2  STARCOOL:QUEST
15:18:10  190.223.54.2  STARCOOL_CONSULTA:6.2,5.0,8.3,4.1,10.4,12.0,89.8,92.1,100.0,1,0,1,0,0,0
15:18:12  190.223.54.2  STARCOOL:SALIDAS
15:18:12  190.223.54.2  STARCOOL_SALIDAS:1,0,1,0,0,0
15:18:14  190.223.54.2  INYECTOR:ESTADO?
15:18:14  190.223.54.2  INYECTOR:0000111101100000,1
15:18:16  190.223.54.2  RIPENER:PLATAFORMA
15:18:18  190.223.54.2  STARCOOL:PLATAFORMA
15:18:18  190.223.54.2  +HTTPREAD: 37
15:18:18  190.223.54.2  {"comando":"sin comandos pendientes"}
15:18:18  190.223.54.2  OK
