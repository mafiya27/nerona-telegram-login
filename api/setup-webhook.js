// GET https://<your-app>.vercel.app/api/setup-webhook?secret=<SETUP_SECRET>
// One-time setup: registers the Telegram webhook. Protect with SETUP_SECRET env var.
const { BOT_TOKEN, tgApi, json } = require("./_lib");

module.exports = async (req, res) => {
  const secret = process.env.SETUP_SECRET || "";
  if (!secret || req.query.secret !== secret) {
    return json(res, 403, { ok: false, reason: "forbidden" });
  }
  if (!BOT_TOKEN) return json(res, 500, { ok: false, reason: "server_not_configured" });

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const webhookUrl = "https://" + host + "/api/telegram-webhook";

  const out = await tgApi("setWebhook", {
    url: webhookUrl,
    drop_pending_updates: true,
    allowed_updates: ["message"],
  });
  return json(res, 200, { ok: out.httpOk && out.data.ok, webhookUrl, telegram: out.data });
};
