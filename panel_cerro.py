"""Panel Cerro Prieto a partir del serial del controlador.

STARCOOL_CONSULTA es el d02. RIPENER, REEFER_QUEST e INYECTOR, aunque
lleguen en varias líneas, se juntan en el rs. La hora es America/Lima.
"""

import datetime
import json
import math
import os
import re
import threading
import time
from zoneinfo import ZoneInfo

try:
    ZONA = ZoneInfo("America/Lima")
except Exception:
    ZONA = datetime.timezone(datetime.timedelta(hours=-5), name="America/Lima")

CONTINUACION = re.compile(r"^[0-9,.\-]")
BITMAP = re.compile(r"INYECTOR:([01]{8,})(?:,(.*))?$")
ACKS = {"STARCOOL_OK", "INYECTOR_OK", "REEFER_CAMBIO_OK"}
LETRAS = "ABCDEFGHIJKLMNOP"
# índice del bitmap → grupo y nombre. 0 = encendido, 1 = apagado.
USOS = {
    4: ("CO₂", "Válvula CO₂ zona 1"),
    5: ("CO₂", "Válvula CO₂ zona 2"),
    6: ("CO₂", "Válvula CO₂ zona 3"),
    7: ("Nitrógeno", "Válvula N₂ zona 3"),
    8: ("Nitrógeno", "Válvula N₂ zona 2"),
    9: ("Nitrógeno", "Válvula N₂ zona 1"),
    14: ("Bypass", "Bypass de oxígeno"),
}
ORDEN_VALVULAS = (4, 5, 6, 9, 8, 7, 14)
PASOS = (
    ("STARCOOL:PLATAFORMA", "ventana"),
    ("RIPENER:PLATAFORMA", "ripener_plataforma"),
    ("STARCOOL_CONSULTA:", "consulta"),
    ("STARCOOL:QUEST", "consulta"),
    ("STARCOOL_SALIDAS:", "salidas"),
    ("STARCOOL:SALIDAS", "salidas"),
    ("RIPENER_ETILENO:", "etileno"),
    ("RIPENER:ETILENO", "etileno"),
    ("REEFER_QUEST:", "reefer"),
    ("REEFER:QUEST", "reefer"),
    ("INYECTOR:ESTADO?", "inyector"),
    ("SERVIDOR:", "servidor"),
    ("RIPENER:QUEST", "ripener"),
)
FABRICA = {
    "co2": {"1": 8.0, "2": 10.0, "3": 12.0},
    "o2": {"1": 4.0, "2": 4.0, "3": 8.0},
}
SEMILLA = [
    ("Inyector", "Electro 0 · zona 1 · ventilador", "INYECTOR:&O0", "Salida &O0. El equipo responde INYECTOR_OK."),
    ("Inyector", "Salida &O1", "INYECTOR:&O1", "Salida &O1. El equipo responde INYECTOR_OK."),
    ("Inyector", "Relé 3 apagado · zona 2", "INYECTOR:&RELE3OFF", "Apaga el relé 3. El equipo responde INYECTOR_OK."),
    ("Inyector", "Pedir estado", "INYECTOR:ESTADO?", "Pide el bitmap del inyector."),
    ("Starcool", "Zona 111", "STARCOOL:ZONA111", "El equipo responde STARCOOL_OK."),
    ("Starcool", "Zona 222", "STARCOOL:ZONA222", "El equipo responde STARCOOL_OK."),
    ("Starcool", "Zona 333", "STARCOOL:ZONA333", "El equipo responde STARCOOL_OK."),
    ("Starcool", "Sleep", "STARCOOL:SLEEP", "El equipo responde STARCOOL_OK."),
    ("Starcool", "CMP222 on", "STARCOOL:CMP222_ON", "El equipo responde STARCOOL_OK."),
    ("Starcool", "CMP222 off", "STARCOOL:CMP222_OFF", "El equipo responde STARCOOL_OK."),
    ("Válvulas", "VALCO200", "INYECTOR:VALCO200", "El equipo responde INYECTOR_OK."),
    ("Válvulas", "VALCO211", "INYECTOR:VALCO211", "El equipo responde INYECTOR_OK."),
    ("Válvulas", "VALCO222", "INYECTOR:VALCO222", "El equipo responde INYECTOR_OK."),
    ("Válvulas", "VALCO233", "INYECTOR:VALCO233", "El equipo responde INYECTOR_OK."),
    ("Válvulas", "VALNITRO00", "INYECTOR:VALNITRO00", "El equipo responde INYECTOR_OK."),
    ("Válvulas", "VALNITRO22", "INYECTOR:VALNITRO22", "El equipo responde INYECTOR_OK."),
    ("Válvulas", "VALNITRO33", "INYECTOR:VALNITRO33", "El equipo responde INYECTOR_OK."),
    ("Válvulas", "VALNITRO111", "INYECTOR:VALNITRO111", "El equipo responde INYECTOR_OK."),
    ("Reefer", "Trama write 0, 3.5, 100", "REEFER:Trama_Write(0,3.5,100)", "El equipo responde REEFER_CAMBIO_OK."),
    ("Reefer", "Trama write 10, 0, 1", "REEFER:Trama_Write(10,0,1)", "El equipo responde REEFER_CAMBIO_OK."),
]


def _familia_comando(texto):
    if texto.startswith("INYECTOR:VALCO") or texto.startswith("INYECTOR:VALNITRO"):
        return "valvulas"
    if texto.startswith("INYECTOR:"):
        if BITMAP.match(texto):
            return None
        return "inyector"
    if texto.startswith("STARCOOL:"):
        return "starcool"
    return None


def _es_respuesta_cmd(cmd, texto):
    trama = cmd.get("trama") or ""
    familia = cmd.get("familia")
    if texto == "STARCOOL_OK":
        return familia == "starcool" and trama not in ("STARCOOL:QUEST", "STARCOOL:SALIDAS", "STARCOOL:PLATAFORMA")
    if texto == "INYECTOR_OK":
        return familia in ("inyector", "valvulas") and not trama.startswith("INYECTOR:ESTADO")
    if texto.startswith("STARCOOL_CONSULTA:") and trama == "STARCOOL:QUEST":
        return True
    if texto.startswith("STARCOOL_SALIDAS:") and trama == "STARCOOL:SALIDAS":
        return True
    if BITMAP.match(texto) and trama.startswith("INYECTOR:ESTADO"):
        return True
    return False


def _cmd_pub(item):
    enviado = _parse_iso(item.get("t"))
    respondido = _parse_iso(item.get("respuesta_en"))
    espera = None
    if enviado and respondido:
        espera = round((respondido - enviado).total_seconds(), 3)
    return {
        "id": item.get("id"),
        "t": item.get("t"),
        "fecha": fmt_fecha(enviado),
        "ip": item.get("ip"),
        "origen": item.get("origen"),
        "familia": item.get("familia"),
        "trama": item.get("trama") or "",
        "delta_anterior_s": item.get("delta_anterior_s"),
        "respuesta": item.get("respuesta"),
        "respuesta_en": item.get("respuesta_en"),
        "respuesta_fecha": fmt_fecha(respondido),
        "espera_s": espera,
    }


class PanelError(Exception):
    def __init__(self, status, detalle):
        super().__init__(detalle)
        self.status = status
        self.detalle = detalle


def ahora():
    return datetime.datetime.now(ZONA)


def fmt_fecha(dt):
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZONA)
    else:
        dt = dt.astimezone(ZONA)
    return dt.strftime("%d/%m/%Y %H:%M:%S")


def _parse_iso(valor):
    if not valor or not isinstance(valor, str):
        return None
    try:
        dt = datetime.datetime.fromisoformat(valor)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZONA)
    return dt.astimezone(ZONA)


def _num(valor):
    if valor is None or isinstance(valor, bool):
        return None
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return None
    if math.isnan(n) or math.isinf(n):
        return None
    return round(n, 4)


def es_reinicio(valor):
    n = _num(valor)
    if n is None:
        return False
    return abs(n) < 1e-9 or abs(n - 25.5) < 1e-4


def partir_csv(texto):
    if not texto:
        return []
    salida = []
    for parte in str(texto).split(","):
        parte = parte.strip()
        salida.append(_num(parte) if parte else None)
    return salida


def humedad_valida(valor):
    """Una humedad usable está por encima de 50 y hasta 100. 0 y 25.5 son reinicio."""
    n = _num(valor)
    if n is None or es_reinicio(n) or n <= 50 or n > 100:
        return False
    return True


