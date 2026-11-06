import type {Project} from '../src/data';
import type {Candidate, CandidateInput, PublishedProject, RepositoryMetadata} from './contracts';

interface CandidateRow {
  id:string;
  repository:string;
  project_json:string;
  metadata_json:string;
  source_urls_json:string;
  provenance:CandidateInput['provenance'];
  revision:number;
  status:Candidate['status'];
  updated_at:string;
}

interface PublicationRow extends Omit<CandidateRow, 'id'|'status'|'updated_at'> {
  candidate_id:string;
  published_at:string;
}

const CANDIDATE_COLUMNS = 'id, repository, project_json, metadata_json, source_urls_json, provenance, revision, status, updated_at';
const PUBLICATION_COLUMNS = 'p.candidate_id, p.repository, p.project_json, p.metadata_json, p.source_urls_json, p.provenance, p.revision, p.published_at';
const LATEST_PUBLICATION = `NOT EXISTS (
  SELECT 1 FROM publications newer
  WHERE newer.candidate_id = p.candidate_id AND newer.revision > p.revision
)`;

function boundedText(value:unknown, max:number, allowEmpty=false):string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new TypeError('Invalid candidate text');
  }
  const result = value.trim();
  if (!allowEmpty && result.length === 0) throw new TypeError('Empty candidate text');
  return result;
}

function textArray(value:unknown, count:number, size:number):string[] {
  if (!Array.isArray(value) || value.length > count) throw new TypeError('Invalid candidate list');
  return value.map(item => boundedText(item, size));
}

function count(value:unknown, positive=false):number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new TypeError('Invalid repository count');
  }
  return value;
}

function canonicalUrl(value:unknown, expected:string):string {
  const url = boundedText(value, 1024);
  if (url.toLowerCase() !== expected.toLowerCase()) throw new TypeError('Unexpected repository URL');
  return expected;
}

/** Allowlist fields, bound storage, and keep public links within this repository. */
export function normalizeCandidate(input:CandidateInput):CandidateInput {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid candidate');
  const id = boundedText(input.id, 64);
  const repository = boundedText(input.repository, 200);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || !/^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i.test(repository)) {
    throw new TypeError('Invalid candidate identity');
  }
  const [ownerLogin, repositoryName] = repository.split('/');
  if (!ownerLogin || repositoryName === '.' || repositoryName === '..') throw new TypeError('Invalid repository');
  const repositoryUrl = `https://github.com/${repository}`;
  const apiUrl = `https://api.github.com/repos/${repository}`;
  const p = input.project;
  const m = input.metadata;
  if (!p || !m || p.id !== id) throw new TypeError('Mismatched candidate identity');
  const project:Project = {
    id,
    name:boundedText(p.name, 200), owner:boundedText(p.owner, 300),
    category:boundedText(p.category, 100), tagline:boundedText(p.tagline, 500),
    description:boundedText(p.description, 4000), tags:textArray(p.tags, 16, 100),
    url:canonicalUrl(p.url, repositoryUrl), use:boundedText(p.use, 2000),
    points:textArray(p.points, 12, 2000), art:boundedText(p.art, 100),
    symbol:boundedText(p.symbol, 100, true), bg:boundedText(p.bg, 32), ink:boundedText(p.ink, 32),
  };
  if (!/^#[0-9a-f]{3,8}$/i.test(project.bg) || !/^#[0-9a-f]{3,8}$/i.test(project.ink)) {
    throw new TypeError('Invalid project colors');
  }
  if (boundedText(m.ownerLogin, 100).toLowerCase() !== ownerLogin.toLowerCase() || !['User', 'Organization'].includes(m.ownerType)) {
    throw new TypeError('Invalid repository owner');
  }
  const avatar = boundedText(m.avatar, 200);
  if (!/^\/avatars\/[a-z0-9_-]+\.png$/i.test(avatar)) throw new TypeError('Invalid avatar path');
  const avatarUrl = new URL(boundedText(m.avatarUrl, 1024));
  if (avatarUrl.protocol !== 'https:' || avatarUrl.hostname !== 'avatars.githubusercontent.com' || avatarUrl.port || avatarUrl.username || avatarUrl.password || avatarUrl.hash) {
    throw new TypeError('Invalid owner avatar URL');
  }
  const fetchedAt = boundedText(m.fetchedAt, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(fetchedAt) || !Number.isFinite(Date.parse(fetchedAt))) {
    throw new TypeError('Invalid metadata timestamp');
  }
  const metadata:RepositoryMetadata = {
    avatar, ownerLogin, ownerType:m.ownerType, ownerId:count(m.ownerId, true),
    ownerUrl:canonicalUrl(m.ownerUrl, `https://github.com/${ownerLogin}`),
    avatarUrl:avatarUrl.href, stars:count(m.stars), forks:count(m.forks), fetchedAt,
    repositoryUrl:canonicalUrl(m.repositoryUrl, repositoryUrl),
    metadataApiSource:canonicalUrl(m.metadataApiSource, apiUrl),
  };
  const sourceUrls = [...new Set(textArray(input.sourceUrls, 12, 1024))].sort();
  if (!sourceUrls.length || sourceUrls.some(source => {
    const url = new URL(source);
    const sameRepo = url.href.toLowerCase();
    return url.protocol !== 'https:' || !!url.username || !!url.password || !!url.port ||
      !(sameRepo === apiUrl.toLowerCase() || sameRepo === repositoryUrl.toLowerCase() ||
        sameRepo.startsWith(`${repositoryUrl.toLowerCase()}/`) || sameRepo.startsWith(`${repositoryUrl.toLowerCase()}#`));
  })) throw new TypeError('Invalid source URLs');
  if (!['seed', 'github', 'synthetic'].includes(input.provenance)) throw new TypeError('Invalid provenance');
  return {id, repository, project, metadata, sourceUrls, provenance:input.provenance};
}

