import hashlib
import hmac
import os
import re
import secrets
import socket
import threading
import datetime
import json
from http.cookies import SimpleCookie
from panel_cerro import Panel, PanelError, ahora, fecha_de_nombre
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import time
import requests
from concurrent.futures import ThreadPoolExecutor
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# --- Configuración ---
HOST = "0.0.0.0"
PORT = int(os.environ.get("CERRO_TCP_PORT", "9985"))
API_HTTP_HOST = "0.0.0.0"
API_HTTP_PORT = int(os.environ.get("CERRO_API_PORT", "9986"))
# Si CERRO_API_TOKEN está definido, POST /comando exige la cabecera X-Token.
API_TOKEN = os.environ.get("CERRO_API_TOKEN", "").strip()
BASE_DIR = os.environ.get("CERRO_DIR", os.getcwd())
DIR_LOGS = os.environ.get("CERRO_LOGS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos")
MAX_ARCHIVO = 20 * 1024 * 1024
RUTA_INTERFAZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "interfaz.html")
RUTA_FRONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "dist")
PREFIJO_FRONT = "/cerroprieto"
RUTA_LOGIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "login.html")
USUARIO_PANEL = os.environ.get("CERRO_USER", "").strip() or "zgroup"
CLAVE_PANEL = os.environ.get("CERRO_PASS", "") or "Proyecto2026!"
SESION_NOMBRE = "cerro_sesion"
SESION_SEG = 12 * 3600
_sesiones = {}
_sesiones_lock = threading.Lock()
_fallos_login = {}
MAX_POR_IP = 30           # máx. conexiones simultáneas por IP (cierra las más viejas)
IDLE_TIMEOUT = 120        # segundos sin datos → cerrar conexión y liberar slot
BACKLOG = 256
REINTENTOS_ARCHIVO = 5
REINTENTOS_API = 3
REINICIO_SERVIDOR_SEG = 3
MAX_CUERPO_HTTP = 65536
DIR_REGISTROS = "registros"
panel = Panel(BASE_DIR)

API_URL = os.environ.get("CERRO_API_URL", "http://161.132.53.51:9050/TermoKing/")
API_URL2 = os.environ.get("CERRO_API_URL2", "http://161.132.206.104:9050/Datos/")
ARCHIVO_API_PENDIENTE = os.path.join(BASE_DIR, "cerro_api_pendiente.jsonl")

# Firma del controlador de cámara (tramas del ciclo RIPENER / STARCOOL / REEFER).
MARCADORES_CERRO = (
    "RIPENER:",
    "RIPENER_",
    "STARCOOL:",
    "STARCOOL_",
    "REEFER:",
    "REEFER_",
    "INYECTOR:",
    "INYECTOR_",
    "SERVIDOR:",
)

# --- Recursos compartidos ---
file_lock = threading.Lock()
api_pendiente_lock = threading.Lock()
_conexiones_lock = threading.Lock()
_conexiones_por_ip = {}   # ip -> [Sesion, ...]
_cerro_por_ip = {}        # ip -> Sesion que recibe los comandos
api_executor = ThreadPoolExecutor(max_workers=20, thread_name_prefix="api")
_file_handles = {}
_file_handles_lock = threading.Lock()
_http_lock = threading.Lock()
http_session = None
_serial_lock = threading.Lock()
_serial_seq = 0
_serial_lineas = deque(maxlen=800)
_estado_por_ip = {}


class ErrorComando(Exception):
    def __init__(self, status, detalle, extra=None):
        super().__init__(detalle)
        self.status = status
        self.detalle = detalle
        self.extra = extra or {}


class Sesion:
    def __init__(self, conn, ip, puerto):
        self.conn = conn
        self.ip = ip
        self.puerto = puerto
        self.tipo = "desconocido"   # desconocido | cerro | json
        self.equipo = None
        self.conectado_en = ahora()
        self.identificado_en = None
        self.ultima = self.conectado_en
        self.ultima_muestra = ""
        self.tramas = 0
        self.cola_deteccion = ""
        self.ultimo_envio = None
        self.send_lock = threading.Lock()

    def resumen(self, comando_activo):
        return {
            "ip": self.ip,
            "puerto": self.puerto,
            "tipo": self.tipo,
            "equipo": self.equipo,
            "comando_activo": comando_activo,
            "conectado_en": self.conectado_en.isoformat(timespec="seconds"),
            "identificado_en": (
                self.identificado_en.isoformat(timespec="seconds")
                if self.identificado_en else None
            ),
            "ultima": self.ultima.isoformat(timespec="seconds"),
            "tramas": self.tramas,
            "ultima_muestra": self.ultima_muestra,
            "ultimo_envio": self.ultimo_envio,
        }


def _crear_http_session():
    session = requests.Session()
    adapter = HTTPAdapter(
        pool_connections=4,
        pool_maxsize=10,
        max_retries=Retry(total=1, backoff_factor=0.3, status_forcelist=[502, 503, 504]),
    )
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def _reset_http_session():
    global http_session
    with _http_lock:
        if http_session is not None:
            try:
                http_session.close()
            except Exception:
                pass
        http_session = _crear_http_session()
        print("🔄 Sesión HTTP reiniciada")


def _get_http_session():
    global http_session
    with _http_lock:
        if http_session is None:
            http_session = _crear_http_session()
        return http_session


def _cerrar_file_handle(ruta):
    with _file_handles_lock:
        fh = _file_handles.pop(ruta, None)
        if fh is not None:
            try:
                fh.close()
            except OSError:
                pass


def _abrir_file_handle(ruta):
    carpeta = os.path.dirname(ruta)
    if carpeta:
        os.makedirs(carpeta, exist_ok=True)
    with _file_handles_lock:
        if ruta not in _file_handles:
            hoy = os.path.basename(ruta)
            for previa, fh in list(_file_handles.items()):
                if os.path.basename(previa) != hoy:
                    try:
                        fh.close()
                    except OSError:
                        pass
                    del _file_handles[previa]
            _file_handles[ruta] = open(ruta, "a", encoding="utf-8", buffering=8192)
        return _file_handles[ruta]


