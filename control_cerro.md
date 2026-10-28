# Flujo de control

Pestaña del administrador para armar pares encendido/apagado, secuencias con espera entre comandos, y reglas que arrancan esas secuencias según el CO₂ y el O₂ de las zonas.

La cuenta de monitoreo no ve esta pestaña. El serial no cambia de ritmo: el flujo solo prepara comandos y el hueco que ya existe los saca.

## 1. Lo que el equipo ya impone

El controlador habla cada unos 2 segundos. Entre una respuesta y la siguiente hay un hueco, y en cada hueco sale como máximo un comando de la cola. Ejemplos de respuestas que abren hueco: `RIPENER:PLATAFORMA`, `STARCOOL:PLATAFORMA`, `SERVIDOR`, el cierre de RIPENER, el etileno, el cierre del reefer, `STARCOOL_CONSULTA`, `STARCOOL_SALIDAS` y el bitmap del inyector.

Un ciclo completo dura cerca de 18 a 20 segundos y dentro de él hay varios huecos. El flujo no escribe el TCP por su cuenta y no se mete en medio de una trama partida.

Consecuencia: **22 segundos no salen en el milisegundo 22**. Salen en el primer hueco que ya cumplió esos 22 segundos. En la práctica el apagado queda entre 22 y unos 24 segundos después del encendido, porque el hueco siguiente está a unos 2 segundos. El registro guarda los segundos reales, no el número pedido.

El reloj empieza cuando el encendido **salió por el serial**, no cuando se pulsó el botón ni cuando entró a la cola. La hora es America/Lima.

## 2. Pares del mismo control

Un par junta dos comandos del catálogo que ya existe:

| Pieza | Ejemplo |
|-------|---------|
| Nombre del control | Compresor 222 |
| Encendido | `STARCOOL:CMP222_ON` |
| Apagado | `STARCOOL:CMP222_OFF` |

Otro par puede ser una válvula y su posición de cierre, si en el catálogo hay dos tramas distintas. El panel no inventa el apagado: si no hay una trama de off, no hay par.

Acciones del par:

- **Encender.** El on entra a la cola y sale en el próximo hueco.
- **Apagar.** El off entra ya, para el próximo hueco.
- **Mantener encendido N segundos.** Sale el on. En el momento en que el serial lo escribió, se calcula `apagado_no_antes = enviado + N segundos` y el off queda armado. Los huecos que ocurran antes de esa hora se usan para otros comandos. El primer hueco en esa hora o después saca el off.

Mientras el off de un par está armado, no se acepta otro encendido de ese mismo par. Así no se enciende dos veces y se pierde el apagado. Otros controles sí pueden usar los huecos del medio.

Si el controlador se desconecta, el off sigue armado. Sale en el primer hueco de cuando vuelva. El registro muestra que pasaron más de N segundos.

## 3. Secuencias

Una secuencia es una lista ordenada. Cada paso es un comando del catálogo y los segundos que hay que esperar **después de que el paso anterior salió por el serial**.

Ejemplo: abrir nitrógeno de la zona 1 durante 22 segundos y luego pedir el estado del inyector.

| Paso | Comando | Esperar después del anterior |
|------|---------|------------------------------|
| 1 | `INYECTOR:VALNITRO111` | 0 (sale en el próximo hueco) |
| 2 | comando de cierre del mismo control | 22 |
| 3 | `INYECTOR:ESTADO?` | 0 |

Espera 0 significa “el hueco siguiente”, no “el mismo instante”. Sigue valiendo un comando por hueco.

El paso 2 no entra en juego hasta que el paso 1 tenga hora de envío. El paso 3 espera a que el paso 2 haya salido y se cumpla su espera. Si un paso es el off de un par, usa la misma reserva del apartado 2: no se puede lanzar otra vez ese par hasta cerrar.

Se puede guardar la secuencia y lanzarla a mano. También puede lanzarla una regla del apartado 5.

