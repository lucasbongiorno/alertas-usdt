export const DEFAULTS = {
  minimo: 0.5,
  volumen: 500,
  feeRed: 1,
  otros: 0,
  pausa: false,
  desvioMax: 3,
  cooldownMin: 30,
  staleMin: 15,
};

const num = (x) => (typeof x === "number" ? x : parseFloat(x));

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function cleanQuotes(data, cfg, nowMs = Date.now()) {
  const all = [];
  const discarded = [];
  for (const [name, q] of Object.entries(data || {})) {
    if (!q || typeof q !== "object") continue;
    const buy = num(q.totalAsk ?? q.ask);
    const sell = num(q.totalBid ?? q.bid);
    if (!(buy > 0) || !(sell > 0)) { discarded.push({ name, reason: "sin precio" }); continue; }
    let t = num(q.time);
    if (t) {
      if (t < 1e12) t *= 1000;
      if (nowMs - t > cfg.staleMin * 60000) { discarded.push({ name, reason: "cotización vieja" }); continue; }
    }
    all.push({ name, buy, sell });
  }
  if (all.length < 3) return { kept: all, discarded };
  const mb = median(all.map((x) => x.buy));
  const ms = median(all.map((x) => x.sell));
  const kept = [];
  for (const x of all) {
    const dB = Math.abs(x.buy / mb - 1) * 100;
    const dS = Math.abs(x.sell / ms - 1) * 100;
    if (dB > cfg.desvioMax || dS > cfg.desvioMax) discarded.push({ name: x.name, reason: "precio fuera de rango (posible anuncio no real)" });
    else kept.push(x);
  }
  return { kept, discarded };
}

export function marginFor(buyPrice, sellPrice, cfg) {
  const vol = cfg.volumen;
  const capital = vol * buyPrice;
  const llegan = Math.max(vol - cfg.feeRed, 0);
  const net = llegan * sellPrice - capital - capital * (cfg.otros / 100);
  return { capital, net, margin: (net / capital) * 100 };
}

export function bestPair(kept, cfg) {
  let best = null;
  for (const b of kept) for (const s of kept) {
    if (b.name === s.name) continue;
    const m = marginFor(b.buy, s.sell, cfg);
    if (!best || m.margin > best.margin) best = { buy: b, sell: s, ...m };
  }
  return best;
}

const ars = (n, d = 0) => "$" + n.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";

export function alertText(best, cfg) {
  return [
    "🔔 Posible oportunidad USDT/ARS",
    `Comprar en: ${best.buy.name} a ${ars(best.buy.buy, 2)}`,
    `Vender en: ${best.sell.name} a ${ars(best.sell.sell, 2)}`,
    `Margen neto: ${pct(best.margin)} (≈ ${ars(best.net)} sobre ${ars(best.capital)})`,
    `Calculado con ${cfg.volumen} USDT y fee de red de ${cfg.feeRed} USDT.`,
    "",
    "⚠️ Verificá en la app límites, stock, medios de pago y reputación antes de operar. Probá con monto mínimo.",
  ].join("\n");
}

export function statusText(best, kept, discarded, cfg) {
  const lines = [];
  if (!best) {
    lines.push("No hay suficientes cotizaciones válidas para comparar ahora.");
  } else {
    const ok = best.margin >= cfg.minimo;
    lines.push(ok ? "✅ CONVIENE (según tus parámetros)" : "⛔ NO CONVIENE hoy");
    lines.push(`Mejor par: comprar en ${best.buy.name} (${ars(best.buy.buy, 2)}) y vender en ${best.sell.name} (${ars(best.sell.sell, 2)})`);
    lines.push(`Margen neto: ${pct(best.margin)} · tu mínimo: ${pct(cfg.minimo)}`);
  }
  if (kept.length) {
    const cheapest = kept.reduce((a, b) => (b.buy < a.buy ? b : a));
    const richest = kept.reduce((a, b) => (b.sell > a.sell ? b : a));
    lines.push(`Compra más barata: ${cheapest.name} ${ars(cheapest.buy, 2)} · Venta más alta: ${richest.name} ${ars(richest.sell, 2)}`);
  }
  if (discarded.length) lines.push(`Descartadas: ${discarded.map((d) => `${d.name} (${d.reason})`).join(", ")}`);
  lines.push(`Parámetros: ${cfg.volumen} USDT · fee red ${cfg.feeRed} USDT · otros ${pct(cfg.otros)}${cfg.pausa ? " · alertas en PAUSA" : ""}`);
  return lines.join("\n");
}
