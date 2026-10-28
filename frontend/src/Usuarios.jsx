import { useEffect, useState } from "react";
import { jget, jpost } from "./api.js";

export default function Usuarios({ onAviso }) {
  const [lista, setLista] = useState([]);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
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
          const data = await jpost("/usuarios", { usuario, clave, rol });
          setLista(data.usuarios || []);
          setUsuario("");
          setClave("");
          onAviso("Usuario creado.");
        } catch (e) { onAviso(e.message, true); }
      }}>
        <label>Usuario<input value={usuario} onChange={e => setUsuario(e.target.value)} required /></label>
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
          <div className="fila" key={u.usuario}>
            <strong>{u.usuario}</strong>
            <span>{u.rol === "administrador" ? "Superadmin" : "Monitor"}</span>
            <button className="secundario" type="button" onClick={async () => {
              if (!window.confirm("¿Quitar a " + u.usuario + "?")) return;
              try {
                const data = await jpost("/usuarios/quitar", { usuario: u.usuario });
                setLista(data.usuarios || []);
              } catch (e) { onAviso(e.message, true); }
            }}>Quitar</button>
          </div>
        ))}
      </div>
    </section>
  );
}
