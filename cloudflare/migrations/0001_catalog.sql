-- Candidates and observed metadata are private until a reviewer approves one
-- exact revision. Public reads use only these append-only publication snapshots.
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  repository TEXT NOT NULL UNIQUE COLLATE NOCASE,
  project_json TEXT NOT NULL CHECK (json_valid(project_json)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  source_urls_json TEXT NOT NULL CHECK (json_valid(source_urls_json)),
  provenance TEXT NOT NULL CHECK (provenance IN ('seed', 'github', 'synthetic')),
  fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'published', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  repository TEXT NOT NULL,
  project_json TEXT NOT NULL CHECK (json_valid(project_json)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  source_urls_json TEXT NOT NULL CHECK (json_valid(source_urls_json)),
  provenance TEXT NOT NULL CHECK (provenance IN ('seed', 'github', 'synthetic')),
  published_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, revision)
);

CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  decision TEXT NOT NULL CHECK (decision IN ('publish', 'reject')),
  note TEXT NOT NULL CHECK (length(note) <= 2000),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  UNIQUE (candidate_id, revision)
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  provenance TEXT NOT NULL CHECK (provenance IN ('github', 'synthetic')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  checked INTEGER NOT NULL CHECK (checked BETWEEN 0 AND 3),
  changed INTEGER NOT NULL CHECK (changed BETWEEN 0 AND checked),
  failed INTEGER NOT NULL CHECK (failed BETWEEN 0 AND checked),
  CHECK (changed + failed <= checked)
);

-- Reserved for a future authenticated human UI. No application path writes
-- this table. Collector observations, seed fixtures, and review audits are not
-- user feedback and must never be inserted here.
CREATE TABLE IF NOT EXISTS human_feedback (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  actor_kind TEXT NOT NULL CHECK (actor_kind = 'human'),
  provenance TEXT NOT NULL CHECK (provenance = 'human_ui'),
  feedback TEXT NOT NULL CHECK (length(feedback) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS candidates_review_queue
  ON candidates (status, updated_at, id);
CREATE INDEX IF NOT EXISTS publications_latest
  ON publications (candidate_id, revision DESC);

CREATE TRIGGER IF NOT EXISTS publications_no_update
BEFORE UPDATE ON publications BEGIN
  SELECT RAISE(ABORT, 'Published snapshots are immutable');
END;
CREATE TRIGGER IF NOT EXISTS publications_no_delete
BEFORE DELETE ON publications BEGIN
  SELECT RAISE(ABORT, 'Published snapshots are immutable');
END;
CREATE TRIGGER IF NOT EXISTS review_events_no_update
BEFORE UPDATE ON review_events BEGIN
  SELECT RAISE(ABORT, 'Review events are append-only');
END;
CREATE TRIGGER IF NOT EXISTS review_events_no_delete
BEFORE DELETE ON review_events BEGIN
  SELECT RAISE(ABORT, 'Review events are append-only');
END;
