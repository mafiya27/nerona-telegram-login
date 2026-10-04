# NERONA FE!N — License Server (Vercel + Supabase)

Telegram login + full license server for the NERONA FE!N Chrome extension.
v2.0 adds: Supabase-backed licenses, HWID binding, revocable sessions,
remote config, server-side hit logging, and an admin API — all on free tiers.

## How it works

1. User opens the extension → login screen → clicks "Open Telegram Bot"
2. User sends `/login` to your bot → bot replies with a signed login token
3. User pastes the token into the extension → extension calls `/api/activate`
   with the token + its hardware ID
4. Server finds (or auto-provisions a trial for) the Telegram user's license,
   binds it to the HWID, and returns a **session token**
5. Extension uses the session for heartbeats (`/api/session`), remote config
   (`/api/config`) and hit reporting (`/api/hits`)

Without Supabase configured, the server runs in legacy mode (token check only,
like v1).

## Setup

### 1. Create the bot
1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot`
2. Save the **bot token** and **bot username**

### 2. Deploy to Vercel
1. Push this folder to a GitHub repo (or use `vercel` CLI: `vercel` inside this folder)
2. In Vercel dashboard → your project → **Settings → Environment Variables**, add:
   - `TELEGRAM_BOT_TOKEN` = your bot token (required)
   - `ALLOWED_IDS` = comma-separated Telegram user IDs allowed to log in (optional; empty = anyone)
     - Find your ID via [@userinfobot](https://t.me/userinfobot)
   - `TOKEN_TTL_SECONDS` = `2592000` (optional, 30 days)
   - `SETUP_SECRET` = a long random string (required for webhook setup)
3. Redeploy so the env vars apply

### 3. Register the webhook (one time)
Open in your browser:
```
https://<your-app>.vercel.app/api/setup-webhook?secret=<SETUP_SECRET>
```
You should see `{"ok":true,...}`. The bot will now receive messages.

### 4. Supabase license database (v2)
Full step-by-step: **SETUP-SUPABASE.md**. Short version:
1. Create a free project at supabase.com → run `supabase/schema.sql` in the SQL Editor
2. Copy Project URL + `service_role` key from Project Settings → API
3. Vercel → Environment Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
   `ADMIN_SECRET` (invent a long random string), `AUTO_PROVISION=true`,
   `TRIAL_DAYS=7`, `TELEGRAM_NOTIFY_CHAT_ID` (optional)
4. Redeploy

## API reference

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/telegram-webhook` | POST | Telegram | updates receiver (do not call manually) |
| `/api/verify` | POST | login token | legacy token check → `{ok, user}` |
| `/api/activate` | POST | login token + hwid | provision/bind license → session token |
| `/api/session` | POST | session + hwid | heartbeat / license status |
| `/api/config` | GET/POST | session | remote config JSON |
| `/api/hits` | POST | session | store hit (BIN+last4 only), server Telegram alert |
| `/api/setup-webhook` | GET `?secret=` | setup secret | one-time webhook registration |
| `/api/admin/license` | POST | `X-Admin-Secret` | create license |
| `/api/admin/revoke` | POST | `X-Admin-Secret` | active/suspended/revoked (+kills sessions) |
| `/api/admin/reset-hwid` | POST | `X-Admin-Secret` | clear HWID binding |
| `/api/admin/licenses` | GET | `X-Admin-Secret` | list licenses |

## Revoking access
- `POST /api/admin/revoke {"tg_id":"...","status":"revoked"}` → license dead,
  all live sessions killed immediately (enforced on next heartbeat)
- `POST /api/admin/reset-hwid` → user can activate on a new machine
- Remove a user ID from `ALLOWED_IDS` and redeploy → their login token stops verifying
- Change `TELEGRAM_BOT_TOKEN` (via @BotFather `/revoke`) → **all** tokens invalidate instantly

## Privacy notes
- Full card numbers are **never** stored: `/api/hits` truncates to BIN (first 6)
  + last 4 before insert, even if the client sends the full number.
- The Supabase `service_role` key lives only in Vercel env vars — never in the repo,
  never in the extension.
