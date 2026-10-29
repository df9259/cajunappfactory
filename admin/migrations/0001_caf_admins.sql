-- 10-29 invites: admins besides the owner, and their single-use invite links (only SHA-256 of the token is stored)
CREATE TABLE IF NOT EXISTS caf_admins (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'admin', added_by TEXT, added_at INTEGER NOT NULL, removed_at INTEGER);
CREATE TABLE IF NOT EXISTS caf_invites (id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'admin', invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS caf_invites_email ON caf_invites(email);