def paso_gas(prev_valor, prev_tend, crudo):
    """Aplica la regla de 0 y 25.5 y conserva la flecha si el valor se repite."""
    return _paso_medida(prev_valor, prev_tend, crudo, es_reinicio)


def paso_humedad(prev_valor, prev_tend, crudo):
    """0, 25.5 o un valor fuera de 50–100 no pisan la última humedad válida."""
    crudo = _num(crudo)
    invalida = crudo is None or not humedad_valida(crudo)
    if invalida:
        return {
            "valor": prev_valor,
            "crudo": crudo,
            "reinicio": crudo is not None,
            "tendencia": prev_tend if prev_valor is not None else None,
        }, prev_valor, prev_tend
    return _cerrar_medida(prev_valor, prev_tend, crudo)


def _paso_medida(prev_valor, prev_tend, crudo, es_invalida):
    crudo = _num(crudo)
    if crudo is None or es_invalida(crudo):
        return {
            "valor": prev_valor,
            "crudo": crudo,
            "reinicio": crudo is not None and es_invalida(crudo),
            "tendencia": prev_tend if prev_valor is not None else None,
        }, prev_valor, prev_tend
    return _cerrar_medida(prev_valor, prev_tend, crudo)


def _cerrar_medida(prev_valor, prev_tend, crudo):
    if prev_valor is None:
        tend = None
    elif math.isclose(crudo, prev_valor, rel_tol=0, abs_tol=1e-4):
        tend = prev_tend
    elif crudo > prev_valor:
        tend = "sube"
    else:
        tend = "baja"
    return {
        "valor": crudo,
        "crudo": crudo,
        "reinicio": False,
        "tendencia": tend,
    }, crudo, tend


def estado_color(desviacion):
    if desviacion is None:
        return "none"
    if desviacion <= 1:
        return "ok"
    if desviacion <= 2:
        return "warn"
    return "danger"


def clasificar_paso(texto):
    for prefijo, paso in PASOS:
        if texto == prefijo or texto.startswith(prefijo):
            return paso
    if texto == "RIPENER:" or (
        texto.startswith("RIPENER:") and CONTINUACION.match(texto[8:])
    ):
        return "ripener"
    if BITMAP.fullmatch(texto):
        return "inyector"
    return None


def _celda_vacia():
    return {"valor": None, "crudo": None, "reinicio": False, "tendencia": None}


def _celdas_vacias():
    return [_celda_vacia() for _ in range(6)]


def _humedad_vacia():
    return [_celda_vacia() for _ in range(3)]


def _nuevo_estado(ip):
    return {
        "ip": ip,
        "ultima": None,
        "ultimo_texto": "",
        "paso": None,
        "bloque": None,
        "ripener_partes": [],
        "ripener": "",
        "reefer_partes": [],
        "reefer": "",
        "d02": "",
        "d02_en": None,
        "celdas": _celdas_vacias(),
        "hum_celdas": _humedad_vacia(),
        "salidas": "",
        "salidas_en": None,
        "etileno": None,
        "etileno_en": None,
        "inyector": "",
        "inyector_flag": "",
        "inyector_en": None,
        "consignas": {},
        "servidor_raw": "",
        "ultimo_ack": None,
        "ack_en": None,
    }


def _salidas_fabrica():
    return [
        {"nombre": f"Salida {i}", "cuando_1": "", "cuando_0": ""}
        for i in range(1, 7)
    ]


def _comandos_fabrica():
    return [
        {
            "id": f"c{i}",
            "grupo": grupo,
            "titulo": titulo,
            "trama": trama,
            "descripcion": descripcion,
        }
        for i, (grupo, titulo, trama, descripcion) in enumerate(SEMILLA, 1)
    ]


