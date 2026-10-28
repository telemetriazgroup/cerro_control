import { useEffect, useState } from "react";
import { esAdmin, jget, nombreRol } from "./api.js";
import Live from "./Live.jsx";
import History from "./History.jsx";
import Serial from "./Serial.jsx";
import Comandos from "./Comandos.jsx";
import Usuarios, { Perfil } from "./Usuarios.jsx";
import Flujo from "./Flujo.jsx";

const BASE = [
  ["vivo", "En vivo"],
  ["hist", "Histórico"],
];
const EXTRA = [
  ["serial", "Serial"],
  ["cmd", "Comandos"],
  ["usuarios", "Usuarios"],
  ["flujo", "Flujo de control"],
];

const TITULOS = {
  vivo: "Estatus",
  hist: "Histórico",
  serial: "Serial",
  cmd: "Comandos",
  usuarios: "Usuarios",
  flujo: "Flujo de control",
};

export default function App() {
  const [tab, setTab] = useState("vivo");
  const [snap, setSnap] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [menu, setMenu] = useState(false);
  const [perfil, setPerfil] = useState(false);
  const [mio, setMio] = useState(null);
  const [fecha, setFecha] = useState(() => fechaBarra());

  function onAviso(texto, malo) {
    setAviso({ texto, malo: !!malo });
  }

  useEffect(() => {
    document.title = "ZTRACK · monitoreo de plantas industriales";
    const reloj = setInterval(() => setFecha(fechaBarra()), 30000);
    return () => clearInterval(reloj);
  }, []);

  useEffect(() => {
    let vivo = true;
    let desde = 0;
    let lineas = [];
    async function tick() {
      try {
        const data = await jget("/serial?desde=" + desde);
        if (!vivo) return;
        if (typeof data.siguiente === "number") desde = data.siguiente;
        if (data.lineas?.length) lineas = lineas.concat(data.lineas).slice(-400);
        setSnap({ ...data, lineas });
      } catch (e) {
        if (vivo && e.message && e.message !== "hay que iniciar sesión") onAviso(e.message, true);
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => { vivo = false; clearInterval(id); };
  }, []);

  const rol = snap?.rol || "";
  const admin = esAdmin(rol);
  const pestanas = admin ? BASE.concat(EXTRA) : BASE;
  const actual = pestanas.some(p => p[0] === tab) ? tab : "vivo";
  const panel = snap?.panel;
  const usuario = snap?.usuario || "";
  const nombres = mio?.nombres ?? snap?.nombres ?? "";
  const apellidos = mio?.apellidos ?? snap?.apellidos ?? "";
  const visible = [nombres, apellidos].filter(Boolean).join(" ") || usuario;

  function ir(id) {
    setPerfil(false);
    setMenu(false);
    setTab(id);
  }

  return (
    <div className="app">
      <aside className="lado">
        <div className="logo">
          <img src={import.meta.env.BASE_URL + "marca/logo-ztrack.png"} alt="ZTRACK by ZGROUP" />
        </div>
        <nav className="menu">
          {pestanas.map(([id, nombre]) => (
            <button key={id} type="button" className={!perfil && actual === id ? "activa" : ""} onClick={() => ir(id)}>
              <Icono nombre={id} />
              <span>{nombre}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="cuerpo">
        <header className="barra">
          <h1>{(perfil ? "Mi perfil" : TITULOS[actual])} · plantas industriales</h1>
          <div className="barra-der">
            <span className="fecha">{fecha}</span>
            <span className="idioma">Español</span>
            <div className="quien">
              <button className="secundario" type="button" onClick={() => setMenu(v => !v)}>
                <span className="avatar">{iniciales(visible)}</span>
                <span>
                  <strong>{visible}</strong>
                  <small>{rol ? nombreRol(rol) : ""}</small>
                </span>
              </button>
              {menu && (
                <div className="menu-usuario">
                  <div style={{ padding: "6px 10px 8px" }}>
                    <strong>{visible}</strong>
                    <small style={{ display: "block", color: "var(--suave)" }}>{usuario} · {rol ? nombreRol(rol) : ""}</small>
                  </div>
                  <button type="button" onClick={() => { setPerfil(true); setMenu(false); }}>Mi perfil</button>
                  <button className="salir-rojo" type="button" onClick={async () => { await fetch("/salir", { method: "POST" }); location.href = "/login"; }}>Cerrar sesión</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="pagina">
          {aviso && <div className={aviso.malo ? "aviso malo" : "aviso"}>{aviso.texto}</div>}
          {perfil && (
            <Perfil
              usuario={usuario}
              nombres={nombres}
              apellidos={apellidos}
              onAviso={onAviso}
              onListo={cuenta => setMio({ nombres: cuenta.nombres || "", apellidos: cuenta.apellidos || "" })}
            />
          )}
          {!perfil && actual === "vivo" && <Live panel={panel} admin={admin} onAviso={onAviso} onHistorico={() => ir("hist")} />}
          {!perfil && actual === "hist" && <History hoy={snap?.hoy} admin={admin} onAviso={onAviso} />}
          {!perfil && admin && actual === "serial" && <Serial lineas={snap?.lineas} enlaces={snap?.enlaces} comandos={snap?.config?.comandos} onAviso={onAviso} />}
          {!perfil && admin && actual === "cmd" && <Comandos comandos={snap?.config?.comandos} cola={snap?.cola} hoy={snap?.hoy} onAviso={onAviso} />}
          {!perfil && admin && actual === "usuarios" && <Usuarios onAviso={onAviso} />}
          {!perfil && admin && actual === "flujo" && <Flujo onAviso={onAviso} />}
        </main>
      </div>
    </div>
  );
}

function fechaBarra(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("es-PE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Lima",
  }).formatToParts(fecha);
  const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  return `${cap(mapa.weekday)}, ${mapa.day} De ${cap(mapa.month)} De ${mapa.year}`;
}

function iniciales(nombre) {
  const trozos = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!trozos.length) return "·";
  return trozos.slice(0, 2).map(t => t[0].toUpperCase()).join("");
}

function Icono({ nombre }) {
  const comun = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (nombre === "vivo") {
    return <svg {...comun}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
  }
  if (nombre === "hist") {
    return <svg {...comun}><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15l3-4 3 2 4-6" /></svg>;
  }
  if (nombre === "serial") {
    return <svg {...comun}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h10" /></svg>;
  }
  if (nombre === "cmd") {
    return <svg {...comun}><path d="M8 8l-4 4 4 4" /><path d="M13 16h7" /></svg>;
  }
  if (nombre === "usuarios") {
    return <svg {...comun}><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.2" /><path d="M16 19a4.2 4.2 0 0 1 4.5-4" /></svg>;
  }
  return <svg {...comun}><circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="17" r="2" /><path d="M8 8.5 10.5 15" /><path d="M16 8.5 13.5 15" /></svg>;
}
