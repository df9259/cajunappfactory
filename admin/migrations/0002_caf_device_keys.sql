-- 10-29 step 2: phone device keys (EC P-256, Android Keystore) and short unlock sessions (only SHA-256 of the cookie is stored)
CREATE TABLE IF NOT EXISTS caf_admin_keys (id TEXT PRIMARY KEY, email TEXT NOT NULL, device_id TEXT NOT NULL, label TEXT, public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS caf_admin_keys_email ON caf_admin_keys(email);
CREATE TABLE IF NOT EXISTS caf_nonces (nonce TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS caf_unlocks (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, key_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_at INTEGER NOT NULL);
