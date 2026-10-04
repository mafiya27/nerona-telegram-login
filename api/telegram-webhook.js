// POST https://<your-app>.vercel.app/api/telegram-webhook
// Set this URL as the Telegram webhook (see /api/setup-webhook).
// Handles /start and /login from users, issues a signed session token
// which the user pastes into the extension.
const { BOT_TOKEN, createToken, isAllowed, tgApi, json } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { ok: false, reason: "method_not_allowed" });
  if (!BOT_TOKEN) return json(res, 500, { ok: false, reason: "server_not_configured" });

  // Optional shared secret so only Telegram (which knows nothing of it) —
  // actually Telegram can't send secrets; we rely on the token path being unguessable.
  // The bot token itself in the URL path is the real protection; keep the webhook URL private.

  const update = req.body || {};
  const msg = update.message;
  if (!msg || !msg.from) return json(res, 200, { ok: true }); // ignore non-messages

  const chatId = msg.chat.id;
  const from = msg.from;
  const text = String(msg.text || "").trim();

  const isLoginCmd =
    text === "/start" || text.startsWith("/start ") || text === "/login" || text.startsWith("/login ");

  try {
    if (isLoginCmd) {
      if (!isAllowed(from.id)) {
        await tgApi("sendMessage", {
          chat_id: chatId,
          text: "⛔ You are not authorized to use NERONA FE!N.\nAsk the admin to allowlist your Telegram ID: `" + from.id + "`",
          parse_mode: "Markdown",
        });
        return json(res, 200, { ok: true });
      }
      const token = createToken({
        id: from.id,
        first_name: from.first_name,
        username: from.username,
      });
      const days = Math.round(parseInt(process.env.TOKEN_TTL_SECONDS || "2592000", 10) / 86400);
      await tgApi("sendMessage", {
        chat_id: chatId,
        text:
          "✅ *NERONA FE!N login approved*\n\n" +
          "Hi " + (from.first_name || "there") + "! Copy the token below and paste it into the extension's login screen:\n\n" +
          "`" + token + "`\n\n" +
          "⏳ Valid for " + days + " days. Keep it private — it logs in as you.",
        parse_mode: "Markdown",
      });
    } else {
      // Gentle hint for any other message
      await tgApi("sendMessage", {
        chat_id: chatId,
        text: "👋 Send /login to get your NERONA FE!N access token.",
      });
    }
  } catch (e) {
    // Never fail the webhook hard; Telegram will retry otherwise.
    console.error("webhook error:", e && e.message);
  }
  return json(res, 200, { ok: true });
};
