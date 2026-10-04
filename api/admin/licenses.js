// GET /api/admin/licenses — list licenses (latest 100). Header: X-Admin-Secret.
const { json } = require("../_lib");
const { db } = require("../_db");
const { requireAdmin, cors } = require("../_auth");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (!requireAdmin(req)) return json(res, 403, { ok: false, reason: "forbidden" });
  if (req.method !== "GET") return json(res, 405, { ok: false, reason: "method_not_allowed" });
  const client = db();
  if (!client) return json(res, 200, { ok: false, reason: "db_not_configured" });

  const { data, error } = await client
    .from("licenses")
    .select("key, tg_id, tg_username, plan, status, expires_at, hwid_changes, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return json(res, 200, { ok: false, reason: "query_failed" });
  return json(res, 200, { ok: true, licenses: data });
};
