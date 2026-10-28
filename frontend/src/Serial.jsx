import { useEffect, useRef, useState } from "react";
import { jpost } from "./api.js";

export default function Serial({ lineas, enlaces, comandos, onAviso }) {
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