def _escribir_linea(ruta, linea):
    for intento in range(1, REINTENTOS_ARCHIVO + 1):
        try:
            with file_lock:
                fh = _abrir_file_handle(ruta)
                fh.write(linea)
                fh.flush()
            return True
        except OSError as e:
            print(f"❌ Error escribiendo {ruta} (intento {intento}/{REINTENTOS_ARCHIVO}): {e}")
            _cerrar_file_handle(ruta)
            time.sleep(0.5 * intento)
    return False


def _ruta_ip(ip, fecha_actual):
    carpeta = os.path.join(BASE_DIR, DIR_REGISTROS, ip.replace(":", "_"))
    return os.path.join(carpeta, f"cerro_{fecha_actual}.txt")


def guardar_en_archivo(mensaje, timestamp, ip=None):
    """Guarda en el registro del día y, si hay IP, en registros/<ip>/."""
    fecha_actual = timestamp.strftime("%d_%m_%Y")
    hora = timestamp.strftime("%H:%M:%S")
    prefijo_ip = f"[{ip}] " if ip else ""
    linea_global = f"[{hora}] {prefijo_ip}{mensaje}\n"

    ok = _escribir_linea(os.path.join(BASE_DIR, f"cerro_{fecha_actual}.txt"), linea_global)
    if ip:
        _escribir_linea(_ruta_ip(ip, fecha_actual), f"[{hora}] {mensaje}\n")

    if ok:
        return True

    emergencia = os.path.join(BASE_DIR, f"cerro_emergencia_{fecha_actual}.txt")
    try:
        with open(emergencia, "a", encoding="utf-8") as fh:
            fh.write(linea_global)
            fh.flush()
        print(f"⚠️ Dato guardado en respaldo: {emergencia}")
        return True
    except OSError as e:
        print(f"❌ No se pudo guardar ni en respaldo: {e}")
        return False


def _guardar_api_pendiente(mensaje_json):
    registro = {
        "timestamp": ahora().isoformat(),
        "payload": mensaje_json,
    }
    with api_pendiente_lock:
        try:
            with open(ARCHIVO_API_PENDIENTE, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(registro, ensure_ascii=False) + "\n")
                fh.flush()
        except OSError as e:
            print(f"❌ No se pudo guardar JSON pendiente de API: {e}")


def _post_api(url, mensaje_json):
    for intento in range(1, REINTENTOS_API + 1):
        try:
            session = _get_http_session()
            return session.post(url, json=mensaje_json, timeout=5)
        except (requests.RequestException, OSError) as e:
            print(f"❌ Error POST {url} (intento {intento}/{REINTENTOS_API}): {e}")
            _reset_http_session()
            time.sleep(1 * intento)
    return None


def procesar_json(mensaje_json, sesion):
    """Envía el JSON de telemetría a ambas APIs. Responde al cliente solo con API 1."""
    respuesta_api1 = "sin envio"
    enviado_ok = True

    response = _post_api(API_URL, mensaje_json)
    if response is not None:
        print(f"🌐 API 1 (TermoKing) respondió: {response.text}")
        respuesta_api1 = response.text
    else:
        print("❌ API 1 no respondió tras reintentos")
        enviado_ok = False

    response2 = _post_api(API_URL2, mensaje_json)
    if response2 is not None:
        print(f"📡 API 2 (Datos) respondió: {response2.text}")
    else:
        print("❌ API 2 no respondió tras reintentos")
        enviado_ok = False

    if not enviado_ok:
        _guardar_api_pendiente(mensaje_json)

    sesion.ultimo_envio = {
        "cuando": ahora().isoformat(timespec="seconds"),
        "termoking": response is not None,
        "datos": response2 is not None,
        "termoking_url": API_URL,
        "datos_url": API_URL2,
    }

    try:
        datos = respuesta_api1.encode("utf-8")
        with sesion.send_lock:
            sesion.conn.sendall(datos)
    except OSError:
        print(f"⚠️ No se pudo devolver respuesta al cliente {sesion.ip}.")


def _reintentar_api_pendientes():
    """Hilo en segundo plano que reenvía JSON que falló en las APIs."""
    while True:
        time.sleep(30)
        try:
            if not os.path.exists(ARCHIVO_API_PENDIENTE):
                continue

            with api_pendiente_lock:
                with open(ARCHIVO_API_PENDIENTE, "r", encoding="utf-8") as fh:
                    lineas = [ln.strip() for ln in fh if ln.strip()]

            if not lineas:
                continue

            pendientes = []
            for linea in lineas:
                try:
                    registro = json.loads(linea)
                    payload = registro["payload"]
                except (json.JSONDecodeError, KeyError):
                    continue

                ok1 = _post_api(API_URL, payload) is not None
                ok2 = _post_api(API_URL2, payload) is not None
                if ok1 and ok2:
                    print("✅ JSON pendiente reenviado correctamente")
                else:
                    pendientes.append(linea)

            with api_pendiente_lock:
                with open(ARCHIVO_API_PENDIENTE, "w", encoding="utf-8") as fh:
                    for linea in pendientes:
                        fh.write(linea + "\n")

        except Exception as e:
            print(f"⚠️ Error en reintento de API pendientes: {e}")


def _extraer_json_del_buffer(buffer):
    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(buffer):
        if buffer[idx] != "{":
            idx += 1
            continue
        try:
            mensaje_json, fin = decoder.raw_decode(buffer, idx)
            return mensaje_json, fin
        except json.JSONDecodeError:
            idx += 1
    return None, None


def _es_marcador_cerro(texto):
    return any(marca in texto for marca in MARCADORES_CERRO)


def _ventana_es_cerro(sesion, chunk):
    """La firma puede llegar partida entre dos recv."""
    sesion.cola_deteccion = (sesion.cola_deteccion + chunk)[-128:]
    return _es_marcador_cerro(sesion.cola_deteccion)


def _es_json_telemetria(mensaje):
    return isinstance(mensaje, dict) and "i" in mensaje


def _registrar_conexion(sesion):
    """Registra la sesión. Si la IP supera el límite, cierra otra conexión.

    La sesión ya identificada como controlador cerro se conserva mientras
    existan otras conexiones de la misma IP que se puedan cerrar.
    """
    victimas = []
    with _conexiones_lock:
        lista = _conexiones_por_ip.setdefault(sesion.ip, [])
        while len(lista) >= MAX_POR_IP:
            idx = next((i for i, s in enumerate(lista) if s.tipo != "cerro"), 0)
            victima = lista.pop(idx)
            victimas.append(victima)
            print(
                f"♻️ {sesion.ip}: cerrando conexión antigua para liberar slot "
                f"({len(lista) + 1}/{MAX_POR_IP})"
            )
        lista.append(sesion)
    for victima in victimas:
        try:
            victima.conn.close()
        except OSError:
            pass


