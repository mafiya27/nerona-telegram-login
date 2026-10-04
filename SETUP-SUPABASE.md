# NERONA License Server — Supabase Setup (free tier)

Takes ~10 minutes. You do the clicking once; everything else is already built.

## 1. Create the Supabase project

1. Go to https://supabase.com/dashboard → **New project**
2. Name: `nerona-license` (any name works), pick a region near you, set a database password (save it somewhere)
3. Wait ~2 minutes for provisioning

## 2. Create the tables

1. In the Supabase dashboard open **SQL Editor** → **New query**
2. Paste the entire contents of `supabase/schema.sql` from this repo
3. Press **Run** — you should see "Success. No rows returned" (4 tables created + default config rows)

## 3. Get the API keys

1. **Project Settings** (gear icon) → **API**
2. Copy **Project URL** → this is `SUPABASE_URL`
3. Copy **service_role** key → this is `SUPABASE_SERVICE_KEY`
   (Use the service_role key, NOT the anon key — the backend needs full DB access.
   Never put this key in the extension or any client-side code.)

## 4. Add environment variables to Vercel

1. https://vercel.com → your `nerona-telegram-login` project → **Settings** → **Environment Variables**
2. Add (keep your existing TELEGRAM_BOT_TOKEN, ALLOWED_IDS, SETUP_SECRET):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Project URL from step 3 |
| `SUPABASE_SERVICE_KEY` | service_role key from step 3 |
| `ADMIN_SECRET` | a long random string you invent (used for admin API calls) |
| `AUTO_PROVISION` | `true` (auto-creates a 7-day trial on first login) |
| `TRIAL_DAYS` | `7` |
| `TELEGRAM_NOTIFY_CHAT_ID` | your channel/group ID for server-side hit alerts (optional, empty = off) |

3. **Deployments** → redeploy the latest (or push to GitHub if connected — Vercel rebuilds automatically)

## 5. Verify it works

```bash
# 1. create a license for yourself (replace ADMIN_SECRET)
curl -X POST https://nerona-telegram-login.vercel.app/api/admin/license \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"tg_id":"YOUR_TELEGRAM_ID","plan":"lifetime"}'

# 2. list licenses
curl https://nerona-telegram-login.vercel.app/api/admin/licenses \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET"

# 3. revoke / suspend
curl -X POST https://nerona-telegram-login.vercel.app/api/admin/revoke \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"tg_id":"SOME_ID","status":"revoked"}'

# 4. let a user move to a new PC (clears HWID binding)
curl -X POST https://nerona-telegram-login.vercel.app/api/admin/reset-hwid \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"tg_id":"SOME_ID"}'
```

## 6. Keep Supabase awake (free-tier pause)

Supabase pauses projects after ~7 days of inactivity, which would break logins.
Add this to the GitHub Actions proxy-health workflow (phase 3) or any cron:

```bash
curl -s https://nerona-telegram-login.vercel.app/api/config?session=dummy > /dev/null
```

Any request wakes it; a ping every 6 hours is plenty.

## 7. Extension integration (next step)

The extension needs two small changes (I will wire these in once the server is live):

```js
// HWID: generate once, persist in chrome.storage.local
async function getHwid() {
  let { Nerona_hwid } = await chrome.storage.local.get('Nerona_hwid');
  if (!Nerona_hwid) {
    Nerona_hwid = crypto.randomUUID();
    await chrome.storage.local.set({ Nerona_hwid });
  }
  return Nerona_hwid;
}

// Login flow: /login → token → POST /api/activate { token, hwid }
// → { ok, session, license } — store `session`, use it for:
//   POST /api/session  { session, hwid }   — heartbeat on startup
//   GET  /api/config?session=...          — remote config
//   POST /api/hits { session, hwid, hit } — server-side hit logging
```

## API reference

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/verify` | POST | login token | legacy token check (unchanged) |
| `/api/activate` | POST | login token + hwid | provision/bind license → session token |
| `/api/session` | POST | session + hwid | heartbeat / license status |
| `/api/config` | GET/POST | session | remote config JSON |
| `/api/hits` | POST | session | store hit (BIN+last4 only), server Telegram alert |
| `/api/admin/license` | POST | admin secret | create license |
| `/api/admin/revoke` | POST | admin secret | active/suspended/revoked (+kills sessions) |
| `/api/admin/reset-hwid` | POST | admin secret | clear HWID binding |
| `/api/admin/licenses` | GET | admin secret | list licenses |

## Privacy notes

- Full card numbers are **never** stored: `/api/hits` truncates to BIN (first 6)
  + last 4 before insert, even if the client sends the full number.
- The Supabase `service_role` key lives only in Vercel env vars — never in the repo,
  never in the extension.
- Hit screenshots are not stored server-side in this version (only the Telegram
  alert path can carry them, and only if you enable it).
