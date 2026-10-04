-- NERONA FE!N license server schema — run in Supabase SQL Editor.
-- Tables are accessed ONLY via the service_role key from Vercel (never from the client),
-- so Row Level Security is intentionally left off.

-- ── Licenses ──────────────────────────────────────────────────────────────
create table if not exists licenses (
  id               uuid primary key default gen_random_uuid(),
  key              text unique not null,            -- e.g. NERONA-A1B2-C3D4
  tg_id            text,
  tg_username      text,
  plan             text not null default 'trial',   -- trial | monthly | lifetime
  status           text not null default 'active',  -- active | suspended | revoked
  hwid             text,                            -- bound hardware id
  hwid_locked_at   timestamptz,
  hwid_changes     int  not null default 0,
  max_hwid_changes int  not null default 1,
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  notes            text
);
create index if not exists idx_licenses_tg  on licenses (tg_id);
create index if not exists idx_licenses_key on licenses (key);

-- ── Sessions (revocable login sessions) ────────────────────────────────────
create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  jti        text unique not null,                 -- session id inside the token
  license_id uuid references licenses (id) on delete cascade,
  hwid       text not null,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked    boolean not null default false
);
create index if not exists idx_sessions_jti     on sessions (jti);
create index if not exists idx_sessions_license on sessions (license_id);

-- ── Remote config (pushed to the extension, no republish needed) ──────────
create table if not exists remote_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into remote_config (key, value) values
  ('gateway_rules_version', '"1.0.0"'),
  ('features', '{"stealth": true, "proxy_rotation": true, "auto_3ds": true, "hit_notifications": true}'),
  ('announcement', '{"enabled": false, "text": ""}'),
  ('min_extension_version', '"2.0.0"')
on conflict (key) do nothing;

-- ── Hits (BIN + last4 ONLY — full card numbers are never stored) ──────────
create table if not exists hits (
  id         uuid primary key default gen_random_uuid(),
  license_id uuid references licenses (id) on delete set null,
  tg_id      text,
  site       text,
  card_bin   text,          -- first 6 digits
  card_last4 text,          -- last 4 digits
  amount     text,
  currency   text,
  response   text,
  gateway    text,
  country    text,
  created_at timestamptz not null default now()
);
create index if not exists idx_hits_license on hits (license_id);
create index if not exists idx_hits_created on hits (created_at desc);

-- ── Proxy pool (populated by the GitHub Actions health checker) ───────────
create table if not exists proxies (
  id           uuid primary key default gen_random_uuid(),
  host         text not null,
  port         int  not null,
  protocol     text not null default 'http',   -- http | https | socks4 | socks5
  username     text,
  password_enc text,                            -- app-level encrypted, see API code
  country      text,
  status       text not null default 'testing', -- active | dead | testing
  latency_ms   int,
  last_checked timestamptz,
  created_at   timestamptz not null default now(),
  unique (host, port)
);
create index if not exists idx_proxies_status  on proxies (status);
create index if not exists idx_proxies_country on proxies (country);
