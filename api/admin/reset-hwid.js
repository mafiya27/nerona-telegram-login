// POST /api/admin/reset-hwid — clear the HWID binding so the user can
// activate on a new machine. Header: X-Admin-Secret.
// Body: { "key"? | "tg_id"? }
const { json } = require("../_lib");
const { db } = require("../_db");
const { requireAdmin, parseBody, cors } = require("../_auth");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (!requireAdmin(req)) return json(res, 403, { ok: false, reason: "forbidden" });
  if (req.method !== "POST") return json(res, 405, { ok: false, reason: "method_not_allowed" });
  const client = db();
  if (!client) return json(res, 200, { ok: false, reason: "db_not_configured" });

  const body = parseBody(req);
  let q = client.from("licenses").select("id");
  if (body.key) q = q.eq("key", String(body.key));
  else if (body.tg_id) q = q.eq("tg_id", String(body.tg_id));
  else return json(res, 200, { ok: false, reason: "missing_selector" });

  const { data: lic } = await q.maybeSingle();
  if (!lic) return json(res, 200, { ok: false, reason: "not_found" });

  await client.from("licenses").update({ hwid: null, hwid_locked_at: null }).eq("id", lic.id);
  await client.from("sessions").update({ revoked: true }).eq("license_id", lic.id);
  return json(res, 200, { ok: true });
};
