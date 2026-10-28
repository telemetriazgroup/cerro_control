import { useEffect, useState } from "react";
import { jget, jpost } from "./api.js";

export default function Flujo({ onAviso }) {
  const [data, setData] = useState(null);
  const [nombre, setNombre] = useState("");
  const [onId, setOnId] = useState("");
  const [offId, setOffId] = useState("");
  const [secNombre, setSecNombre] = useState("");
  const [pasos, setPasos] = useState([{ cmd_id: "", espera: 0 }]);
  const [regla, setRegla] = useState({ nombre: "", secuencia_id: "", modo: "entrar", condiciones: [{ zona: 1, gas: "co2", desde: 7, hasta: 9 }] });

  async function cargar() {
    const q = new URLSearchParams();
    const hoy = new Date();
    const dia = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    q.set("desde", dia + "T00:00");
    q.set("hasta", dia + "T23:00");
    setData(await jget("/flujo?" + q.toString()));
  }
  useEffect(() => {
    cargar().catch(e => onAviso(e.message, true));
    const id = setInterval(() => cargar().catch(() => {}), 15000);
    return () => clearInterval(id);
  }, []);

  const comandos = data?.comandos || [];
  const lecturas = (data?.lecturas || []).filter(x => x.valor != null);

  async function actuar(fn) {
    try { setData(await fn()); }
    catch (e) { onAviso(e.message, true); }
  }

  return (
    <>
      <section className="bloque">
        <h2>Pares encendido / apagado</h2>
        <p className="leyenda">Mantener N segundos arma el apagado para el primer hueco que ya cumplió ese plazo, contado desde que el encendido salió por el serial.</p>
        <form className="rango" onSubmit={ev => {
          ev.preventDefault();
          actuar(async () => {
            const pub = await jpost("/flujo/par", { nombre, on_id: onId, off_id: offId });
            setNombre("");
            onAviso("Par guardado.");
            return pub;
          });
        }}>
          <label>Nombre<input value={nombre} onChange={e => setNombre(e.target.value)} required /></label>
          <label>Encendido<SelectCmd comandos={comandos} value={onId} onChange={setOnId} /></label>
          <label>Apagado<SelectCmd comandos={comandos} value={offId} onChange={setOffId} /></label>
          <button className="primario" type="submit">Guardar par</button>
        </form>
        <div className="lista" style={{ marginTop: 12 }}>
          {(data?.pares || []).map(par => <Par key={par.id} par={par} actuar={actuar} onAviso={onAviso} />)}
        </div>
      </section>

      <section className="bloque">
        <h2>Secuencias</h2>
        <p className="leyenda">La espera son los segundos después de que el paso anterior salió. Cero es el hueco siguiente.</p>
        <form onSubmit={ev => {
          ev.preventDefault();
          actuar(async () => {
            const pub = await jpost("/flujo/secuencia", {
              nombre: secNombre,
              pasos: pasos.filter(p => p.cmd_id).map(p => ({ cmd_id: p.cmd_id, espera: Number(p.espera) || 0 })),
            });
            setSecNombre("");
            onAviso("Secuencia guardada.");
            return pub;
          });
        }}>
          <div className="rango">
            <label>Nombre<input value={secNombre} onChange={e => setSecNombre(e.target.value)} required /></label>
            <button className="primario" type="submit">Guardar secuencia</button>
          </div>
          {pasos.map((p, i) => (
            <div className="rango" key={i} style={{ marginTop: 8 }}>
              <SelectCmd comandos={comandos} value={p.cmd_id} onChange={v => setPasos(pasos.map((x, n) => n === i ? { ...x, cmd_id: v } : x))} />
              <label>Espera (s)<input type="number" min="0" value={p.espera} onChange={e => setPasos(pasos.map((x, n) => n === i ? { ...x, espera: e.target.value } : x))} /></label>
            </div>
          ))}
          <button className="secundario" type="button" style={{ marginTop: 8 }} onClick={() => setPasos([...pasos, { cmd_id: "", espera: 0 }])}>Agregar paso</button>
        </form>
        <div className="lista" style={{ marginTop: 12 }}>
          {(data?.secuencias || []).map(sec => (
            <div className="fila" key={sec.id}>
              <strong>{sec.nombre}</strong>
              <span>{(sec.pasos || []).length} {(sec.pasos || []).length === 1 ? "paso" : "pasos"}</span>
              <button className="secundario" type="button" onClick={() => actuar(async () => {
                const pub = await jpost("/flujo/secuencia/lanzar", { id: sec.id });
                onAviso("Secuencia en cola.");
                return pub;
              })}>Lanzar</button>
              <button className="secundario" type="button" onClick={() => {
                if (!window.confirm("¿Quitar la secuencia " + sec.nombre + "?")) return;
                actuar(() => jpost("/flujo/secuencia/quitar", { id: sec.id }));
              }}>Quitar</button>
            </div>
          ))}
        </div>
      </section>

      <section className="bloque">
        <h2>Reglas de CO₂ y O₂</h2>
        <p className="leyenda">
          {lecturas.length ? "Lectura vigente: " + lecturas.map(x => "Z" + x.zona + " " + (x.gas === "co2" ? "CO₂" : "O₂") + " " + x.valor).join(" · ") : "Sin lectura vigente."}
        </p>
        <p className="leyenda">Hacen falta dos consultas seguidas dentro del rango. Una regla nueva nace desactivada.</p>
        <form onSubmit={ev => {
          ev.preventDefault();
          actuar(async () => {
            const pub = await jpost("/flujo/regla", { ...regla, activa: false, condiciones: regla.condiciones.map(c => ({ ...c, zona: Number(c.zona), desde: Number(c.desde), hasta: Number(c.hasta) })) });
            onAviso("Regla guardada, desactivada.");
            return pub;
          });
        }}>
          <div className="rango">
            <label>Nombre<input value={regla.nombre} onChange={e => setRegla({ ...regla, nombre: e.target.value })} required /></label>
            <label>Secuencia
              <select value={regla.secuencia_id} onChange={e => setRegla({ ...regla, secuencia_id: e.target.value })} required>
                <option value="">Elegir</option>
                {(data?.secuencias || []).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
            <label>Modo
              <select value={regla.modo} onChange={e => setRegla({ ...regla, modo: e.target.value })}>
                <option value="entrar">Al entrar</option>
                <option value="seguir">Mientras siga</option>
              </select>
            </label>
            <button className="primario" type="submit">Guardar regla</button>
          </div>
          {regla.condiciones.map((c, i) => (
            <div className="rango" key={i} style={{ marginTop: 8 }}>
              <select value={c.zona} onChange={e => setRegla({ ...regla, condiciones: regla.condiciones.map((x, n) => n === i ? { ...x, zona: e.target.value } : x) })}>
                <option value={1}>Zona 1</option><option value={2}>Zona 2</option><option value={3}>Zona 3</option>
              </select>
              <select value={c.gas} onChange={e => setRegla({ ...regla, condiciones: regla.condiciones.map((x, n) => n === i ? { ...x, gas: e.target.value } : x) })}>
                <option value="co2">CO₂</option><option value="o2">O₂</option>
              </select>
              <input type="number" step="0.1" value={c.desde} onChange={e => setRegla({ ...regla, condiciones: regla.condiciones.map((x, n) => n === i ? { ...x, desde: e.target.value } : x) })} />
              <input type="number" step="0.1" value={c.hasta} onChange={e => setRegla({ ...regla, condiciones: regla.condiciones.map((x, n) => n === i ? { ...x, hasta: e.target.value } : x) })} />
            </div>
          ))}
          <button className="secundario" type="button" style={{ marginTop: 8 }} onClick={() => setRegla({ ...regla, condiciones: [...regla.condiciones, { zona: 1, gas: "o2", desde: 4, hasta: 8 }] })}>Agregar condición</button>
        </form>
        <div className="lista" style={{ marginTop: 12 }}>
          {(data?.reglas || []).map(r => (
            <div className="fila" key={r.id}>
              <strong>{r.nombre}</strong>
              <span>{r.activa ? "activa" : "desactivada"} · {r.modo === "seguir" ? "mientras siga" : "al entrar"} · {r.ahora === "dentro" ? "ahora dentro" : r.ahora === "fuera" ? "ahora fuera" : "sin lectura"}</span>
              <button className="secundario" type="button" onClick={() => actuar(() => jpost("/flujo/regla", { id: r.id, nombre: r.nombre, secuencia_id: r.secuencia_id, modo: r.modo, condiciones: r.condiciones, activa: !r.activa }))}>{r.activa ? "Desactivar" : "Activar"}</button>
              <button className="secundario" type="button" onClick={() => {
                if (!window.confirm("¿Quitar la regla " + r.nombre + "?")) return;
                actuar(() => jpost("/flujo/regla/quitar", { id: r.id }));
              }}>Quitar</button>
            </div>
          ))}
        </div>
      </section>

      <section className="bloque">
        <h2>Registro</h2>
        {(data?.corridas || []).length ? (data.corridas).map(c => (
          <div key={c.id} className="leyenda">
            <strong>{c.creado_display} · {c.nombre} · {c.estado}{c.pedido_s != null ? " · pedido " + c.pedido_s + " s" : ""}</strong>
            {(c.pasos || []).map(paso => (
              <div key={paso.n}>{paso.n}. {paso.titulo || paso.trama}{paso.enviado_display ? " · salió " + paso.enviado_display : " · pendiente"}{paso.segundos != null ? " · " + paso.segundos + " s desde el anterior" : ""}{paso.respuesta ? " · " + paso.respuesta : ""}</div>
            ))}
          </div>
        )) : <p className="leyenda">No hay corridas hoy.</p>}
      </section>
    </>
  );
}

function SelectCmd({ comandos, value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} required>
      <option value="">Elegir</option>
      {comandos.map(c => <option key={c.id} value={c.id}>{(c.titulo || c.trama) + " · " + c.trama}</option>)}
    </select>
  );
}

function Par({ par, actuar, onAviso }) {
  const [seg, setSeg] = useState(22);
  return (
    <div className="fila">
      <strong>{par.nombre}</strong>
      <input type="number" min="0" value={seg} onChange={e => setSeg(e.target.value)} style={{ width: 80 }} />
      <button className="secundario" type="button" onClick={() => actuar(async () => { const p = await jpost("/flujo/par/accionar", { id: par.id, accion: "encender" }); onAviso("Entró a la cola."); return p; })}>Encender</button>
      <button className="secundario" type="button" onClick={() => actuar(async () => { const p = await jpost("/flujo/par/accionar", { id: par.id, accion: "apagar" }); onAviso("Entró a la cola."); return p; })}>Apagar</button>
      <button className="secundario" type="button" onClick={() => actuar(async () => { const p = await jpost("/flujo/par/accionar", { id: par.id, accion: "mantener", segundos: Number(seg) }); onAviso("El apagado queda armado."); return p; })}>Mantener</button>
      <button className="secundario" type="button" onClick={() => {
        if (!window.confirm("¿Quitar el par " + par.nombre + "?")) return;
        actuar(() => jpost("/flujo/par/quitar", { id: par.id }));
      }}>Quitar</button>
    </div>
  );
}