class Panel:
    def __init__(self, base_dir):
        self.base = base_dir
        self.dir_lecturas = os.path.join(base_dir, "lecturas")
        self.ruta_config = os.path.join(base_dir, "panel_config.json")
        self.ruta_cola = os.path.join(base_dir, "cola_comandos.json")
        self.ruta_vivo = os.path.join(base_dir, "estado_vivo.json")
        self.dir_cmd = os.path.join(base_dir, "historial_cmd")
        os.makedirs(self.dir_lecturas, exist_ok=True)
        os.makedirs(self.dir_cmd, exist_ok=True)
        self._lock = threading.Lock()
        self._ips = {}
        self._cola = []
        self._seq = 0
        self._cmd_seq = 0
        self._cmd_espera = {}
        self._cmd_ultimo = {}
        self._cmd_eco = {}
        self._cmd_cache = None
        self._cmd_cache_firma = None
        self.config = self._cargar_config()
        self._cargar_cola()
        self._cargar_vivo()
        self._restaurar_comandos()

    def linea(self, ip, texto, cuando=None):
        """Incorpora una trama entrante. Si es la ventana, devuelve el comando a enviar."""
        cuando = cuando or ahora()
        with self._lock:
            est = self._ips.get(ip)
            if est is None:
                est = _nuevo_estado(ip)
                self._ips[ip] = est
            self._consumir(est, texto, cuando)
            self._persist_vivo()
            if texto == "STARCOOL:PLATAFORMA":
                return self._tomar(ip)
        return None

    def confirmar(self, ident, ok, error=None):
        with self._lock:
            item = self._buscar(ident)
            if item is None:
                return
            if ok:
                item["estado"] = 0
                item["enviado"] = ahora().isoformat(timespec="seconds")
                item["error"] = None
            else:
                item["intentos"] = int(item.get("intentos") or 0) + 1
                item["error"] = error or "no se pudo escribir en el serial"
                item["estado"] = 2 if item["intentos"] >= 3 else 1
            self._podar()
            self._guardar_cola()

    def encolar(self, trama, titulo="", descripcion="", grupo="", ip=None):
        texto = self._validar_trama(trama)
        titulo = str(titulo or texto).strip()[:80]
        descripcion = str(descripcion or "").strip()[:400]
        grupo = str(grupo or "").strip()[:40]
        if ip is not None:
            ip = str(ip).strip() or None
        with self._lock:
            self._seq += 1
            item = {
                "id": f"q{self._seq}",
                "titulo": titulo,
                "descripcion": descripcion,
                "trama": texto,
                "grupo": grupo,
                "ip": ip,
                "estado": 1,
                "creado": ahora().isoformat(timespec="seconds"),
                "enviado": None,
                "ack": None,
                "error": None,
                "intentos": 0,
            }
            self._cola.append(item)
            self._guardar_cola()
            return self._item_pub(item)

    def cancelar(self, ident):
        with self._lock:
            item = self._buscar(ident)
            if item is None or item.get("estado") != 1:
                raise PanelError(404, "ese comando no está pendiente")
            item["estado"] = 3
            item["cancelado"] = ahora().isoformat(timespec="seconds")
            self._podar()
            self._guardar_cola()
            return self._item_pub(item)

    def actualizar(self, data):
        if not isinstance(data, dict):
            raise PanelError(400, "el cuerpo debe ser un objeto")
        with self._lock:
            if data.get("seguir_equipo"):
                self.config["objetivos_fijados"] = False
            if "objetivos" in data:
                self.config["objetivos"] = self._validar_objetivos(data["objetivos"])
                self.config["objetivos_fijados"] = True
            if "salidas" in data:
                self.config["salidas"] = self._validar_salidas(data["salidas"])
            if "etileno" in data:
                self.config["etileno"] = self._validar_etileno(data["etileno"])
            self.config["rev"] = int(self.config.get("rev") or 0) + 1
            self._guardar_config()
            return self._config_copy()

    def guardar_catalogo(self, lista):
        if not isinstance(lista, list):
            raise PanelError(400, "comandos debe ser una lista")
        if len(lista) > 80:
            raise PanelError(400, "hay demasiados comandos")
        with self._lock:
            vistos = set()
            salida = []
            for item in lista:
                if not isinstance(item, dict):
                    raise PanelError(400, "comando inválido")
                titulo = str(item.get("titulo") or "").strip()[:80]
                trama = self._validar_trama(item.get("trama"))
                if not titulo:
                    raise PanelError(400, "cada comando necesita un título")
                descripcion = str(item.get("descripcion") or "").strip()[:400]
                grupo = str(item.get("grupo") or "General").strip()[:40] or "General"
                ident = str(item.get("id") or "").strip()[:40]
                if not ident or ident in vistos:
                    ident = self._nuevo_cmd_id()
                vistos.add(ident)
                salida.append({
                    "id": ident,
                    "grupo": grupo,
                    "titulo": titulo,
                    "descripcion": descripcion,
                    "trama": trama,
                })
            self.config["comandos"] = salida
            self.config["rev"] = int(self.config.get("rev") or 0) + 1
            self._guardar_config()
            return self._config_copy()

    def vista(self, ip=None):
        with self._lock:
            est = self._elegir(ip)
            if est is None:
                return self._vacio(ip)
            return self._armar(est)

    def ips(self):
        with self._lock:
            return list(self._ips)

    def cola_publica(self):
        with self._lock:
            pendientes = [self._item_pub(x) for x in self._cola if x.get("estado") in (1, 4)]
            recientes = [self._item_pub(x) for x in self._cola if x.get("estado") in (0, 2)]
            return {"pendientes": pendientes, "recientes": list(reversed(recientes[-40:]))}

    def config_publica(self):
        with self._lock:
            return self._config_copy()

    def observar_serial(self, ip, texto, flujo="in", cuando=None):
        """Anota un comando de Starcool, inyector o válvulas y la respuesta que le sigue."""
        cuando = cuando or ahora()
        texto = str(texto or "").strip()
        if not texto or not ip:
            return None
        with self._lock:
            return self._observar_cmd(str(ip), texto, "interfaz" if flujo == "out" else "serial", cuando)

    def historial_comandos(self, desde_s, hasta_s, ip=None, origen=None, familia=None):
        try:
            desde = datetime.date.fromisoformat(str(desde_s))
            hasta = datetime.date.fromisoformat(str(hasta_s))
        except (TypeError, ValueError):
            raise PanelError(400, "las fechas deben ir como AAAA-MM-DD")
        if hasta < desde:
            desde, hasta = hasta, desde
        aviso = None
        if (hasta - desde).days > 62:
            desde = hasta - datetime.timedelta(days=62)
            aviso = "El rango se ajustó a los últimos 62 días."
        with self._lock:
            filas = self._leer_comandos(desde, hasta)
        if ip:
            filas = [x for x in filas if x.get("ip") == ip]
        if origen in ("serial", "interfaz"):
            filas = [x for x in filas if x.get("origen") == origen]
        if familia in ("starcool", "inyector", "valvulas"):
            filas = [x for x in filas if x.get("familia") == familia]
        pub = [_cmd_pub(x) for x in filas]
        pub.sort(key=lambda x: x.get("t") or "", reverse=True)
        return {
            "desde": desde.isoformat(),
            "hasta": hasta.isoformat(),
            "aviso": aviso,
            "total": len(pub),
            "comandos": pub[:500],
        }

    def lecturas(self, desde_s, hasta_s, ip=None):
        try:
            desde = datetime.date.fromisoformat(str(desde_s))
            hasta = datetime.date.fromisoformat(str(hasta_s))
        except (TypeError, ValueError):
            raise PanelError(400, "las fechas deben ir como AAAA-MM-DD")
        if hasta < desde:
            desde, hasta = hasta, desde
        aviso = None
        if (hasta - desde).days > 62:
            desde = hasta - datetime.timedelta(days=62)
            aviso = "El rango se ajustó a los últimos 62 días."
        with self._lock:
            objetivos, origen = self._objetivos_de(self._elegir(ip))
            objetivos = json.loads(json.dumps(objetivos))
        stats = [_stat_vacio() for _ in range(6)]
        ultimo = [None] * 6
        tend = [None] * 6
        puntos = []
        tabla = []
        horas_map = {}
        horas_orden = []
        total = 0
        paso = 1
        dia = desde
        while dia <= hasta:
            ruta = os.path.join(self.dir_lecturas, dia.isoformat() + ".jsonl")
            dia += datetime.timedelta(days=1)
            if not os.path.exists(ruta):
                continue
            try:
                fh = open(ruta, encoding="utf-8")
            except OSError:
                continue
            with fh:
                for linea in fh:
                    rec = _linea_lectura(linea)
                    if rec is None:
                        continue
                    if ip and rec.get("ip") != ip:
                        continue
                    vals = rec.get("v") or []
                    celdas = []
                    for i in range(6):
                        crudo = vals[i] if i < len(vals) else None
                        celda, ultimo[i], tend[i] = paso_gas(ultimo[i], tend[i], crudo)
                        celdas.append(celda)
                        _sumar_stat(stats[i], celda, _obj_indice(objetivos, i))
                    _sumar_hora(horas_map, horas_orden, rec.get("t"), celdas)
                    total += 1
                    if (total - 1) % paso == 0:
                        puntos.append({
                            "t": rec["t"],
                            "co2": [_num(celdas[i]["valor"]) for i in range(3)],
                            "o2": [_num(celdas[i]["valor"]) for i in range(3, 6)],
                        })
                    if len(puntos) > 2000:
                        puntos = puntos[::2]
                        paso *= 2
                    tabla.append(_fila_tabla(rec, celdas, objetivos))
        return {
            "desde": desde.isoformat(),
            "hasta": hasta.isoformat(),
            "ip": ip,
            "aviso": aviso,
            "total": total,
            "grafica": len(puntos),
            "muestreada": paso > 1,
            "objetivos": objetivos,
            "objetivos_origen": origen,
            "puntos": puntos,
            "tabla": list(reversed(tabla[-200:])),
            "analisis": _analisis_pub(stats),
            "por_hora": [_cerrar_hora(clave, horas_map[clave]) for clave in horas_orden],
        }

    def _consumir(self, est, texto, cuando):
        est["ultima"] = cuando
        est["ultimo_texto"] = texto
        paso = clasificar_paso(texto)
        if paso:
            est["paso"] = paso
        if est.get("bloque") in ("ripener", "reefer") and texto and CONTINUACION.match(texto):
            est[est["bloque"] + "_partes"].append(texto)
            self._refrescar_bloque(est)
            return
        if est.get("bloque"):
            self._refrescar_bloque(est)
            est["bloque"] = None
        if texto in ACKS:
            est["ultimo_ack"] = texto
            est["ack_en"] = cuando
            self._anotar_ack(est["ip"], texto, cuando)
            return
        if texto.startswith("SERVIDOR:"):
            cuerpo = texto[len("SERVIDOR:"):]
            consignas = {}
            for parte in cuerpo.split(","):
                if ":" not in parte:
                    continue
                clave, valor = parte.split(":", 1)
                n = _num(valor)
                if n is not None:
                    consignas[clave.strip()] = n
            est["consignas"] = consignas
            est["servidor_raw"] = cuerpo
            return
        if texto.startswith("RIPENER_ETILENO:"):
            est["etileno"] = texto.split(":", 1)[1].strip()
            est["etileno_en"] = cuando
            return
        if texto.startswith("STARCOOL_CONSULTA:"):
            crudo = texto.split(":", 1)[1].strip()
            if crudo:
                est["d02"] = crudo
                est["d02_en"] = cuando
                self._registrar_gases(est, crudo, cuando)
            return
        if texto.startswith("STARCOOL_SALIDAS:"):
            est["salidas"] = texto.split(":", 1)[1].strip()
            est["salidas_en"] = cuando
            return
        bits = BITMAP.fullmatch(texto)
        if bits:
            est["inyector"] = bits.group(1)
            est["inyector_flag"] = (bits.group(2) or "").strip()
            est["inyector_en"] = cuando
            return
        if texto == "RIPENER:" or (
            texto.startswith("RIPENER:") and CONTINUACION.match(texto[8:])
        ):
            est["bloque"] = "ripener"
            est["ripener_partes"] = []
            resto = texto[8:]
            if resto:
                est["ripener_partes"].append(resto)
            self._refrescar_bloque(est)
            return
        if texto.startswith("REEFER_QUEST:"):
            est["bloque"] = "reefer"
            est["reefer_partes"] = []
            resto = texto.split(":", 1)[1]
            if resto:
                est["reefer_partes"].append(resto)
            self._refrescar_bloque(est)

    def _refrescar_bloque(self, est):
        if est.get("bloque") == "ripener":
            est["ripener"] = "".join(est.get("ripener_partes") or [])
        elif est.get("bloque") == "reefer":
            est["reefer"] = "".join(est.get("reefer_partes") or [])

    def _registrar_gases(self, est, crudo, cuando):
        nums = partir_csv(crudo)
        gases = [nums[i] if i < len(nums) else None for i in range(6)]
        if all(v is None for v in gases):
            return
        celdas = est["celdas"]
        for i, valor in enumerate(gases):
            prev = celdas[i]["valor"]
            tend = celdas[i]["tendencia"]
            celda, _, _ = paso_gas(prev, tend, valor)
            celdas[i] = celda
        hums = est["hum_celdas"]
        for i in range(3):
            valor = nums[6 + i] if 6 + i < len(nums) else None
            celda, _, _ = paso_humedad(hums[i]["valor"], hums[i]["tendencia"], valor)
            hums[i] = celda
        self._append_lectura({
            "t": cuando.isoformat(timespec="seconds"),
            "ip": est["ip"],
            "v": [_num(v) for v in gases],
        })

    def _append_lectura(self, rec):
        dia = _parse_iso(rec["t"])
        nombre = (dia or ahora()).date().isoformat() + ".jsonl"
        ruta = os.path.join(self.dir_lecturas, nombre)
        linea = json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n"
        try:
            with open(ruta, "a", encoding="utf-8") as fh:
                fh.write(linea)
                fh.flush()
        except OSError as e:
            print(f"❌ No se pudo guardar la lectura: {e}")

    def _observar_cmd(self, ip, texto, origen, cuando):
        if self._cerrar_respuesta(ip, texto, cuando):
            return None
        familia = _familia_comando(texto)
        if not familia:
            return None
        if origen == "serial" and self._es_eco(ip, texto, cuando):
            return None
        anterior = self._cmd_ultimo.get(ip)
        delta = None if anterior is None else round((cuando - anterior).total_seconds(), 3)
        self._cmd_seq += 1
        item = {
            "id": f"h{self._cmd_seq}",
            "t": cuando.isoformat(timespec="seconds"),
            "ip": ip,
            "origen": origen,
            "familia": familia,
            "trama": texto[:240],
            "delta_anterior_s": delta,
            "respuesta": None,
            "respuesta_en": None,
        }
        self._cmd_ultimo[ip] = cuando
        espera = self._cmd_espera.setdefault(ip, [])
        espera.append(item)
        self._cmd_espera[ip] = espera[-12:]
        if origen == "interfaz":
            self._cmd_eco[ip] = (item["trama"], cuando)
        self._guardar_cmd(item)
        self._cmd_cache = None
        return item["id"]

    def _es_eco(self, ip, texto, cuando):
        previo = self._cmd_eco.get(ip)
        if not previo:
            return False
        trama, marca = previo
        return trama == texto and (cuando - marca).total_seconds() <= 3

    def _cerrar_respuesta(self, ip, texto, cuando):
        espera = self._cmd_espera.get(ip) or []
        vivos = []
        elegido = None
        for item in espera:
            marca = _parse_iso(item.get("t"))
            if marca is None or (cuando - marca).total_seconds() > 30 or item.get("respuesta"):
                continue
            vivos.append(item)
            if _es_respuesta_cmd(item, texto):
                elegido = item
        self._cmd_espera[ip] = vivos
        if elegido is None:
            return False
        elegido["respuesta"] = texto[:500]
        elegido["respuesta_en"] = cuando.isoformat(timespec="seconds")
        self._guardar_cmd({
            "id": elegido["id"],
            "t": elegido["respuesta_en"],
            "respuesta": elegido["respuesta"],
            "respuesta_en": elegido["respuesta_en"],
        })
        self._cmd_cache = None
        return True

    def _guardar_cmd(self, rec):
        marca = str(rec.get("t") or "")
        dia = marca[:10]
        if len(dia) != 10:
            dia = ahora().date().isoformat()
        ruta = os.path.join(self.dir_cmd, dia + ".jsonl")
        linea = json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n"
        try:
            with open(ruta, "a", encoding="utf-8") as fh:
                fh.write(linea)
                fh.flush()
        except OSError as e:
            print(f"❌ No se pudo guardar el comando: {e}")

    def _restaurar_comandos(self):
        hoy = ahora().date()
        filas = self._leer_comandos(hoy - datetime.timedelta(days=1), hoy)
        limite = ahora() - datetime.timedelta(seconds=30)
        for item in filas:
            ident = str(item.get("id") or "")
            if ident.startswith("h") and ident[1:].isdigit():
                self._cmd_seq = max(self._cmd_seq, int(ident[1:]))
            marca = _parse_iso(item.get("t"))
            ip = item.get("ip")
            if not ip or marca is None:
                continue
            ultimo = self._cmd_ultimo.get(ip)
            if ultimo is None or marca > ultimo:
                self._cmd_ultimo[ip] = marca
            if item.get("origen") == "interfaz":
                self._cmd_eco[ip] = (item.get("trama") or "", marca)
            if not item.get("respuesta") and marca >= limite:
                self._cmd_espera.setdefault(ip, []).append(item)

    def _leer_comandos(self, desde, hasta):
        firmas = []
        rutas = []
        dia = desde
        while dia <= hasta:
            ruta = os.path.join(self.dir_cmd, dia.isoformat() + ".jsonl")
            rutas.append(ruta)
            try:
                firmas.append(os.path.getsize(ruta))
            except OSError:
                firmas.append(0)
            dia += datetime.timedelta(days=1)
        firma = tuple(firmas)
        if self._cmd_cache is not None and self._cmd_cache_firma == firma:
            return list(self._cmd_cache)
        por_id = {}
        orden = []
        for ruta in rutas:
            if not os.path.exists(ruta):
                continue
            try:
                fh = open(ruta, encoding="utf-8")
            except OSError:
                continue
            with fh:
                for linea in fh:
                    linea = linea.strip()
                    if not linea:
                        continue
                    try:
                        rec = json.loads(linea)
                    except json.JSONDecodeError:
                        continue
                    ident = rec.get("id")
                    if not ident:
                        continue
                    if rec.get("trama"):
                        por_id[ident] = rec
                        orden.append(ident)
                    elif ident in por_id and rec.get("respuesta"):
                        por_id[ident]["respuesta"] = rec.get("respuesta")
                        por_id[ident]["respuesta_en"] = rec.get("respuesta_en")
        filas = [por_id[ident] for ident in orden if ident in por_id]
        self._cmd_cache = filas
        self._cmd_cache_firma = firma
        return list(filas)

    def _anotar_ack(self, ip, texto, cuando):
        for item in reversed(self._cola):
            if item.get("estado") != 0 or item.get("ack"):
                continue
            dest = item.get("ip_envio") or item.get("ip")
            if dest and dest != ip:
                continue
            enviado = _parse_iso(item.get("enviado"))
            if enviado and (cuando - enviado).total_seconds() > 25:
                continue
            item["ack"] = texto
            item["ack_en"] = cuando.isoformat(timespec="seconds")
            self._guardar_cola()
            return

    def _tomar(self, ip):
        self._reanimar()
        for item in self._cola:
            if item.get("estado") != 1:
                continue
            dest = item.get("ip")
            if dest and dest != ip:
                continue
            item["estado"] = 4
            item["ip_envio"] = ip
            item["_vuelo"] = time.monotonic()
            self._guardar_cola()
            return {
                "id": item["id"],
                "trama": item["trama"],
                "titulo": item.get("titulo") or item["trama"],
                "ip": ip,
            }
        return None

    def _reanimar(self):
        limite = time.monotonic() - 8
        for item in self._cola:
            if item.get("estado") == 4 and item.get("_vuelo", 0) < limite:
                item["estado"] = 1

    def _buscar(self, ident):
        for item in self._cola:
            if item.get("id") == ident:
                return item
        return None

    def _podar(self):
        hechos = [x for x in self._cola if x.get("estado") in (0, 2, 3)]
        conservar = {id(x) for x in hechos[-80:]}
        conservar.update(id(x) for x in self._cola if x.get("estado") in (1, 4))
        self._cola = [x for x in self._cola if id(x) in conservar]

    def _elegir(self, ip):
        if ip:
            return self._ips.get(ip)
        if not self._ips:
            return None
        return max(self._ips.values(), key=lambda e: e.get("ultima") or datetime.datetime.min.replace(tzinfo=ZONA))

    def _objetivos_de(self, est):
        if self.config.get("objetivos_fijados"):
            return self.config["objetivos"], "panel"
        if est is not None:
            tomados = _desde_consignas(est.get("consignas") or {})
            if tomados:
                return tomados, "equipo"
        return self.config["objetivos"], "fabrica"

    def _armar(self, est):
        nums = partir_csv(est.get("d02") or "")
        objetivos, origen = self._objetivos_de(est)
        celdas = est.get("celdas") or _celdas_vacias()
        zonas = []
        for z in (1, 2, 3):
            ctrl_i = 9 + z
            ctrl = _control(nums[ctrl_i] if ctrl_i < len(nums) else None)
            zonas.append({
                "zona": z,
                "co2": _gas_pub(celdas[z - 1], objetivos["co2"][str(z)]),
                "o2": _gas_pub(celdas[z + 2], objetivos["o2"][str(z)]),
                "control": ctrl,
            })
        humedad = []
        hums = est.get("hum_celdas") or _humedad_vacia()
        for z in (1, 2, 3):
            celda = hums[z - 1] if z - 1 < len(hums) else _celda_vacia()
            humedad.append({
                "zona": z,
                "valor": celda.get("valor"),
                "crudo": celda.get("crudo"),
                "reinicio": bool(celda.get("reinicio")),
                "tendencia": celda.get("tendencia"),
            })
        compresores = []
        for n in (1, 2):
            idx = 12 + n
            valor = nums[idx] if idx < len(nums) else None
            encendido = valor is not None and int(round(valor)) == 1
            compresores.append({
                "numero": n,
                "valor": None if valor is None else int(round(valor)),
                "encendido": encendido,
                "etiqueta": "Encendido" if encendido else ("Apagado" if valor is not None else "Sin dato"),
            })
        estados = []
        for i, valor in enumerate(nums):
            pos = i + 1
            if pos < 10 or pos in (11, 12, 13, 14, 15):
                continue
            estados.append({"pos": pos, "label": f"Estado {pos}", "valor": _num(valor)})
        rs = []
        if est.get("ripener"):
            rs.append({
                "nombre": "RIPENER",
                "datos": est["ripener"],
                "raw": f"RIPENER:{est['ripener']}&",
            })
        if est.get("reefer"):
            rs.append({
                "nombre": "REEFER_QUEST",
                "datos": est["reefer"],
                "raw": f"REEFER_QUEST:{est['reefer']}&",
            })
        bloques = [b["raw"][:-1] if b["raw"].endswith("&") else b["raw"] for b in rs]
        if est.get("inyector"):
            bloques.append(f"INYECTOR:{est['inyector']},{est.get('inyector_flag') or ''}")
        rs_raw = "&".join(bloques) + ("&" if bloques else "")
        ultima = est.get("ultima")
        segundos = None
        if ultima:
            segundos = max(0, round((ahora() - ultima).total_seconds(), 1))
        consignas = est.get("consignas") or {}
        return {
            "ip": est.get("ip"),
            "sin_datos": not bool(est.get("d02")),
            "zona_horaria": "America/Lima",
            "ultimo_dato": fmt_fecha(ultima),
            "ultimo_texto": est.get("ultimo_texto") or "",
            "segundos": segundos,
            "paso": est.get("paso"),
            "gases_en": fmt_fecha(est.get("d02_en")),
            "d02_raw": est.get("d02") or "",
            "por_zona": zonas,
            "humedad": humedad,
            "compresores": compresores,
            "estados": estados,
            "rs": rs,
            "inyector": _armar_inyector(est.get("inyector") or "", est.get("inyector_flag") or ""),
            "salidas": self._armar_salidas(est.get("salidas") or ""),
            "etileno": {
                "valor": est.get("etileno"),
                "nombre": self.config["etileno"]["nombre"],
                "unidad": self.config["etileno"]["unidad"],
                "nota": self.config["etileno"]["nota"],
                "en": fmt_fecha(est.get("etileno_en")),
            },
            "consignas_equipo": _consignas_pub(consignas),
            "objetivos": json.loads(json.dumps(objetivos)),
            "objetivos_origen": origen,
            "datos_total": {
                "ip": est.get("ip"),
                "fecha": ultima.isoformat(timespec="seconds") if ultima else None,
                "zona_horaria": "America/Lima",
                "d02": est.get("d02") or "",
                "rs": rs_raw,
                "starcool_salidas": est.get("salidas") or "",
                "ripener_etileno": est.get("etileno"),
                "servidor": est.get("servidor_raw") or "",
                "origen": "serial",
            },
            "ultimo_ack": est.get("ultimo_ack"),
        }

    def _armar_salidas(self, raw):
        partes = [p.strip() for p in raw.split(",")] if raw else []
        etiquetas = self.config.get("salidas") or []
        campos = []
        total = max(len(partes), len(etiquetas))
        for i in range(total):
            meta = etiquetas[i] if i < len(etiquetas) else {
                "nombre": f"Campo {i + 1}", "cuando_1": "", "cuando_0": "",
            }
            valor = partes[i] if i < len(partes) else ""
            if valor == "1":
                significado = meta.get("cuando_1") or ""
            elif valor == "0":
                significado = meta.get("cuando_0") or ""
            else:
                significado = ""
            campos.append({
                "pos": i + 1,
                "valor": valor,
                "nombre": meta.get("nombre") or f"Campo {i + 1}",
                "cuando_1": meta.get("cuando_1") or "",
                "cuando_0": meta.get("cuando_0") or "",
                "significado": significado,
            })
        return {"raw": raw, "campos": campos}

    def _vacio(self, ip):
        return {
            "ip": ip,
            "sin_datos": True,
            "zona_horaria": "America/Lima",
            "ultimo_dato": None,
            "ultimo_texto": "",
            "segundos": None,
            "paso": None,
            "gases_en": None,
            "d02_raw": "",
            "por_zona": [],
            "humedad": [],
            "compresores": [],
            "estados": [],
            "rs": [],
            "inyector": _armar_inyector("", ""),
            "salidas": self._armar_salidas(""),
            "etileno": {
                "valor": None,
                "nombre": self.config["etileno"]["nombre"],
                "unidad": self.config["etileno"]["unidad"],
                "nota": self.config["etileno"]["nota"],
                "en": None,
            },
            "consignas_equipo": None,
            "objetivos": json.loads(json.dumps(self.config["objetivos"])),
            "objetivos_origen": "panel" if self.config.get("objetivos_fijados") else "fabrica",
            "datos_total": {"origen": "serial", "zona_horaria": "America/Lima"},
            "ultimo_ack": None,
        }

    def _config_copy(self):
        return {
            "rev": self.config.get("rev") or 1,
            "objetivos_fijados": bool(self.config.get("objetivos_fijados")),
            "objetivos": json.loads(json.dumps(self.config["objetivos"])),
            "salidas": json.loads(json.dumps(self.config["salidas"])),
            "etileno": json.loads(json.dumps(self.config["etileno"])),
            "comandos": json.loads(json.dumps(self.config["comandos"])),
        }

    def _item_pub(self, item):
        return {
            "id": item.get("id"),
            "titulo": item.get("titulo") or "",
            "descripcion": item.get("descripcion") or "",
            "trama": item.get("trama") or "",
            "grupo": item.get("grupo") or "",
            "ip": item.get("ip"),
            "estado": item.get("estado"),
            "creado": item.get("creado"),
            "creado_display": fmt_fecha(_parse_iso(item.get("creado"))),
            "enviado": item.get("enviado"),
            "enviado_display": fmt_fecha(_parse_iso(item.get("enviado"))),
            "ack": item.get("ack"),
            "ack_en": item.get("ack_en"),
            "ack_en_display": fmt_fecha(_parse_iso(item.get("ack_en"))),
            "recibido": _recibido(item, ahora()),
            "ip_envio": item.get("ip_envio") or item.get("ip"),
            "error": item.get("error"),
            "intentos": item.get("intentos") or 0,
        }

    def _validar_trama(self, trama):
        if not isinstance(trama, str):
            raise PanelError(400, "la trama debe ser texto")
        texto = trama.replace("\r", "").replace("\n", "").strip()
        if not texto:
            raise PanelError(400, "la trama está vacía")
        if len(texto) > 240:
            raise PanelError(400, "la trama es demasiado larga")
        if any(ord(c) < 32 for c in texto):
            raise PanelError(400, "la trama tiene caracteres de control")
        return texto

    def _validar_objetivos(self, obj):
        if not isinstance(obj, dict):
            raise PanelError(400, "objetivos inválidos")
        salida = {"co2": {}, "o2": {}}
        for gas in ("co2", "o2"):
            bloque = obj.get(gas) or {}
            if not isinstance(bloque, dict):
                raise PanelError(400, "objetivos inválidos")
            for z in ("1", "2", "3"):
                raw = bloque.get(z, bloque.get(int(z)))
                n = _num(raw)
                if n is None or n < 0 or n > 100:
                    raise PanelError(400, f"{gas.upper()} zona {z} debe estar entre 0 y 100")
                salida[gas][z] = n
        return salida

    def _validar_salidas(self, lista):
        if not isinstance(lista, list) or not lista or len(lista) > 12:
            raise PanelError(400, "las salidas necesitan entre 1 y 12 campos")
        salida = []
        for i, item in enumerate(lista, 1):
            if not isinstance(item, dict):
                raise PanelError(400, "campo de salida inválido")
            salida.append({
                "nombre": str(item.get("nombre") or f"Campo {i}").strip()[:80] or f"Campo {i}",
                "cuando_1": str(item.get("cuando_1") or "").strip()[:80],
                "cuando_0": str(item.get("cuando_0") or "").strip()[:80],
            })
        return salida

    def _validar_etileno(self, data):
        if not isinstance(data, dict):
            raise PanelError(400, "etileno inválido")
        return {
            "nombre": str(data.get("nombre") or "Etileno").strip()[:80] or "Etileno",
            "unidad": str(data.get("unidad") or "").strip()[:24],
            "nota": str(data.get("nota") or "").strip()[:240],
        }

    def _nuevo_cmd_id(self):
        self.config["cmd_seq"] = int(self.config.get("cmd_seq") or 0) + 1
        return f"c{self.config['cmd_seq']}"

    def _cargar_config(self):
        data = _leer_json(self.ruta_config)
        if not data:
            data = {
                "rev": 1,
                "cmd_seq": len(SEMILLA),
                "objetivos_fijados": False,
                "objetivos": json.loads(json.dumps(FABRICA)),
                "salidas": _salidas_fabrica(),
                "etileno": {"nombre": "Etileno", "unidad": "", "nota": ""},
                "comandos": _comandos_fabrica(),
            }
            self.config = data
            self._guardar_config()
            return data
        data.setdefault("rev", 1)
        data.setdefault("cmd_seq", len(SEMILLA))
        data.setdefault("objetivos_fijados", False)
        data.setdefault("objetivos", json.loads(json.dumps(FABRICA)))
        data.setdefault("salidas", _salidas_fabrica())
        data.setdefault("etileno", {"nombre": "Etileno", "unidad": "", "nota": ""})
        data.setdefault("comandos", _comandos_fabrica())
        return data

    def _cargar_cola(self):
        data = _leer_json(self.ruta_cola) or {}
        self._seq = int(data.get("seq") or 0)
        self._cola = []
        for item in data.get("items") or []:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            if item.get("estado") == 4:
                item["estado"] = 1
            self._cola.append(item)

    def _cargar_vivo(self):
        data = _leer_json(self.ruta_vivo) or {}
        for ip, raw in (data.get("ips") or {}).items():
            if isinstance(raw, dict):
                self._ips[ip] = _estado_mem(ip, raw)

    def _guardar_config(self):
        _atomic_json(self.ruta_config, self.config)

    def _guardar_cola(self):
        _atomic_json(self.ruta_cola, {
            "seq": self._seq,
            "items": [{k: v for k, v in item.items() if not str(k).startswith("_")} for item in self._cola],
        })

    def _persist_vivo(self):
        ips = {}
        for ip, est in self._ips.items():
            ips[ip] = _estado_disco(est)
        try:
            _atomic_json(self.ruta_vivo, {"ips": ips})
        except OSError as e:
            print(f"❌ No se pudo guardar el estado: {e}")


