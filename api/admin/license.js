// POST /api/admin/license — create a license. Header: X-Admin-Secret.
// Body: { "tg_id"?, "tg_username"?, "plan" ("trial"|"monthly"|"lifetime"), "days"? }
const { json } = require("../_lib");
const { db } = require("../_db");
const { requireAdmin, parseBody, cors, makeLicenseKey } = require("../_auth");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (!requireAdmin(req)) return json(res, 403, { ok: false, reason: "forbidden" });
  if (req.method !== "POST") return json(res, 405, { ok: false, reason: "method_not_allowed" });
  const client = db();
  if (!client) return json(res, 200, { ok: false, reason: "db_not_configured" });

  const body = parseBody(req);
  const plan = ["trial", "monthly", "lifetime"].includes(body.plan) ? body.plan : "monthly";
  const days = parseInt(body.days || (plan === "lifetime" ? 36500 : plan === "trial" ? 7 : 30), 10);
  const { data, error } = await client.from("licenses").insert({
    key: makeLicenseKey(),
    tg_id: body.tg_id ? String(body.tg_id) : null,
    tg_username: body.tg_username ? String(body.tg_username).slice(0, 64) : null,
    plan,
    status: "active",
    expires_at: new Date(Date.now() + days * 86400000).toISOString(),
    notes: body.notes ? String(body.notes).slice(0, 255) : null,
  }).select("*").single();
  if (error) return json(res, 200, { ok: false, reason: "create_failed", detail: error.message });
  return json(res, 200, { ok: true, license: data });
};