## 4. Cómo entra en la cola que ya hay

La cola sigue siendo una sola por controlador y sigue saliendo de a uno. Cada ítem gana tres datos:

- `disponible_desde`: hora a partir de la cual este ítem puede salir. Vacío significa “en el próximo hueco”.
- `par`: identificador del par, si este ítem es su on o su off.
- `secuencia` y `paso`: de qué corrida viene, para el registro.

Al elegir qué sale en un hueco, se salta todo ítem cuyo `disponible_desde` todavía no llegó, y se toma el primero que ya puede salir. Un off que espera 22 segundos no tapa los huecos intermedios.

Un ítem en vuelo (ya tomado, todavía no escrito) sigue bloqueando el siguiente, como ahora. Cuando el envío queda anotado, se mira la corrida: si hay un paso siguiente, se le pone `disponible_desde` con la hora real de envío más la espera.

Si el proceso se reinicia, los off armados y los pasos pendientes viven en disco con esa hora absoluta. Al arrancar se vuelven a poner en la cola. Un reinicio no debe dejar un control encendido sin su apagado.

## 5. Reglas según CO₂ y O₂

La regla no mira el serial crudo. Mira la lectura vigente de cada zona, la misma que pinta las tarjetas: el último CO₂ u O₂ distinto de 0 y de 25.5. Esos dos valores son reinicio del sensor, no una medición, y no disparan nada.

Cada consulta `STARCOOL_CONSULTA` trae las seis medidas (CO₂ y O₂ de las zonas 1, 2 y 3) y es el momento de evaluar las reglas. Eso ocurre una vez por ciclo, no en cada línea del serial.

Una regla tiene:

- nombre y si está activa;
- una o más condiciones, todas a la vez;
- la secuencia que lanza;
- si dispara al **entrar** en la condición o mientras **siga** cumplida.

Cada condición elige zona, gas y un rango programado:

| Zona | Gas | Desde | Hasta | Lectura de ahora |
|------|-----|-------|-------|------------------|
| 1 | CO₂ | 7.0 | 9.0 | 8.1 → dentro |
| 1 | O₂ | 3.5 | 4.5 | 6.0 → fuera |

“Alrededor de un rango” es ese desde/hasta. No hace falta otro tipo de objetivo. El setpoint de color de las tarjetas (fábrica 8/10/12 y 4/4/8, o el que el administrador guardó) es independiente: la regla usa el rango que se escribió en ella.

Modo **al entrar**: la secuencia sale una vez cuando la lectura pasa de fuera a dentro. Se queda en silencio mientras siga dentro. Vuelve a armarse solo cuando alguna condición sale del rango y luego entra otra vez. Así un ciclo de 20 segundos no relanza la válvula en cada consulta.

Modo **mientras siga**: repite la secuencia al terminar la anterior, si la lectura sigue en rango. Hace falta una pausa mínima entre corridas (por ejemplo 60 segundos) para no encadenar pulsos.

Dos consultas seguidas dentro del rango antes de disparar evitan que un solo valor suelto mueva una válvula. Si la lectura vigente no existe todavía, la regla no corre.

La regla solo encola la secuencia. El hueco de 2 segundos sigue siendo quien escribe el serial.

## 6. Registro

Cada corrida guarda, por paso:

- trama y título;
- hora pedida (`disponible_desde`) y hora en que salió;
- segundos reales desde el paso anterior, medidos entre las dos horas de salida;
- si el equipo respondió (`STARCOOL_OK`, `INYECTOR_OK`, `REEFER_CAMBIO_OK` o la consulta que corresponda) y a qué hora.

Para un “mantener 22 segundos” la fila del par muestra el pedido (22) y lo ocurrido (por ejemplo 23.4). Ese número es la diferencia entre el envío del on y el envío del off, no la diferencia contra cualquier comando anterior del mismo serial. El historial de comandos que ya existe sigue comparando contra el comando previo de la línea; este registro es el de la corrida.

