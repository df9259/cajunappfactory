-- Schema snapshot of D1 stopscope-dispatch (structure only, no rows), from stopscope-web migrations, 2026-10-23
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  pw_hash TEXT, pw_salt TEXT, pw_iter INTEGER,
  google_sub TEXT UNIQUE,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL
, sign_in_count INTEGER NOT NULL DEFAULT 0, pro_comp INTEGER DEFAULT 0);
CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, stripe_customer_id TEXT, stripe_subscription_id TEXT, stripe_seat_item_id TEXT, billing_status TEXT NOT NULL DEFAULT 'none', billing_interval TEXT, current_period_end INTEGER, past_due_since INTEGER, trial_used INTEGER NOT NULL DEFAULT 0, seats_billed INTEGER, collection_method TEXT NOT NULL DEFAULT 'charge_automatically', free_license INTEGER NOT NULL DEFAULT 0, billing_ended_at INTEGER, stripe_event_at INTEGER);
CREATE TABLE memberships (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','dispatcher','driver')),
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'web' CHECK (kind IN ('web','app')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
, app_user_id TEXT, admin_scope INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER);
CREATE TABLE rate_counters (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE drivers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active')),
  created_at INTEGER NOT NULL,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL
, account_deleted_at INTEGER, invite_sent_at INTEGER);
CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);
CREATE TABLE routes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  route_date TEXT,
  driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
  start_address TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','assigned','in_progress','completed')),
  allow_driver_changes INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, start_lat REAL, start_lng REAL, start_geo_addr TEXT, path_polyline TEXT, path_meters INTEGER, path_seconds INTEGER, path_sig TEXT, end_mode TEXT NOT NULL DEFAULT 'last' CHECK (end_mode IN ('last','start')), started_at INTEGER, finished_at INTEGER, opt_hash TEXT, driven_client_m INTEGER, driven_meters INTEGER, driven_src TEXT, track_polyline TEXT, track_points INTEGER, track_saved_at INTEGER, odo_unit TEXT, odo_start REAL, odo_start_at INTEGER, odo_start_photo TEXT, odo_end REAL, odo_end_at INTEGER, odo_end_photo TEXT);
