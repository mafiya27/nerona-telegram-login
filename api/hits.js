// POST /api/hits — record a hit server-side and notify via Telegram.
// Body: { "session": "<session token>", "hwid": "<hardware id>", "hit": {
//    site, card_number?, card_bin?, card_last4?, amount, currency,
//    response, gateway, country, screenshot? (data URL, optional) } }
//
// PRIVACY: full card numbers are NEVER stored. Only the first 6 (BIN) and
// last 4 digits are persisted; anything longer is truncated before insert.
// Telegram notifications are sent from the server (bot token stays in env).
const { json, tgApi } = require("./_lib");
const { db } = require("./_db");
const { checkSession, parseBody, cors } = require("./_auth");

const NOTIFY_CHAT_ID = process.env.TELEGRAM_NOTIFY_CHAT_ID || "";

function digits(s) { return String(s || "").replace(/\D/g, ""); }

function sanitizeHit(hit) {
  hit = hit || {};
  let bin = digits(hit.card_bin);
  let last4 = digits(hit.card_last4);
  const full = digits(hit.card_number || hit.card || "");
  if (full.length >= 10) {
    bin = full.slice(0, 6);
    last4 = full.slice(-4);
  }
  return {
    site: String(hit.site || "").slice(0, 255),
    card_bin: bin.slice(0, 6),
    card_last4: last4.slice(-4),
    amount: String(hit.amount || "").slice(0, 32),
    currency: String(hit.currency || "").slice(0, 8),
    response: String(hit.response || "").slice(0, 255),
    gateway: String(hit.gateway || "").slice(0, 64),
    country: String(hit.country || "").slice(0, 8),
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notify(hit) {
  if (!NOTIFY_CHAT_ID) return;
  const lines = [
    "✅ <b>HIT — Nerona</b>",
    "",
    hit.site ? "🌐 <b>Site:</b> <code>" + escapeHtml(hit.site) + "</code>" : null,
    hit.card_bin ? "🔢 <b>BIN:</b> <code>" + escapeHtml(hit.card_bin) + "</code>" : null,
    hit.card_last4 ? "💳 <b>Last4:</b> <code>•••• " + escapeHtml(hit.card_last4) + "</code>" : null,
    hit.amount ? "💰 <b>Amount:</b> <code>" + escapeHtml(hit.amount) + "</code>" : null,
    hit.response ? "🔖 <b>Status:</b> <code>" + escapeHtml(hit.response) + "</code>" : null,
    hit.gateway ? "🏦 <b>Gateway:</b> <code>" + escapeHtml(hit.gateway) + "</code>" : null,
    "",
    "🕐 <code>" + escapeHtml(new Date().toLocaleString()) + "</code>",
  ].filter(Boolean);
  try {
    await tgApi("sendMessage", {
      chat_id: NOTIFY_CHAT_ID,
      text: lines.join("\n"),
      parse_mode: "HTML",
    });
  } catch (e) { /* notification failure must not fail the hit */ }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (req.method !== "POST") return json(res, 405, { ok: false, reason: "method_not_allowed" });

  const body = parseBody(req);
  const chk = await checkSession(body.session, body.hwid);
  if (!chk.ok) return json(res, 200, { ok: false, reason: chk.reason });
  if (chk.legacy) return json(res, 200, { ok: false, reason: "db_not_configured" });

  const hit = sanitizeHit(body.hit);
  const client = db();
  const { error } = await client.from("hits").insert({
    license_id: chk.session.license_id,
    tg_id: chk.payload.uid,
    ...hit,
  });
  if (error) return json(res, 200, { ok: false, reason: "store_failed" });

  await notify(hit);
  return json(res, 200, { ok: true });
};