def _promover_cerro(ip, lista):
    otra = next((s for s in reversed(lista) if s.tipo == "cerro"), None)
    if otra is not None:
        _cerro_por_ip[ip] = otra
    else:
        _cerro_por_ip.pop(ip, None)


def _desregistrar_conexion(sesion):
    with _conexiones_lock:
        lista = _conexiones_por_ip.get(sesion.ip, [])
        try:
            lista.remove(sesion)
        except ValueError:
            pass
        if not lista:
            _conexiones_por_ip.pop(sesion.ip, None)
        if _cerro_por_ip.get(sesion.ip) is sesion:
            _promover_cerro(sesion.ip, lista)


def _registrar_cerro(sesion):
    with _conexiones_lock:
        primera_vez = sesion.tipo != "cerro"
        sesion.tipo = "cerro"
        _cerro_por_ip[sesion.ip] = sesion
        if sesion.identificado_en is None:
            sesion.identificado_en = ahora()
    if primera_vez:
        print(
            f"🎯 Controlador cerro en {sesion.ip}:{sesion.puerto} "
            f"(comandos por POST /comando)"
        )


def _conexiones_activas():
    with _conexiones_lock:
        return sum(len(v) for v in _conexiones_por_ip.values())


def _tocar_sesion(sesion, chunk):
    sesion.ultima = ahora()
    sesion.tramas += 1
    muestra = " ".join(chunk.split())
    if muestra:
        sesion.ultima_muestra = muestra[:180]


def listar_dispositivos():
    with _conexiones_lock:
        sesiones = [s for lista in _conexiones_por_ip.values() for s in list(lista)]
        activos = {ip: s for ip, s in _cerro_por_ip.items()}
    return [
        s.resumen(comando_activo=activos.get(s.ip) is s)
        for s in sesiones
    ]


def listar_cerro():
    return [d for d in listar_dispositivos() if d["tipo"] == "cerro"]


def _estado_vacio():
    return {
        "consignas": {},
        "etileno": None,
        "inyector_bits": None,
        "inyector_flag": None,
        "starcool_consulta": None,
        "starcool_salidas": None,
        "ripener": [],
        "reefer": [],
        "ultimo_ack": None,
        "ultimo_comando": None,
        "bloque": None,
    }


def _aplicar_estado(ip, texto, flujo):
    est = _estado_por_ip.setdefault(ip, _estado_vacio())
    if flujo == "out":
        est["ultimo_comando"] = texto
        est["bloque"] = None
        return

    if texto.startswith("SERVIDOR:"):
        for parte in texto[len("SERVIDOR:"):].split(","):
            if ":" in parte:
                clave, valor = parte.split(":", 1)
                est["consignas"][clave.strip()] = valor.strip()
        est["bloque"] = None
        return
    if texto.startswith("RIPENER_ETILENO:"):
        est["etileno"] = texto.split(":", 1)[1].strip()
        est["bloque"] = None
        return
    if texto.startswith("STARCOOL_CONSULTA:"):
        est["starcool_consulta"] = texto.split(":", 1)[1].strip()
        est["bloque"] = None
        return
    if texto.startswith("STARCOOL_SALIDAS:"):
        est["starcool_salidas"] = texto.split(":", 1)[1].strip()
        est["bloque"] = None
        return

    bits = re.fullmatch(r"INYECTOR:([01]{8,}),(.*)", texto)
    if bits:
        est["inyector_bits"] = bits.group(1)
        est["inyector_flag"] = bits.group(2).strip()
        est["bloque"] = None
        return
    if texto.startswith(("STARCOOL_OK", "INYECTOR_OK", "REEFER_CAMBIO_OK")):
        est["ultimo_ack"] = texto
        est["bloque"] = None
        return
    if texto == "RIPENER:":
        est["bloque"] = "ripener"
        est["ripener"] = []
        return
    if texto.startswith("REEFER_QUEST:"):
        est["bloque"] = "reefer"
        est["reefer"] = []
        resto = texto.split(":", 1)[1].strip()
        if resto:
            est["reefer"].append(resto)
        return
    if est.get("bloque") in ("ripener", "reefer") and texto[:1] in "0123456789,-":
        est[est["bloque"]].append(texto)
        est[est["bloque"]] = est[est["bloque"]][-6:]
        return
    if texto.startswith(("RIPENER", "STARCOOL", "REEFER", "INYECTOR", "SERVIDOR")):
        est["bloque"] = None


def _publicar_serial(ip, texto, flujo, tipo):
    global _serial_seq
    with _serial_lock:
        _serial_seq += 1
        _serial_lineas.append({
            "n": _serial_seq,
            "hora": ahora().strftime("%H:%M:%S"),
            "ip": ip,
            "flujo": flujo,
            "tipo": tipo,
            "texto": texto,
        })
        _aplicar_estado(ip, texto, flujo)
    try:
        panel.observar_serial(ip, texto, flujo)
    except Exception as e:
        print(f"❌ No se pudo anotar el comando {texto!r}: {e}")


_ventana_lock = threading.Lock()
_ventana_gen = {}
_ventana_timers = {}


def _volcar_serial(sesion, chunk, flujo="in"):
    for linea in chunk.splitlines():
        limpia = linea.strip()
        if not limpia:
            continue
        _publicar_serial(sesion.ip, limpia, flujo, sesion.tipo)
        if flujo != "in" or sesion.tipo == "json":
            continue
        try:
            panel.linea(sesion.ip, limpia)
            espera = panel.espera_ventana(sesion.ip, limpia)
        except Exception as e:
            print(f"❌ No se pudo interpretar {limpia!r}: {e}")
            espera = None
        if espera:
            _programar_ventana(sesion.ip, espera)


def _programar_ventana(ip, espera):
    """Rearma el silencio. Si llega otra línea del mismo grupo, el envío anterior no sale."""
    with _ventana_lock:
        gen = _ventana_gen.get(ip, 0) + 1
        _ventana_gen[ip] = gen
        previo = _ventana_timers.pop(ip, None)
        if previo is not None:
            previo.cancel()
        timer = threading.Timer(espera, _abrir_ventana, args=(ip, gen))
        timer.daemon = True
        _ventana_timers[ip] = timer
        timer.start()


