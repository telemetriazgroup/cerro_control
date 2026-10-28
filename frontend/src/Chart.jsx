import { useEffect, useRef, useState } from "react";

function techoGas(puntos, series) {
  let max = 0;
  for (const p of puntos) {
    for (const s of series) {
      if (!s.on) continue;
      const v = s.pick(p);
      if (v != null && v > max) max = v;
    }
  }
  return max <= 15 ? 15 : max + 5;
}

function rangoTemp(puntos, series) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of puntos) {
    for (const s of series) {
      if (!s.on) continue;
      const v = s.pick(p);
      if (v == null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) return [0, 20];
  if (min === max) return [min - 2, max + 2];
  const holgura = (max - min) * 0.12;
  return [min - holgura, max + holgura];
}

export default function Chart({ puntos, series, modo, titulo }) {
  const ref = useRef(null);
  const caja = useRef(null);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    const canvas = ref.current;
    const padre = caja.current;
    if (!canvas || !padre) return;
    const dibujar = () => {
      const ancho = padre.clientWidth || 640;
      const alto = 320;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(ancho * dpr);
      canvas.height = Math.floor(alto * dpr);
      canvas.style.width = ancho + "px";
      canvas.style.height = alto + "px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ancho, alto);
      const m = { l: 44, r: 12, t: 16, b: 28 };
      const w = ancho - m.l - m.r;
      const h = alto - m.t - m.b;
      const activos = series.filter(s => s.on);
      const [y0, y1] = modo === "gas" ? [0, techoGas(puntos, series)] : rangoTemp(puntos, series);
      ctx.strokeStyle = "#e6e8ec";
      ctx.fillStyle = "#667085";
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const y = m.t + (h * i) / 4;
        const valor = y1 - ((y1 - y0) * i) / 4;
        ctx.beginPath();
        ctx.moveTo(m.l, y);
        ctx.lineTo(ancho - m.r, y);
        ctx.stroke();
        ctx.fillText(valor.toFixed(modo === "gas" ? 0 : 1), m.l - 6, y + 4);
      }
      if (!puntos.length || !activos.length) return;
      const xDe = i => m.l + (puntos.length === 1 ? w / 2 : (w * i) / (puntos.length - 1));
      const yDe = v => m.t + ((y1 - v) / (y1 - y0 || 1)) * h;
      ctx.textAlign = "center";
      const marcas = puntos.length > 1 ? [0, puntos.length - 1] : [0];
      for (const i of marcas) {
        const t = (puntos[i].t || "").replace("T", " ").slice(5, 16);
        ctx.fillText(t, xDe(i), alto - 8);
      }
      for (const s of activos) {
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let empezado = false;
        puntos.forEach((p, i) => {
          const v = s.pick(p);
          if (v == null) return;
          const x = xDe(i);
          const y = yDe(v);
          if (!empezado) { ctx.moveTo(x, y); empezado = true; }
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        puntos.forEach((p, i) => {
          const v = s.pick(p);
          if (v == null) return;
          if (puntos.length === 1 || puntos.length <= 18) {
            ctx.beginPath();
            ctx.arc(xDe(i), yDe(v), 3, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
      canvas._geom = { m, w, h, xDe, puntos };
    };
    dibujar();
    const obs = new ResizeObserver(dibujar);
    obs.observe(padre);
    return () => obs.disconnect();
  }, [puntos, series, modo]);

  function mover(ev) {
    const canvas = ref.current;
    const geom = canvas && canvas._geom;
    if (!geom || !geom.puntos.length) { setTip(null); return; }
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    let mejor = 0;
    let dist = Infinity;
    geom.puntos.forEach((_, i) => {
      const d = Math.abs(geom.xDe(i) - x);
      if (d < dist) { dist = d; mejor = i; }
    });
    const p = geom.puntos[mejor];
    const lineas = series.filter(s => s.on).map(s => {
      const v = s.pick(p);
      return { color: s.color, texto: s.label + "  " + (v == null ? "—" : Number(v).toFixed(1)) };
    });
    setTip({ x: geom.xDe(mejor), titulo: (p.t || "").replace("T", " ").slice(0, 16), lineas });
  }

  return (
    <div>
      <div className="leyenda">{titulo}</div>
      <div ref={caja} style={{ position: "relative" }}>
        <canvas ref={ref} className="lienzo" onMouseMove={mover} onMouseLeave={() => setTip(null)} />
        {tip && (
          <div style={{
            position: "absolute", left: Math.min(tip.x + 8, (caja.current?.clientWidth || 300) - 160), top: 24,
            background: "#1c2430", color: "#fff", borderRadius: 10, padding: "8px 10px", fontSize: 12, pointerEvents: "none",
          }}>
            <div style={{ marginBottom: 4 }}>{tip.titulo}</div>
            {tip.lineas.map(l => (
              <div key={l.texto} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="muestra" style={{ background: l.color }} />
                {l.texto}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
