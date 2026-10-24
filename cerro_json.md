# Cerro Prieto — trama JSON, interpretación y panel

Cómo llega la telemetría del equipo, qué significa cada parte del JSON y dónde se ve en la interfaz `/cerro-prieto/`.

El flujo genérico de TermoKing (POST, Redis, cola de comandos) está en `recepcion_data.md`. Este documento es solo el equipo Cerro Prieto.

| Dato | Valor |
|------|--------|
| IMEI | `868428044554560` |
| Tipo | `TermoKing` |
| Entrada del equipo | `POST /TermoKing/` |
| Panel | `GET /cerro-prieto/` |
| API del panel | `/api/cerro-prieto` |
| Código | `app/functions/cerro_prieto.py`, `app/routes/cerro_prieto_api.py`, `app/static/cerro-prieto/` |

El panel no recibe el POST del equipo. Lee la **última trama ya guardada** y la vuelve a pedir cada 20 segundos (`GET /api/cerro-prieto/estado`).

---

## 1. Comunicación

```
Equipo
  │  POST /TermoKing/   JSON (campo "i" = IMEI)
  ▼
handle_telemetry_post → guardar_datos()
  │
  ├─ guarda la trama en TK_868428044554560_{MM}_{YYYY}
  │    (Redis y luego el batch writer; si Redis falla, insert directo)
  │
  └─ si hay un comando con estado 1 en TK_control_{MM}_{YYYY}
       responde { "comando": "PANTALLA:..." }
     si no
       responde { "comando": "sin comandos pendientes" }
       y ese comando pasa a estado 0

Panel (navegador)
  │  GET /api/cerro-prieto/estado
  ▼
última trama de TK_868428044554560_{MM}_{YYYY}  (sort fecha desc)
  + objetivos guardados en cerro_prieto_panel
  + últimos comandos de TK_control_*
```

Hora de `fecha` y de los comandos: reloj de `APP_TIMEZONE` (America/Lima, GMT-5), guardada con sufijo `+00:00`. No se convierte otra vez a UTC al mostrarla.

Colecciones que usa este equipo:

| Colección | Qué guarda |
|-----------|------------|
| `TK_868428044554560_{MM}_{YYYY}` | Cada trama JSON del equipo |
| `TK_control_{MM}_{YYYY}` | Comandos encolados (`estado` 1 pendiente, 0 despachado, 3 cancelado) |
| `TK_dispositivos_{MM}_{YYYY}` | Última vez que el IMEI se comunicó |
| `cerro_prieto_panel` | Setpoints del panel, su historial, lecturas de CO₂/O₂ y el último valor válido |

Un comando del panel **no llega al equipo en el acto**. Queda en `TK_control_*` con `estado: 1` y sale en la respuesta del **próximo** `POST /TermoKing/` de ese IMEI.

---

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

## 8. JSON que arma el panel

`GET /api/cerro-prieto/estado` no es la trama original. Es la trama ya interpretada. El navegador pinta este objeto.

```json
{
  "imei": "868428044554560",
  "tipo": "TermoKing",
  "ultima_actualizacion_display": "23/10/2026 16:38:50",
  "sin_datos": false,
  "d02_raw": "6.1,4.7,8.3,4.0,10.4,11.9,75.6,90.2,100.0,1,0,0,1,0,0",
  "d02": {
    "por_zona": [
      {
        "zona": 1,
        "co2": {
          "valor": 6.1,
          "valor_crudo": 6.1,
          "reinicio": false,
          "tendencia": "baja",
          "objetivo": 6,
          "estado": "ok",
          "desviacion": 0.1
        },
        "o2": { "valor": 4.0, "tendencia": "sube", "reinicio": false },
        "control": { "valor": 0, "activo": false, "etiqueta": "Control inactivo" }
      }
    ],
    "compresores": [
      { "numero": 1, "estado_d02": 14, "valor": 0, "etiqueta": "Apagado", "estado": "danger" }
    ],
    "flags": [
      { "label": "Estado 10", "valor": 1 }
    ]
  },
  "rs": [
    { "nombre": "RIPENER", "datos": "0,20.0,...", "raw": "RIPENER:0,20.0,...&" },
    { "nombre": "REEFER_QUEST", "datos": "1,5.0,...", "raw": "REEFER_QUEST:1,5.0,...&" }
  ],
  "inyector": {
    "bitmap": "0000111101100010",
    "leyenda": { "0": "Encendido", "1": "Apagado" },
    "valvulas": [
      { "letra": "E", "label": "Válvula CO₂ Zona 1", "bit": "1", "etiqueta": "Apagado" }
    ]
  },
  "datos_total": { "i": "868428044554560", "d02": "...", "rs": "...", "fecha": "..." },
  "objetivos": {
    "co2": { "1": 6, "2": 10, "3": 12 },
    "o2": { "1": 4, "2": 5, "3": 8 }
  },
  "ultimo_comando": { "comando": "PANTALLA:NITRO1*", "estado": 0, "pendiente": false },
  "comando_pendiente": { "hay_comando": false }
}
```

Campos de una celda de gas dentro de `d02.por_zona`:

| Campo | Significado en pantalla |
|-------|-------------------------|
| `valor` | Número que se muestra. Si hubo reinicio, es el último válido, no el 0 ni el 25.5 |
| `valor_crudo` | Lo que vino en el CSV, incluido 0 o 25.5 |
| `reinicio` | `true` cuando el crudo fue 0 o 25.5 |
| `tendencia` | `sube`, `baja` o `null` (sin flecha) |
| `objetivo` | Setpoint del panel |
| `desviacion` | Distancia absoluta al setpoint |
| `estado` | `ok` verde, `warn` naranja, `danger` rojo, `none` sin color |
| `control.activo` | `true` solo si el estado 11, 12 o 13 de esa zona vale 1 |

`starcool.bloques` va en la misma respuesta: reúne CO₂, O₂ y humedad de `d02` con los nombres RIPENER (zona 1), REEFER_QUEST (zona 2) e INYECTOR (zona 3). La pantalla no dibuja ese arreglo; las zonas se dibujan desde `d02.por_zona` y el canal `rs` se dibuja desde el texto original.

Histórico (`GET /api/cerro-prieto/lecturas`):

```json
{
  "desde": "2026-10-22",
  "hasta": "2026-10-23",
  "total": 1000,
  "limite": 1000,
  "truncado": true,
  "lecturas": [
    {
      "fecha_display": "23/10/2026 16:38:50",
      "zonas": [
        {
          "zona": 1,
          "co2": { "valor": 6.1, "valor_crudo": 0, "reinicio": true, "tendencia": "baja" },
          "o2": { "valor": 4.0, "valor_crudo": 4.0, "reinicio": false, "tendencia": "sube" }
        }
      ]
    }
  ]
}
```

Si `reinicio` es `true`, la tabla muestra `valor` (último válido) y la marca “reinicio”. No muestra 0 ni 25.5. Si todavía no existe un valor válido, `valor` es `null` y la celda queda en `—`.
