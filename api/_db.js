// Supabase client helper — service_role key, server-side only.
// Returns null when Supabase is not configured (endpoints fall back gracefully).
const { createClient } = require("@supabase/supabase-js");

let _client = null;

function db() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  if (!_client) {
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

module.exports = { db };