def _estado_disco(est):
    out = {}
    for clave, valor in est.items():
        if isinstance(valor, datetime.datetime):
            out[clave] = valor.isoformat(timespec="seconds")
        else:
            out[clave] = valor
    return out


def _estado_mem(ip, data):
    est = _nuevo_estado(ip)
    est.update(data)
    est["ip"] = ip
    for campo in ("ultima", "d02_en", "salidas_en", "etileno_en", "inyector_en", "ack_en"):
        est[campo] = _parse_iso(est.get(campo))
    if not isinstance(est.get("celdas"), list) or len(est["celdas"]) != 6:
        est["celdas"] = _celdas_vacias()
    if not isinstance(est.get("hum_celdas"), list) or len(est["hum_celdas"]) != 3:
        est["hum_celdas"] = _humedad_vacia()
    est["ripener_partes"] = list(est.get("ripener_partes") or [])
    est["reefer_partes"] = list(est.get("reefer_partes") or [])
    est["consignas"] = dict(est.get("consignas") or {})
    return est


def _desde_consignas(consignas):
    try:
        return {
            "co2": {str(i): float(consignas[f"CO2_{i}"]) for i in (1, 2, 3)},
            "o2": {str(i): float(consignas[f"O2_{i}"]) for i in (1, 2, 3)},
        }
    except (KeyError, TypeError, ValueError):
        return None


