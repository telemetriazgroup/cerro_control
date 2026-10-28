import { useState } from "react";
import { flecha, jpost, textoNum } from "./api.js";

const ESTATUS = [
  ["set_point", "Set point", "gota", "#7c5cbf"],
  ["suministro", "T° Suministro", "termo", "#3b82f6"],
  ["retorno", "T° Retorno", "termo", "#38bdf8"],
  ["evaporador", "Evaporador", "frio", "#8b5cf6"],
  ["condensador", "Condensador", "calor", "#f59e0b"],
  ["power", "Equipo", "equipo", "#16a34a"],
];

const EXTRA = [
  ["humedad", "Humedad", "gota", "#0ea5e9"],
  ["ventilacion", "Ventilación", "aire", "#64748b"],
  ["co2", "CO₂ sensor", "gas", "#1b7f4a"],
  ["o2", "O₂ sensor", "gas", "#2563eb"],
  ["sp_humedad", "SP humedad", "gota", "#0284c7"],
  ["sp_co2", "SP CO₂", "gas", "#15803d"],
];

function campo(reefer, clave) {
  return (reefer || []).find(c => c.clave === clave) || {};
}

function hace(segundos) {
  if (segundos == null) return "";
  if (segundos < 60) return "hace " + segundos + " s";
  const min = segundos / 60;
  if (min < 60) return "hace " + min.toFixed(1) + " min";
  return "hace " + Math.round(min / 60) + " h";
}

function textoEquipo(c) {
  if (c.texto === "Encendido" || c.clase === "on") return "ON";
  if (c.texto === "Apagado" || c.clase === "off") return "OFF";
  return "—";
}

function valorCampo(clave, c) {
  if (clave === "power") return textoEquipo(c);
  if (c.valor == null || c.texto === "NA") return "—";
  return textoNum(c.valor);
}