def _abrir_ventana(ip, gen):
    with _ventana_lock:
        if _ventana_gen.get(ip) != gen:
            return
        _ventana_timers.pop(ip, None)
    try:
        comando = panel.tomar_ventana(ip)
    except Exception as e:
        print(f"❌ No se pudo tomar el comando de {ip}: {e}")
        return
    if not comando:
        return
    sesion = _cerro_por_ip.get(ip)
    if sesion is None:
        panel.confirmar(comando["id"], ok=False, error="el controlador ya no está conectado")
        return
    _despachar_ventana(sesion, comando)


def _despachar_ventana(sesion, comando):
    """Suelta un comando en el hueco de ~2 s que queda entre respuestas."""
    try:
        enviar_trama(comando["trama"], sesion.ip)
    except ErrorComando as e:
        panel.confirmar(comando["id"], ok=False, error=e.detalle)
        print(f"❌ Ventana {sesion.ip}: no salió {comando['trama']}: {e.detalle}")
        return
    panel.confirmar(comando["id"], ok=True)
    print(f"🪟 Ventana {sesion.ip}: {comando['trama']}")


def snapshot_serial(desde=0, ip=None, equipo=None):
    with _serial_lock:
        if desde <= 0:
            lineas = list(_serial_lineas)[-300:]
        else:
            lineas = [x for x in _serial_lineas if x["n"] > desde]
        if ip:
            lineas = [x for x in lineas if x["ip"] == ip]
        estado = json.loads(json.dumps(_estado_por_ip))
        siguiente = _serial_seq
    momento = ahora()
    return {
        "siguiente": siguiente,
        "lineas": lineas,
        "estado": estado,
        "dispositivos": listar_dispositivos(),
        "tcp": PORT,
        "enlaces": {"termoking": API_URL, "datos": API_URL2},
        "hora": momento.strftime("%d/%m/%Y %H:%M:%S"),
        "hoy": momento.date().isoformat(),
        "zona_horaria": "America/Lima",
        "panel": panel.vista(equipo or ip),
        "cola": panel.cola_publica(),
        "config": panel.config_publica(),
    }


def enviar_trama(trama, ip=None):
    """Escribe la trama ya mismo en el TCP del controlador cerro."""
    if not isinstance(trama, str):
        raise ErrorComando(400, "trama debe ser texto")
    texto = trama.strip("\r\n")
    if not texto.strip():
        raise ErrorComando(400, "trama vacia")

    payload = texto + "\n"
    with _conexiones_lock:
        if ip:
            sesion = _cerro_por_ip.get(ip)
            if sesion is None:
                raise ErrorComando(
                    404,
                    "no hay controlador cerro conectado en esa ip",
                    {"ip": ip, "cerro": list(_cerro_por_ip)},
                )
        elif not _cerro_por_ip:
            raise ErrorComando(409, "ningun controlador cerro conectado")
        elif len(_cerro_por_ip) > 1:
            raise ErrorComando(
                409,
                "hay varios controladores cerro, indique ip",
                {"ips": list(_cerro_por_ip)},
            )
        else:
            ip, sesion = next(iter(_cerro_por_ip.items()))
        conn = sesion.conn
        send_lock = sesion.send_lock
        puerto = sesion.puerto

    datos = payload.encode("utf-8")
    try:
        with send_lock:
            conn.sendall(datos)
    except OSError as e:
        raise ErrorComando(
            502,
            f"no se pudo escribir en el tcp: {e}",
            {"ip": ip, "puerto": puerto},
        )

    guardar_en_archivo(f">> {texto}", ahora(), ip)
    _publicar_serial(ip, texto, "out", "cerro")
    print(f"➡️ Comando a {ip}:{puerto}: {texto}")
    return {
        "ok": True,
        "ip": ip,
        "puerto": puerto,
        "bytes": len(datos),
        "trama": payload,
    }


def handle_client(conn, addr):
    client_ip, client_port = addr
    sesion = Sesion(conn, client_ip, client_port)
    _registrar_conexion(sesion)

    print(f"✅ Cliente conectado: {client_ip}:{client_port} (activas: {_conexiones_activas()})")
    buffer = ""

    try:
        conn.settimeout(IDLE_TIMEOUT)
        while True:
            try:
                data = conn.recv(4096)
            except socket.timeout:
                print(f"⏱️ Sin actividad {client_ip}:{client_port} ({IDLE_TIMEOUT}s), cerrando.")
                break
            except OSError as e:
                print(f"❌ Error recv {client_ip}:{client_port}: {e}")
                break

            if not data:
                print(f"🔌 Cliente {client_ip}:{client_port} desconectado.")
                break

            chunk = data.decode("utf-8", errors="replace")
            timestamp = ahora()
            _tocar_sesion(sesion, chunk)
            guardar_en_archivo(chunk, timestamp, client_ip)

            # El controlador de cámara no entra al flujo TermoKing.
            # Cada trama suya deja este socket como destino de POST /comando.
            if sesion.tipo == "cerro" or (
                sesion.tipo != "json" and _ventana_es_cerro(sesion, chunk)
            ):
                _registrar_cerro(sesion)
                _volcar_serial(sesion, chunk)
                buffer = ""
                continue

            buffer += chunk
            while True:
                mensaje_json, fin = _extraer_json_del_buffer(buffer)
                if mensaje_json is None:
                    if len(buffer) > 65536:
                        buffer = buffer[-8192:]
                    break

                if not _es_json_telemetria(mensaje_json):
                    print(f"📎 JSON sin equipo en {client_ip}, solo se registra")
                    buffer = buffer[fin:]
                    continue

                sesion.tipo = "json"
                sesion.equipo = str(mensaje_json.get("i"))
                print(f"📦 JSON {sesion.equipo} desde {client_ip}:", mensaje_json)
                try:
                    future = api_executor.submit(procesar_json, mensaje_json, sesion)
                    future.result(timeout=20)
                except Exception as e:
                    print(f"❌ Error procesando JSON (se continúa): {e}")
                    _guardar_api_pendiente(mensaje_json)
                buffer = buffer[fin:]

    except Exception as e:
        print(f"❌ Error inesperado {client_ip}:{client_port}: {e}")
    finally:
        _desregistrar_conexion(sesion)
        try:
            conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        conn.close()
        print(f"📤 Conexión cerrada ({client_ip}:{client_port}) — activas: {_conexiones_activas()}")


