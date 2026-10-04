// POST https://<your-app>.vercel.app/api/verify
// Body: { "token": "<session token>" }
// Returns { ok:true, user:{id, first_name, username, expires_at} } or { ok:false, reason }.
const { verifyToken, json } = require("./_lib");

module.exports = async (req, res) => {
  // CORS: the extension calls this directly
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204);
    return res.end();
  }
  if (req.method !== "POST") return json(res, 405, { ok: false, reason: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const result = verifyToken(body && body.token);
  if (!result.ok) return json(res, 200, { ok: false, reason: result.reason });

  const p = result.payload;
  return json(res, 200, {
    ok: true,
    user: {
      id: p.uid,
      first_name: p.fn || "",
      username: p.un || "",
      expires_at: p.exp * 1000,
    },
  });
};