export default function Live({ panel, admin, onAviso, onHistorico }) {
  const p = panel || {};
  const reefer = p.reefer || [];
  const objetivos = p.objetivos || { co2: {}, o2: {} };
  const [obj, setObj] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const editando = obj || {
    co2: { 1: objetivos.co2?.["1"] ?? "", 2: objetivos.co2?.["2"] ?? "", 3: objetivos.co2?.["3"] ?? "" },
    o2: { 1: objetivos.o2?.["1"] ?? "", 2: objetivos.o2?.["2"] ?? "", 3: objetivos.o2?.["3"] ?? "" },
  };
  const power = campo(reefer, "power");
  const equipo = textoEquipo(power);
  const enLinea = !p.sin_datos && (p.segundos == null || p.segundos < 180);

  async function guardarObjetivos(ev) {
    ev.preventDefault();
    try {
      await jpost("/config", {
        objetivos: {
          co2: { 1: Number(editando.co2[1]), 2: Number(editando.co2[2]), 3: Number(editando.co2[3]) },
          o2: { 1: Number(editando.o2[1]), 2: Number(editando.o2[2]), 3: Number(editando.o2[3]) },
        },
      });
      setObj(null);
      onAviso("Objetivos guardados.");
    } catch (e) { onAviso(e.message, true); }
  }

  const textoObj = `CO₂ ${textoNum(objetivos.co2?.["1"], 0)} / ${textoNum(objetivos.co2?.["2"], 0)} / ${textoNum(objetivos.co2?.["3"], 0)} % · O₂ ${textoNum(objetivos.o2?.["1"], 0)} / ${textoNum(objetivos.o2?.["2"], 0)} / ${textoNum(objetivos.o2?.["3"], 0)} %`;

  return (
    <section className="hoja">
      <div className="cabecera-eq">
        <div>
          <h2 className="id-eq">{p.ip || "Cerro Prieto"}</h2>
          <div className="pills">
            <span className="pill lleno">CÁMARA</span>
            <span className={enLinea ? "pill lleno" : "pill neutro"}>{enLinea ? "En línea" : "Sin datos"}</span>
            <span className={equipo === "ON" ? "pill linea" : "pill neutro"}>{equipo === "—" ? "Equipo" : "Equipo " + equipo}</span>
          </div>
          <p className="cuando">
            {p.ultimo_dato ? "Última actualización: " + p.ultimo_dato : "Esperando el ciclo del controlador."}
            {p.segundos != null ? " · " + hace(p.segundos) : ""}
            {" · America/Lima"}
          </p>
        </div>
        <button className="secundario" type="button" onClick={() => onAviso("La vista se actualiza sola cada segundo.")}>Actualizar</button>
      </div>

      <h3 className="kicker">Estatus reefer</h3>
      <p className="leyenda">Temperaturas del REEFER_QUEST de este ciclo. El condensador desde 35 °C se marca caliente.</p>
      <div className="estatus">
        {ESTATUS.concat(EXTRA).map(([clave, nombre, icono, color]) => {
          const c = campo(reefer, clave);
          const clase = c.clase === "caliente" ? "caliente" : clave === "power" && equipo === "ON" ? "ok" : "";
          const unidad = clave === "power" ? "" : (c.unidad || (clave.startsWith("set") || ["suministro", "retorno", "evaporador", "condensador"].includes(clave) ? "°C" : ""));
          const valor = valorCampo(clave, c);
          return (
            <Tarjeta key={clave} nombre={nombre} icono={icono} color={color} clase={clase} valor={valor} unidad={valor === "—" ? "" : unidad} />
          );
        })}
      </div>

      <button className="plegado" type="button" onClick={() => setAbierto(v => !v)} aria-expanded={abierto}>
        <span className="plegado-izq">
          <IconoMini nombre="lista" />
          <span>
            <strong>Datos del reefer</strong>
            <small>Sensores de temperatura del mismo REEFER_QUEST.</small>
          </span>
        </span>
        <span className={abierto ? "chev abierto" : "chev"}>⌄</span>
      </button>
      {abierto && (
        <div className="estatus" style={{ marginTop: 12 }}>
          {[["sensor_1", "Sensor 1", "termo", "#64748b"], ["sensor_2", "Sensor 2", "termo", "#64748b"], ["sensor_3", "Sensor 3", "termo", "#64748b"], ["sensor_4", "Sensor 4", "termo", "#64748b"]].map(([clave, nombre, icono, color]) => {
            const c = campo(reefer, clave);
            const unidad = c.unidad || "";
            return <Tarjeta key={clave} nombre={c.nombre || nombre} icono={icono} color={color} valor={valorCampo(clave, c)} unidad={valorCampo(clave, c) === "—" ? "" : unidad} />;
          })}
        </div>
      )}

      <h3 className="kicker" style={{ marginTop: 22 }}>Atmósfera por zona</h3>
      <p className="leyenda">Objetivos — {textoObj}. {p.objetivos_origen === "equipo" ? "Consigna del equipo." : p.objetivos_origen === "panel" ? "Guardados en el panel." : "Valores de fábrica hasta que se guarden."}</p>
      <div className="zonas">
        {(p.por_zona || []).map(z => (
          <article className="zona" key={z.zona}>
            <h3>Zona {z.zona}{z.control?.etiqueta ? " · " + z.control.etiqueta : ""}</h3>
            <div className="par-gas">
              <Gas nombre="CO₂" gas={z.co2} />
              <Gas nombre="O₂" gas={z.o2} />
            </div>
          </article>
        ))}
        {!p.por_zona?.length && <p className="leyenda">Sin lectura vigente.</p>}
      </div>
      {admin && (
        <form className="rango" style={{ marginTop: 14 }} onSubmit={guardarObjetivos}>
          {[1, 2, 3].map(z => (
            <label key={"c" + z}>CO₂ zona {z}
              <input type="number" step="0.1" value={editando.co2[z]} onChange={e => setObj({ ...editando, co2: { ...editando.co2, [z]: e.target.value } })} />
            </label>
          ))}
          {[1, 2, 3].map(z => (
            <label key={"o" + z}>O₂ zona {z}
              <input type="number" step="0.1" value={editando.o2[z]} onChange={e => setObj({ ...editando, o2: { ...editando.o2, [z]: e.target.value } })} />
            </label>
          ))}
          <button className="primario" type="submit">Guardar objetivos</button>
          <button className="secundario" type="button" onClick={async () => {
            try { await jpost("/config", { seguir_equipo: true }); onAviso("Se usa la consigna del equipo."); }
            catch (e) { onAviso(e.message, true); }
          }}>Usar consigna del equipo</button>
        </form>
      )}

      {admin && <Ciclo panel={p} onAviso={onAviso} />}

      <div className="pie-analisis">
        <div>
          <h3>Monitoreo y análisis</h3>
          <p>Gases, temperaturas del reefer y la tabla del mismo ciclo. Lo más reciente queda arriba.</p>
        </div>
        <button className="secundario" type="button" onClick={onHistorico}>Abrir histórico</button>
      </div>
    </section>
  );
}

function Tarjeta({ nombre, icono, color, valor, unidad, clase }) {
  return (
    <article className={"tarjeta" + (clase ? " " + clase : "")}>
      <div className="eti"><IconoMini nombre={icono} color={color} />{nombre}</div>
      <div className="valor">
        {valor}
        {unidad ? <span className="unidad"> {unidad}</span> : null}
      </div>
    </article>
  );
}

