import { useState } from "react";
import { jpost } from "./api.js";

export default function Serial({ lineas, enlaces, comandos, onAviso }) {
  const [directo, setDirecto] = useState(false);
  const [trama, setTrama] = useState("");
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
      <div className="log mono">
        {(lineas || []).length ? lineas.map(l => (
          <div key={l.n}>{(l.hora || l.t || "") + "  " + (l.ip ? l.ip + "  " : "") + (l.texto || l.linea || "")}</div>
        )) : "Esperando tramas."}
      </div>
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
      <button className="primario" type="button" onClick={() => setDirecto(v => !v)}>Enviar comando directamente</button>
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
    </section>
  );
}
