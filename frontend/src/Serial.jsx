import { useEffect, useRef, useState } from "react";
import { flecha, jpost, textoNum } from "./api.js";

export default function Serial({ lineas, enlaces, comandos, panel, onAviso }) {
  const [directo, setDirecto] = useState(false);
  const [trama, setTrama] = useState("");
  const caja = useRef(null);
  const seguir = useRef(true);
  const propio = useRef(false);
  const lista = (lineas || []).slice(-200);
  const ultima = lista.length ? lista[lista.length - 1] : null;

  useEffect(() => {
    const el = caja.current;
    if (!el || !seguir.current) return;
    let vivo = true;
    propio.current = true;
    const bajar = () => {
      if (vivo && caja.current) caja.current.scrollTop = caja.current.scrollHeight;
    };
    bajar();
    const marco = requestAnimationFrame(() => {
      bajar();
      requestAnimationFrame(() => { if (vivo) propio.current = false; });
    });
    return () => { vivo = false; cancelAnimationFrame(marco); };
  }, [lista.length, ultima && ultima.n]);

  function alDesplazar() {
    if (propio.current) return;
    const el = caja.current;
    if (!el) return;
    seguir.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }
  const activos = (comandos || []).filter(c => !c.archivado);
  const grupos = {};
  for (const cmd of activos) {
    const g = cmd.grupo || "General";
    (grupos[g] ||= []).push(cmd);
  }

  async function encolar(cmd) {
    try {
      const data = await jpost("/comando", {
        trama: cmd.trama,
        titulo: cmd.titulo,
        descripcion: cmd.descripcion,
        grupo: cmd.grupo,
      });
      onAviso(data.detalle || "En cola.");
    } catch (e) { onAviso(e.message, true); }
  }

  return (
    <section className="bloque">
      <h2>Serial</h2>
      <p className="leyenda">
        Lo que entra por el TCP del controlador. Los equipos JSON siguen saliendo a {enlaces?.termoking || "TermoKing"} y {enlaces?.datos || "Datos"}.
        Un comando sale en el próximo espacio de unos 2 s entre respuestas.
      </p>
      <h3 className="kicker">Línea</h3>
      <p className="leyenda">
        {ultima
          ? "Última: " + (ultima.hora || ultima.t || "") + "  " + (ultima.texto || ultima.linea || "")
          : "Esperando la primera trama."}
        {" "}· últimas {lista.length} de 200.
      </p>
      <div className="log mono" ref={caja} onScroll={alDesplazar}>
        {lista.length ? lista.map(l => (
          <div key={l.n}>{(l.hora || l.t || "") + "  " + (l.ip ? l.ip + "  " : "") + (l.texto || l.linea || "")}</div>
        )) : "Esperando tramas."}
      </div>
      <TiraEstado panel={panel} />
      <button className="primario" type="button" style={{ marginTop: 12 }} onClick={() => setDirecto(v => !v)}>Enviar comando directamente</button>
      {directo && (
        <form className="rango" style={{ marginTop: 12 }} onSubmit={ev => {
          ev.preventDefault();
          const texto = trama.trim();
          if (!texto) return;
          encolar({ trama: texto, titulo: texto });
          setTrama("");
        }}>
          <label>Trama
            <input value={trama} onChange={e => setTrama(e.target.value)} placeholder="INYECTOR:ESTADO?" autoFocus />
          </label>
          <button className="primario" type="submit">Enviar</button>
        </form>
      )}
      <h3 className="kicker">Comandos</h3>
      {Object.entries(grupos).map(([grupo, lista]) => (
        <div key={grupo} style={{ marginBottom: 12 }}>
          <div className="leyenda">{grupo}</div>
          <div className="rango">
            {lista.map(cmd => (
              <button className="secundario" key={cmd.id} type="button" title={cmd.trama} onClick={() => encolar(cmd)}>{cmd.titulo}</button>
            ))}
          </div>
        </div>
      ))}
      {!activos.length && <p className="leyenda">No hay comandos activos en el catálogo.</p>}
    </section>
  );
}

const VALVULAS_BASE = [
  ["CO₂", "CO₂ 1"],
  ["CO₂", "CO₂ 2"],
  ["CO₂", "CO₂ 3"],
  ["Nitrógeno", "N₂ 1"],
  ["Nitrógeno", "N₂ 2"],
  ["Nitrógeno", "N₂ 3"],
  ["Bypass", "Bypass"],
];

function nombreValvula(v, i) {
  if (v?.grupo === "Bypass") return "Bypass";
  const zona = String(v?.label || "").match(/zona\s+(\d)/i);
  if (v?.grupo === "Nitrógeno") return "N₂ " + (zona ? zona[1] : "");
  if (v?.grupo === "CO₂") return "CO₂ " + (zona ? zona[1] : "");
  return VALVULAS_BASE[i]?.[1] || "Válvula";
}

function TiraEstado({ panel }) {
  const p = panel || {};
  const valvulas = (p.inyector && p.inyector.valvulas) || [];
  const zonas = p.por_zona?.length ? p.por_zona : [1, 2, 3].map(z => ({ zona: z }));
  const huecos = valvulas.length ? valvulas : VALVULAS_BASE.map(([grupo, titulo]) => ({ grupo, label: titulo, encendido: false, vacio: true }));
  return (
    <div className="tira-estado" aria-label="Inyectores y lecturas">
      {huecos.map((v, i) => (
        <span key={"v" + i} className={"mini-estado" + (v.vacio ? " vacio" : v.encendido ? " on" : " off")} title={v.encendido ? "Activado" : "Desactivado"}>
          <span className="eti">{nombreValvula(v, i)}</span>
          <span className="valor">{v.vacio ? "—" : v.encendido ? "On" : "Off"}</span>
        </span>
      ))}
      {zonas.map(z => (
        <span key={"z" + z.zona} className="mini-zona">
          <MiniGas nombre={"CO₂ " + z.zona} gas={z.co2} activo={!!z.control?.activo} />
          <MiniGas nombre={"O₂ " + z.zona} gas={z.o2} activo={!!z.control?.activo} />
        </span>
      ))}
    </div>
  );
}

function MiniGas({ nombre, gas, activo }) {
  const g = gas || {};
  const hay = g.valor != null;
  const clase = !hay ? " vacio" : activo ? " on" : " off";
  return (
    <span className={"mini-estado" + clase} title={activo ? "Control activo" : "Control inactivo"}>
      <span className="eti">{nombre}</span>
      <span className="valor">{hay ? textoNum(g.valor) : "—"}{hay ? flecha(g.tendencia) : ""}</span>
    </span>
  );
}