def _consignas_pub(consignas):
    if not consignas:
        return None
    def toma(prefijo):
        out = {}
        for i in (1, 2, 3):
            if f"{prefijo}_{i}" in consignas:
                out[str(i)] = _num(consignas[f"{prefijo}_{i}"])
        return out
    pub = {"co2": toma("CO2"), "o2": toma("O2"), "humedad": toma("H")}
    if not pub["co2"] and not pub["o2"]:
        return None
    return pub


def _control(valor):
    if valor is None:
        return {"valor": None, "activo": False, "etiqueta": "Sin dato"}
    activo = int(round(valor)) == 1
    return {
        "valor": int(round(valor)),
        "activo": activo,
        "etiqueta": "Control activo" if activo else "Control inactivo",
    }


def _gas_pub(celda, objetivo):
    valor = celda.get("valor")
    obj = _num(objetivo)
    desv = None if valor is None or obj is None else abs(valor - obj)
    return {
        "valor": _num(valor),
        "crudo": _num(celda.get("crudo")),
        "reinicio": bool(celda.get("reinicio")),
        "tendencia": celda.get("tendencia"),
        "objetivo": obj,
        "desviacion": None if desv is None else round(desv, 2),
        "estado": estado_color(desv),
    }


def _armar_inyector(bitmap, flag):
    bits = []
    for i, bit in enumerate(bitmap[:16]):
        uso = USOS.get(i)
        bits.append({
            "indice": i,
            "letra": LETRAS[i],
            "bit": bit,
            "encendido": bit == "0",
            "grupo": uso[0] if uso else "",
            "label": uso[1] if uso else "",
        })
    valvulas = [bits[i] for i in ORDEN_VALVULAS if i < len(bits)]
    return {
        "bitmap": bitmap,
        "flag": flag,
        "bits": bits,
        "valvulas": valvulas,
        "leyenda": {"0": "Encendido", "1": "Apagado"},
    }


