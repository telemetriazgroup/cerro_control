import { useEffect, useState } from "react";
import { jget, jpost } from "./api.js";

export default function Comandos({ comandos, cola, onAviso }) {
  const [trama, setTrama] = useState("");
  const [hist, setHist] = useState([]);
  const grupos = {};
  for (const cmd of comandos || []) {
    const g = cmd.grupo || "General";
    (grupos[g] ||= []).push(cmd);
  }

  useEffect(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    jget("/historial-comandos?desde=" + hoy + "&hasta=" + hoy).then(d => setHist(d.comandos || [])).catch(() => {});
  }, []);

  async function encolar(cmd) {
    try {
      const data = await jpost("/comando", { trama: cmd.trama, titulo: cmd.titulo, descripcion: cmd.descripcion, grupo: cmd.grupo });
      onAviso(data.detalle || "En cola.");
    } catch (e) { onAviso(e.message, true); }
  }

  return (
    <>
      <section className="bloque">
        <h2>Comandos</h2>
        <p className="leyenda">Se envían de a uno, en el próximo espacio de unos 2 s entre respuestas. No cortan una ráfaga de ripener o reefer.</p>
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
        <form className="rango" onSubmit={ev => { ev.preventDefault(); encolar({ trama, titulo: trama }); setTrama(""); }}>
          <label>Trama libre<input value={trama} onChange={e => setTrama(e.target.value)} placeholder="INYECTOR:ESTADO?" /></label>
          <button className="primario" type="submit">Encolar</button>
        </form>
      </section>
      <section className="bloque">
        <h2>Cola</h2>
        <div className="lista">
          {(cola?.pendientes || []).map(item => (
            <div className="fila" key={item.id}>
              <strong>{item.titulo || item.trama}</strong>
              <span className="mono">{item.trama}</span>
              <span>{item.estado === 4 ? "En vuelo" : "Pendiente"}{item.disponible_display ? " · desde " + item.disponible_display : ""}</span>
              <button className="secundario" type="button" onClick={async () => {
                try { await jpost("/cola/cancelar", { id: item.id }); onAviso("Cancelado."); }
                catch (e) { onAviso(e.message, true); }
              }}>Cancelar</button>
            </div>
          ))}
          {!cola?.pendientes?.length && <p className="leyenda">No hay comandos en espera.</p>}
        </div>
      </section>
      <section className="bloque">
        <h2>Historial de comandos</h2>
        <p className="leyenda">El ciclo fijo no se lista. Serial es lo que apareció en la línea. Interfaz es lo que salió desde este panel.</p>
        <div className="tabla-marco">
          <table>
            <thead><tr><th>Fecha</th><th>Origen</th><th>Trama</th><th>Respuesta</th><th>Δ anterior</th></tr></thead>
            <tbody>
              {hist.map(c => (
                <tr key={c.id || c.t + c.trama}>
                  <td>{c.fecha}</td><td>{c.origen}</td><td className="mono">{c.trama}</td>
                  <td>{c.respuesta || "—"}</td><td>{c.delta_anterior_s ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
