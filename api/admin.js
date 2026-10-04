// POST/GET /api/admin — consolidated admin router.
// Vercel Hobby allows max 12 serverless functions per deployment, so all
// admin endpoints live here, dispatched by ?action=. External paths are
// preserved via vercel.json rewrites, e.g.:
//   /api/admin/proxies  ->  /api/admin?action=proxies
// Header: X-Admin-Secret (required for every action).
//
// actions:
//   license      POST {tg_id?, tg_username?, plan?, days?, notes?} — create license
//   licenses     GET — list licenses (latest 100)
//   revoke       POST {key?|tg_id?, status} — active|suspended|revoked
//   reset-hwid   POST {key?|tg_id?} — clear HWID binding
//   proxies      GET ?status=&country=&limit= / POST {proxies:[...], protocol?} / DELETE {host, port}
//   proxy-health POST {results:[...]} — bulk upsert of checker results
const { json } = require("./_lib");
const { db } = require("./_db");
const { requireAdmin, parseBody, cors, makeLicenseKey } = require("./_auth");

// ── shared ────────────────────────────────────────────────────────────────
async function findLicense(client, body) {
  let q = client.from("licenses").select("id");
  if (body.key) q = q.eq("key", String(body.key));
  else if (body.tg_id) q = q.eq("tg_id", String(body.tg_id));
  else return null;
  const { data } = await q.maybeSingle();
  return data;
}

// ── license: create ───────────────────────────────────────────────────────
async function aLicense(client, body) {
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
  if (error) return { ok: false, reason: "create_failed", detail: error.message };
  return { ok: true, license: data };
}

