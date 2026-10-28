import { useState } from "react";
import { flecha, jpost, textoNum } from "./api.js";

const TARJETAS = [
  ["set_point", "Set point", "#7c6a1a"],
  ["suministro", "Suministro", "#1b7f4a"],
  ["retorno", "Retorno", "#c24141"],
  ["evaporador", "Evaporador", "#667085"],
  ["condensador", "Condensador", "#c24141"],
  ["power", "Equipo", "#1b7f4a"],
];

function campo(reefer, clave) {
  return (reefer || []).find(c => c.clave === clave) || {};
}

function Tarjeta({ nombre, color, valor, unidad, clase, extra }) {
  return (
    <article className={"tarjeta" + (clase ? " " + clase : "")}>
      <div className="eti"><span className="punto" style={{ background: color }} />{nombre}</div>
      <div className="valor">
        {valor}
        {unidad ? <span className="unidad">{unidad}</span> : null}
      </div>
      {extra ? <div className="meta">{extra}</div> : null}
    </article>
  );
}

export default function Live({ panel, admin, onAviso }) {
  const p = panel || {};
  const reefer = p.reefer || [];
  const objetivos = p.objetivos || { co2: {}, o2: {} };
  const [obj, setObj] = useState(null);
  const editando = obj || {
    co2: { 1: objetivos.co2?.["1"] ?? "", 2: objetivos.co2?.["2"] ?? "", 3: objetivos.co2?.["3"] ?? "" },
    o2: { 1: objetivos.o2?.["1"] ?? "", 2: objetivos.o2?.["2"] ?? "", 3: objetivos.o2?.["3"] ?? "" },
  };

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
    <>
      <section className="bloque">
        <h2>Estatus del equipo</h2>
        <p className="leyenda">
          {p.ip ? p.ip + " · " : ""}
          {p.sin_datos ? "Esperando el ciclo del controlador." : "Último dato " + (p.ultimo_dato || "")}
          {p.segundos != null ? " · hace " + p.segundos + " s" : ""}
          {" · America/Lima"}
        </p>
        <div className="rejilla">
          {TARJETAS.map(([clave, nombre, color]) => {
            const c = campo(reefer, clave);
            const esPower = clave === "power";
            return (
              <Tarjeta
                key={clave}
                nombre={nombre}
                color={color}
                clase={c.clase === "caliente" ? "caliente" : c.clase === "on" ? "ok" : ""}
                valor={esPower ? (c.texto || "—") : textoNum(c.valor)}
                unidad={esPower ? "" : "°C"}
              />
            );
          })}
        </div>
        <details className="plegado">
          <summary>Datos del reefer</summary>
          <div className="rejilla" style={{ marginTop: 12 }}>
            {["sensor_1", "sensor_2", "sensor_3", "sensor_4", "humedad", "ventilacion", "co2", "o2"].map(clave => {
              const c = campo(reefer, clave);
              return (
                <Tarjeta
                  key={clave}
                  nombre={c.nombre || clave}
                  color="#2563eb"
                  valor={c.texto && c.texto !== "NA" ? String(c.texto).replace(/ °C| %| CFM/g, "") : "—"}
                  unidad={c.unidad || ""}
                />
              );
            })}
          </div>
        </details>
      </section>

      <section className="bloque">
        <h2>Atmósfera por zona</h2>
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
      </section>

      {admin && <Ciclo panel={p} onAviso={onAviso} />}
    </>
  );
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
    <section className="bloque">
      <h2>Ciclo y salidas</h2>
      <p className="leyenda">Paso {p.paso || "—"} · etileno {p.etileno?.valor || "—"} {p.etileno?.unidad || ""}</p>
      <div className="rejilla">
        {(p.humedad || []).map(h => (
          <Tarjeta key={"h" + h.zona} nombre={"Humedad zona " + h.zona} color="#2563eb" valor={textoNum(h.valor, 0)} unidad="%" extra={h.reinicio ? "reinicio, se conserva el último válido" : ""} />
        ))}
        {(p.compresores || []).map(c => (
          <Tarjeta key={"k" + c.numero} nombre={"Compresor " + c.numero} color="#b7791f" valor={c.etiqueta || "—"} clase={c.encendido ? "ok" : ""} />
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
    </section>
  );
}

function Salidas({ salidas, onAviso }) {
  const inicial = (salidas && salidas.campos) || [];
  const [campos, setCampos] = useState(null);
  const lista = campos || inicial;
  if (!lista.length) return null;
  return (
    <details className="plegado">
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
