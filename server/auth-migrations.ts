import type { DatabaseSync } from 'node:sqlite';
import type { BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';

/** Schema only. Startup never creates a person, password, session, or key. */
export async function migrateAuth(db: DatabaseSync, options: BetterAuthOptions): Promise<void> {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const migration = await getMigrations(options);
  if (migration.schemaProblems.length || migration.unsafeChanges.length) throw new Error('AUTH_SCHEMA_INCOMPATIBLE');
  await migration.runMigrations();
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS gither_single_owner ON "user" (role) WHERE role = 'owner';
    CREATE TRIGGER IF NOT EXISTS gither_immutable_role BEFORE UPDATE OF role ON "user"
      WHEN NEW.role IS NOT OLD.role BEGIN SELECT RAISE(ABORT, 'Role changes require an offline migration'); END;
    CREATE TABLE IF NOT EXISTS gither_owner_bootstrap (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE RESTRICT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gither_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      audience TEXT NOT NULL CHECK(audience IN ('api', 'mcp')),
      prefix TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
      scopes_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER,
      CHECK(expires_at > created_at)
    );
    CREATE INDEX IF NOT EXISTS gither_keys_owner ON gither_keys(user_id, created_at);
    CREATE TABLE IF NOT EXISTS gither_login_limits (
      bucket TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      attempts INTEGER NOT NULL
    );
  `);
}