def _obj_indice(objetivos, indice):
    if indice < 3:
        return _num(objetivos["co2"][str(indice + 1)])
    return _num(objetivos["o2"][str(indice - 2)])


def _stat_vacio():
    return {
        "n": 0, "validas": 0, "reinicios": 0, "suma": 0.0,
        "min": None, "max": None, "suma_desv": 0.0,
        "en_1": 0, "en_2": 0, "fuera": 0,
    }


def _hora_vacia():
    celda = {"inicio": None, "fin": None, "min": None, "max": None, "n": 0}
    return {"co2": [dict(celda) for _ in range(3)], "o2": [dict(celda) for _ in range(3)]}


def _sumar_hora(horas_map, horas_orden, marca, celdas):
    if not isinstance(marca, str) or len(marca) < 13:
        return
    clave = marca[:13]
    bloque = horas_map.get(clave)
    if bloque is None:
        bloque = _hora_vacia()
        horas_map[clave] = bloque
        horas_orden.append(clave)
    for i in range(3):
        _tocar_hora(bloque["co2"][i], _num(celdas[i]["valor"]))
        _tocar_hora(bloque["o2"][i], _num(celdas[i + 3]["valor"]))


def _tocar_hora(celda, valor):
    if valor is None:
        return
    if celda["n"] == 0:
        celda["inicio"] = valor
        celda["min"] = valor
        celda["max"] = valor
    else:
        if valor < celda["min"]:
            celda["min"] = valor
        if valor > celda["max"]:
            celda["max"] = valor
    celda["fin"] = valor
    celda["n"] += 1