CREATE TABLE route_stops (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  address TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  lat REAL, lng REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped'))
, geo_status TEXT, status_at INTEGER, status_lat REAL, status_lng REAL, status_note TEXT, status_driver_id TEXT, signer_name TEXT, unsigned_reason TEXT);
CREATE TABLE stop_items (
  id TEXT PRIMARY KEY,
  stop_id TEXT NOT NULL REFERENCES route_stops(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE api_usage (day TEXT NOT NULL, scope TEXT NOT NULL, api TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope, api));
CREATE TABLE app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  google_sub TEXT UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_sign_in_at INTEGER NOT NULL
, web_user_id TEXT, tutorial_version INTEGER, last_seen_at INTEGER, sign_in_count INTEGER NOT NULL DEFAULT 0, pro_comp INTEGER DEFAULT 0, app_version TEXT, app_version_code INTEGER, app_version_at INTEGER);
CREATE TABLE app_sessions (
  token_hash TEXT PRIMARY KEY,
  app_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
, family_created_at INTEGER);
CREATE TABLE delete_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('app','web')),
  subject_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE deleted_companies (
  id TEXT PRIMARY KEY,
  name TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  billing_status TEXT,
  free_license INTEGER,
  deleted_at INTEGER NOT NULL
);
CREATE TABLE route_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  driver_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  acc REAL, speed REAL, heading REAL,
  received_at INTEGER NOT NULL
);
CREATE TABLE stop_proofs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id TEXT NOT NULL REFERENCES route_stops(id) ON DELETE CASCADE,
  driver_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('photo','signature')),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  taken_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (stop_id, client_id)
);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_email TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE user_usage (day TEXT NOT NULL, kind TEXT NOT NULL, user_id TEXT NOT NULL, api TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, user_id, api));
CREATE TABLE driver_invites (
  token_hash TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE invite_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new','existing')),
  sent INTEGER NOT NULL,
  by_user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE license_grants (
  email TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  claimed_company_id TEXT,
  claimed_at INTEGER
, welcome_sent_at INTEGER);
CREATE TABLE app_handoffs (
  code_hash TEXT PRIMARY KEY,
  app_user_id TEXT NOT NULL,
  web_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
, admin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE app_admin_keys (
  id TEXT PRIMARY KEY,
  app_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  public_key TEXT NOT NULL,          -- base64url SPKI DER (EC P-256)
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE app_admin_nonces (
  nonce_hash TEXT PRIMARY KEY,
  key_id TEXT NOT NULL REFERENCES app_admin_keys(id) ON DELETE CASCADE,
  app_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE auth_nonces (
  nonce_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE export_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'route' | 'reports'
  target TEXT,                 -- route id, or "from..to driver"
  created_at INTEGER NOT NULL
);
CREATE INDEX memberships_company ON memberships(company_id);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX drivers_company ON drivers(company_id);
CREATE UNIQUE INDEX companies_stripe_customer ON companies(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX routes_company ON routes(company_id, route_date);
CREATE INDEX route_stops_route ON route_stops(route_id, position);
CREATE INDEX stop_items_stop ON stop_items(stop_id, position);
CREATE INDEX app_sessions_user ON app_sessions(app_user_id);
CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);
CREATE INDEX delete_tokens_subject ON delete_tokens(kind, subject_id);
CREATE INDEX route_points_route ON route_points(route_id, t);
CREATE INDEX route_points_received ON route_points(received_at);
CREATE INDEX stop_proofs_stop ON stop_proofs(stop_id);
CREATE INDEX stop_proofs_company ON stop_proofs(company_id, created_at);
CREATE INDEX admin_audit_time ON admin_audit(created_at);
CREATE INDEX driver_invites_driver ON driver_invites(driver_id);
CREATE INDEX invite_log_driver ON invite_log(driver_id, created_at);
CREATE INDEX app_handoffs_exp ON app_handoffs(expires_at);
CREATE INDEX sessions_app_user ON sessions(app_user_id) WHERE app_user_id IS NOT NULL;
CREATE UNIQUE INDEX route_points_unique ON route_points(route_id, driver_id, t, lat, lng);
CREATE INDEX app_admin_keys_user ON app_admin_keys(app_user_id, revoked_at);
CREATE INDEX app_admin_nonces_exp ON app_admin_nonces(expires_at);
CREATE INDEX auth_nonces_exp ON auth_nonces(expires_at);
CREATE INDEX export_log_company ON export_log(company_id, created_at);
-- 10-23 (Dominic): anonymous daily feature counts from the app (counts only, no addresses/locations). Kept 90 days (src/prune.js).
CREATE TABLE IF NOT EXISTS feature_counters (
  day TEXT NOT NULL,            -- UTC YYYY-MM-DD the phone counted on
  app_user_id TEXT NOT NULL,
  counter TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, app_user_id, counter)
);
CREATE INDEX IF NOT EXISTS feature_counters_day ON feature_counters(day, counter);
-- 10-23 (Dominic): Google Play Real-time Developer Notifications (POST /api/play/rtdn, src/rtdn.js). Kept 365 days (src/prune.js).
-- verified=1 when the state came from purchases.subscriptionsv2.get; 0 = raw notification only (no Play credential on the Worker).
CREATE TABLE IF NOT EXISTS subscription_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,     -- Pub/Sub messageId (redelivery is idempotent)
  received_at INTEGER NOT NULL,
  event_time INTEGER,                  -- eventTimeMillis from Play
  kind TEXT NOT NULL,                  -- 'subscription' | 'test' | 'other'
  notification_type INTEGER,           -- SubscriptionNotification.notificationType
  package_name TEXT,
  subscription_id TEXT,
  purchase_token TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  state TEXT,                          -- subscriptionsv2 subscriptionState (verified only)
  in_trial INTEGER,                    -- 1/0 when verified and known, NULL otherwise
  expiry_time INTEGER,
  raw TEXT NOT NULL                    -- decoded notification JSON (no personal data: Play sends only token + ids)
);
CREATE INDEX IF NOT EXISTS subscription_events_time ON subscription_events(received_at);
CREATE INDEX IF NOT EXISTS subscription_events_token ON subscription_events(purchase_token, received_at);
-- 10-29 invites: admins besides the owner, and their single-use invite links (only SHA-256 of the token is stored)
CREATE TABLE IF NOT EXISTS caf_admins (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'admin', added_by TEXT, added_at INTEGER NOT NULL, removed_at INTEGER);
CREATE TABLE IF NOT EXISTS caf_invites (id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'admin', invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS caf_invites_email ON caf_invites(email);
