// POST /api/admin/proxy-health — bulk upsert of proxy check results.
// Header: X-Admin-Secret. Called by the GitHub Actions health checker.
// Body: { "results": [ {host, port, protocol?, status, latency_ms?, country?, ip?} ] }
// status: "active" | "dead". Upserts on (host, port).
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
  const results = Array.isArray(body.results) ? body.results : [];
  if (!results.length) return json(res, 200, { ok: false, reason: "empty_results" });
  if (results.length > 500) return json(res, 200, { ok: false, reason: "too_many" });

  const now = new Date().toISOString();
  const rows = [];
  for (const r of results) {
    const host = String(r.host || "").trim().slice(0, 255);
    const port = parseInt(r.port, 10);
    if (!host || !(port > 0 && port < 65536)) continue;
    const status = r.status === "active" ? "active" : "dead";
    rows.push({
      host,
      port,
      protocol: ["http", "https", "socks4", "socks5"].includes(r.protocol) ? r.protocol : "http",
      status,
      latency_ms: r.latency_ms != null ? Math.max(0, parseInt(r.latency_ms, 10) || 0) : null,
      country: String(r.country || "").slice(0, 8).toUpperCase() || null,
      last_checked: now,
    });
  }
  if (!rows.length) return json(res, 200, { ok: false, reason: "no_valid_rows" });

  const { error } = await client.from("proxies").upsert(rows, { onConflict: "host,port" });
  if (error) return json(res, 200, { ok: false, reason: "upsert_failed", detail: error.message });
  return json(res, 200, { ok: true, updated: rows.length, checked_at: now });
};
