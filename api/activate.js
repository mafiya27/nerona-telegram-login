// POST /api/activate
// Body: { "token": "<telegram login token>", "hwid": "<hardware id>" }
// Telegram user -> license lookup (or auto-provisioned trial) -> HWID bind -> session token.
//
// Reasons: bad_format | bad_signature | expired | not_allowed | no_license
//          license_suspended | license_revoked | license_expired | hwid_mismatch
//          server_not_configured
const crypto = require("crypto");
const { verifyToken, json } = require("./_lib");
const { db } = require("./_db");
const { createSessionToken, parseBody, cors, makeLicenseKey, SESSION_TTL_SECONDS } = require("./_auth");

const AUTO_PROVISION = (process.env.AUTO_PROVISION || "true").toLowerCase() === "true";
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || "7", 10);

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (req.method !== "POST") return json(res, 405, { ok: false, reason: "method_not_allowed" });

  const body = parseBody(req);
  const hwid = String(body.hwid || "").trim().slice(0, 128);
  if (!hwid) return json(res, 200, { ok: false, reason: "missing_hwid" });

  const t = verifyToken(body.token);
  if (!t.ok) return json(res, 200, { ok: false, reason: t.reason });
  const p = t.payload;

  const client = db();
  if (!client) {
    // Legacy mode: no database — behave like the old /api/verify but issue a session.
    const jti = crypto.randomBytes(16).toString("hex");
    return json(res, 200, {
      ok: true,
      legacy: true,
      session: createSessionToken({ uid: p.uid, jti, hwid }),
      user: { id: p.uid, first_name: p.fn || "", username: p.un || "" },
    });
  }

  // Find (or auto-provision) the license for this Telegram user.
  let { data: lic } = await client.from("licenses").select("*").eq("tg_id", p.uid).maybeSingle();

  if (!lic) {
    if (!AUTO_PROVISION) return json(res, 200, { ok: false, reason: "no_license" });
    const expires_at = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
    const { data: created, error } = await client.from("licenses").insert({
      key: makeLicenseKey(),
      tg_id: p.uid,
      tg_username: p.un || null,
      plan: "trial",
      status: "active",
      expires_at,
      notes: "auto-provisioned via /login",
    }).select("*").single();
    if (error || !created) return json(res, 200, { ok: false, reason: "provision_failed" });
    lic = created;
  }

  if (lic.status !== "active") return json(res, 200, { ok: false, reason: "license_" + lic.status });
  if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()) {
    return json(res, 200, { ok: false, reason: "license_expired" });
  }

  // HWID binding: first activation locks the license to this machine.
  if (!lic.hwid) {
    await client.from("licenses").update({
      hwid, hwid_locked_at: new Date().toISOString(),
    }).eq("id", lic.id);
  } else if (lic.hwid !== hwid) {
    const changes = lic.hwid_changes || 0;
    const maxChanges = lic.max_hwid_changes == null ? 1 : lic.max_hwid_changes;
    if (changes >= maxChanges) {
      return json(res, 200, { ok: false, reason: "hwid_mismatch" });
    }
    await client.from("licenses").update({
      hwid, hwid_locked_at: new Date().toISOString(),
      hwid_changes: changes + 1,
    }).eq("id", lic.id);
  }

  // Revoke older sessions for this license (single active session per license).
  await client.from("sessions").update({ revoked: true }).eq("license_id", lic.id);

  const jti = crypto.randomBytes(16).toString("hex");
  const sessionExp = Math.min(
    Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    lic.expires_at ? Math.floor(new Date(lic.expires_at).getTime() / 1000) : Infinity
  );
  const { error: sErr } = await client.from("sessions").insert({
    jti, license_id: lic.id, hwid,
    expires_at: new Date(sessionExp * 1000).toISOString(),
  });
  if (sErr) return json(res, 200, { ok: false, reason: "session_failed" });

  return json(res, 200, {
    ok: true,
    session: createSessionToken({ uid: p.uid, jti, hwid, ttlSeconds: sessionExp - Math.floor(Date.now() / 1000) }),
    license: {
      key: lic.key, plan: lic.plan, status: lic.status,
      expires_at: lic.expires_at, tg_username: lic.tg_username,
    },
  });
};
