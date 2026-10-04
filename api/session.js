// POST /api/session — heartbeat / status check.
// Body: { "session": "<session token>", "hwid": "<hardware id>" }
// Returns license state; the extension should call this on startup and periodically.
const { json } = require("./_lib");
const { checkSession, parseBody, cors } = require("./_auth");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (req.method !== "POST") return json(res, 405, { ok: false, reason: "method_not_allowed" });

  const body = parseBody(req);
  const result = await checkSession(body.session, body.hwid);
  if (!result.ok) return json(res, 200, { ok: false, reason: result.reason });

  return json(res, 200, {
    ok: true,
    legacy: !!result.legacy,
    license: result.license,
    user: { id: result.payload.uid },
  });
};
