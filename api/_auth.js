// Session + admin helpers for the NERONA license server.
// Session tokens are stateless HMAC tokens like the login tokens, but carry a
// `jti` so each session can be revoked server-side via the sessions table.
const crypto = require("crypto");
const { BOT_TOKEN, b64urlEncode, b64urlDecode, sign } = require("./_lib");
const { db } = require("./_db");

const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_SECONDS || "2592000", 10); // 30 days

function createSessionToken({ uid, jti, hwid, ttlSeconds }) {
  const payload = {
    uid: String(uid),
    jti: String(jti),
    hwid: String(hwid || ""),
    exp: Math.floor(Date.now() / 1000) + (ttlSeconds || SESSION_TTL_SECONDS),
  };
  const body = b64urlEncode(JSON.stringify(payload));
  return body + "." + sign(body);
}

function verifySessionToken(token) {
  if (!BOT_TOKEN) return { ok: false, reason: "server_not_configured" };
  if (!token || typeof token !== "string") return { ok: false, reason: "missing_token" };
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { ok: false, reason: "bad_format" };
  const [body, sig] = parts;
  const expected = sign(body);
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
  if (!payload.uid || !payload.jti || !payload.exp) return { ok: false, reason: "bad_payload" };
  if (Math.floor(Date.now() / 1000) > payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

// Full session check: token signature + DB row (revocation, expiry) + license state.
// Returns { ok:true, session, license } or { ok:false, reason }.
async function checkSession(token, hwid) {
  const t = verifySessionToken(token);
  if (!t.ok) return t;
  const p = t.payload;
  if (hwid && p.hwid && String(hwid) !== String(p.hwid)) {
    return { ok: false, reason: "hwid_mismatch" };
  }
  const client = db();
  if (!client) {
    // No database configured — trust the signed token alone (legacy mode).
    return { ok: true, payload: p, license: null, legacy: true };
  }
  const { data: sess, error } = await client
    .from("sessions")
    .select("id, license_id, hwid, expires_at, revoked, licenses(id, key, tg_id, tg_username, plan, status, expires_at)")
    .eq("jti", p.jti)
    .maybeSingle();
  if (error || !sess) return { ok: false, reason: "unknown_session" };
  if (sess.revoked) return { ok: false, reason: "session_revoked" };
  if (new Date(sess.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (hwid && sess.hwid && String(hwid) !== String(sess.hwid)) {
    return { ok: false, reason: "hwid_mismatch" };
  }
  const lic = sess.licenses;
  if (!lic) return { ok: false, reason: "no_license" };
  if (lic.status !== "active") return { ok: false, reason: "license_" + lic.status };
  if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "license_expired" };
  }
  // heartbeat
  await client.from("sessions").update({ last_seen: new Date().toISOString() }).eq("id", sess.id);
  return {
    ok: true,
    payload: p,
    session: sess,
    license: {
      key: lic.key,
      plan: lic.plan,
      status: lic.status,
      expires_at: lic.expires_at,
      tg_id: lic.tg_id,
      tg_username: lic.tg_username,
    },
  };
}

function requireAdmin(req) {
  const secret = process.env.ADMIN_SECRET || "";
  if (!secret) return false;
  const got = req.headers["x-admin-secret"] || req.headers["X-Admin-Secret"] || "";
  if (!got) return false;
  const a = Buffer.from(String(got), "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  return body && typeof body === "object" ? body : {};
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Secret");
}

function makeLicenseKey() {
  const part = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return "NERONA-" + part() + "-" + part();
}

module.exports = {
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  checkSession,
  requireAdmin,
  parseBody,
  cors,
  makeLicenseKey,
};