def _crear_server_socket():
    while True:
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((HOST, PORT))
            sock.listen(BACKLOG)
            return sock
        except OSError as e:
            print(f"❌ No se pudo abrir puerto {PORT}: {e} — reintentando en {REINICIO_SERVIDOR_SEG}s...")
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass
            time.sleep(REINICIO_SERVIDOR_SEG)


def _servir(server_socket):
    while True:
        try:
            conn, addr = server_socket.accept()
            threading.Thread(
                target=handle_client,
                args=(conn, addr),
                daemon=True,
            ).start()
        except OSError as e:
            if e.errno == 24:
                print("⚠️ Too many open files en accept(), limpiando y reintentando...")
                _reset_http_session()
                time.sleep(2)
            elif e.errno in (9, 104, 107):
                raise
            else:
                print(f"❌ Error en accept(): {e} — reintentando...")
                time.sleep(1)
        except Exception as e:
            print(f"❌ Error inesperado en bucle accept(): {e}")
            time.sleep(1)


def _leer_cuerpo(handler):
    largo = int(handler.headers.get("Content-Length", "0") or "0")
    if largo < 0 or largo > MAX_CUERPO_HTTP:
        raise ErrorComando(400, "cuerpo http invalido")
    if largo == 0:
        return ""
    return handler.rfile.read(largo).decode("utf-8", errors="replace")


def _rellenar(texto):
    return (texto or "").encode("utf-8")[:200].ljust(200, b"\0")


def _autorizado(handler):
    """Un script con X-Token sigue pudiendo llamar la API si CERRO_API_TOKEN está definido."""
    if not API_TOKEN:
        return False
    recibido = handler.headers.get("X-Token", "")
    return hmac.compare_digest(_rellenar(recibido), _rellenar(API_TOKEN))


def _cookie(handler, nombre):
    crudo = handler.headers.get("Cookie", "")
    if not crudo:
        return ""
    jar = SimpleCookie()
    try:
        jar.load(crudo)
    except Exception:
        return ""
    morsel = jar.get(nombre)
    return morsel.value if morsel else ""


def _sesion(handler):
    token = _cookie(handler, SESION_NOMBRE)
    if not token:
        return None
    momento = time.monotonic()
    with _sesiones_lock:
        datos = _sesiones.get(token)
        if not isinstance(datos, dict) or datos.get("expira", 0) < momento:
            _sesiones.pop(token, None)
            return None
        return dict(datos)


def _puede_ver(handler):
    return _autorizado(handler) or _sesion(handler) is not None


def _rol_de(handler):
    if _autorizado(handler):
        return "administrador"
    datos = _sesion(handler)
    if not datos:
        return ""
    return datos.get("rol") or "administrador"


def _es_admin(handler):
    return _rol_de(handler) == "administrador"


def _abrir_sesion(usuario, rol):
    token = secrets.token_urlsafe(32)
    limite = time.monotonic()
    with _sesiones_lock:
        vencidas = [k for k, datos in _sesiones.items() if not isinstance(datos, dict) or datos.get("expira", 0) < limite]
        for k in vencidas:
            _sesiones.pop(k, None)
        _sesiones[token] = {
            "expira": limite + SESION_SEG,
            "usuario": usuario,
            "rol": rol,
        }
    return token


def _cerrar_sesion(handler):
    token = _cookie(handler, SESION_NOMBRE)
    if token:
        with _sesiones_lock:
            _sesiones.pop(token, None)


def _cabecera_sesion(token):
    return f"{SESION_NOMBRE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESION_SEG}"


def _cabecera_cerrar():
    return f"{SESION_NOMBRE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"


_usuarios_lock = threading.Lock()
_RUTA_USUARIOS = os.path.join(BASE_DIR, "usuarios.json")
_USUARIO_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


def _hash_clave(clave, sal=None):
    sal = sal or secrets.token_hex(16)
    derivado = hashlib.pbkdf2_hmac("sha256", clave.encode("utf-8"), bytes.fromhex(sal), 120000).hex()
    return {"sal": sal, "hash": derivado}


def _clave_coincide(clave, guardada):
    if not guardada:
        return False
    actual = _hash_clave(clave, guardada.get("sal"))["hash"]
    return hmac.compare_digest(_rellenar(actual), _rellenar(guardada.get("hash") or ""))


