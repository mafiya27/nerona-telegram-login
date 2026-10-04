// GET or POST /api/config — remote config for the extension.
// Auth: { "session": "<session token>" } in body (POST) or ?session= (GET).
// Returns every row of remote_config as { key: value }. Lets you push gateway
// rules, feature flags and announcements without republishing the extension.
const { json } = require("./_lib");
const { db } = require("./_db");
const { checkSession, parseBody, cors } = require("./_auth");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, reason: "method_not_allowed" });
  }

  const q = req.query || {};
  const body = req.method === "POST" ? parseBody(req) : {};
  const session = body.session || q.session;
  const hwid = body.hwid || q.hwid;

  const chk = await checkSession(session, hwid);
  if (!chk.ok) return json(res, 200, { ok: false, reason: chk.reason });

  const client = db();
  let config = {};
  if (client) {
    const { data } = await client.from("remote_config").select("key, value");
    for (const row of data || []) config[row.key] = row.value;
  }
  return json(res, 200, { ok: true, config, server_time: Date.now() });
};