function stableJson(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A newer observation time alone must not invalidate a review. */
export async function contentFingerprint(input:CandidateInput):Promise<string> {
  const {fetchedAt: _observationTime, ...metadata} = input.metadata;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson({...input, metadata})));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Also used by the insert-only seed path. Never touches publication rows. */
export async function candidateInsert(db:D1Database, raw:CandidateInput, updateExisting:boolean):Promise<D1PreparedStatement> {
  const input = normalizeCandidate(raw);
  const fingerprint = await contentFingerprint(input);
  const now = new Date().toISOString();
  const conflict = updateExisting ? `DO UPDATE SET
    repository = excluded.repository,
    project_json = excluded.project_json,
    metadata_json = excluded.metadata_json,
    source_urls_json = excluded.source_urls_json,
    provenance = excluded.provenance,
    fingerprint = excluded.fingerprint,
    revision = candidates.revision + 1,
    status = 'pending_review',
    updated_at = excluded.updated_at
    WHERE candidates.fingerprint <> excluded.fingerprint` : 'DO NOTHING';
  return db.prepare(`INSERT INTO candidates
    (id, repository, project_json, metadata_json, source_urls_json, provenance, fingerprint, revision, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending_review', ?, ?)
    ON CONFLICT(id) ${conflict}`).bind(
    input.id, input.repository, JSON.stringify(input.project), JSON.stringify(input.metadata),
    JSON.stringify(input.sourceUrls), input.provenance, fingerprint, now, now,
  );
}

export async function upsertCandidate(db:D1Database, input:CandidateInput):Promise<boolean> {
  const result = await (await candidateInsert(db, input, true)).run();
  return result.meta.changes > 0;
}

function candidateFromRow(row:CandidateRow):Candidate {
  return {id:row.id, repository:row.repository, project:JSON.parse(row.project_json) as Project,
    metadata:JSON.parse(row.metadata_json) as RepositoryMetadata, sourceUrls:JSON.parse(row.source_urls_json) as string[],
    provenance:row.provenance, revision:row.revision, status:row.status, updatedAt:row.updated_at};
}

function publicationFromRow(row:PublicationRow):PublishedProject {
  return {id:row.candidate_id, repository:row.repository, project:JSON.parse(row.project_json) as Project,
    metadata:JSON.parse(row.metadata_json) as RepositoryMetadata, sourceUrls:JSON.parse(row.source_urls_json) as string[],
    provenance:row.provenance, revision:row.revision, publishedAt:row.published_at};
}