// ── licenses: list ────────────────────────────────────────────────────────
async function aLicenses(client) {
  const { data, error } = await client
    .from("licenses")
    .select("key, tg_id, tg_username, plan, status, expires_at, hwid_changes, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, reason: "query_failed" };
  return { ok: true, licenses: data };
}

// ── revoke ────────────────────────────────────────────────────────────────
async function aRevoke(client, body) {
  const status = String(body.status || "");
  if (!["active", "suspended", "revoked"].includes(status)) {
    return { ok: false, reason: "bad_status" };
  }
  const lic = await findLicense(client, body);
  if (!lic) return { ok: false, reason: body.key || body.tg_id ? "not_found" : "missing_selector" };
  await client.from("licenses").update({ status }).eq("id", lic.id);
  if (status !== "active") {
    await client.from("sessions").update({ revoked: true }).eq("license_id", lic.id);
  }
  return { ok: true, status };
}

// ── reset-hwid ────────────────────────────────────────────────────────────
async function aResetHwid(client, body) {
  const lic = await findLicense(client, body);
  if (!lic) return { ok: false, reason: body.key || body.tg_id ? "not_found" : "missing_selector" };
  await client.from("licenses").update({ hwid: null, hwid_locked_at: null }).eq("id", lic.id);
  await client.from("sessions").update({ revoked: true }).eq("license_id", lic.id);
  return { ok: true };
}

// ── proxies ───────────────────────────────────────────────────────────────
function parseProxyLine(line) {
  line = String(line || "").trim();
  if (!line || line.startsWith("#")) return null;
  let protocol = "http";
  const protoMatch = line.match(/^(https?|socks4|socks5):\/\//i);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    line = line.slice(protoMatch[0].length);
  }
  let auth = null;
  const atIdx = line.lastIndexOf("@");
  if (atIdx !== -1) {
    auth = line.slice(0, atIdx);
    line = line.slice(atIdx + 1);
  }
  const parts = line.split(":");
  let host, port;
  if (!auth && parts.length === 4) {
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
    password_enc = (cIdx === -1 ? "" : auth.slice(cIdx + 1)).slice(0, 256) || null;
  }
  return { host, port, protocol, username, password_enc, status: "testing" };
}

async function aProxies(client, method, query, body) {
  if (method === "GET") {
    let q = client.from("proxies").select("host, port, protocol, country, status, latency_ms, last_checked, created_at");
    if (query.status) q = q.eq("status", String(query.status));
    if (query.country) q = q.eq("country", String(query.country).toUpperCase().slice(0, 8));
    q = q.order("latency_ms", { ascending: true, nullsFirst: false })
         .limit(Math.min(parseInt(query.limit || "100", 10) || 100, 500));
    const { data, error } = await q;
    if (error) return { ok: false, reason: "query_failed" };
    return { ok: true, proxies: data };
  }
  if (method === "POST") {
    const lines = Array.isArray(body.proxies) ? body.proxies : [];
    const rows = [];
    for (const line of lines.slice(0, 500)) {
      const p = parseProxyLine(line);
      if (p) {
        if (body.protocol && ["http", "https", "socks4", "socks5"].includes(body.protocol)) p.protocol = body.protocol;
        rows.push(p);
      }
    }
    if (!rows.length) return { ok: false, reason: "no_valid_proxies" };
    const { error } = await client.from("proxies").upsert(rows, { onConflict: "host,port", ignoreDuplicates: false });
    if (error) return { ok: false, reason: "upsert_failed", detail: error.message };
    return { ok: true, added: rows.length };
  }
  if (method === "DELETE") {
    const host = String(body.host || "").trim();
    const port = parseInt(body.port, 10);
    if (!host || !(port > 0)) return { ok: false, reason: "bad_selector" };
    const { error } = await client.from("proxies").delete().eq("host", host).eq("port", port);
    if (error) return { ok: false, reason: "delete_failed" };
    return { ok: true };
  }
  return { ok: false, reason: "method_not_allowed" };
}

// ── proxy-health ──────────────────────────────────────────────────────────
async function aProxyHealth(client, body) {
  const results = Array.isArray(body.results) ? body.results : [];
  if (!results.length) return { ok: false, reason: "empty_results" };
  if (results.length > 500) return { ok: false, reason: "too_many" };
  const now = new Date().toISOString();
  const rows = [];
  for (const r of results) {
    const host = String(r.host || "").trim().slice(0, 255);
    const port = parseInt(r.port, 10);
    if (!host || !(port > 0 && port < 65536)) continue;
    rows.push({
      host,
      port,
      protocol: ["http", "https", "socks4", "socks5"].includes(r.protocol) ? r.protocol : "http",
      status: r.status === "active" ? "active" : "dead",
      latency_ms: r.latency_ms != null ? Math.max(0, parseInt(r.latency_ms, 10) || 0) : null,
      country: String(r.country || "").slice(0, 8).toUpperCase() || null,
      last_checked: now,
    });
  }
  if (!rows.length) return { ok: false, reason: "no_valid_rows" };
  const { error } = await client.from("proxies").upsert(rows, { onConflict: "host,port" });
  if (error) return { ok: false, reason: "upsert_failed", detail: error.message };
  return { ok: true, updated: rows.length, checked_at: now };
}

// ── router ────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204); return res.end(); }
  if (!requireAdmin(req)) return json(res, 403, { ok: false, reason: "forbidden" });
  const client = db();
  if (!client) return json(res, 200, { ok: false, reason: "db_not_configured" });

  const action = String((req.query || {}).action || "");
  const body = req.method === "GET" ? {} : parseBody(req);
  const query = req.query || {};
  let out;
  try {
    switch (action) {
      case "license":      out = await aLicense(client, body); break;
      case "licenses":     out = await aLicenses(client); break;
      case "revoke":       out = await aRevoke(client, body); break;
      case "reset-hwid":   out = await aResetHwid(client, body); break;
      case "proxies":      out = await aProxies(client, req.method, query, body); break;
      case "proxy-health": out = await aProxyHealth(client, body); break;
      default:             out = { ok: false, reason: "unknown_action" };
    }
  } catch (e) {
    out = { ok: false, reason: "handler_error", detail: String((e && e.message) || e) };
  }
  return json(res, 200, out);
};
