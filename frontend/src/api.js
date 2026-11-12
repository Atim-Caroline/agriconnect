const B = "/api/v1";
const msg = d => !d ? "Something went wrong." : d.detail || Object.entries(d).map(([k, v]) => `${k}: ${[].concat(v).join(" ")}`).join(" · ");
const raw = (path, o = {}) => {
  const h = { "Content-Type": "application/json" }, t = localStorage.getItem("ac_a"); if (t) h.Authorization = "Bearer " + t;
  return fetch(B + path, { method: o.method || "GET", headers: h, body: o.body ? JSON.stringify(o.body) : undefined });
};
export async function api(path, o) {
  let r = await raw(path, o);
  if (r.status === 401 && localStorage.getItem("ac_r")) {
    const rr = await fetch(B + "/auth/token/refresh/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: localStorage.getItem("ac_r") }) });
    if (rr.ok) { localStorage.setItem("ac_a", (await rr.json()).access); r = await raw(path, o); } else localStorage.clear();
  }
  const d = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(msg(d));
  return d;
}
export const setTokens = d => { localStorage.setItem("ac_a", d.access); localStorage.setItem("ac_r", d.refresh); };
export const clearTokens = () => localStorage.clear();