def _cerrar_hora(clave, bloque):
    def pub(celda):
        delta = None if celda["n"] == 0 else round(celda["fin"] - celda["inicio"], 4)
        return {
            "inicio": celda["inicio"],
            "fin": celda["fin"],
            "min": celda["min"],
            "max": celda["max"],
            "n": celda["n"],
            "delta": delta,
        }
    return {
        "hora": clave,
        "etiqueta": clave[8:10] + "/" + clave[5:7] + " " + clave[11:13] + ":00",
        "co2": {str(i + 1): pub(bloque["co2"][i]) for i in range(3)},
        "o2": {str(i + 1): pub(bloque["o2"][i]) for i in range(3)},
    }


def _recibido(item, momento):
    """True si llegó el OK del equipo, False si ya no va a llegar, None si sigue en espera."""
    estado = item.get("estado")
    if estado == 2:
        return False
    if estado != 0:
        return None
    if item.get("ack"):
        return True
    enviado = _parse_iso(item.get("enviado"))
    if enviado and (momento - enviado).total_seconds() > 25:
        return False
    return None


def _sumar_stat(stat, celda, objetivo):
    stat["n"] += 1
    if celda.get("reinicio"):
        stat["reinicios"] += 1
        return
    valor = celda.get("valor")
    if valor is None:
        return
    stat["validas"] += 1
    stat["suma"] += valor
    stat["min"] = valor if stat["min"] is None else min(stat["min"], valor)
    stat["max"] = valor if stat["max"] is None else max(stat["max"], valor)
    if objetivo is None:
        return
    desv = abs(valor - objetivo)
    stat["suma_desv"] += desv
    if desv <= 1:
        stat["en_1"] += 1
    if desv <= 2:
        stat["en_2"] += 1
    else:
        stat["fuera"] += 1


def _stat_pub(stat):
    v = stat["validas"]
    return {
        "n": stat["n"],
        "validas": v,
        "reinicios": stat["reinicios"],
        "promedio": round(stat["suma"] / v, 2) if v else None,
        "min": round(stat["min"], 2) if stat["min"] is not None else None,
        "max": round(stat["max"], 2) if stat["max"] is not None else None,
        "desviacion_media": round(stat["suma_desv"] / v, 2) if v else None,
        "en_1": stat["en_1"],
        "en_2": stat["en_2"],
        "fuera": stat["fuera"],
    }


def _analisis_pub(stats):
    return {
        "co2": {str(z): _stat_pub(stats[z - 1]) for z in (1, 2, 3)},
        "o2": {str(z): _stat_pub(stats[z + 2]) for z in (1, 2, 3)},
    }


def _fila_tabla(rec, celdas, objetivos):
    zonas = []
    for z in (1, 2, 3):
        zonas.append({
            "zona": z,
            "co2": _gas_pub(celdas[z - 1], objetivos["co2"][str(z)]),
            "o2": _gas_pub(celdas[z + 2], objetivos["o2"][str(z)]),
        })
    dt = _parse_iso(rec.get("t"))
    return {"fecha": fmt_fecha(dt), "t": rec.get("t"), "zonas": zonas}


def _linea_lectura(linea):
    linea = linea.strip()
    if not linea:
        return None
    try:
        rec = json.loads(linea)
    except json.JSONDecodeError:
        return None
    if not isinstance(rec, dict) or not rec.get("t") or not isinstance(rec.get("v"), list):
        return None
    return rec


def _leer_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError) as e:
        print(f"⚠️ No se pudo leer {path}: {e}")
        try:
            os.replace(path, path + ".malo")
        except OSError:
            pass
        return None
    if not isinstance(data, dict):
        return None
    return data


