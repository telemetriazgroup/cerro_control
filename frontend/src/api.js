export function ruta(url) {
  const base = import.meta.env.BASE_URL || "/cerroprieto/";
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith(base)) return url;
  return base.replace(/\/$/, "") + url;
}

export async function jget(url) {
  const respuesta = await fetch(ruta(url));
  if (respuesta.status === 401) {
    location.href = "/cerroprieto/login";
    throw new Error("hay que iniciar sesión");
  }
  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(data.detalle || "no se pudo completar");
  return data;
}

export async function jpost(url, cuerpo) {
  const respuesta = await fetch(ruta(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo ?? {}),
  });
  if (respuesta.status === 401) {
    location.href = "/cerroprieto/login";
    throw new Error("hay que iniciar sesión");
  }
  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(data.detalle || "no se pudo completar");
  return data;
}

export function esAdmin(rol) {
  return rol === "administrador";
}

export function nombreRol(rol) {
  return rol === "administrador" ? "Superadmin" : "Monitor";
}

export function num(valor) {
  if (valor == null || Number.isNaN(Number(valor))) return null;
  return Number(valor);
}

export function textoNum(valor, decimales = 1) {
  const n = num(valor);
  if (n == null) return "—";
  return n.toFixed(decimales);
}

export function flecha(tendencia) {
  if (tendencia === "sube") return "↑";
  if (tendencia === "baja") return "↓";
  return "";
}