function IconoMini({ nombre, color }) {
  const comun = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: color || "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (nombre === "termo") return <svg {...comun}><path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z" /><path d="M12 14v3" /></svg>;
  if (nombre === "gota") return <svg {...comun}><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" /></svg>;
  if (nombre === "frio") return <svg {...comun}><path d="M12 2v20M4.5 7l15 10M19.5 7l-15 10" /></svg>;
  if (nombre === "calor") return <svg {...comun}><path d="M12 3c2 3 2 5 0 8 3 0 5 2 5 5a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 3 3-2-3-2-5 0-12z" /></svg>;
  if (nombre === "equipo") return <svg {...comun}><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>;
  if (nombre === "aire") return <svg {...comun}><path d="M4 8h11a3 3 0 1 0-3-3" /><path d="M4 12h14a3 3 0 1 1-3 3" /><path d="M4 16h8" /></svg>;
  if (nombre === "gas") return <svg {...comun}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9 12h6" /></svg>;
  return <svg {...comun}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>;
}

function Gas({ nombre, gas }) {
  const g = gas || {};
  return (
    <div className={"gas tarjeta " + (g.estado || "")}>
      <div className="eti">{nombre} {flecha(g.tendencia)} {g.reinicio ? "· reinicio" : ""}</div>
      <div className="valor">{textoNum(g.valor)}<span className="unidad"> %</span></div>
      <div className="meta">objetivo {textoNum(g.objetivo, 0)}</div>
    </div>
  );
}

function Ciclo({ panel, onAviso }) {
  const p = panel || {};
  return (
    <div className="ciclo">
      <h3 className="kicker">Ciclo y salidas</h3>
      <p className="leyenda">Paso {p.paso || "—"} · etileno {p.etileno?.valor || "—"} {p.etileno?.unidad || ""}</p>
      <div className="estatus">
        {(p.humedad || []).map(h => (
          <Tarjeta key={"h" + h.zona} nombre={"Humedad zona " + h.zona} icono="gota" color="#0ea5e9" valor={textoNum(h.valor, 0)} unidad="%" />
        ))}
        {(p.compresores || []).map(c => (
          <Tarjeta key={"k" + c.numero} nombre={"Compresor " + c.numero} icono="equipo" color="#b7791f" valor={c.etiqueta || "—"} clase={c.encendido ? "ok" : ""} />
        ))}
      </div>
      <div className="lista" style={{ marginTop: 12 }}>
        {((p.inyector && p.inyector.bits) || []).filter(b => b.label).map(b => (
          <div className="fila" key={b.indice}>
            <strong>{b.label}</strong>
            <span>{b.encendido ? "Encendido" : "Apagado"}</span>
          </div>
        ))}
      </div>
      <Salidas salidas={p.salidas} onAviso={onAviso} />
    </div>
  );
}

function Salidas({ salidas, onAviso }) {
  const inicial = (salidas && salidas.campos) || [];
  const [campos, setCampos] = useState(null);
  const lista = campos || inicial;
  if (!lista.length) return null;
  return (
    <details className="salidas">
      <summary>Significado de STARCOOL_SALIDAS</summary>
      <form onSubmit={async ev => {
        ev.preventDefault();
        try {
          await jpost("/config", { salidas: lista });
          onAviso("Significados guardados.");
        } catch (e) { onAviso(e.message, true); }
      }}>
        {lista.map((c, i) => (
          <div className="rango" key={c.pos} style={{ marginTop: 8 }}>
            <label>Nombre<input value={c.nombre || ""} onChange={e => {
              const copia = lista.map(x => ({ ...x }));
              copia[i].nombre = e.target.value;
              setCampos(copia);
            }} /></label>
            <label>Si vale 1<input value={c.cuando_1 || ""} onChange={e => {
              const copia = lista.map(x => ({ ...x }));
              copia[i].cuando_1 = e.target.value;
              setCampos(copia);
            }} /></label>
            <label>Si vale 0<input value={c.cuando_0 || ""} onChange={e => {
              const copia = lista.map(x => ({ ...x }));
              copia[i].cuando_0 = e.target.value;
              setCampos(copia);
            }} /></label>
            <span className="meta">ahora {c.valor || "—"} {c.significado || ""}</span>
          </div>
        ))}
        <button className="primario" type="submit" style={{ marginTop: 10 }}>Guardar significados</button>
      </form>
    </details>
  );
}
