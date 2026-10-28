export default function Serial({ lineas, enlaces }) {
  return (
    <section className="bloque">
      <h2>Serial</h2>
      <p className="leyenda">
        Lo que entra por el TCP del controlador. Los equipos JSON siguen saliendo a {enlaces?.termoking || "TermoKing"} y {enlaces?.datos || "Datos"}.
      </p>
      <div className="log mono">
        {(lineas || []).length ? lineas.map(l => (
          <div key={l.n}>{(l.hora || l.t || "") + "  " + (l.ip ? l.ip + "  " : "") + (l.texto || l.linea || "")}</div>
        )) : "Esperando tramas."}
      </div>
    </section>
  );
}
