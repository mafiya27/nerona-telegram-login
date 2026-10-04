// Shared helpers for the Nerona Telegram-login backend.
// Runs on Vercel serverless functions (Node.js runtime).
const crypto = require("crypto");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_IDS = (process.env.ALLOWED_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TOKEN_TTL_SECONDS = parseInt(process.env.TOKEN_TTL_SECONDS || "2592000", 10); // 30 days

function b64urlEncode(str) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(b64) {
  b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return Buffer.from(b64, "base64").toString("utf8");
}

function sign(payloadB64) {
  return crypto.createHmac("sha256", BOT_TOKEN).update(payloadB64).digest("hex");
}

// Create a signed session token for a Telegram user.
// Format: <b64url(payload)>.<hex hmac>  — stateless, no database needed.
function createToken({ id, first_name, username }) {
  const payload = {
    uid: String(id),
    fn: String(first_name || "").slice(0, 64),
    un: String(username || "").slice(0, 64),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  return body + "." + sign(body);
}

// Verify a token. Returns { ok, payload } or { ok:false, reason }.
function verifyToken(token) {
  if (!BOT_TOKEN) return { ok: false, reason: "server_not_configured" };
  if (!token || typeof token !== "string") return { ok: false, reason: "missing_token" };
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { ok: false, reason: "bad_format" };
  const [body, sig] = parts;
  const expected = sign(body);
  // constant-time compare
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body));
  } catch (e) {
    return { ok: false, reason: "bad_payload" };
  }
  if (!payload.uid || !payload.exp) return { ok: false, reason: "bad_payload" };
  if (Math.floor(Date.now() / 1000) > payload.exp) return { ok: false, reason: "expired" };
  if (ALLOWED_IDS.length && !ALLOWED_IDS.includes(String(payload.uid))) {
    return { ok: false, reason: "not_allowed" };
  }
  return { ok: true, payload };
}

function isAllowed(tgId) {
  if (!ALLOWED_IDS.length) return true; // open if no allowlist configured
  return ALLOWED_IDS.includes(String(tgId));
}

async function tgApi(method, params) {
  const res = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { httpOk: res.ok, data };
}

function json(res, status, obj) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

module.exports = {
  BOT_TOKEN,
  ALLOWED_IDS,
  TOKEN_TTL_SECONDS,
  b64urlEncode,
  b64urlDecode,
  sign,
  createToken,
  verifyToken,
  isAllowed,
  tgApi,
  json,
};
