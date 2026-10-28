import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "./Chart.jsx";
import { flecha, jget, jpost, textoNum } from "./api.js";

const GASES = [
  ["co2", 0, "CO₂ zona 1", "#1b7f4a"],
  ["co2", 1, "CO₂ zona 2", "#3d9b68"],
  ["co2", 2, "CO₂ zona 3", "#8fbf7a"],
  ["o2", 0, "O₂ zona 1", "#2563eb"],
  ["o2", 1, "O₂ zona 2", "#60a5fa"],
  ["o2", 2, "O₂ zona 3", "#93c5fd"],
];
const TEMPS = [
  ["suministro", "Suministro", "#1b7f4a"],
  ["retorno", "Retorno", "#c24141"],
  ["evaporador", "Evaporador", "#667085"],
  ["condensador", "Condensador", "#d97706"],
  ["set_point", "Set point", "#e0b000"],
];

function serieGas(clave, i, label, color, on) {
  return { id: clave + i, label, color, on, pick: p => (p[clave] || [])[i] };
}
function serieTemp(clave, label, color, on) {
  return { id: clave, label, color, on, pick: p => (p.temp || {})[clave] };
}

export default function History({ hoy, admin, onAviso }) {
  const dia = hoy || new Date().toISOString().slice(0, 10);
  const [desde, setDesde] = useState(dia + "T00:00");
  const [hasta, setHasta] = useState(dia + "T23:00");
  const [data, setData] = useState(null);
  const [gasesOn, setGasesOn] = useState(() => Object.fromEntries(GASES.map(g => [g[0] + g[1], true])));
  const [tempsOn, setTempsOn] = useState({ suministro: true, retorno: true, evaporador: false, condensador: false, set_point: true });

  const cargado = useRef(false);
  useEffect(() => {
    if (!hoy || cargado.current) return;
    cargado.current = true;
    const d = hoy + "T00:00";
    const h = hoy + "T23:00";
    setDesde(d);
    setHasta(h);
    buscar(d, h);
  }, [hoy]);

  async function buscar(d = desde, h = hasta) {
    try {
      const q = new URLSearchParams({ desde: d, hasta: h });
      setData(await jget("/lecturas?" + q.toString()));
    } catch (e) { onAviso(e.message, true); }
  }

  const gases = useMemo(() => GASES.map(g => serieGas(g[0], g[1], g[2], g[3], gasesOn[g[0] + g[1]] !== false)), [gasesOn]);
  const temps = useMemo(() => TEMPS.map(t => serieTemp(t[0], t[1], t[2], !!tempsOn[t[0]])), [tempsOn]);
  const puntos = data?.puntos || [];

  function reporte(formato) {
    const q = new URLSearchParams({ desde, hasta, formato });
    window.location.href = "/reporte?" + q.toString();
  }

  return (
    <>
      <section className="bloque">
        <div className="tope">
          <div>
            <h2>Monitoreo y análisis</h2>
            <p className="leyenda">La hora elegida entra completa. Misma consulta para la gráfica y la tabla. Lo más reciente queda arriba.</p>
          </div>
          <div className="rango">
            <button className="secundario" type="button" onClick={() => reporte("xlsx")}>Excel</button>
            <button className="secundario" type="button" onClick={() => reporte("pdf")}>PDF</button>
          </div>
        </div>
        <form className="rango" onSubmit={ev => { ev.preventDefault(); buscar(); }}>
          <label>Desde<input type="datetime-local" step="3600" value={desde} onChange={e => setDesde(e.target.value)} /></label>
          <label>Hasta<input type="datetime-local" step="3600" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
          <button className="primario" type="submit">Buscar</button>
        </form>
        {data && <p className="leyenda" style={{ marginTop: 10 }}>{data.desde} — {data.hasta} · {data.total} {data.total === 1 ? "registro" : "registros"}{data.aviso ? " · " + data.aviso : ""}</p>}
      </section>

      <section className="bloque">
        <h2>Gases</h2>
        <div className="historia">
          <Chart puntos={puntos} series={gases} modo="gas" titulo="CO₂ y O₂, %. El 0 y el 25.5 no se dibujan: queda el último valor válido." />
          <Leyenda series={gases} onToggle={id => setGasesOn(s => ({ ...s, [id]: s[id] === false }))} />
        </div>
      </section>
      <section className="bloque">
        <h2>Temperaturas del reefer</h2>
        <div className="historia">
          <Chart puntos={puntos} series={temps} modo="temp" titulo="La misma hora que el CO₂ y el O₂ de ese ciclo. °C." />
          <Leyenda series={temps} onToggle={id => setTempsOn(s => ({ ...s, [id]: !s[id] }))} />
        </div>
      </section>

      <section className="bloque">
        <h2>Datos en tabla</h2>
        <p className="leyenda">La fila de arriba es la más reciente.</p>
        <div className="tabla-marco">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>CO₂ 1</th><th>CO₂ 2</th><th>CO₂ 3</th>
                <th>O₂ 1</th><th>O₂ 2</th><th>O₂ 3</th>
                <th>Set point</th><th>Suministro</th><th>Retorno</th><th>Evaporador</th><th>Condensador</th>
              </tr>
            </thead>
            <tbody>
              {(data?.tabla || []).map(fila => {
                const r = Object.fromEntries((fila.reefer || []).map(c => [c.clave, c]));
                return (
                  <tr key={fila.t}>
                    <td>{fila.fecha}</td>
                    {(fila.zonas || []).map(z => <td key={"c" + z.zona}>{textoNum(z.co2?.valor)} {flecha(z.co2?.tendencia)}</td>)}
                    {(fila.zonas || []).map(z => <td key={"o" + z.zona}>{textoNum(z.o2?.valor)} {flecha(z.o2?.tendencia)}</td>)}
                    {["set_point", "suministro", "retorno", "evaporador", "condensador"].map(k => <td key={k}>{r[k]?.texto || "—"}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {admin && <Analisis data={data} onAviso={onAviso} />}
    </>
  );
}

function Leyenda({ series, onToggle }) {
  return (
    <div className="series">
      <strong>Series</strong>
      {series.map(s => (
        <label key={s.id}>
          <input type="checkbox" checked={s.on} onChange={() => onToggle(s.id)} />
          <span className="muestra" style={{ background: s.color }} />
          {s.label}
        </label>
      ))}
    </div>
  );
}

function Analisis({ data, onAviso }) {
  const [archivo, setArchivo] = useState(null);
  async function subir(ev) {
    ev.preventDefault();
    if (!archivo) return;
    try {
      const respuesta = await fetch("/archivos?nombre=" + encodeURIComponent(archivo.name), { method: "POST", body: archivo });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.detalle || "no se pudo subir");
      if (cuerpo.existe && !cuerpo.incorporado) {
        if (!window.confirm("Ese día ya tiene lecturas. ¿Reemplazarlas con este archivo?")) return;
        await jpost("/archivos/incorporar", { nombre: cuerpo.nombre, reemplazar: true });
      }
      onAviso("Archivo incorporado.");
    } catch (e) { onAviso(e.message, true); }
  }
  return (
    <section className="bloque">
      <h2>Análisis y archivo</h2>
      {data?.analisis && (
        <div className="rejilla">
          {["co2", "o2"].flatMap(gas => [1, 2, 3].map(z => {
            const a = data.analisis[gas]?.[String(z)] || {};
            return (
              <article className="tarjeta" key={gas + z}>
                <div className="eti">{gas === "co2" ? "CO₂" : "O₂"} zona {z}</div>
                <div className="valor" style={{ fontSize: 18 }}>{a.promedio != null ? textoNum(a.promedio) : "—"}</div>
                <div className="meta">{a.validas || 0} válidas · desvío {a.desviacion_media ?? "—"}</div>
              </article>
            );
          }))}
        </div>
      )}
      <form className="rango" style={{ marginTop: 12 }} onSubmit={subir}>
        <label>Archivo del serial<input type="file" accept=".txt" onChange={e => setArchivo(e.target.files?.[0] || null)} /></label>
        <button className="primario" type="submit">Incorporar</button>
      </form>
      <p className="leyenda">Nombre cerro_dia_mes_año.txt o con _extra. Si ese día ya tiene datos, se pide confirmación.</p>
    </section>
  );
}
