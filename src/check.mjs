import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULTS, cleanQuotes, bestPair, alertText, statusText } from "../lib/logic.mjs";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const modo = process.env.MODO || "alerta";
const configPath = process.env.CONFIG_FILE || new URL("../config.json", import.meta.url).pathname;
const statePath = process.env.STATE_FILE || ".state/last.json";

if (!token || !chatId) {
  console.error("Faltan los secrets TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID.");
  process.exit(1);
}

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram respondió ${res.status}`);
}

function loadState() {
  try { return existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null; } catch { return null; }
}
function saveState(s) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(s));
}

async function main() {
  const cfg = { ...DEFAULTS, ...JSON.parse(readFileSync(configPath, "utf8")) };
  if (cfg.pausa && modo !== "estado") { console.log("Alertas en pausa (config.json)."); return; }

  const res = await fetch(`https://criptoya.com/api/USDT/ARS/${cfg.volumen}`, { headers: { accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`CriptoYa respondió ${res.status}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("CriptoYa devolvió una respuesta inesperada: " + text.slice(0, 80)); }

  const { kept, discarded } = cleanQuotes(data, cfg);
  const best = bestPair(kept, cfg);

  if (modo === "estado") { await send(statusText(best, kept, discarded, cfg)); return; }
  if (!best || best.margin < cfg.minimo) { console.log("Sin margen suficiente:", best ? best.margin.toFixed(2) + "%" : "sin datos"); return; }

  const key = `${best.buy.name}>${best.sell.name}`;
  const last = loadState();
  const now = Date.now();
  const repetida = last && last.key === key && now - last.ts < cfg.cooldownMin * 60000 && best.margin < last.margin + 0.3;
  if (repetida) { console.log("Alerta repetida, no se reenvía."); return; }

  await send(alertText(best, cfg));
  saveState({ key, ts: now, margin: best.margin });
  console.log("Alerta enviada:", key, best.margin.toFixed(2) + "%");
}

main().catch(async (err) => {
  console.error("Error:", err.message);
  if (modo === "estado") { try { await send("Hubo un error consultando los precios: " + err.message); } catch {} }
});
