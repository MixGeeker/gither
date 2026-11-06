import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const AUTH_SCOPES = [
  'catalog:read', 'pool:read', 'pool:write', 'candidates:read',
  'candidates:write', 'profile:read', 'collection:claim',
] as const;
export type AuthScope = typeof AUTH_SCOPES[number];
export type KeyAudience = 'api' | 'mcp';
export const MAX_ACTIVE_KEYS = 20;
export const MAX_KEY_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export interface CreateKeyInput {
  name: string;
  audience: KeyAudience;
  scopes: AuthScope[];
  expiresAt: string;
}
export interface KeyMetadata {
  id: string;
  name: string;
  audience: KeyAudience;
  prefix: string;
  scopes: AuthScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
export interface KeyPrincipal {
  id: string;
  keyId: string;
  userId: string;
  role: 'owner';
  audience: KeyAudience;
  scopes: AuthScope[];
}
type KeyRow = {
  id: string; user_id: string; name: string; audience: KeyAudience; prefix: string;
  token_hash: string; scopes_json: string; created_at: number; expires_at: number;
  last_used_at: number | null; revoked_at: number | null;
};
function scopesFrom(value: unknown): AuthScope[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > AUTH_SCOPES.length ||
      value.some(s => typeof s !== 'string' || !AUTH_SCOPES.includes(s as AuthScope)) ||
      new Set(value).size !== value.length) return null;
  return [...value].sort() as AuthScope[];
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (value: number | null): string | null => value === null ? null : new Date(value).toISOString();
function metadata(row: KeyRow): KeyMetadata {
  return {
    id: row.id, name: row.name, audience: row.audience, prefix: row.prefix,
    scopes: JSON.parse(row.scopes_json) as AuthScope[],
    createdAt: iso(row.created_at)!, expiresAt: iso(row.expires_at)!,
    lastUsedAt: iso(row.last_used_at), revokedAt: iso(row.revoked_at),
  };
}

export function createKeyStore(db: DatabaseSync) {
  function requireOwner(userId: string): void {
    if (typeof userId !== 'string' || !db.prepare('SELECT id FROM "user" WHERE id = ? AND role = ?').get(userId, 'owner')) {
      throw new Error('OWNER_SESSION_REQUIRED');
    }
  }
  // These management functions are trusted application APIs, never HTTP
  // credentials. Callers MUST obtain userId from a validated browser session.
  async function createKey(userId: string, input: CreateKeyInput): Promise<KeyMetadata & { key: string }> {
    requireOwner(userId);
    const now = Date.now();
    const scopes = scopesFrom(input?.scopes);
    const expires = typeof input?.expiresAt === 'string' ? Date.parse(input.expiresAt) : NaN;
    if (!input || typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.trim().length > 80 ||
        /[\u0000-\u001f\u007f]/.test(input.name) || !['api', 'mcp'].includes(input.audience) || !scopes ||
        !Number.isFinite(expires) || expires <= now || expires > now + MAX_KEY_LIFETIME_MS ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.expiresAt)) {
      throw new Error('INVALID_KEY_INPUT');
    }
    const id = randomBytes(16).toString('base64url');
    const prefix = `gthr_${input.audience}_${id}`;
    const key = `${prefix}.${randomBytes(32).toString('base64url')}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      requireOwner(userId);
      const active = db.prepare('SELECT count(*) AS count FROM gither_keys WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?').get(userId, now) as { count: number };
      if (active.count >= MAX_ACTIVE_KEYS) throw new Error('ACTIVE_KEY_LIMIT_REACHED');
      db.prepare(`INSERT INTO gither_keys (id,user_id,name,audience,prefix,token_hash,scopes_json,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, userId, input.name.trim(), input.audience, prefix, digest(key), JSON.stringify(scopes), now, expires);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const row = db.prepare('SELECT * FROM gither_keys WHERE id = ?').get(id) as KeyRow;
    return { ...metadata(row), key };
  }
  async function listKeys(userId: string): Promise<KeyMetadata[]> {
    requireOwner(userId);
    return (db.prepare('SELECT * FROM gither_keys WHERE user_id = ? ORDER BY created_at DESC, id').all(userId) as KeyRow[]).map(metadata);
  }
  async function revokeKey(userId: string, keyId: string): Promise<boolean> {
    requireOwner(userId);
    if (typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(keyId)) return false;
    return db.prepare('UPDATE gither_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND user_id = ?').run(Date.now(), keyId, userId).changes > 0;
  }
  async function verifyKey(request: Request, audience: KeyAudience, requiredScopes: readonly string[]): Promise<KeyPrincipal | null> {
    if (!['api', 'mcp'].includes(audience) || !Array.isArray(requiredScopes) ||
        requiredScopes.some(scope => !AUTH_SCOPES.includes(scope as AuthScope))) return null;
    const header = request.headers.get('authorization');
    const match = header?.match(/^Bearer (gthr_(api|mcp)_([A-Za-z0-9_-]{22})\.[A-Za-z0-9_-]{43})$/);
    if (!match || match[2] !== audience) return null;
    const row = db.prepare(`SELECT k.* FROM gither_keys k JOIN "user" u ON u.id = k.user_id
      WHERE k.id = ? AND u.role = 'owner'`).get(match[3]!) as KeyRow | undefined;
    const now = Date.now();
    if (!row || row.audience !== audience || row.revoked_at !== null || row.expires_at <= now ||
        !/^[a-f0-9]{64}$/.test(row.token_hash) ||
        !timingSafeEqual(Buffer.from(digest(match[1]!), 'hex'), Buffer.from(row.token_hash, 'hex'))) return null;
    let scopes: AuthScope[] | null;
    try { scopes = scopesFrom(JSON.parse(row.scopes_json)); } catch { return null; }
    if (!scopes || requiredScopes.some(scope => !scopes.includes(scope as AuthScope))) return null;
    db.prepare('UPDATE gither_keys SET last_used_at = ? WHERE id = ?').run(now, row.id);
    return { id: row.user_id, userId: row.user_id, keyId: row.id, role: 'owner', audience, scopes };
  }
  return { createKey, listKeys, revokeKey, verifyKey };
}
