import { useEffect, useRef, useState } from "react";

function techo(puntos, series, modo) {
  if (modo === "temp") {
    let min = Infinity;
    let max = -Infinity;
    for (const p of puntos) {
      for (const s of series) {
        if (!s.on) continue;
        const v = s.pick(p);
        if (v == null || Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min)) return [0, 20];
    if (min === max) return [min - 2, max + 2];
    const holgura = (max - min) * 0.15;
    return [min - holgura, max + holgura];
  }
  let max = 0;
  for (const p of puntos) {
    for (const s of series) {
      if (!s.on) continue;
      const v = s.pick(p);
      if (v != null && v > max) max = v;
    }
  }
  return [0, max <= 15 ? 15 : max + 5];
}

function simplificar(puntos, series, tope = 180) {
  if (puntos.length <= tope) return puntos;
  const activos = series.filter(s => s.on && !s.plano);
  const quedar = new Set([0, puntos.length - 1]);
  const fuente = activos.length ? activos : series.filter(s => s.on);
  for (const s of fuente) {
    let ultimo = null;
    let ultIdx = 0;
    let dir = 0;
    for (let i = 0; i < puntos.length; i++) {
      const v = s.pick(puntos[i]);
      if (v == null) continue;
      if (ultimo == null) {
        quedar.add(i);
        ultimo = v;
        ultIdx = i;
        continue;
      }
      const delta = v - ultimo;
      const nueva = delta > 0.05 ? 1 : delta < -0.05 ? -1 : 0;
      if (nueva !== 0 && nueva !== dir) {
        quedar.add(ultIdx);
        quedar.add(i);
        dir = nueva;
      }
      ultimo = v;
      ultIdx = i;
    }
    quedar.add(ultIdx);
  }
  let lista = [...quedar].sort((a, b) => a - b);
  if (lista.length > tope) {
    const paso = Math.ceil(lista.length / tope);
    const recorte = lista.filter((_, i) => i % paso === 0);
    recorte.push(lista[lista.length - 1]);
    lista = [...new Set(recorte)];
  }
  return lista.map(i => puntos[i]);
}

function fechaCorta(t) {
  return (t || "").replace("T", " ").slice(0, 16);
}

export default function Chart({ puntos, series, modo, titulo, archivo }) {
  const ref = useRef(null);
  const caja = useRef(null);
  const ventana = useRef([0, 0]);
  const [win, setWin] = useState([0, 0]);
  const [tip, setTip] = useState(null);
  const [etiquetas, setEtiquetas] = useState(true);

  useEffect(() => {
    const fin = Math.max(0, puntos.length - 1);
    ventana.current = [0, fin];
    setWin([0, fin]);
  }, [puntos]);

  function fijar(a, b) {
    const n = puntos.length;
    if (!n) return;
    let i0 = Math.max(0, Math.min(a, n - 1));
    let i1 = Math.max(0, Math.min(b, n - 1));
    if (i1 < i0) [i0, i1] = [i1, i0];
    if (i1 - i0 < 1 && n > 1) i1 = Math.min(n - 1, i0 + 1);
    ventana.current = [i0, i1];
    setWin([i0, i1]);
  }

  function zoom(factor, frac) {
    const [a, b] = ventana.current;
    const span = Math.max(1, b - a);
    const centro = a + span * frac;
    let nuevo = Math.round(span * factor);
    const tope = Math.max(1, puntos.length - 1);
    nuevo = Math.max(8, Math.min(tope, nuevo));
    let na = Math.round(centro - nuevo * frac);
    let nb = na + nuevo;
    if (na < 0) { nb -= na; na = 0; }
    if (nb > tope) { na -= nb - tope; nb = tope; }
    fijar(Math.max(0, na), nb);
  }

  useEffect(() => {
    const canvas = ref.current;
    const padre = caja.current;
    if (!canvas || !padre) return;
    const [i0, i1] = win;
    const recorte = puntos.slice(i0, Math.max(i0, i1) + 1);
    const dibujo = simplificar(recorte, series);
    const dibujar = () => {
      const ancho = padre.clientWidth || 640;
      const alto = 360;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(ancho * dpr);
      canvas.height = Math.floor(alto * dpr);
      canvas.style.width = ancho + "px";
      canvas.style.height = alto + "px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, ancho, alto);
      const m = { l: 48, r: 16, t: 22, b: 36 };
      const w = ancho - m.l - m.r;
      const h = alto - m.t - m.b;
      const activos = series.filter(s => s.on);
      const [y0, y1] = techo(dibujo.length ? dibujo : recorte, series, modo);
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
      ctx.textAlign = "left";
      ctx.fillText(modo === "gas" ? "%" : "°C", 6, m.t + 4);
      const n = Math.max(1, dibujo.length);
      const xDe = i => m.l + (n === 1 ? w / 2 : (w * i) / (n - 1));
      const yDe = v => m.t + ((y1 - v) / (y1 - y0 || 1)) * h;
      if (dibujo.length) {
        ctx.textAlign = "center";
        ctx.fillStyle = "#667085";
        const marcas = n === 1 ? [0] : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1];
        const vistas = [...new Set(marcas)];
        for (const i of vistas) {
          ctx.fillText(fechaCorta(dibujo[i].t).slice(5), xDe(i), alto - 10);
        }
      }
      for (const s of activos) {
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = s.plano ? 1.3 : 1.7;
        ctx.setLineDash(s.plano ? [6, 4] : []);
        if (s.plano) {
          const v = dibujo.length ? s.pick(dibujo[0]) : null;
          if (v == null || !dibujo.length) continue;
          ctx.beginPath();
          ctx.moveTo(xDe(0), yDe(v));
          ctx.lineTo(xDe(dibujo.length - 1), yDe(v));
          ctx.stroke();
          continue;
        }
        ctx.beginPath();
        let empezado = false;
        dibujo.forEach((p, i) => {
          const v = s.pick(p);
          if (v == null) return;
          const x = xDe(i);
          const y = yDe(v);
          if (!empezado) { ctx.moveTo(x, y); empezado = true; }
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        if (dibujo.length <= 24) {
          dibujo.forEach((p, i) => {
            const v = s.pick(p);
            if (v == null) return;
            ctx.beginPath();
            ctx.arc(xDe(i), yDe(v), 2.5, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        if (etiquetas) {
          ctx.font = "10px Segoe UI, sans-serif";
          ctx.textAlign = "center";
          let lastX = -999;
          dibujo.forEach((p, i) => {
            const v = s.pick(p);
            if (v == null) return;
            const antes = i > 0 ? s.pick(dibujo[i - 1]) : null;
            const despues = i < dibujo.length - 1 ? s.pick(dibujo[i + 1]) : null;
            const extremo = i === 0 || i === dibujo.length - 1
              || (antes != null && despues != null && ((v >= antes && v >= despues) || (v <= antes && v <= despues)) && v !== antes);
            if (!extremo) return;
            const x = xDe(i);
            if (x - lastX < 72) return;
            lastX = x;
            ctx.fillText(Number(v).toFixed(1), x, Math.max(12, yDe(v) - 7));
          });
        }
      }
      ctx.setLineDash([]);
      canvas._geom = { m, w, h, xDe, puntos: dibujo };
    };
    dibujar();
    const obs = new ResizeObserver(dibujar);
    obs.observe(padre);
    return () => obs.disconnect();
  }, [puntos, series, modo, win, etiquetas]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const alGirar = (ev) => {
      if (!puntos.length) return;
      ev.preventDefault();
      const geom = canvas._geom;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const frac = geom ? Math.min(1, Math.max(0, (x - geom.m.l) / (geom.w || 1))) : 0.5;
      zoom(ev.deltaY < 0 ? 0.72 : 1.35, frac);
    };
    canvas.addEventListener("wheel", alGirar, { passive: false });
    return () => canvas.removeEventListener("wheel", alGirar);
  });

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
    setTip({ x: geom.xDe(mejor), titulo: fechaCorta(p.t), lineas });
  }

  function descargar() {
    const canvas = ref.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = (archivo || "grafica") + ".png";
    a.click();
  }

  const [i0, i1] = win;
  const n = puntos.length;

  return (
    <div>
      <div className="leyenda">{titulo}</div>
      <div className="controles-graf">
        <label>
          <input type="checkbox" checked={etiquetas} onChange={e => setEtiquetas(e.target.checked)} />
          Etiquetas
        </label>
        <button className="secundario" type="button" onClick={() => zoom(0.72, 0.5)}>Zoom +</button>
        <button className="secundario" type="button" onClick={() => zoom(1.35, 0.5)}>Zoom −</button>
        <button className="secundario" type="button" onClick={() => fijar(0, Math.max(0, n - 1))}>Ver todo</button>
        <button className="secundario" type="button" onClick={descargar}>Descargar gráfica</button>
      </div>
      <div ref={caja} style={{ position: "relative" }}>
        <canvas ref={ref} className="lienzo" onMouseMove={mover} onMouseLeave={() => setTip(null)} />
        {tip && (
          <div style={{
            position: "absolute", left: Math.min(tip.x + 8, (caja.current?.clientWidth || 300) - 180), top: 28,
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
      {n > 1 && (
        <div className="rango-graf">
          <span>{fechaCorta(puntos[i0]?.t)}</span>
          <div className="barras">
            <input type="range" min={0} max={n - 1} value={i0} onChange={e => fijar(Number(e.target.value), i1)} aria-label="Desde en la gráfica" />
            <input type="range" min={0} max={n - 1} value={i1} onChange={e => fijar(i0, Number(e.target.value))} aria-label="Hasta en la gráfica" />
          </div>
          <span>{fechaCorta(puntos[i1]?.t)}</span>
        </div>
      )}
    </div>
  );
}
