-- 10-29 0.2.0: native app sign-in (Google ID token or emailed code) -> app session (only SHA-256 of tokens/codes stored)
CREATE TABLE IF NOT EXISTS caf_app_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, method TEXT NOT NULL, created_at INTEGER NOT NULL, last_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS caf_app_sessions_email ON caf_app_sessions(email);
CREATE TABLE IF NOT EXISTS caf_app_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0);
