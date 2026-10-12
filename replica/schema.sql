-- Keepsake record schema v3: proposed local store for the Apple apps (iOS, iPadOS, macOS).
-- SQLite via GRDB, shared by the app and its share extension through an App Group container.
-- PROPOSAL for review at gate 1. Not a migration in any shipped code.
--
-- Conventions
--   ids        TEXT, client-generated (existing Keepsake ids are kept verbatim on import)
--   times      TEXT ISO-8601 UTC ("2026-10-11T09:30:00.000Z"), same as the extension today
--   money      price_minor INTEGER (minor units) + currency TEXT; NULL when unknown
--   deletion   soft: deleted_at set, purged from the trash after 30 days; sync carries the tombstone
--   ownership  single user per device library; no user_id column (CloudKit private DB scopes by iCloud account)
--   access     no server; access control is the OS sandbox plus the App Group. Nothing is network-exposed.

PRAGMA foreign_keys = ON;

CREATE TABLE collection (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description   TEXT NOT NULL DEFAULT '',
  keywords      TEXT NOT NULL DEFAULT '[]',   -- JSON array of lowercase strings (<= 40)
  aliases       TEXT NOT NULL DEFAULT '[]',   -- JSON array (<= 20)
  taxonomy_key  TEXT,                          -- default taxonomy entry this collection came from
  color         TEXT NOT NULL DEFAULT '#8A9A88',
  cover_media   TEXT REFERENCES media(id) ON DELETE SET NULL,
  cover_url     TEXT,                          -- user-chosen remote cover
  pinned        INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  sort_order    REAL NOT NULL DEFAULT 0,       -- fractional so reorders touch one row (sync-friendly)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX collection_live ON collection (deleted_at, pinned, sort_order);

CREATE TABLE item (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL DEFAULT 'link'
                     CHECK (kind IN ('product','place','recipe','video','article','workout','book','media','idea','image','link')),
  title              TEXT NOT NULL,             -- what the user sees and edits
  original_title     TEXT NOT NULL DEFAULT '',  -- as captured; never overwritten by AI or edits
  note               TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  -- source: always persisted first, before any enrichment
  url                TEXT,                      -- the page the user is pointed back to
  source_url         TEXT,                      -- exactly what was captured (share-sheet URL, tab URL)
  canonical_url      TEXT,
  url_key            TEXT,                      -- normalizeUrl(): duplicate detection key (tracking params removed)
  host               TEXT NOT NULL DEFAULT '',
  source_app         TEXT NOT NULL DEFAULT '',  -- 'chrome', 'safari', 'instagram', 'tiktok', 'import:instagram', …
  captured_via       TEXT NOT NULL DEFAULT ''   -- 'toolbar','context-menu','floating','share-extension','import',…
                     CHECK (captured_via IN ('','toolbar','context-menu','floating','tabs-import','share-extension','in-app','import','sample')),
  -- product fields (kept on the row: products are first-class and filtered/sorted by price)
  price_minor        INTEGER CHECK (price_minor IS NULL OR price_minor >= 0),
  currency           TEXT NOT NULL DEFAULT '',
  retailer           TEXT NOT NULL DEFAULT '',
  -- kind-specific details as JSON validated by the shared schema (place: address, lat, lng, hours;
  -- recipe: ingredients[], steps[], yield, total_time; video: creator, duration;
  -- workout: exercises[{name, sets, reps, duration, rest}], focus, equipment;
  -- media (film or show): title, year, format; book: author, isbn. Lists only: no tracking fields.)
  details            TEXT NOT NULL DEFAULT '{}',
  -- organisation
  collection_id      TEXT REFERENCES collection(id) ON DELETE SET NULL,  -- NULL = waiting in Review
  status             TEXT NOT NULL DEFAULT 'saved'
                     CHECK (status IN ('saved','todo','done')),           -- done = bought/visited/cooked/watched/read
  favorite           INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  purchased          INTEGER NOT NULL DEFAULT 0 CHECK (purchased IN (0,1)),  -- kept: existing Purchased view
  archived           INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  -- classification (confidence-aware; manual always wins)
  confidence         REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  classified_by      TEXT NOT NULL DEFAULT 'local' CHECK (classified_by IN ('local','ai','manual','import','sample')),
  classify_reason    TEXT NOT NULL DEFAULT '',
  suggested          TEXT NOT NULL DEFAULT '[]', -- JSON [{collectionId, confidence}] shown in Review
  needs_review       INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0,1)),
  -- capture lifecycle: an item is usable the moment it exists; enrichment only adds
  capture_state      TEXT NOT NULL DEFAULT 'complete'
                     CHECK (capture_state IN ('pending','complete','failed')),
  capture_error      TEXT NOT NULL DEFAULT '',
  -- provenance blobs kept from 1.x (instagram{…}, ai{…}) as JSON, read-only for new code
  legacy             TEXT NOT NULL DEFAULT '{}',
  related_item_id    TEXT REFERENCES item(id) ON DELETE SET NULL,
  -- which fields the user set by hand: enrichment and AI never overwrite these (JSON array of field names)
  user_fields        TEXT NOT NULL DEFAULT '[]',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
