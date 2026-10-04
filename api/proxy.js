// GET /api/proxy — fetch one working proxy from the pool for the extension.
// Auth: ?session=<session token>&hwid=<hwid>&country=US (country optional).
// Returns the lowest-latency active proxy for the country (or any country).
// Credentials are included — the session token protects this endpoint.
const { json } = require("./_lib");
const { db } = require("./_db");
const { checkSession, cors } = require("./_auth");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (req.method !== "GET") return json(res, 405, { ok: false, reason: "method_not_allowed" });

  const q = req.query || {};
  const chk = await checkSession(q.session, q.hwid);
  if (!chk.ok) return json(res, 200, { ok: false, reason: chk.reason });
  if (chk.legacy) return json(res, 200, { ok: false, reason: "db_not_configured" });

  const client = db();
  const country = String(q.country || "").toUpperCase().slice(0, 8) || null;

  // Prefer a fresh, low-latency proxy for the requested country; fall back
  // to any country rather than returning nothing.
  // NOTE: the GitHub health checker may mark IP-whitelisted proxies "dead"
  // even though they work from the user's own IP — so when no proxy is
  // marked active, fall back to any pooled proxy and let the extension's
  // own connect test be the final judge.
  async function pick(c, onlyActive) {
    let query = client
      .from("proxies")
      .select("host, port, protocol, username, password_enc, country, latency_ms");
    if (onlyActive) query = query.eq("status", "active");
    if (c) query = query.eq("country", c);
    const { data } = await query.order("latency_ms", { ascending: true, nullsFirst: false }).limit(25);
    if (!data || !data.length) return null;
    // Random among the 25 fastest so load spreads across the pool.
    return data[Math.floor(Math.random() * data.length)];
  }

  let proxy = await pick(country, true);
  if (!proxy && country) proxy = await pick(null, true);
  if (!proxy) proxy = await pick(country, false);
  if (!proxy && country) proxy = await pick(null, false);
  if (!proxy) return json(res, 200, { ok: false, reason: "pool_empty" });

  return json(res, 200, {
    ok: true,
    proxy: {
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol,
      username: proxy.username,
      password: proxy.password_enc,
      country: proxy.country,
      latency_ms: proxy.latency_ms,
    },
  });
};