def _leer_o_semilla():
    if not os.path.exists(_RUTA_USUARIOS):
        semilla = [{
            "usuario": USUARIO_PANEL,
            "rol": "administrador",
            **_hash_clave(CLAVE_PANEL),
        }]
        _escribir_usuarios(semilla)
        return semilla
    try:
        with open(_RUTA_USUARIOS, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        data = []
    return data if isinstance(data, list) else []


def _cargar_usuarios():
    with _usuarios_lock:
        return _leer_o_semilla()


def _escribir_usuarios(usuarios):
    os.makedirs(BASE_DIR, exist_ok=True)
    temporal = _RUTA_USUARIOS + ".tmp"
    with open(temporal, "w", encoding="utf-8") as fh:
        json.dump(usuarios, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(temporal, _RUTA_USUARIOS)


def _usuario_publico(item):
    return {"usuario": item.get("usuario"), "rol": item.get("rol")}


def _buscar_usuario(usuario):
    for item in _cargar_usuarios():
        if item.get("usuario") == usuario:
            return item
    return None


def _credenciales_ok(usuario, clave):
    item = _buscar_usuario(usuario)
    if item is None or item.get("rol") not in ("administrador", "monitoreo"):
        return None
    if not _clave_coincide(clave, item):
        return None
    return item


def _crear_usuario(usuario, clave, rol):
    usuario = str(usuario or "").strip()
    clave = str(clave or "")
    rol = str(rol or "").strip()
    if not _USUARIO_RE.match(usuario):
        raise ErrorComando(400, "el usuario usa letras, números, punto, guion o guion bajo, de 3 a 32 caracteres")
    if len(clave) < 8:
        raise ErrorComando(400, "la contraseña necesita al menos 8 caracteres")
    if rol not in ("administrador", "monitoreo"):
        raise ErrorComando(400, "el rol es administrador o monitoreo")
    with _usuarios_lock:
        usuarios = _leer_o_semilla()
        if any(item.get("usuario") == usuario for item in usuarios):
            raise ErrorComando(400, "ese usuario ya existe")
        usuarios.append({"usuario": usuario, "rol": rol, **_hash_clave(clave)})
        _escribir_usuarios(usuarios)
    return [_usuario_publico(item) for item in usuarios]


def _quitar_usuario(usuario):
    usuario = str(usuario or "").strip()
    with _usuarios_lock:
        usuarios = _leer_o_semilla()
        queda = [item for item in usuarios if item.get("usuario") != usuario]
        if len(queda) == len(usuarios):
            raise ErrorComando(404, "no está ese usuario")
        if not any(item.get("rol") == "administrador" for item in queda):
            raise ErrorComando(400, "tiene que quedar al menos un administrador")
        _escribir_usuarios(queda)
    return [_usuario_publico(item) for item in queda]


def _demasiados_intentos(ip):
    momento = time.monotonic()
    with _sesiones_lock:
        lista = [t for t in _fallos_login.get(ip, []) if momento - t < 600]
        _fallos_login[ip] = lista
        return len(lista) >= 8


def _anotar_fallo(ip):
    with _sesiones_lock:
        _fallos_login.setdefault(ip, []).append(time.monotonic())


def _resto_front(ruta):
    """Ruta dentro de /cerroprieto, o None si no pertenece al frontend."""
    if ruta == PREFIJO_FRONT:
        return "/"
    marca = PREFIJO_FRONT + "/"
    if ruta.startswith(marca):
        return "/" + ruta[len(marca):]
    return None


class ApiHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"🌐 API {self.address_string()} {fmt % args}")

    def _json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _html(self):
        indice = os.path.join(RUTA_FRONT, "index.html")
        self._pagina(indice if os.path.isfile(indice) else RUTA_INTERFAZ)

    def _estatico(self, ruta):
        base = os.path.realpath(RUTA_FRONT)
        destino = os.path.realpath(os.path.join(base, ruta.lstrip("/")))
        if not destino.startswith(base + os.sep) or not os.path.isfile(destino):
            self._json(404, {"ok": False, "detalle": "no está"})
            return
        tipo = {
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".webp": "image/webp",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".map": "application/json",
            ".woff2": "font/woff2",
        }.get(os.path.splitext(destino)[1], "application/octet-stream")
        try:
            with open(destino, "rb") as fh:
                body = fh.read()
        except OSError as e:
            self._json(500, {"ok": False, "detalle": f"sin archivo: {e}"})
            return
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _pagina(self, ruta, status=200):
        try:
            with open(ruta, encoding="utf-8") as fh:
                body = fh.read().encode("utf-8")
        except OSError as e:
            self._json(500, {"ok": False, "detalle": f"sin pagina: {e}"})
            return
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _redirigir(self, destino, cookie=None):
        self.send_response(303)
        self.send_header("Location", destino)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def _entrar(self):
        ip = self.client_address[0]
        if _demasiados_intentos(ip):
            self._redirigir("/login?e=2")
            return
        try:
            crudo = _leer_cuerpo(self)
        except ErrorComando:
            self._redirigir("/login?e=1")
            return
        datos = parse_qs(crudo, keep_blank_values=True)
        usuario = (datos.get("usuario") or [""])[0]
        clave = (datos.get("clave") or [""])[0]
        cuenta = _credenciales_ok(usuario, clave)
        if cuenta is None:
            _anotar_fallo(ip)
            self._redirigir("/login?e=1")
            return
        self._redirigir(PREFIJO_FRONT + "/", _cabecera_sesion(_abrir_sesion(cuenta["usuario"], cuenta["rol"])))

    def _salir(self):
        _cerrar_sesion(self)
        self._redirigir("/login", _cabecera_cerrar())

    def _ruta(self):
        return urlparse(self.path).path.rstrip("/") or "/"

    def do_GET(self):
        ruta = self._ruta()
        if ruta == "/salud":
            self._json(200, {"ok": True})
            return
        resto_front = _resto_front(ruta)
        if resto_front and resto_front.startswith("/marca/"):
            self._estatico(resto_front)
            return
        if ruta == "/login" or resto_front == "/login":
            if _puede_ver(self):
                self._redirigir(PREFIJO_FRONT + "/")
                return
            self._pagina(RUTA_LOGIN)
            return
        if not _puede_ver(self):
            if ruta == "/" or resto_front == "/":
                self._redirigir("/login")
                return
            self._json(401, {"ok": False, "detalle": "hay que iniciar sesión"})
            return
        if ruta == "/sesion":
            datos = _sesion(self) or {}
            self._json(200, {
                "ok": True,
                "usuario": datos.get("usuario") or USUARIO_PANEL,
                "rol": _rol_de(self),
            })
            return
        if not _es_admin(self) and ruta in ("/historial-comandos", "/archivos", "/usuarios", "/comandos", "/config", "/dispositivos", "/cerro", "/flujo"):
            self._json(403, {"ok": False, "detalle": "esta cuenta solo puede ver el panel"})
            return
        if ruta == "/":
            self._redirigir(PREFIJO_FRONT + "/")
            return
        if resto_front == "/":
            self._html()
            return
        if resto_front and resto_front.startswith("/assets/"):
            self._estatico(resto_front)
            return
        if ruta == "/dispositivos":
            self._json(200, {"dispositivos": listar_dispositivos()})
        elif ruta == "/cerro":
            self._json(200, {"cerro": listar_cerro()})
        elif ruta == "/comandos":
            self._json(200, {"comandos": panel.config_publica()["comandos"]})
        elif ruta == "/config":
            self._json(200, panel.config_publica())
        elif ruta == "/lecturas":
            consulta = parse_qs(urlparse(self.path).query)
            hoy = ahora().date().isoformat()
            desde = (consulta.get("desde") or [hoy])[0]
            hasta = (consulta.get("hasta") or [hoy])[0]
            ip = (consulta.get("ip") or [None])[0]
            if ip:
                ip = ip.strip() or None
            try:
                self._json(200, panel.lecturas(desde, hasta, ip))
            except PanelError as e:
                self._json(e.status, {"ok": False, "detalle": e.detalle})
        elif ruta == "/serial":
            consulta = parse_qs(urlparse(self.path).query)
            try:
                desde = int((consulta.get("desde") or ["0"])[0])
            except ValueError:
                desde = 0
            ip = (consulta.get("ip") or [None])[0]
            equipo = (consulta.get("equipo") or [None])[0]
            if ip:
                ip = ip.strip() or None
            if equipo:
                equipo = equipo.strip() or None
            data = snapshot_serial(desde, ip, equipo)
            rol = _rol_de(self)
            datos = _sesion(self) or {}
            data["rol"] = rol
            data["usuario"] = datos.get("usuario") or ""
            if rol == "monitoreo":
                data["lineas"] = []
                data["cola"] = {"pendientes": [], "recientes": []}
                config = dict(data.get("config") or {})
                config.pop("comandos", None)
                data["config"] = config
            self._json(200, data)
        elif ruta == "/historial-comandos":
            consulta = parse_qs(urlparse(self.path).query)
            hoy = ahora().date().isoformat()
            desde = (consulta.get("desde") or [hoy])[0]
            hasta = (consulta.get("hasta") or [hoy])[0]
            ip = (consulta.get("ip") or [None])[0]
            origen = (consulta.get("origen") or [None])[0]
            familia = (consulta.get("familia") or [None])[0]
            if ip:
                ip = ip.strip() or None
            try:
                self._json(200, panel.historial_comandos(desde, hasta, ip, origen, familia))
            except PanelError as e:
                self._json(e.status, {"ok": False, "detalle": e.detalle})
        elif ruta == "/reporte":
            consulta = parse_qs(urlparse(self.path).query)
            hoy = ahora().date().isoformat()
            desde = (consulta.get("desde") or [hoy])[0]
            hasta = (consulta.get("hasta") or [hoy])[0]
            ip = (consulta.get("ip") or [None])[0]
            formato = (consulta.get("formato") or ["xlsx"])[0]
            if ip:
                ip = ip.strip() or None
            try:
                cuerpo, tipo, nombre = panel.reporte(desde, hasta, ip, formato)
            except PanelError as e:
                self._json(e.status, {"ok": False, "detalle": e.detalle})
                return
            self.send_response(200)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(cuerpo)))
            self.send_header("Content-Disposition", f'attachment; filename="{nombre}"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(cuerpo)
        elif ruta == "/archivos":
            self._json(200, {"archivos": listar_capturas()})
        elif ruta == "/usuarios":
            self._json(200, {"ok": True, "usuarios": [_usuario_publico(item) for item in _cargar_usuarios()]})
        elif ruta == "/flujo":
            consulta = parse_qs(urlparse(self.path).query)
            hoy = ahora().date().isoformat()
            desde = (consulta.get("desde") or [hoy])[0]
            hasta = (consulta.get("hasta") or [hoy])[0]
            ip = (consulta.get("ip") or [None])[0]
            origen = (consulta.get("origen") or [None])[0]
            if ip:
                ip = ip.strip() or None
            if origen:
                origen = origen.strip() or None
            try:
                self._json(200, {"ok": True, **panel.flujo_publico(ip, desde, hasta, origen)})
            except PanelError as e:
                self._json(e.status, {"ok": False, "detalle": e.detalle})
        else:
            self._json(404, {"ok": False, "detalle": "ruta no encontrada"})

    def _cuerpo_json(self):
        crudo = _leer_cuerpo(self)
        consulta = parse_qs(urlparse(self.path).query)
        ip = (consulta.get("ip") or [None])[0]
        ctype = self.headers.get("Content-Type", "")
        if "application/json" in ctype or crudo.lstrip().startswith("{"):
            data = json.loads(crudo or "{}")
            if not isinstance(data, dict):
                raise ErrorComando(400, "el json debe ser un objeto")
        else:
            data = {"trama": crudo}
        if ip and not data.get("ip"):
            data["ip"] = ip
        if data.get("ip") is not None:
            data["ip"] = str(data["ip"]).strip() or None
        return data

    def _recibir_archivo(self):
        consulta = parse_qs(urlparse(self.path).query)
        nombre = _nombre_captura((consulta.get("nombre") or [""])[0])
        largo = int(self.headers.get("Content-Length", "0") or "0")
        if largo <= 0 or largo > MAX_ARCHIVO:
            raise ErrorComando(400, "el archivo tiene que pesar entre 1 byte y 20 MB")
        os.makedirs(DIR_LOGS, exist_ok=True)
        destino = os.path.join(DIR_LOGS, nombre)
        temporal = destino + ".tmp"
        quedo = largo
        try:
            with open(temporal, "wb") as fh:
                while quedo:
                    bloque = self.rfile.read(min(65536, quedo))
                    if not bloque:
                        break
                    fh.write(bloque)
                    quedo -= len(bloque)
                    fh.flush()
            if quedo:
                raise ErrorComando(400, "el archivo llegó incompleto")
            os.replace(temporal, destino)
        except ErrorComando:
            if os.path.exists(temporal):
                os.remove(temporal)
            raise
        except OSError as e:
            if os.path.exists(temporal):
                os.remove(temporal)
            raise ErrorComando(500, f"no se pudo guardar el archivo: {e}")
        reemplazar = (consulta.get("reemplazar") or ["0"])[0] in ("1", "true", "si")
        self._json(200, panel.incorporar_archivo(destino, reemplazar=reemplazar))

    def do_POST(self):
        ruta = self._ruta()
        if ruta == "/login":
            self._entrar()
            return
        if ruta == "/salir":
            self._salir()
            return
        if not _puede_ver(self):
            self._json(401, {"ok": False, "detalle": "hay que iniciar sesión"})
            return
        if not _es_admin(self) and ruta != "/salir":
            self._json(403, {"ok": False, "detalle": "esta cuenta solo puede ver el panel"})
            return
        try:
            if ruta == "/comando":
                data = self._cuerpo_json()
                trama = data.get("trama", data.get("comando", ""))
                resultado = panel.encolar(
                    trama,
                    titulo=data.get("titulo") or "",
                    descripcion=data.get("descripcion") or "",
                    grupo=data.get("grupo") or "",
                    ip=data.get("ip"),
                )
                self._json(200, {
                    "ok": True,
                    "encolado": True,
                    "detalle": "Se envía en el próximo espacio de unos 2 s entre respuestas",
                    **resultado,
                })
            elif ruta == "/comandos":
                data = self._cuerpo_json()
                self._json(200, {"ok": True, **panel.guardar_catalogo(data.get("comandos"))})
            elif ruta == "/config":
                data = self._cuerpo_json()
                self._json(200, {"ok": True, "config": panel.actualizar(data)})
            elif ruta == "/cola/cancelar":
                data = self._cuerpo_json()
                self._json(200, {"ok": True, "comando": panel.cancelar(data.get("id"))})
            elif ruta == "/archivos":
                self._recibir_archivo()
            elif ruta == "/archivos/incorporar":
                data = self._cuerpo_json()
                self._json(200, _incorporar_guardado(data.get("nombre"), bool(data.get("reemplazar"))))
            elif ruta == "/usuarios":
                data = self._cuerpo_json()
                cuentas = _crear_usuario(data.get("usuario"), data.get("clave"), data.get("rol"))
                self._json(200, {"ok": True, "usuarios": cuentas})
            elif ruta == "/usuarios/quitar":
                data = self._cuerpo_json()
                cuentas = _quitar_usuario(data.get("usuario"))
                self._json(200, {"ok": True, "usuarios": cuentas})
            elif ruta == "/flujo/par":
                self._json(200, {"ok": True, **panel.guardar_par(self._cuerpo_json())})
            elif ruta == "/flujo/par/quitar":
                data = self._cuerpo_json()
                self._json(200, {"ok": True, **panel.quitar_par(data.get("id"))})
            elif ruta == "/flujo/par/accionar":
                data = self._cuerpo_json()
                self._json(200, {"ok": True, **panel.accionar_par(data.get("id"), data.get("accion"), data.get("segundos"), data.get("ip"))})
            elif ruta == "/flujo/secuencia":
                self._json(200, {"ok": True, **panel.guardar_secuencia(self._cuerpo_json())})
            elif ruta == "/flujo/secuencia/quitar":
                data = self._cuerpo_json()
                self._json(200, {"ok": True, **panel.quitar_secuencia(data.get("id"))})
            elif ruta == "/flujo/secuencia/lanzar":
                data = self._cuerpo_json()
                self._json(200, {"ok": True, **panel.lanzar_secuencia(data.get("id"), data.get("ip"))})
            elif ruta == "/flujo/regla":
                self._json(200, {"ok": True, **panel.guardar_regla(self._cuerpo_json())})
            elif ruta == "/flujo/regla/quitar":
                data = self._cuerpo_json()
                self._json(200, {"ok": True, **panel.quitar_regla(data.get("id"))})
            else:
                self._json(404, {"ok": False, "detalle": "ruta no encontrada"})
        except ErrorComando as e:
            self._json(e.status, {"ok": False, "detalle": e.detalle, **e.extra})
        except PanelError as e:
            self._json(e.status, {"ok": False, "detalle": e.detalle})
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "detalle": "json invalido"})
        except Exception as e:
            self._json(500, {"ok": False, "detalle": str(e)})