-- Not unique: 1.x lets the user "Save another copy" of a page. Duplicate detection is a lookup, not a constraint.
CREATE INDEX item_url_key_live ON item (url_key) WHERE url_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX item_collection ON item (collection_id, deleted_at, created_at);
CREATE INDEX item_review ON item (needs_review, deleted_at) WHERE needs_review = 1;
CREATE INDEX item_kind ON item (kind, deleted_at, created_at);
CREATE INDEX item_created ON item (deleted_at, created_at);
CREATE INDEX item_pending ON item (capture_state) WHERE capture_state = 'pending';

-- Images: thumbnails stored as files in the App Group container (never inside rows).
CREATE TABLE media (
  id           TEXT PRIMARY KEY,
  item_id      TEXT REFERENCES item(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'cover' CHECK (role IN ('cover','candidate','user-photo','screenshot')),
  remote_url   TEXT,            -- where it came from (may expire, e.g. Instagram CDN)
  local_path   TEXT,            -- relative path inside the container; NULL if not downloaded
  bytes        INTEGER,
  width        INTEGER,
  height       INTEGER,
  sha256       TEXT,
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX media_item ON media (item_id, role);

-- Full-text search over what a person remembers about a save.
CREATE VIRTUAL TABLE item_fts USING fts5(
  title, note, description, retailer, host, details_text, collection_name,
  content='', tokenize='unicode61 remove_diacritics 2'
);
-- item_fts is maintained by the data layer on every item write (rowid mapped through item_search_map).
CREATE TABLE item_search_map (rowid INTEGER PRIMARY KEY, item_id TEXT NOT NULL UNIQUE REFERENCES item(id) ON DELETE CASCADE);

-- Learned sorting habits (syncable): one row per term/retailer per collection, so two devices
-- learning at once add up instead of overwriting a single blob.
CREATE TABLE learned_weight (
  scope          TEXT NOT NULL CHECK (scope IN ('term','retailer')),
  key            TEXT NOT NULL,
  collection_id  TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  weight         REAL NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (scope, key, collection_id)
);

-- Change log for AI and bulk changes, with per-entry undo (syncable so undo works from either device).
CREATE TABLE change_log (
  id          TEXT PRIMARY KEY,
  run_id      TEXT,
  item_id     TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('ai','bulk','import','enrichment')),
  changes     TEXT NOT NULL,     -- JSON [{field, before, after}]
  reason      TEXT NOT NULL DEFAULT '',
  undone      INTEGER NOT NULL DEFAULT 0 CHECK (undone IN (0,1)),
  at          TEXT NOT NULL
);
CREATE INDEX change_log_item ON change_log (item_id, at);

-- Workout goals (owner decision 2026-10-11). Local, no AI by default; syncable.
CREATE TABLE goal (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,   -- the saved workout
  kind        TEXT NOT NULL CHECK (kind IN ('frequency','target')),  -- "3x a week for 4 weeks" | "reach 3x12 push-ups"
  spec        TEXT NOT NULL,      -- JSON: {perWeek, weeks} or {exercise, sets, reps|duration}
  starts_on   TEXT NOT NULL,
  ends_on     TEXT,
  source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai-suggested')),  -- AI only on request, user accepts
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE TABLE goal_checkin (       -- add-only, so two devices never conflict
  id          TEXT PRIMARY KEY,
  goal_id     TEXT NOT NULL REFERENCES goal(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  result      TEXT NOT NULL DEFAULT '{}'   -- JSON: {sets, reps, duration, note}
);
CREATE INDEX goal_checkin_goal ON goal_checkin (goal_id, at);

-- Price readings: add-only (from the iOS plan); deferred to a later milestone.
CREATE TABLE price_reading (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency    TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('json-ld','meta'))  -- visible-text guesses are never tracked
);
CREATE INDEX price_reading_item ON price_reading (item_id, at);

-- Sync bookkeeping (CKSyncEngine state, per-record change tags). Device-local, never exported.
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value BLOB NOT NULL);
CREATE TABLE record_meta (
  record_type  TEXT NOT NULL,
  record_id    TEXT NOT NULL,
  system_fields BLOB,              -- archived CKRecord system fields (change tag)
  dirty        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (record_type, record_id)
);

-- Device-local, never synced and never exported: settings, permissions state, AI key (in Keychain, not here).
CREATE TABLE device_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
