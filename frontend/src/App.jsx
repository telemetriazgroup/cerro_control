import { useEffect, useState } from "react";
import { esAdmin, jget, nombreRol } from "./api.js";
import Live from "./Live.jsx";
import History from "./History.jsx";
import Serial from "./Serial.jsx";
import Comandos from "./Comandos.jsx";
import Usuarios from "./Usuarios.jsx";
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

export default function App() {
  const [tab, setTab] = useState("vivo");
  const [snap, setSnap] = useState(null);
  const [aviso, setAviso] = useState(null);

  function onAviso(texto, malo) {
    setAviso({ texto, malo: !!malo });
  }

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

  return (
    <div className="marco">
      <header className="tope">
        <div>
          <h1 className="marca">Cerro Prieto</h1>
          <p className="sub">Atmósfera controlada · {snap?.hora || "America/Lima"}</p>
        </div>
        <div className="sesion">
          <div><strong>{snap?.usuario || ""}</strong> · {rol ? nombreRol(rol) : ""}</div>
          <button className="salir" type="button" onClick={async () => { await fetch("/salir", { method: "POST" }); location.href = "/login"; }}>Salir</button>
        </div>
      </header>
      <nav className="nav">
        {pestanas.map(([id, nombre]) => (
          <button key={id} type="button" className={actual === id ? "activa" : ""} onClick={() => setTab(id)}>{nombre}</button>
        ))}
      </nav>
      {aviso && <div className={aviso.malo ? "aviso malo" : "aviso"}>{aviso.texto}</div>}
      {actual === "vivo" && <Live panel={panel} admin={admin} onAviso={onAviso} />}
      {actual === "hist" && <History hoy={snap?.hoy} admin={admin} onAviso={onAviso} />}
      {admin && actual === "serial" && <Serial lineas={snap?.lineas} enlaces={snap?.enlaces} />}
      {admin && actual === "cmd" && <Comandos comandos={snap?.config?.comandos} cola={snap?.cola} onAviso={onAviso} />}
      {admin && actual === "usuarios" && <Usuarios onAviso={onAviso} />}
      {admin && actual === "flujo" && <Flujo onAviso={onAviso} />}
    </div>
  );
}
