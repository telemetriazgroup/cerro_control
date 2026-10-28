import { useEffect, useRef, useState } from "react";
import { jget, jpost, ruta } from "./api.js";

const VACIO = { titulo: "", grupo: "General", trama: "", descripcion: "" };

export default function Comandos({ comandos, cola, hoy, onAviso }) {
  const dia = hoy || new Date().toISOString().slice(0, 10);
  const [lista, setLista] = useState(comandos || []);
  const previa = useRef("");
  const [nuevo, setNuevo] = useState(VACIO);
  const [desde, setDesde] = useState(dia + "T00:00");
  const [hasta, setHasta] = useState(dia + "T23:00");
  const [hist, setHist] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const firma = JSON.stringify(comandos || []);
    if (firma === previa.current) return;
    const activo = document.activeElement;
    if (activo && activo.closest && activo.closest(".catalogo")) return;
    previa.current = firma;
    setLista(comandos || []);
  }, [comandos]);

  useEffect(() => {
    if (!hoy) return;
    const d = hoy + "T00:00";
    const h = hoy + "T23:00";
    setDesde(d);
    setHasta(h);
    buscar(d, h);
  }, [hoy]);

  async function buscar(d = desde, h = hasta) {
    setCargando(true);
    try {
      const q = new URLSearchParams({ desde: d, hasta: h });
      const data = await jget("/historial-comandos?" + q.toString());
      setHist(data.comandos || []);
      setTotal(data.total || 0);
    } catch (e) { onAviso(e.message, true); }
    finally { setCargando(false); }
  }

  async function persistir(siguiente, aviso) {
    try {
      const data = await jpost("/comandos", { comandos: siguiente });
      const guardados = data.comandos || siguiente;
      previa.current = JSON.stringify(guardados);
      setLista(guardados);
      onAviso(aviso || "Catálogo guardado.");
    } catch (e) { onAviso(e.message, true); }
  }

  function cambiar(id, campo, valor) {
    setLista(lista.map(c => c.id === id ? { ...c, [campo]: valor } : c));
  }

  function bajar(formato) {
    const q = new URLSearchParams({ desde, hasta, formato });
    window.location.href = ruta("/historial-comandos?" + q.toString());
  }

  const activos = lista.filter(c => !c.archivado);
  const archivados = lista.filter(c => c.archivado);

  return (
    <>
      <section className="bloque catalogo">
        <h2>Catálogo</h2>
        <p className="leyenda">Editar cambia el título, el grupo o la trama. Archivar lo saca del serial y lo deja guardado aquí.</p>
        <form className="rango" onSubmit={ev => {
          ev.preventDefault();
          if (!nuevo.titulo.trim() || !nuevo.trama.trim()) {
            onAviso("El comando nuevo necesita título y trama.", true);
            return;
          }
          persistir(lista.concat([{ ...nuevo, id: "" }]), "Comando agregado.");
          setNuevo(VACIO);
        }}>
          <label>Título<input value={nuevo.titulo} onChange={e => setNuevo({ ...nuevo, titulo: e.target.value })} /></label>
          <label>Grupo<input value={nuevo.grupo} onChange={e => setNuevo({ ...nuevo, grupo: e.target.value })} /></label>
          <label>Trama<input className="mono" value={nuevo.trama} onChange={e => setNuevo({ ...nuevo, trama: e.target.value })} placeholder="INYECTOR:ESTADO?" /></label>
          <label>Descripción<input value={nuevo.descripcion} onChange={e => setNuevo({ ...nuevo, descripcion: e.target.value })} /></label>
          <button className="primario" type="submit">Agregar</button>
        </form>
        <div className="lista" style={{ marginTop: 14 }}>
          {activos.map(cmd => (
            <form className="fila" key={cmd.id} onSubmit={ev => { ev.preventDefault(); persistir(lista, "Comando guardado."); }}>
              <label>Título<input value={cmd.titulo || ""} onChange={e => cambiar(cmd.id, "titulo", e.target.value)} /></label>
              <label>Grupo<input value={cmd.grupo || ""} onChange={e => cambiar(cmd.id, "grupo", e.target.value)} /></label>
              <label>Trama<input className="mono" value={cmd.trama || ""} onChange={e => cambiar(cmd.id, "trama", e.target.value)} /></label>
              <label>Descripción<input value={cmd.descripcion || ""} onChange={e => cambiar(cmd.id, "descripcion", e.target.value)} /></label>
              <button className="primario" type="submit">Guardar</button>
              <button className="secundario" type="button" onClick={() => persistir(lista.map(c => c.id === cmd.id ? { ...c, archivado: true } : c), "Comando archivado.")}>Archivar</button>
            </form>
          ))}
        </div>
        {archivados.length > 0 && (
          <>
            <h3 className="kicker">Archivados</h3>
            <div className="lista">
              {archivados.map(cmd => (
                <div className="fila" key={cmd.id}>
                  <strong>{cmd.titulo}</strong>
                  <span className="mono">{cmd.trama}</span>
                  <button className="secundario" type="button" onClick={() => persistir(lista.map(c => c.id === cmd.id ? { ...c, archivado: false } : c), "Comando restaurado.")}>Restaurar</button>
                </div>
              ))}
            </div>
          </>
        )}
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
        <div className="tope">
          <div>
            <h2>Historial de comandos</h2>
            <p className="leyenda">El ciclo fijo no se lista. Serial es lo que apareció en la línea. Interfaz es lo que salió desde este panel.</p>
          </div>
          <div className="rango">
            <button className="secundario" type="button" onClick={() => bajar("xlsx")}>Excel</button>
            <button className="secundario" type="button" onClick={() => bajar("pdf")}>PDF</button>
          </div>
        </div>
        <form className="rango" onSubmit={ev => { ev.preventDefault(); buscar(); }}>
          <label>Desde<input type="datetime-local" step="3600" value={desde} onChange={e => setDesde(e.target.value)} /></label>
          <label>Hasta<input type="datetime-local" step="3600" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
          <button className="primario" type="submit" disabled={cargando}>{cargando ? "Buscando…" : "Buscar"}</button>
        </form>
        {cargando && (
          <div className="cargando" role="status" style={{ marginTop: 12 }}>
            <span className="giro" />
            Buscando información…
          </div>
        )}
        {!cargando && <p className="leyenda" style={{ marginTop: 10 }}>{total} {total === 1 ? "comando" : "comandos"}</p>}
        {!cargando && (
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
        )}
      </section>
    </>
  );
}