def _atomic_json(path, obj):
    carpeta = os.path.dirname(path)
    if carpeta:
        os.makedirs(carpeta, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _test_reconstruccion(tmp):
    p = Panel(tmp)
    ip = "190.223.54.2"
    # Antes de conocer la consigna del equipo, el color usa el objetivo de fábrica.
    p.linea(ip, "STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,0.0,12.0,89.8,92.1,100.0,1,0,1,0,0,0")
    previo = p.vista(ip)
    assert previo["objetivos_origen"] == "fabrica"
    assert previo["por_zona"][0]["co2"]["desviacion"] == 1.8
    assert previo["por_zona"][0]["co2"]["estado"] == "warn"
    assert previo["por_zona"][0]["o2"]["valor"] == 4.1
    assert previo["por_zona"][1]["o2"]["reinicio"] is True
    assert previo["por_zona"][1]["o2"]["valor"] is None
    ciclo = [
        "RIPENER:PLATAFORMA",
        "STARCOOL:PLATAFORMA",
        "SERVIDOR:CO2_1:6.00,CO2_2:5.00,CO2_3:8.00,O2_1:4.00,O2_2:10.00,O2_3:12.00,H_1:95.00,H_2:95.00,H_3:95.00",
        "RIPENER:QUEST",
        "RIPENER:",
        "0,20.0,25.1,25.6,25.7,26.4",
        ",27.6,0.0,0.0,0.0,66",
        ",0,0.0,20.7,90.0,38.5,0,0.3",
        "RIPENER:ETILENO",
        "RIPENER_ETILENO:0.4",
        "REEFER:QUEST",
        "REEFER_QUEST:",
        "1,4.0,3.9,6.6,0.6,38.0",
        ",28.3,0.0,0.0,0.0,81",
        ",0,4.4,0.0,254.0,-38.5",
        "STARCOOL:QUEST",
        "STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,0.0,12.0,89.8,92.1,100.0,1,0,1,0,0,0",
        "STARCOOL:SALIDAS",
        "STARCOOL_SALIDAS:1,0,1,0,0,0",
        "INYECTOR:ESTADO?",
        "INYECTOR:0000111111100000,1",
    ]
    for linea in ciclo:
        p.linea(ip, linea)
    v = p.vista(ip)
    assert v["rs"][0]["datos"] == "0,20.0,25.1,25.6,25.7,26.4,27.6,0.0,0.0,0.0,66,0,0.0,20.7,90.0,38.5,0,0.3"
    assert v["rs"][1]["datos"] == "1,4.0,3.9,6.6,0.6,38.0,28.3,0.0,0.0,0.0,81,0,4.4,0.0,254.0,-38.5"
    assert "RIPENER:0,20.0," in v["datos_total"]["rs"]
    assert v["datos_total"]["rs"].endswith("INYECTOR:0000111111100000,1&")
    assert v["etileno"]["valor"] == "0.4"
    assert v["salidas"]["raw"] == "1,0,1,0,0,0"
    assert v["inyector"]["bitmap"] == "0000111111100000"
    assert v["inyector"]["valvulas"][0]["encendido"] is False
    assert v["inyector"]["bits"][14]["encendido"] is True
    assert v["objetivos_origen"] == "equipo"
    assert v["por_zona"][0]["co2"]["desviacion"] == 0.2
    assert v["por_zona"][0]["co2"]["estado"] == "ok"
    assert v["por_zona"][0]["control"]["activo"] is False
    assert v["por_zona"][1]["control"]["activo"] is True
    assert v["por_zona"][2]["control"]["activo"] is False
    assert v["compresores"][0]["encendido"] is False
    assert v["compresores"][1]["encendido"] is False
    assert [e["pos"] for e in v["estados"]] == [10]
    assert v["humedad"][0]["valor"] == 89.8
    assert v["humedad"][2]["valor"] == 100.0
    p.linea(ip, "STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,0.0,12.0,0,0,100.0,1,0,1,0,0,0")
    h = p.vista(ip)["humedad"]
    assert h[0]["valor"] == 89.8 and h[0]["reinicio"] is True
    assert h[1]["valor"] == 92.1 and h[1]["reinicio"] is True
    assert h[2]["valor"] == 100.0 and h[2]["reinicio"] is False
    p.linea(ip, "STARCOOL_CONSULTA:6.2,5.1,8.3,4.1,0.0,12.0,40,25.5,0,1,0,1,0,0,0")
    h = p.vista(ip)["humedad"]
    assert h[0]["valor"] == 89.8 and h[0]["reinicio"] is True
    assert h[1]["valor"] == 92.1 and h[1]["reinicio"] is True
    assert h[2]["valor"] == 100.0 and h[2]["reinicio"] is True
    assert v["datos_total"]["fecha"].endswith("-05:00")
    assert v["paso"] == "inyector"


def _test_flecha(tmp):
    p = Panel(tmp)
    ip = "10.0.0.8"
    p.linea(ip, "STARCOOL_CONSULTA:6.0,5.0,8.0,4.0,10.0,12.0,1,1,1,1,0,1,0,0,0")
    p.linea(ip, "STARCOOL_CONSULTA:8.0,5.0,8.0,4.0,0,12.0,1,1,1,1,0,1,0,0,0")
    p.linea(ip, "STARCOOL_CONSULTA:25.5,5.0,8.0,4.0,10.5,12.0,1,1,1,1,0,1,0,0,0")
    z = p.vista(ip)["por_zona"]
    assert z[0]["co2"]["valor"] == 8.0
    assert z[0]["co2"]["reinicio"] is True
    assert z[0]["co2"]["tendencia"] == "sube"
    assert z[0]["co2"]["crudo"] == 25.5
    assert z[1]["o2"]["valor"] == 10.5
    assert z[1]["o2"]["tendencia"] == "sube"
    assert z[1]["o2"]["reinicio"] is False


def _test_cola(tmp):
    p = Panel(tmp)
    ip = "10.0.0.8"
    assert p.linea(ip, "STARCOOL:PLATAFORMA") is None
    p.encolar("STARCOOL:ZONA222", titulo="Zona 222", ip=ip)
    p.encolar("STARCOOL:SLEEP", titulo="Sleep", ip=ip)
    assert p.linea(ip, "RIPENER:PLATAFORMA") is None
    primero = p.linea(ip, "STARCOOL:PLATAFORMA")
    assert primero["trama"] == "STARCOOL:ZONA222"
    p.confirmar(primero["id"], ok=True)
    p.linea(ip, "STARCOOL_OK")
    recientes = p.cola_publica()["recientes"]
    assert recientes[0]["estado"] == 0
    assert recientes[0]["ack"] == "STARCOOL_OK"
    assert recientes[0]["recibido"] is True
    assert recientes[0]["ack_en_display"]
    segundo = p.linea(ip, "STARCOOL:PLATAFORMA")
    assert segundo["trama"] == "STARCOOL:SLEEP"
    p.confirmar(segundo["id"], ok=False, error="socket")
    otro = p.linea("10.9.9.9", "STARCOOL:PLATAFORMA")
    assert otro is None
    libre = p.encolar("INYECTOR:&O0", titulo="Electro")
    assert p.linea("10.9.9.9", "STARCOOL:PLATAFORMA")["trama"] == "INYECTOR:&O0"
    p.cancelar(p.encolar("STARCOOL:ZONA111", titulo="Zona 111", ip=ip)["id"])
    assert all(x["trama"] != "STARCOOL:ZONA111" for x in p.cola_publica()["recientes"])
    salio = p.linea(ip, "STARCOOL:PLATAFORMA")
    assert salio["trama"] == "STARCOOL:SLEEP"
    p.confirmar(salio["id"], ok=True)
    for item in p._cola:
        if item["id"] == salio["id"]:
            item["enviado"] = (ahora() - datetime.timedelta(seconds=40)).isoformat(timespec="seconds")
    silencio = [x for x in p.cola_publica()["recientes"] if x["id"] == salio["id"]][0]
    assert silencio["recibido"] is False
    assert silencio["ack"] is None
    assert libre["id"]


def _test_historico(tmp):
    p = Panel(tmp)
    ip = "10.0.0.8"
    p.linea(ip, "STARCOOL_CONSULTA:6.0,5.0,8.0,4.0,10.0,12.0,1,1,1,1,0,1,0,0,0")
    p.linea(ip, "STARCOOL_CONSULTA:8.0,5.0,8.0,4.0,0.0,12.0,1,1,1,1,0,1,0,0,0")
    p.linea(ip, "STARCOOL_CONSULTA:25.5,5.0,8.0,4.0,10.5,12.0,1,1,1,1,0,1,0,0,0")
    hoy = ahora().date().isoformat()
    data = p.lecturas(hoy, hoy, ip)
    assert data["total"] == 3
    assert data["puntos"][0]["t"].endswith("-05:00")
    co2 = data["analisis"]["co2"]["1"]
    assert co2["validas"] == 2
    assert co2["reinicios"] == 1
    assert co2["promedio"] == 7.0
    assert co2["desviacion_media"] == 1.0
    assert co2["en_1"] == 1
    assert co2["en_2"] == 2
    assert co2["fuera"] == 0
    o2 = data["analisis"]["o2"]["2"]
    assert o2["validas"] == 2
    assert o2["reinicios"] == 1
    assert o2["fuera"] == 2
    assert data["tabla"][0]["zonas"][0]["co2"]["reinicio"] is True
    assert data["tabla"][0]["zonas"][0]["co2"]["valor"] == 8.0
    assert len(data["por_hora"]) == 1
    hora = data["por_hora"][0]
    assert hora["etiqueta"].endswith(":00")
    z1 = hora["co2"]["1"]
    assert z1["n"] == 3
    assert z1["inicio"] == 6.0
    assert z1["fin"] == 8.0
    assert z1["delta"] == 2.0
    assert hora["o2"]["2"]["n"] == 3
    assert hora["o2"]["2"]["inicio"] == 10.0
    assert hora["o2"]["2"]["fin"] == 10.5


def _test_comandos(tmp):
    p = Panel(tmp)
    ip = "10.0.0.8"
    base = ahora().replace(microsecond=0)
    p.observar_serial(ip, "STARCOOL:QUEST", "in", base)
    p.observar_serial(ip, "STARCOOL_CONSULTA:6.2,5.1,8.1,4.1,10.4,11.8,80,90,100,1,0,0,1,0,0", "in", base + datetime.timedelta(seconds=2))
    p.observar_serial(ip, "INYECTOR:ESTADO?", "in", base + datetime.timedelta(seconds=6))
    p.observar_serial(ip, "INYECTOR:0000111111100000,1", "in", base + datetime.timedelta(seconds=7))
    p.observar_serial(ip, "INYECTOR:VALCO211", "out", base + datetime.timedelta(seconds=12))
    p.observar_serial(ip, "INYECTOR:VALCO211", "in", base + datetime.timedelta(seconds=12, milliseconds=400))
    p.observar_serial(ip, "INYECTOR_OK", "in", base + datetime.timedelta(seconds=13))
    p.observar_serial("10.9.9.9", "STARCOOL_OK", "in", base + datetime.timedelta(seconds=13))
    hoy = base.date().isoformat()
    filas = p.historial_comandos(hoy, hoy, ip)["comandos"]
    assert [x["trama"] for x in filas] == ["INYECTOR:VALCO211", "INYECTOR:ESTADO?", "STARCOOL:QUEST"]
    valvula = filas[0]
    assert valvula["origen"] == "interfaz"
    assert valvula["familia"] == "valvulas"
    assert valvula["respuesta"] == "INYECTOR_OK"
    assert valvula["espera_s"] == 1
    assert valvula["delta_anterior_s"] == 6
    estado = filas[1]
    assert estado["origen"] == "serial"
    assert estado["familia"] == "inyector"
    assert estado["respuesta"] == "INYECTOR:0000111111100000,1"
    assert estado["espera_s"] == 1
    quest = filas[2]
    assert quest["origen"] == "serial"
    assert quest["familia"] == "starcool"
    assert quest["respuesta"].startswith("STARCOOL_CONSULTA:")
    assert quest["espera_s"] == 2
    assert quest["delta_anterior_s"] is None
    solo = p.historial_comandos(hoy, hoy, ip, familia="valvulas")["comandos"]
    assert len(solo) == 1 and solo[0]["trama"] == "INYECTOR:VALCO211"
    p2 = Panel(tmp)
    otra = p2.historial_comandos(hoy, hoy, ip)["comandos"]
    assert otra[0]["respuesta"] == "INYECTOR_OK"
    assert otra[0]["delta_anterior_s"] == 6


def _probar():
    import shutil
    import tempfile
    for fn in (_test_reconstruccion, _test_flecha, _test_cola, _test_historico, _test_comandos):
        tmp = tempfile.mkdtemp()
        try:
            fn(tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print("panel_cerro: ok")


if __name__ == "__main__":
    _probar()
