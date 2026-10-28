import { useEffect, useState } from "react";
import { jget, jpost } from "./api.js";

export function Perfil({ nombres, apellidos, usuario, onAviso, onListo }) {
  const [nombre, setNombre] = useState(nombres || "");
  const [apellido, setApellido] = useState(apellidos || "");
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");

  useEffect(() => {
    setNombre(nombres || "");
    setApellido(apellidos || "");
  }, [nombres, apellidos]);

  return (
    <section className="bloque">
      <h2>Mi perfil</h2>
      <p className="leyenda">{usuario}. La contraseña nueva es opcional y pide la actual.</p>
      <form className="rango" onSubmit={async ev => {
        ev.preventDefault();
        try {
          const data = await jpost("/cuenta", {
            nombres: nombre,
            apellidos: apellido,
            clave_actual: actual,
            clave_nueva: nueva,
          });
          setActual("");
          setNueva("");
          onListo(data.cuenta || {});
          onAviso(nueva ? "Datos y contraseña guardados." : "Datos guardados.");
        } catch (e) { onAviso(e.message, true); }
      }}>
        <label>Nombres<input value={nombre} onChange={e => setNombre(e.target.value)} /></label>
        <label>Apellidos<input value={apellido} onChange={e => setApellido(e.target.value)} /></label>
        <label>Contraseña actual<input type="password" value={actual} onChange={e => setActual(e.target.value)} autoComplete="current-password" /></label>
        <label>Contraseña nueva<input type="password" value={nueva} onChange={e => setNueva(e.target.value)} autoComplete="new-password" /></label>
        <button className="primario" type="submit">Guardar</button>
      </form>
    </section>
  );
}

export default function Usuarios({ onAviso }) {
  const [lista, setLista] = useState([]);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [nombres, setNombres] = useState("");
  const [apellidos, setApellidos] = useState("");
  const [rol, setRol] = useState("monitoreo");

  async function cargar() {
    const data = await jget("/usuarios");
    setLista(data.usuarios || []);
  }
  useEffect(() => { cargar().catch(e => onAviso(e.message, true)); }, []);

  return (
    <section className="bloque">
      <h2>Usuarios</h2>
      <p className="leyenda">Superadmin usa todo el panel. Monitor ve el estatus en vivo y el histórico de gases y temperaturas.</p>
      <form className="rango" onSubmit={async ev => {
        ev.preventDefault();
        try {
          const data = await jpost("/usuarios", { usuario, clave, rol, nombres, apellidos });
          setLista(data.usuarios || []);
          setUsuario("");
          setClave("");
          setNombres("");
          setApellidos("");
          onAviso("Usuario creado.");
        } catch (e) { onAviso(e.message, true); }
      }}>
        <label>Usuario<input value={usuario} onChange={e => setUsuario(e.target.value)} required /></label>
        <label>Nombres<input value={nombres} onChange={e => setNombres(e.target.value)} /></label>
        <label>Apellidos<input value={apellidos} onChange={e => setApellidos(e.target.value)} /></label>
        <label>Contraseña<input type="password" value={clave} onChange={e => setClave(e.target.value)} required /></label>
        <label>Rol
          <select value={rol} onChange={e => setRol(e.target.value)}>
            <option value="monitoreo">Monitor</option>
            <option value="administrador">Superadmin</option>
          </select>
        </label>
        <button className="primario" type="submit">Crear</button>
      </form>
      <div className="lista" style={{ marginTop: 14 }}>
        {lista.map(u => (
          <UsuarioFila key={u.usuario} cuenta={u} onAviso={onAviso} onLista={setLista} />
        ))}
      </div>
    </section>
  );
}

function UsuarioFila({ cuenta, onAviso, onLista }) {
  const [nombres, setNombres] = useState(cuenta.nombres || "");
  const [apellidos, setApellidos] = useState(cuenta.apellidos || "");
  const [clave, setClave] = useState("");
  useEffect(() => {
    setNombres(cuenta.nombres || "");
    setApellidos(cuenta.apellidos || "");
  }, [cuenta.nombres, cuenta.apellidos]);
  return (
    <form className="fila" onSubmit={async ev => {
      ev.preventDefault();
      try {
        const data = await jpost("/usuarios/datos", {
          usuario: cuenta.usuario,
          nombres,
          apellidos,
          clave_nueva: clave,
        });
        onLista(data.usuarios || []);
        setClave("");
        onAviso(clave ? "Datos y contraseña actualizados." : "Datos actualizados.");
      } catch (e) { onAviso(e.message, true); }
    }}>
      <strong>{cuenta.usuario}</strong>
      <span>{cuenta.rol === "administrador" ? "Superadmin" : "Monitor"}</span>
      <label>Nombres<input value={nombres} onChange={e => setNombres(e.target.value)} /></label>
      <label>Apellidos<input value={apellidos} onChange={e => setApellidos(e.target.value)} /></label>
      <label>Nueva contraseña<input type="password" value={clave} onChange={e => setClave(e.target.value)} placeholder="opcional" /></label>
      <button className="primario" type="submit">Guardar</button>
      <button className="secundario" type="button" onClick={async () => {
        if (!window.confirm("¿Quitar a " + cuenta.usuario + "?")) return;
        try {
          const data = await jpost("/usuarios/quitar", { usuario: cuenta.usuario });
          onLista(data.usuarios || []);
        } catch (e) { onAviso(e.message, true); }
      }}>Quitar</button>
    </form>
  );
}