La pestaña lista las corridas de la más reciente a la más antigua, con filtro por día y por par o secuencia.

## 7. Pestaña

Solo administrador. Tres bloques en **Flujo de control**:

1. **Pares.** Catálogo a la vista, elegir on y off, nombre, y el campo de segundos para “mantener encendido”.
2. **Secuencias.** Pasos con comando y segundos de espera. Botón para lanzar una vez.
3. **Reglas.** Condiciones por zona y gas, rango, modo al entrar o mientras siga, y qué secuencia lanzan. Al lado, la lectura vigente, para ver si ahora mismo estaría dentro.

Quitar un par no borra el catálogo de comandos. Desactivar una regla no corta un off que ya está armado: ese apagado sigue hasta salir.

## 8. Orden para construirlo

1. Pares, “mantener N segundos” y el registro de segundos reales, usando `disponible_desde` en la cola.
2. Secuencias como varios pasos de esa misma espera.
3. Reglas evaluadas en cada `STARCOOL_CONSULTA`, con el último valor válido y el disparo al entrar en el rango.

Hasta el paso 3 el flujo es manual. Las reglas no se activan solas el día en que se publica la pestaña: nacen desactivadas.

## 9. Proceso de corrección de atmósfera

El procedimiento de la zona 2 no cabe en una secuencia plana. Tiene un tiempo que sale de la lectura, una espera de estabilización, una repetición y una segunda etapa que solo empieza si el O₂ sigue alto.

El orden que el panel reconoce:

1. Etapa A. Si el CO₂ está a más de la tolerancia (0.1) bajo el setpoint, abrir la electroválvula de CO₂, mantenerla `(setpoint − lectura) / 0.1 × segundos por 0.1 %` y cerrarla. La referencia de campo de esta cámara es 10 s por cada 0.1 %, así que 0.3 % son 30 s. Después se esperan 300 s y se vuelve a leer. Si sigue faltando CO₂, se repite la etapa A.
2. Etapa B. Solo con el CO₂ ya en rango. Apagar BYPASS, abrir el nitrógeno de la zona, confirmar esos dos estados, encender compresor 1 y después compresor 2, seguir el O₂ hasta el setpoint, apagar compresor 2, apagar compresor 1 y al final cerrar las electroválvulas de ingreso.
3. Si el setpoint de O₂ es menor que 7 %, el generador no alcanza. El proceso lo dice y no enciende compresores.

La pestaña **Corrección de atmósfera** guarda ese proceso con la zona y los cuatro números. Los comandos salen del catálogo de producción por su título: `Z2_CO2`, `OFF_CO2`, `BYPASS_OFF`, `Z2_Nitro`, `COMP1_ON`, `COMP2_ON`, `COMP2_OFF`, `COMP1_OFF` y `Nitro_OFF`. En las zonas 1 y 3 el CO₂ y el nitrógeno usan `Z1_CO2`, `Z3_CO2`, `Z1_Nitro` y `Z3_Nitro`. Si el operador elige otro comando del catálogo, ese reemplaza al título.

El evento nace apagado. Con el evento activado hacen falta dos lecturas seguidas en la misma etapa para armar la corrida. A partir de ahí cada comando espera a que el anterior haya salido por el serial:

- `OFF_CO2` espera los segundos calculados desde el envío de `Z2_CO2`.
- La lectura siguiente espera el tiempo de estabilización desde el envío de `OFF_CO2`.
- `Z2_Nitro` espera a que haya salido `BYPASS_OFF`. `COMP1_ON` espera a `Z2_Nitro`. `COMP2_ON` espera a `COMP1_ON`.
- Con los dos compresores ya enviados, el apagado espera a que el O₂ llegue al setpoint. Sale `COMP2_OFF`, después `COMP1_OFF` y al final `Nitro_OFF`.

Apagar el evento no corta un cierre de CO₂ que ya está en cola. Si los compresores ya están en marcha, encola el apagado.