def _servir_api():
    while True:
        try:
            servidor = ThreadingHTTPServer((API_HTTP_HOST, API_HTTP_PORT), ApiHandler)
            print(
                f"🧭 Panel en http://{API_HTTP_HOST}:{API_HTTP_PORT}/ "
                f"· TCP de equipos en {PORT} · hora {ahora().strftime('%d/%m/%Y %H:%M:%S')} America/Lima"
            )
            servidor.serve_forever()
        except OSError as e:
            print(f"❌ API HTTP no pudo abrir puerto {API_HTTP_PORT}: {e} — reintento en {REINICIO_SERVIDOR_SEG}s")
            time.sleep(REINICIO_SERVIDOR_SEG)
        except Exception as e:
            print(f"❌ API HTTP detenida: {e} — reintento en {REINICIO_SERVIDOR_SEG}s")
            time.sleep(REINICIO_SERVIDOR_SEG)


def _nombre_captura(nombre):
    base = os.path.basename(str(nombre or "").replace("\\", "/"))
    if fecha_de_nombre(base) is None:
        raise ErrorComando(
            400,
            "el archivo debe llamarse cerro_dia_mes_año.txt o cerro_dia_mes_año_extra.txt",
        )
    return base


def listar_capturas():
    os.makedirs(DIR_LOGS, exist_ok=True)
    salida = []
    for nombre in sorted(os.listdir(DIR_LOGS)):
        if fecha_de_nombre(nombre) is None:
            continue
        ruta = os.path.join(DIR_LOGS, nombre)
        if not os.path.isfile(ruta):
            continue
        fecha = fecha_de_nombre(nombre)
        salida.append({
            "nombre": nombre,
            "fecha": fecha.isoformat(),
            "fecha_display": fecha.strftime("%d/%m/%Y"),
            "bytes": os.path.getsize(ruta),
            "lecturas_actuales": panel.lecturas_del_dia(fecha),
        })
    return salida


def _incorporar_guardado(nombre, reemplazar):
    base = _nombre_captura(nombre)
    ruta = os.path.join(DIR_LOGS, base)
    return panel.incorporar_archivo(ruta, reemplazar=reemplazar)


def run_forever():
    os.makedirs(BASE_DIR, exist_ok=True)
    os.makedirs(DIR_LOGS, exist_ok=True)
    _reset_http_session()
    threading.Thread(target=_reintentar_api_pendientes, daemon=True).start()
    threading.Thread(target=_servir_api, daemon=True).start()

    while True:
        server_socket = None
        try:
            server_socket = _crear_server_socket()
            print(f"🚀 Servidor escuchando en {HOST}:{PORT} (máx. {MAX_POR_IP} conexiones/IP, idle {IDLE_TIMEOUT}s)")
            _servir(server_socket)
        except Exception as e:
            print(f"💥 Servidor detenido: {e}")
        finally:
            if server_socket is not None:
                try:
                    server_socket.close()
                except OSError:
                    pass

        print(f"🔄 Reiniciando servidor TCP en {REINICIO_SERVIDOR_SEG}s...")
        time.sleep(REINICIO_SERVIDOR_SEG)


if __name__ == "__main__":
    run_forever()
