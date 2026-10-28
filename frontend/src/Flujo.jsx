import { useEffect, useState } from "react";
import { jget, jpost } from "./api.js";

const PROCESO_BASE = {
  id: "",
  nombre: "Zona 2 · CO₂ primero, luego O₂",
  zona: 2,
  activa: false,
  segundos_por_01: 10,
  espera_s: 300,
  tolerancia_co2: 0.1,
  limite_generador: 7,
  comandos: {},
};

export default function Flujo({ onAviso }) {
  const [data, setData] = useState(null);
  const [proceso, setProceso] = useState(PROCESO_BASE);
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

  const plantilla = data?.plantilla_correccion || [];

  return (
    <>
      <section className="bloque">
        <h2>Corrección de atmósfera</h2>
        <p className="leyenda">Primero el tanque de CO₂. La inyección también baja el O₂. El generador entra solo si, con el CO₂ ya en rango, el O₂ sigue sobre su setpoint. Con el evento activado, dos lecturas seguidas en la misma etapa arman la corrida. Cada comando espera a que el anterior haya salido por el serial.</p>
        <p className="leyenda">Referencia de la zona 2: CO₂ 4.7 % hacia 5.0 % son 30 s (10 s por cada 0.1 %). Después se esperan 5 min. Si el CO₂ queda a 0.1 del setpoint, no se inyecta más. El generador no baja de 7 % de O₂, y el BYPASS tiene que estar apagado antes de los compresores.</p>
        <p className="vista-proceso">{vistaProceso(proceso, lecturas, data?.objetivos)}</p>
        <form onSubmit={ev => {
          ev.preventDefault();
          actuar(async () => {
            const pub = await jpost("/flujo/proceso", {
              id: proceso.id || undefined,
              nombre: proceso.nombre,
              zona: Number(proceso.zona),
              activa: proceso.activa,
              segundos_por_01: Number(proceso.segundos_por_01),
              espera_s: Number(proceso.espera_s),
              tolerancia_co2: Number(proceso.tolerancia_co2),
              limite_generador: Number(proceso.limite_generador),
              comandos: proceso.comandos,
            });
            setProceso(PROCESO_BASE);
            onAviso(proceso.activa ? "Evento activado. La corrida espera dos lecturas y después cada comando." : "Proceso guardado, con el evento apagado.");
            return pub;
          });
        }}>
          <div className="rango">
            <label>Nombre<input value={proceso.nombre} onChange={e => setProceso({ ...proceso, nombre: e.target.value })} required /></label>
            <label>Zona
              <select value={proceso.zona} onChange={e => setProceso({ ...proceso, zona: Number(e.target.value) })}>
                <option value={1}>Zona 1</option>
                <option value={2}>Zona 2</option>
                <option value={3}>Zona 3</option>
              </select>
            </label>
            <label>Segundos por 0.1 % CO₂<input type="number" min="1" max="120" value={proceso.segundos_por_01} onChange={e => setProceso({ ...proceso, segundos_por_01: e.target.value })} required /></label>
            <label>Espera (s)<input type="number" min="0" max="3600" value={proceso.espera_s} onChange={e => setProceso({ ...proceso, espera_s: e.target.value })} required /></label>
            <label>Tolerancia CO₂<input type="number" min="0" max="5" step="0.1" value={proceso.tolerancia_co2} onChange={e => setProceso({ ...proceso, tolerancia_co2: e.target.value })} required /></label>
            <label>Límite generador %<input type="number" min="0" max="21" step="0.1" value={proceso.limite_generador} onChange={e => setProceso({ ...proceso, limite_generador: e.target.value })} required /></label>
          </div>
          <label className="check-evento">
            <input type="checkbox" checked={proceso.activa} onChange={e => setProceso({ ...proceso, activa: e.target.checked })} />
            Activar el evento. El operador lo decide. Al activarlo no sale un comando: espera la lectura.
          </label>
          <div className="pasos-flujo">
            {plantilla.map(paso => {
              const esperado = tituloEsperado(paso, Number(proceso.zona));
              const hallado = comandos.find(c => !c.archivado && c.titulo === esperado);
              return (
                <div className="paso-flujo" key={paso.clave}>
                  <span className="eti">Etapa {paso.etapa}</span>
                  <span>
                    {paso.titulo}
                    {esperado ? " · " + esperado : ""}
                    {hallado ? " · " + hallado.trama : ""}
                    {paso.comando ? "" : " · espera la lectura, no un comando"}
                  </span>
                  {paso.comando ? (
                    <SelectCmd
                      comandos={comandos}
                      required={false}
                      value={proceso.comandos[paso.clave] || ""}
                      onChange={v => setProceso({ ...proceso, comandos: { ...proceso.comandos, [paso.clave]: v } })}
                    />
                  ) : <span className="leyenda">Espera</span>}
                </div>
              );
            })}
          </div>
          <div className="rango" style={{ marginTop: 12 }}>
            <button className="primario" type="submit">{proceso.id ? "Actualizar proceso" : "Guardar proceso"}</button>
            {proceso.id ? <button className="secundario" type="button" onClick={() => setProceso(PROCESO_BASE)}>Nuevo</button> : null}
          </div>
        </form>
        <div className="lista" style={{ marginTop: 12 }}>
          {(data?.procesos || []).map(item => (
            <div className="fila" key={item.id}>
              <strong>{item.nombre}</strong>
              <span>Zona {item.zona} · {item.activa ? "evento activado" : "evento apagado"} · {item.segundos_por_01} s / 0.1 % · espera {item.espera_s} s</span>
              <span>{item.situacion?.texto}</span>
              {item.en_curso ? <span>{item.en_curso}</span> : null}
              <button className="secundario" type="button" onClick={() => setProceso({
                id: item.id,
                nombre: item.nombre,
                zona: item.zona,
                activa: item.activa,
                segundos_por_01: item.segundos_por_01,
                espera_s: item.espera_s,
                tolerancia_co2: item.tolerancia_co2,
                limite_generador: item.limite_generador,
                comandos: item.comandos || {},
              })}>Editar</button>
              <button className="secundario" type="button" onClick={() => actuar(async () => {
                const pub = await jpost("/flujo/proceso", {
                  id: item.id,
                  nombre: item.nombre,
                  zona: item.zona,
                  activa: !item.activa,
                  segundos_por_01: item.segundos_por_01,
                  espera_s: item.espera_s,
                  tolerancia_co2: item.tolerancia_co2,
                  limite_generador: item.limite_generador,
                  comandos: item.comandos || {},
                });
                onAviso(item.activa ? "Evento apagado. Si los compresores estaban en marcha, entra el apagado." : "Evento activado. Espera dos lecturas en la misma etapa.");
                return pub;
              })}>{item.activa ? "Apagar evento" : "Activar evento"}</button>
              <button className="secundario" type="button" onClick={() => {
                if (!window.confirm("¿Quitar el proceso " + item.nombre + "?")) return;
                actuar(() => jpost("/flujo/proceso/quitar", { id: item.id }));
              }}>Quitar</button>
            </div>
          ))}
        </div>
      </section>

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

function tituloEsperado(paso, zona) {
  if (paso.clave === "co2_abrir") return ["Z1_CO2", "Z2_CO2", "Z3_CO2"][zona - 1] || "Z2_CO2";
  if (paso.clave === "nitro_abrir") return ["Z1_Nitro", "Z2_Nitro", "Z3_Nitro"][zona - 1] || "Z2_Nitro";
  return paso.comando_doc || "";
}

function vistaProceso(form, lecturas, objetivos) {
  const zona = Number(form.zona);
  const co2 = lecturas.find(x => x.zona === zona && x.gas === "co2")?.valor;
  const o2 = lecturas.find(x => x.zona === zona && x.gas === "o2")?.valor;
  const setCo2 = Number(objetivos?.co2?.[String(zona)]);
  const setO2 = Number(objetivos?.o2?.[String(zona)]);
  if (![co2, o2, setCo2, setO2].every(n => Number.isFinite(n))) {
    return "Sin lectura vigente de esta zona. Al guardar, el proceso queda reconocido y elige etapa cuando llegue un ciclo.";
  }
  const faltante = Math.round((setCo2 - co2) * 10) / 10;
  const tolerancia = Number(form.tolerancia_co2);
  if (faltante > tolerancia) {
    const segundos = Math.round((faltante / 0.1) * Number(form.segundos_por_01));
    return `Con la lectura de ahora: Etapa A. El CO₂ está ${faltante.toFixed(1)} puntos bajo el setpoint. La inyección de referencia dura ${segundos} s y después se esperan ${form.espera_s} s.`;
  }
  if (o2 > setO2) {
    const limite = Number(form.limite_generador);
    if (setO2 < limite) {
      return `Con la lectura de ahora: el CO₂ ya no pide inyección, pero el setpoint de O₂ ${setO2.toFixed(1)} % queda bajo el límite del generador (${limite} %). Este proceso no enciende los compresores.`;
    }
    return `Con la lectura de ahora: Etapa B. El CO₂ ya está en rango y el O₂ sigue en ${Number(o2).toFixed(1)} %, sobre el setpoint ${setO2.toFixed(1)} %.`;
  }
  return "Con la lectura de ahora el CO₂ y el O₂ de esta zona ya están en el caso que el proceso da por corregido.";
}

function SelectCmd({ comandos, value, onChange, required = true }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} required={required}>
      <option value="">Elegir</option>
      {comandos.filter(c => !c.archivado).map(c => <option key={c.id} value={c.id}>{(c.titulo || c.trama) + " · " + c.trama}</option>)}
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
