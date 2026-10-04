// /api/admin/proxies — manage the proxy pool. Header: X-Admin-Secret.
// POST   { "proxies": ["host:port", "user:pass@host:port", "socks5://host:port:user:pass"], "protocol"? }
//        Adds proxies (status "testing" until the health checker runs).
// GET    ?status=active&country=US&limit=100 — list pool entries.
// DELETE { "host": "...", "port": 8080 } — remove one entry.
const { json } = require("../_lib");
const { db } = require("../_db");
const { requireAdmin, parseBody, cors } = require("../_auth");

function parseProxyLine(line) {
  line = String(line || "").trim();
  if (!line || line.startsWith("#")) return null;
  let protocol = "http";
  const protoMatch = line.match(/^(https?|socks4|socks5):\/\//i);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    line = line.slice(protoMatch[0].length);
  }
  // [user:pass@]host:port   or   host:port:user:pass
  let auth = null;
  const atIdx = line.lastIndexOf("@");
  if (atIdx !== -1) {
    auth = line.slice(0, atIdx);
    line = line.slice(atIdx + 1);
  }
  const parts = line.split(":");
  let host, port;
  if (!auth && parts.length === 4) {
    // host:port:user:pass
    host = parts[0].trim();
    port = parseInt(parts[1], 10);
    auth = parts[2] + ":" + parts[3];
  } else if (parts.length === 2) {
    host = parts[0].trim();
    port = parseInt(parts[1], 10);
  } else {
    return null;
  }
  if (!host || !(port > 0 && port < 65536)) return null;
  let username = null, password_enc = null;
  if (auth) {
    const cIdx = auth.indexOf(":");
    username = (cIdx === -1 ? auth : auth.slice(0, cIdx)).slice(0, 128) || null;
    // NOTE: stored as provided; protect via private repo + service_role-only DB.
    password_enc = (cIdx === -1 ? "" : auth.slice(cIdx + 1)).slice(0, 256) || null;
  }
  return { host, port, protocol, username, password_enc, status: "testing" };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (!requireAdmin(req)) return json(res, 403, { ok: false, reason: "forbidden" });
  const client = db();
  if (!client) return json(res, 200, { ok: false, reason: "db_not_configured" });

  if (req.method === "GET") {
    const q = req.query || {};
    let query = client.from("proxies").select("host, port, protocol, country, status, latency_ms, last_checked, created_at");
    if (q.status) query = query.eq("status", String(q.status));
    if (q.country) query = query.eq("country", String(q.country).toUpperCase().slice(0, 8));
    query = query.order("latency_ms", { ascending: true, nullsFirst: false })
                 .limit(Math.min(parseInt(q.limit || "100", 10) || 100, 500));
    const { data, error } = await query;
    if (error) return json(res, 200, { ok: false, reason: "query_failed" });
    return json(res, 200, { ok: true, proxies: data });
  }

  if (req.method === "POST") {
    const body = parseBody(req);
    const lines = Array.isArray(body.proxies) ? body.proxies : [];
    const rows = [];
    for (const line of lines.slice(0, 500)) {
      const p = parseProxyLine(line);
      if (p) {
        if (body.protocol && ["http", "https", "socks4", "socks5"].includes(body.protocol)) p.protocol = body.protocol;
        rows.push(p);
      }
    }
    if (!rows.length) return json(res, 200, { ok: false, reason: "no_valid_proxies" });
    const { error } = await client.from("proxies").upsert(rows, { onConflict: "host,port", ignoreDuplicates: false });
    if (error) return json(res, 200, { ok: false, reason: "upsert_failed", detail: error.message });
    return json(res, 200, { ok: true, added: rows.length });
  }

  if (req.method === "DELETE") {
    const body = parseBody(req);
    const host = String(body.host || "").trim();
    const port = parseInt(body.port, 10);
    if (!host || !(port > 0)) return json(res, 200, { ok: false, reason: "bad_selector" });
    const { error } = await client.from("proxies").delete().eq("host", host).eq("port", port);
    if (error) return json(res, 200, { ok: false, reason: "delete_failed" });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { ok: false, reason: "method_not_allowed" });
};