/** Private collector/reviewer read; not a public projection. */
export async function getCandidate(db:D1Database, id:string):Promise<Candidate|null> {
  const row = await db.prepare(`SELECT ${CANDIDATE_COLUMNS} FROM candidates WHERE id = ?`).bind(id).first<CandidateRow>();
  return row ? candidateFromRow(row) : null;
}

export async function listCandidates(db:D1Database):Promise<Candidate[]> {
  const rows = await db.prepare(`SELECT ${CANDIDATE_COLUMNS} FROM candidates
    ORDER BY CASE status WHEN 'pending_review' THEN 0 ELSE 1 END, updated_at DESC, id ASC LIMIT 50`).all<CandidateRow>();
  return rows.results.map(candidateFromRow);
}

export async function getPublished(db:D1Database, id:string):Promise<PublishedProject|null> {
  const row = await db.prepare(`SELECT ${PUBLICATION_COLUMNS} FROM publications p
    WHERE p.candidate_id = ? ORDER BY p.revision DESC LIMIT 1`).bind(id).first<PublicationRow>();
  return row ? publicationFromRow(row) : null;
}

export async function searchPublished(db:D1Database, q:string, limit:number):Promise<PublishedProject[]> {
  const query = typeof q === 'string' ? q.trim().slice(0, 200) : '';
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20;
  // instr is a literal substring operation: %, _, quotes, and SQL syntax have
  // no wildcard/operator meaning. Only snapshot text participates in search.
  const rows = await db.prepare(`SELECT ${PUBLICATION_COLUMNS} FROM publications p
    WHERE ${LATEST_PUBLICATION} AND (? = '' OR instr(lower(
      p.repository || ' ' || json_extract(p.project_json, '$.name') || ' ' ||
      json_extract(p.project_json, '$.category') || ' ' || json_extract(p.project_json, '$.tagline') || ' ' ||
      json_extract(p.project_json, '$.description') || ' ' || json_extract(p.project_json, '$.use') || ' ' ||
      json_extract(p.project_json, '$.tags') || ' ' || json_extract(p.project_json, '$.points')
    ), lower(?)) > 0)
    ORDER BY p.published_at DESC, p.candidate_id ASC LIMIT ?`).bind(query, query, safeLimit).all<PublicationRow>();
  return rows.results.map(publicationFromRow);
}

export async function reviewCandidate(db:D1Database, id:string, revision:number, decision:'publish'|'reject', note:string, actorId:string):Promise<boolean> {
  if (!Number.isSafeInteger(revision) || revision < 1 || !['publish', 'reject'].includes(decision)) return false;
  const safeNote = boundedText(note, 2000, true);
  const safeActor = boundedText(actorId, 200);
  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [db.prepare(`INSERT INTO review_events
    (id, candidate_id, revision, decision, note, actor_id, created_at)
    SELECT ?, id, revision, ?, ?, ?, ? FROM candidates
    WHERE id = ? AND revision = ? AND status = 'pending_review'`)
    .bind(eventId, decision, safeNote, safeActor, now, id, revision)];
  if (decision === 'publish') {
    statements.push(db.prepare(`INSERT INTO publications
      (candidate_id, revision, repository, project_json, metadata_json, source_urls_json, provenance, published_at)
      SELECT id, revision, repository, project_json, metadata_json, source_urls_json, provenance, ?
      FROM candidates WHERE id = ? AND revision = ? AND status = 'pending_review'
      AND EXISTS (SELECT 1 FROM review_events WHERE id = ? AND decision = 'publish')`)
      .bind(now, id, revision, eventId));
  }
  statements.push(db.prepare(`UPDATE candidates SET status = ?, updated_at = ?
    WHERE id = ? AND revision = ? AND status = 'pending_review'
    AND EXISTS (SELECT 1 FROM review_events WHERE id = ?)`)
    .bind(decision === 'publish' ? 'published' : 'rejected', now, id, revision, eventId));
  // D1 batches are transactions. A stale/replayed decision inserts no event,
  // so neither later statement may change state. Any failure rolls back all.
  const results = await db.batch(statements);
  return (results[0]?.meta.changes ?? 0) === 1;
}

export async function publicStatus(db:D1Database):Promise<{published:number}> {
  const row = await db.prepare('SELECT COUNT(DISTINCT candidate_id) AS published FROM publications').first<{published:number}>();
  return {published:row?.published ?? 0};
}
