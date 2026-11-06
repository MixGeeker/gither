import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  PoolError,
  type BoundClaim, type CandidateDraft, type CandidateRecord, type ClaimInput,
  type CollectionJob, type Decision, type DiscoveryProfile, type FinishInput, type FeedbackSnapshot, type FeedbackSignal, type FeedbackSuggestion, type FlavorTarget,
  type JobClaim, type PoolOptions, type PoolRules, type PoolStatus, type ProfileInput,
  type ProjectCard, type ReviewDecision, type SubmitInput, type SubmitResult,
  type Subscription, type VerifiedPrincipal,
} from './pool-contracts.js';
export { PoolError } from './pool-contracts.js';
export type * from './pool-contracts.js';
export const MAX_SUBMISSION_CANDIDATES = 60;
export const DEFAULT_RULES: PoolRules = { refillThreshold: 30, batchTarget: 60, version: 1 };
export const DEFAULT_PROFILE: DiscoveryProfile = {
  version: 1, topics: [], sources: ['github'], excludedTopics: [],
  flavors: [{ id: 'relevance', label: '符合兴趣', weight: 90 }, { id: 'exploration', label: '探索新方向', weight: 10 }],
};
type Row = Record<string, any>;
const fail = (status: number, code: string, message: string): never => { throw new PoolError(status, code, message); };
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'INVALID_INPUT', 'Expected an object.');
  return v as Record<string, unknown>;
};
const keys = (v: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(v).some(k => !allowed.includes(k))) fail(400, 'INVALID_INPUT', 'Unknown input field.');
};
function str(v: unknown, name: string, min = 1, max = 500): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail(400, 'INVALID_INPUT', `Invalid ${name}.`);
  return (v as string).trim();
}
function integer(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) fail(400, 'INVALID_INPUT', `${name} must be an integer from ${min} to ${max}.`);
  return v as number;
}
function strings(v: unknown, name: string, maxItems: number, maxLength: number, minItems = 0): string[] {
  if (!Array.isArray(v) || v.length < minItems || v.length > maxItems) fail(400, 'INVALID_INPUT', `Invalid ${name} list.`);
  const result = (v as unknown[]).map(x => str(x, name, 1, maxLength));
  if (new Set(result.map(x => x.toLowerCase())).size !== result.length) fail(400, 'INVALID_INPUT', `Duplicate ${name}.`);
  return result;
}
function githubUrl(v: unknown): URL {
  const text = str(v, 'GitHub HTTPS URL', 1, 2048);
  let url: URL; try { url = new URL(text); } catch { return fail(400, 'INVALID_URL', 'A valid GitHub HTTPS URL is required.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || /%|\\/.test(url.pathname)) fail(400, 'INVALID_URL', 'Only bounded HTTPS github.com URLs without credentials, queries or encoded paths are accepted.');
  return url;
}
export function canonicalRepository(value: unknown): string {
  const url = githubUrl(value);
  const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (segments.length !== 2) fail(400, 'INVALID_REPOSITORY', 'Use the repository root URL.');
  const owner = segments[0]!, repo = segments[1]!.replace(/\.git$/i, '');
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') fail(400, 'INVALID_REPOSITORY', 'Invalid GitHub owner or repository name.');
  return `${owner}/${repo}`.toLowerCase();
}
export function validateCandidate(value: unknown): CandidateDraft {
  const v = object(value); keys(v, ['repositoryUrl','title','purpose','description','capabilities','useCase','tags','evidence','stars','language']);
  const canonical = canonicalRepository(v.repositoryUrl);
  if (!Array.isArray(v.evidence) || !v.evidence.length || v.evidence.length > 10) fail(400, 'INVALID_EVIDENCE', 'One to ten repository evidence links are required.');
  const evidence = (v.evidence as unknown[]).map(item => {
    const e = object(item); keys(e, ['url','claim']); const url = githubUrl(e.url);
    const path = url.pathname.toLowerCase();
    if (!(path === '/' + canonical || path === '/' + canonical + '.git' || path.startsWith('/' + canonical + '/'))) fail(400, 'INVALID_EVIDENCE', 'Evidence must belong to the candidate GitHub repository.');
    return { url: url.href, claim: str(e.claim, 'evidence claim', 1, 1000) };
  });
  const candidate: CandidateDraft = {
    repositoryUrl: 'https://github.com/' + canonical,
    title: str(v.title, 'title', 1, 160), purpose: str(v.purpose, 'purpose', 1, 240),
    description: str(v.description, 'description', 1, 2000), capabilities: strings(v.capabilities, 'capabilities', 6, 500, 2),
    useCase: str(v.useCase, 'useCase', 1, 1500), tags: strings(v.tags, 'tags', 12, 60), evidence,
  };
  if (v.stars !== undefined) candidate.stars = integer(v.stars, 'stars', 0, 1_000_000_000);
  if (v.language !== undefined) candidate.language = str(v.language, 'language', 1, 80);
  return candidate;
}
function validateSubscriptions(input: unknown): Subscription[] {
  if (!Array.isArray(input) || input.length > 30) fail(400, 'INVALID_SUBSCRIPTIONS', 'At most 30 subscriptions are allowed.');
  const result = (input as unknown[]).map(value => {
    const v = object(value); keys(v, ['id','label','query','enabled']);
    const id = str(v.id, 'subscription ID', 1, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || typeof v.enabled !== 'boolean') fail(400, 'INVALID_SUBSCRIPTIONS', 'Invalid subscription.');
    return { id, label: str(v.label, 'label', 1, 100), query: str(v.query, 'query', 1, 500), enabled: v.enabled as boolean };
  });
  if (new Set(result.map(x => x.id)).size !== result.length) fail(400, 'INVALID_SUBSCRIPTIONS', 'Subscription IDs must be unique.');
  return result;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stable((value as Row)[k])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sameSecret = (a: string, b: string) => { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
export function requireScope(principal: VerifiedPrincipal, scope: string) {
  if (!principal || !principal.userId || !principal.keyId || !Array.isArray(principal.scopes)) fail(401, 'AUTH_REQUIRED', 'A verified API-key principal is required.');
  if (!principal.scopes.includes(scope)) fail(403, 'INSUFFICIENT_SCOPE', `Required scope: ${scope}.`);
}

export function allocateFlavorTargets(profile: DiscoveryProfile, target: number): FlavorTarget[] {
  const result = profile.flavors.map(flavor => ({ ...flavor, candidateTarget: Math.floor(target * flavor.weight / 100) }));
  let remaining = target - result.reduce((sum, flavor) => sum + flavor.candidateTarget, 0);
  const order = profile.flavors.map((flavor, index) => ({index, remainder: target * flavor.weight / 100 % 1})).sort((a,b) => b.remainder - a.remainder || a.index - b.index);
  for (const item of order) { if (remaining <= 0) break; result[item.index]!.candidateTarget++; remaining--; }
  const exploration = result.find(flavor => flavor.id === 'exploration');
  if (target > 0 && exploration && exploration.candidateTarget === 0) {
    const donor = result.filter(flavor => flavor.id !== 'exploration' && flavor.candidateTarget > 0).sort((a,b) => b.candidateTarget - a.candidateTarget)[0];
    if (donor) { donor.candidateTarget--; exploration.candidateTarget = 1; }
  }
  return result;
}

export function createPoolService(db: DatabaseSync, options: PoolOptions = {}) {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 30_000;
  const cooldown = options.collectionCooldownMs ?? 5 * 60_000;
  if (!(leaseMs > 0 && leaseMs <= 60 * 60_000 && Number.isInteger(maxAttempts) && maxAttempts > 0 && maxAttempts <= 10 && baseBackoffMs > 0 && cooldown >= 0)) throw new Error('Invalid pool service timing options.');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS pool_settings (
      user_id TEXT PRIMARY KEY, rules_json TEXT NOT NULL CHECK(json_valid(rules_json)),
      profile_json TEXT NOT NULL CHECK(json_valid(profile_json)), subscriptions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(subscriptions_json))
    );
    CREATE TABLE IF NOT EXISTS pool_jobs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','leased','backoff','completed','failed')),
      target INTEGER NOT NULL, assessed_count INTEGER NOT NULL DEFAULT 0, pending_count INTEGER NOT NULL DEFAULT 0,
      attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      next_attempt_at INTEGER NOT NULL, lease_expires_at INTEGER, key_id TEXT, token_hash TEXT, claim_token TEXT,
      rules_json TEXT NOT NULL CHECK(json_valid(rules_json)), profile_json TEXT NOT NULL CHECK(json_valid(profile_json)),
      subscriptions_json TEXT NOT NULL CHECK(json_valid(subscriptions_json)), feedback_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(feedback_json)), summary TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pool_one_active_job ON pool_jobs(user_id) WHERE state IN ('queued','leased','backoff');
    CREATE INDEX IF NOT EXISTS pool_jobs_owner_created ON pool_jobs(user_id, created_at);
    CREATE TABLE IF NOT EXISTS pool_claim_requests (
      user_id TEXT NOT NULL, key_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      job_id TEXT NOT NULL, attempt INTEGER NOT NULL, PRIMARY KEY(user_id,key_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS catalog_candidates (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, canonical_repository TEXT NOT NULL,
      draft_json TEXT NOT NULL CHECK(json_valid(draft_json)), state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
      created_at INTEGER NOT NULL, job_id TEXT, review_note TEXT,
      UNIQUE(user_id,canonical_repository)
    );
    CREATE TABLE IF NOT EXISTS catalog_projects (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
      canonical_repository TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
      published_at INTEGER NOT NULL, available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
      UNIQUE(user_id,canonical_repository), UNIQUE(user_id,candidate_id)
    );
    CREATE TABLE IF NOT EXISTS catalog_decisions (
      user_id TEXT NOT NULL, project_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('saved','dismissed')),
      updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,project_id)
    );
    CREATE TABLE IF NOT EXISTS catalog_decision_history (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
      previous_decision TEXT NOT NULL, next_decision TEXT NOT NULL, created_at INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS catalog_reviews (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, candidate_id TEXT NOT NULL, decision TEXT NOT NULL,
      note TEXT NOT NULL, created_at INTEGER NOT NULL, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
      UNIQUE(user_id,idempotency_key)
    );
    CREATE TRIGGER IF NOT EXISTS catalog_reviews_append_only_update BEFORE UPDATE ON catalog_reviews BEGIN SELECT RAISE(ABORT,'Reviews are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS catalog_reviews_append_only_delete BEFORE DELETE ON catalog_reviews BEGIN SELECT RAISE(ABORT,'Reviews are append-only'); END;
    CREATE TABLE IF NOT EXISTS pool_job_candidates (
      job_id TEXT NOT NULL, canonical_repository TEXT NOT NULL, candidate_id TEXT,
      outcome TEXT NOT NULL, PRIMARY KEY(job_id,canonical_repository)
    );
    CREATE TABLE IF NOT EXISTS pool_submissions (
      user_id TEXT NOT NULL, job_id TEXT NOT NULL, key_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
      PRIMARY KEY(user_id,job_id,key_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS pool_proposals (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at INTEGER NOT NULL
    );
  `);
  if (!(db.prepare('PRAGMA table_info(pool_jobs)').all() as Row[]).some(column => column.name === 'feedback_json')) db.exec("ALTER TABLE pool_jobs ADD COLUMN feedback_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(feedback_json))");
  const one = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).get(...args) as Row | undefined;
  const all = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).all(...args) as Row[];
  const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);
  function tx<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function settings(userId: string): Row {
    str(userId, 'user ID', 1, 200);
    run('INSERT OR IGNORE INTO pool_settings(user_id,rules_json,profile_json) VALUES (?,?,?)', userId, JSON.stringify(DEFAULT_RULES), JSON.stringify(DEFAULT_PROFILE));
    return one('SELECT * FROM pool_settings WHERE user_id=?', userId)!;
  }
  const getRules = (userId: string): PoolRules => JSON.parse(settings(userId).rules_json);
  const getProfile = (userId: string): DiscoveryProfile => JSON.parse(settings(userId).profile_json);
  const getSubscriptions = (userId: string): Subscription[] => JSON.parse(settings(userId).subscriptions_json);
  function job(row: Row): CollectionJob {
    return { id: row.id, status: row.state, batchTarget: row.target, assessedCount: row.assessed_count, pendingCount: row.pending_count,
      attempt: row.attempt, maxAttempts: row.max_attempts, createdAt: row.created_at, updatedAt: row.updated_at,
      nextAttemptAt: row.next_attempt_at, leaseExpiresAt: row.lease_expires_at, claimedByKeyId: row.key_id,
      rulesSnapshot: JSON.parse(row.rules_json), profileSnapshot: JSON.parse(row.profile_json), subscriptionsSnapshot: JSON.parse(row.subscriptions_json), flavorTargets: allocateFlavorTargets(JSON.parse(row.profile_json), row.target), feedbackSnapshot: row.feedback_json && row.feedback_json !== '{}' ? JSON.parse(row.feedback_json) : {signals:[],suggestions:[],humanRulesOverride:true}, summary: row.summary };
  }
  function aggregateFeedback(userId: string): FeedbackSnapshot {
    const byTag = new Map<string, {tag:string;saved:number;dismissed:number}>();
    for (const row of all('SELECT d.decision,p.snapshot_json FROM catalog_decisions d JOIN catalog_projects p ON p.id=d.project_id AND p.user_id=d.user_id WHERE d.user_id=?',userId)) {
      const tags = (JSON.parse(row.snapshot_json) as CandidateDraft).tags;
      for (const tag of tags) { const key=tag.toLowerCase();const signal=byTag.get(key)??{tag,saved:0,dismissed:0}; if(row.decision==='saved')signal.saved++;else signal.dismissed++;byTag.set(key,signal); }
    }
    const signals: FeedbackSignal[] = [...byTag.values()].map((value): FeedbackSignal=>{
      const samples=value.saved+value.dismissed, score=value.saved*2-value.dismissed*0.5;
      return {...value,samples,score,evidence:samples<3?'insufficient':'repeated',explanation:`${value.saved} saved × 2 and ${value.dismissed} dismissed × −0.5 = ${score}. ${samples<3?'Fewer than three distinct project decisions: insufficient evidence for a suggestion.':'Repeated observations are advisory only; explicit human rules remain authoritative.'}`};
    }).sort((a,b)=>b.samples-a.samples||a.tag.localeCompare(b.tag));
    const profile=getProfile(userId);
    const suggestions: FeedbackSuggestion[]=signals.filter(signal=>signal.samples>=3&&!profile.excludedTopics.some(topic=>topic.toLowerCase()===signal.tag.toLowerCase())&&(signal.saved>=3&&signal.score>=3||signal.dismissed>=3&&signal.score<=-1.5)).map(signal=>({tag:signal.tag,direction:signal.score>0?'more':'less',samples:signal.samples,explanation:signal.score>0?`Repeated saves suggest reviewing the emphasis on ${signal.tag}; no preference has been changed.`:`Repeated dismissals provide a weak suggestion to review the emphasis on ${signal.tag}, not to ban the topic.`,requiresHumanApproval:true}));
    return {signals,suggestions,humanRulesOverride:true};
  }
  function countAvailable(userId: string): number {
    return one(`SELECT COUNT(*) AS n FROM catalog_projects p LEFT JOIN catalog_decisions d ON d.project_id=p.id AND d.user_id=p.user_id WHERE p.user_id=? AND p.available=1 AND d.project_id IS NULL`, userId)!.n;
  }
  function transitionFailure(row: Row, message: string) {
    const nextState = row.attempt >= row.max_attempts ? 'failed' : 'backoff';
    const retryAt = now() + Math.min(baseBackoffMs * 2 ** Math.max(0, row.attempt - 1), 60 * 60_000);
    run('UPDATE pool_jobs SET state=?,updated_at=?,next_attempt_at=?,lease_expires_at=NULL,token_hash=NULL,claim_token=NULL,summary=? WHERE id=? AND user_id=?', nextState, now(), retryAt, message, row.id, row.user_id);
  }
  function expire(userId: string) {
    const row = one("SELECT * FROM pool_jobs WHERE user_id=? AND state='leased' AND lease_expires_at<=?", userId, now());
    if (row) transitionFailure(row, 'Claim lease expired. Work was not marked completed.');
  }
  function ensureInternal(userId: string): CollectionJob | null {
    const s = settings(userId); expire(userId);
    const active = one("SELECT * FROM pool_jobs WHERE user_id=? AND state IN ('queued','leased','backoff')", userId);
    if (active) return job(active);
    const rules: PoolRules = JSON.parse(s.rules_json);
    if (countAvailable(userId) >= rules.refillThreshold) return null;
    const latest = one('SELECT * FROM pool_jobs WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', userId);
    if (latest && (latest.state === 'failed' || latest.updated_at + cooldown > now())) return null;
    const id = randomUUID(), t = now();
    run(`INSERT INTO pool_jobs(id,user_id,state,target,max_attempts,created_at,updated_at,next_attempt_at,rules_json,profile_json,subscriptions_json,feedback_json) VALUES (?,?,'queued',?,?,?,?,?,?,?,?,?)`, id,userId,rules.batchTarget,maxAttempts,t,t,t,s.rules_json,s.profile_json,s.subscriptions_json,JSON.stringify(aggregateFeedback(userId)));
    return job(one('SELECT * FROM pool_jobs WHERE id=?', id)!);
  }
  const ensureCollectionJob = (userId: string): CollectionJob | null => tx(() => ensureInternal(userId));
  function setRules(userId: string, input: { refillThreshold: number; batchTarget: number; expectedVersion?: number }): PoolRules {
    return tx(() => { const v = object(input); keys(v, ['refillThreshold','batchTarget','expectedVersion']); const previous = getRules(userId);
      if (v.expectedVersion !== undefined && v.expectedVersion !== previous.version) fail(409, 'VERSION_CONFLICT', 'Rules changed; reload before saving.');
      const value: PoolRules = { refillThreshold: integer(v.refillThreshold,'refillThreshold',1,10000), batchTarget: integer(v.batchTarget,'batchTarget',1,1000), version: previous.version + 1 };
      run('UPDATE pool_settings SET rules_json=? WHERE user_id=?', JSON.stringify(value),userId); ensureInternal(userId); return value;
    });
  }
  function setProfile(userId: string, input: ProfileInput): DiscoveryProfile {
    return tx(() => { const v = object(input); keys(v,['topics','sources','flavors','excludedTopics','expectedVersion']); const previous = getProfile(userId);
      if (v.expectedVersion !== undefined && v.expectedVersion !== previous.version) fail(409,'VERSION_CONFLICT','Profile changed; reload before saving.');
      if (!Array.isArray(v.flavors) || v.flavors.length < 1 || v.flavors.length > 12) fail(400,'INVALID_PROFILE','One to twelve flavor weights are required.');
      const flavors = (v.flavors as unknown[]).map(item => { const f=object(item); keys(f,['id','label','weight']); const id=str(f.id,'flavor ID',1,40); if (!/^[a-z0-9_-]+$/.test(id)) fail(400,'INVALID_PROFILE','Invalid flavor ID.'); return {id,label:str(f.label,'flavor label',1,100),weight:integer(f.weight,'flavor weight',0,100)}; });
      if (flavors.reduce((n,f)=>n+f.weight,0) !== 100 || new Set(flavors.map(f=>f.id)).size !== flavors.length || !flavors.some(f=>f.id==='exploration' && f.weight>=1)) fail(400,'INVALID_PROFILE','Flavor weights must total 100 and preserve at least 1 percent exploration.');
      const value: DiscoveryProfile = {version:previous.version+1,topics:strings(v.topics,'topics',40,100),sources:strings(v.sources,'sources',30,300),flavors,excludedTopics:strings(v.excludedTopics,'excludedTopics',40,100)};
      if (value.topics.some(t=>value.excludedTopics.some(x=>x.toLowerCase()===t.toLowerCase()))) fail(400,'INVALID_PROFILE','A topic cannot also be explicitly excluded.');
      run('UPDATE pool_settings SET profile_json=? WHERE user_id=?',JSON.stringify(value),userId); return value;
    });
  }
  function setSubscriptions(userId: string, input: Subscription[]): Subscription[] {
    const subscriptions=validateSubscriptions(input); settings(userId); run('UPDATE pool_settings SET subscriptions_json=? WHERE user_id=?',JSON.stringify(subscriptions),userId); return subscriptions;
  }
  function getStatus(userId: string): PoolStatus {
    return tx(() => { const activeJob=ensureInternal(userId), rules=getRules(userId), profile=getProfile(userId);
      const latest=one('SELECT * FROM pool_jobs WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',userId);
      return {availableCount:countAvailable(userId),pendingCount:one("SELECT COUNT(*) AS n FROM catalog_candidates WHERE user_id=? AND state='pending'",userId)!.n,
        savedCount:one("SELECT COUNT(*) AS n FROM catalog_decisions WHERE user_id=? AND decision='saved'",userId)!.n,
        dismissedCount:one("SELECT COUNT(*) AS n FROM catalog_decisions WHERE user_id=? AND decision='dismissed'",userId)!.n,
        rules,profileVersion:profile.version,activeJob,nextCollectionAt:!activeJob&&latest&&latest.state==='completed'?latest.updated_at+cooldown:null};
    });
  }
  function getAgentStatus(principal: VerifiedPrincipal) {
    requireScope(principal, 'pool:read'); const status = getStatus(principal.userId);
    if (!status.activeJob || principal.scopes.includes('profile:read')) return status;
    const { profileSnapshot, subscriptionsSnapshot, feedbackSnapshot, flavorTargets, ...activeJob } = status.activeJob;
    return { ...status, activeJob: { ...activeJob, profileVersion: profileSnapshot.version, profileSnapshotRedacted: true } };
  }
  function getJobs(userId: string): CollectionJob[] { return tx(()=>{expire(userId);return all('SELECT * FROM pool_jobs WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',userId).map(job);}); }
  function listCatalog(userId: string, input: { includeDecided?: boolean; includeUnavailable?: boolean } = {}): ProjectCard[] {
    return all(`SELECT p.*,COALESCE(d.decision,'none') AS decision FROM catalog_projects p LEFT JOIN catalog_decisions d ON d.project_id=p.id AND d.user_id=p.user_id WHERE p.user_id=? ${input.includeUnavailable?'':'AND p.available=1'} ${input.includeDecided?'':'AND d.project_id IS NULL'} ORDER BY p.published_at DESC,p.id`,userId)
      .map(row=>({...JSON.parse(row.snapshot_json),id:row.id,candidateId:row.candidate_id,canonicalRepository:row.canonical_repository,publishedAt:row.published_at,available:row.available===1,decision:row.decision}));
  }
  function getDecisions(userId: string): { saved: string[]; dismissed: string[] } {
    const rows=all('SELECT project_id,decision FROM catalog_decisions WHERE user_id=? ORDER BY updated_at DESC,project_id',userId);
    return {saved:rows.filter(r=>r.decision==='saved').map(r=>r.project_id),dismissed:rows.filter(r=>r.decision==='dismissed').map(r=>r.project_id)};
  }
  function decisionWrite(userId: string, projectId: string, decision: Decision) {
    if(decision==='none')run('DELETE FROM catalog_decisions WHERE user_id=? AND project_id=?',userId,projectId);
    else run('INSERT INTO catalog_decisions(user_id,project_id,decision,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET decision=excluded.decision,updated_at=excluded.updated_at',userId,projectId,decision,now());
  }
  function saveDecision(userId: string, projectId: string, decision: Decision) {
    return tx(()=>{if(!['saved','dismissed','none'].includes(decision))fail(400,'INVALID_DECISION','Invalid decision.');
      if(!one('SELECT id FROM catalog_projects WHERE user_id=? AND id=?',userId,projectId))fail(404,'NOT_FOUND','Published project not found.');
      const previous=(one('SELECT decision FROM catalog_decisions WHERE user_id=? AND project_id=?',userId,projectId)?.decision??'none') as Decision;
      if(previous!==decision){decisionWrite(userId,projectId,decision);run('INSERT INTO catalog_decision_history(user_id,project_id,previous_decision,next_decision,created_at) VALUES (?,?,?,?,?)',userId,projectId,previous,decision,now());}
      ensureInternal(userId);return {projectId,decision,previousDecision:previous,decisions:getDecisions(userId)};
    });
  }
  function undoDecision(userId: string) {
    return tx(()=>{const last=one('SELECT * FROM catalog_decision_history WHERE user_id=? AND undone=0 ORDER BY seq DESC LIMIT 1',userId);
      if(!last)return {undone:false,decisions:getDecisions(userId)};
      decisionWrite(userId,last.project_id,last.previous_decision);run('UPDATE catalog_decision_history SET undone=1 WHERE seq=? AND user_id=?',last.seq,userId);ensureInternal(userId);
      return {undone:true,projectId:last.project_id,decision:last.previous_decision as Decision,decisions:getDecisions(userId)};
    });
  }
  const candidate = (row: Row): CandidateRecord=>({...JSON.parse(row.draft_json),id:row.id,canonicalRepository:row.canonical_repository,status:row.state,createdAt:row.created_at,jobId:row.job_id,reviewNote:row.review_note});
  const getCandidates = (userId: string): CandidateRecord[] => all('SELECT * FROM catalog_candidates WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1000',userId).map(candidate);
  function seedCandidates(userId: string, input: CandidateDraft[]): CandidateRecord[] {
    if(!Array.isArray(input)||input.length>60)fail(400,'INVALID_INPUT','At most 60 seed candidates.');const drafts=input.map(validateCandidate);
    return tx(()=>drafts.map(draft=>{const canonical=canonicalRepository(draft.repositoryUrl);let row=one('SELECT * FROM catalog_candidates WHERE user_id=? AND canonical_repository=?',userId,canonical);
      if(!row){const id=randomUUID();run('INSERT INTO catalog_candidates(id,user_id,canonical_repository,draft_json,created_at) VALUES (?,?,?,?,?)',id,userId,canonical,JSON.stringify(draft),now());row=one('SELECT * FROM catalog_candidates WHERE id=?',id);}
      return candidate(row!);
    }));
  }
  function reviewCandidate(userId: string, candidateId: string, decision: ReviewDecision, note = '', idempotencyKey?: string) {
    if(!['approved','rejected'].includes(decision))fail(400,'INVALID_REVIEW','Review must approve or reject.');note=str(note,'review note',0,2000);
    const key=idempotencyKey===undefined?'candidate:'+candidateId+':'+decision:str(idempotencyKey,'idempotencyKey',1,128);
    const payloadHash=hash(stable({candidateId,decision,note}));
    return tx(()=>{const row=one('SELECT * FROM catalog_candidates WHERE user_id=? AND id=?',userId,candidateId);if(!row)fail(404,'NOT_FOUND','Candidate not found.');
      const prior=one('SELECT * FROM catalog_reviews WHERE user_id=? AND idempotency_key=?',userId,key);
      if(prior){if(prior.payload_hash!==payloadHash)fail(409,'IDEMPOTENCY_CONFLICT','Review key was used with different content.');return {candidate:candidate(row!),project:listCatalog(userId,{includeDecided:true,includeUnavailable:true}).find(p=>p.candidateId===candidateId)??null};}
      if(row!.state!=='pending')fail(409,'ALREADY_REVIEWED','Candidate is already reviewed. Use availability controls to unpublish a project.');
      run('INSERT INTO catalog_reviews(id,user_id,candidate_id,decision,note,created_at,idempotency_key,payload_hash) VALUES (?,?,?,?,?,?,?,?)',randomUUID(),userId,candidateId,decision,note,now(),key,payloadHash);
      run('UPDATE catalog_candidates SET state=?,review_note=? WHERE user_id=? AND id=?',decision,note,userId,candidateId);
      if(decision==='approved')run('INSERT INTO catalog_projects(id,user_id,candidate_id,canonical_repository,snapshot_json,published_at) VALUES (?,?,?,?,?,?)',randomUUID(),userId,candidateId,row!.canonical_repository,row!.draft_json,now());
      ensureInternal(userId);return {candidate:candidate(one('SELECT * FROM catalog_candidates WHERE user_id=? AND id=?',userId,candidateId)!),project:listCatalog(userId,{includeDecided:true,includeUnavailable:true}).find(p=>p.candidateId===candidateId)??null};
    });
  }
  function setProjectAvailability(userId: string, projectId: string, available: boolean) {
    if(typeof available!=='boolean')fail(400,'INVALID_INPUT','Availability must be boolean.');
    return tx(()=>{if(!one('SELECT id FROM catalog_projects WHERE user_id=? AND id=?',userId,projectId))fail(404,'NOT_FOUND','Published project not found.');
      run('UPDATE catalog_projects SET available=? WHERE user_id=? AND id=?',available?1:0,userId,projectId);ensureInternal(userId);return {projectId,available};});
  }
  function validateClaim(principal: VerifiedPrincipal, input: BoundClaim): Row {
    const jobId=str(input.jobId,'jobId',1,128),token=str(input.claimToken,'claimToken',1,256);
    const row=one('SELECT * FROM pool_jobs WHERE user_id=? AND id=?',principal.userId,jobId);
    if(!row)fail(404,'NOT_FOUND','Collection job not found.');
    if(row!.key_id!==principal.keyId || !row!.token_hash || !sameSecret(hash(token),row!.token_hash))fail(403,'CLAIM_MISMATCH','Claim belongs to a different key or token.');
    if(row!.state!=='leased'||row!.lease_expires_at<=now())fail(409,'LEASE_EXPIRED','Claim is inactive or expired; claim eligible work again.');
    return row!;
  }
  function claimJob(principal: VerifiedPrincipal, input: ClaimInput): JobClaim | null {
    requireScope(principal,'collection:claim');requireScope(principal,'profile:read');const key=str(input.idempotencyKey,'idempotencyKey',1,128);
    return tx(()=>{expire(principal.userId);
      const previous=one('SELECT * FROM pool_claim_requests WHERE user_id=? AND key_id=? AND idempotency_key=?',principal.userId,principal.keyId,key);
      if(previous){const existing=one('SELECT * FROM pool_jobs WHERE user_id=? AND id=?',principal.userId,previous.job_id);
        if(existing?.state==='leased'&&existing.key_id===principal.keyId&&existing.attempt===previous.attempt)return {job:job(existing),claimToken:existing.claim_token};
        fail(409,'CLAIM_REPLAY_EXPIRED','This claim request is no longer active; use a new idempotency key.');}
      ensureInternal(principal.userId);
      const row=one("SELECT * FROM pool_jobs WHERE user_id=? AND state IN ('queued','backoff') AND next_attempt_at<=? ORDER BY created_at LIMIT 1",principal.userId,now());
      if(!row)return null;
      const token=randomBytes(32).toString('base64url');
      const update=run("UPDATE pool_jobs SET state='leased',attempt=attempt+1,key_id=?,token_hash=?,claim_token=?,lease_expires_at=?,updated_at=? WHERE id=? AND user_id=? AND state IN ('queued','backoff') AND next_attempt_at<=?",principal.keyId,hash(token),token,now()+leaseMs,now(),row.id,principal.userId,now());
      if(!update.changes)return null;
      run('INSERT INTO pool_claim_requests(user_id,key_id,idempotency_key,job_id,attempt) VALUES (?,?,?,?,?)',principal.userId,principal.keyId,key,row.id,row.attempt+1);
      return {job:job(one('SELECT * FROM pool_jobs WHERE id=?',row.id)!),claimToken:token};
    });
  }
  function heartbeatJob(principal: VerifiedPrincipal, input: BoundClaim): JobClaim {
    requireScope(principal,'collection:claim');requireScope(principal,'profile:read');return tx(()=>{const row=validateClaim(principal,input);run('UPDATE pool_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND user_id=?',now()+leaseMs,now(),row.id,principal.userId);return {job:job(one('SELECT * FROM pool_jobs WHERE id=?',row.id)!),claimToken:input.claimToken};});
  }
  function finishJob(principal: VerifiedPrincipal, input: FinishInput): CollectionJob {
    requireScope(principal,'collection:claim');requireScope(principal,'profile:read');if(!['completed','failed'].includes(input.outcome))fail(400,'INVALID_INPUT','Invalid completion outcome.');const summary=str(input.summary??'','summary',0,2000);
    return tx(()=>{const existing=one('SELECT * FROM pool_jobs WHERE user_id=? AND id=?',principal.userId,input.jobId);
      if(existing?.state==='completed'&&input.outcome==='completed'&&existing.key_id===principal.keyId&&existing.token_hash&&sameSecret(hash(input.claimToken),existing.token_hash)){if(existing.summary!==summary)fail(409,'IDEMPOTENCY_CONFLICT','Completed job summary differs.');return job(existing);}
      const row=validateClaim(principal,input);
      if(input.outcome==='completed'){if(row.assessed_count<row.target)fail(409,'CANDIDATE_TARGET_INCOMPLETE',`Assessed ${row.assessed_count} of ${row.target} candidates; pending review is not publication.`);
        run("UPDATE pool_jobs SET state='completed',updated_at=?,lease_expires_at=NULL,claim_token=NULL,summary=? WHERE id=? AND user_id=?",now(),summary,row.id,principal.userId);
      }else transitionFailure(row,summary||'Agent reported collection failure.');
      return job(one('SELECT * FROM pool_jobs WHERE id=?',row.id)!);
    });
  }
  function submitCandidates(principal: VerifiedPrincipal, input: SubmitInput): SubmitResult {
    requireScope(principal,'candidates:write');const key=str(input.idempotencyKey,'idempotencyKey',1,128);
    if(!Array.isArray(input.candidates)||input.candidates.length<1||input.candidates.length>MAX_SUBMISSION_CANDIDATES)fail(400,'INVALID_BATCH','Submit one to sixty candidates per call.');
    const drafts=input.candidates.map(validateCandidate), payloadHash=hash(stable(drafts));
    const repositories=drafts.map(d=>canonicalRepository(d.repositoryUrl));
    if(new Set(repositories).size!==repositories.length)fail(400,'DUPLICATE_IN_BATCH','Canonical repositories must be unique within each submission.');
    return tx(()=>{const row=validateClaim(principal,input);
      const prior=one('SELECT * FROM pool_submissions WHERE user_id=? AND job_id=? AND key_id=? AND idempotency_key=?',principal.userId,row.id,principal.keyId,key);
      if(prior){if(prior.payload_hash!==payloadHash)fail(409,'IDEMPOTENCY_CONFLICT','Submission key was used with different content.');return JSON.parse(prior.result_json);}
      const newCount=repositories.filter(repo=>!one('SELECT 1 FROM pool_job_candidates WHERE job_id=? AND canonical_repository=?',row.id,repo)).length;
      if(row.assessed_count+newCount>row.target)fail(409,'CANDIDATE_BUDGET_EXCEEDED','Submission exceeds this job candidate target; approvals do not reset the budget.');
      let newPending=0;
      const results:SubmitResult['results']=drafts.map((draft,index)=>{const canonical=repositories[index]!;
        const assessed=one('SELECT * FROM pool_job_candidates WHERE job_id=? AND canonical_repository=?',row.id,canonical);
        if(assessed)return {repositoryUrl:draft.repositoryUrl,canonicalRepository:canonical,candidateId:assessed.candidate_id,outcome:'duplicate'};
        let existing=one('SELECT id FROM catalog_candidates WHERE user_id=? AND canonical_repository=?',principal.userId,canonical);
        const outcome=existing?'duplicate':'pending';
        if(!existing){const id=randomUUID();run('INSERT INTO catalog_candidates(id,user_id,canonical_repository,draft_json,created_at,job_id) VALUES (?,?,?,?,?,?)',id,principal.userId,canonical,JSON.stringify(draft),now(),row.id);existing={id};newPending++;}
        run('INSERT INTO pool_job_candidates(job_id,canonical_repository,candidate_id,outcome) VALUES (?,?,?,?)',row.id,canonical,existing.id,outcome);
        return {repositoryUrl:draft.repositoryUrl,canonicalRepository:canonical,candidateId:existing.id,outcome};
      });
      run('UPDATE pool_jobs SET assessed_count=assessed_count+?,pending_count=pending_count+?,updated_at=? WHERE id=? AND user_id=?',newCount,newPending,now(),row.id,principal.userId);
      const result:SubmitResult={jobId:row.id,assessedCount:row.assessed_count+newCount,target:row.target,remaining:row.target-row.assessed_count-newCount,results};
      run('INSERT INTO pool_submissions(user_id,job_id,key_id,idempotency_key,payload_hash,result_json) VALUES (?,?,?,?,?,?)',principal.userId,row.id,principal.keyId,key,payloadHash,JSON.stringify(result));
      return result;
    });
  }
  function storeProposal(principal: VerifiedPrincipal, kind: string, payload: unknown) {
    return tx(()=>{settings(principal.userId);
      if(one('SELECT COUNT(*) AS n FROM pool_proposals WHERE user_id=?',principal.userId)!.n>=100)fail(409,'PROPOSAL_LIMIT_REACHED','This owner already has 100 pending proposals. A human must clear reviewed proposals before more can be stored.');
      const id=randomUUID();run('INSERT INTO pool_proposals(id,user_id,key_id,kind,payload_json,created_at) VALUES (?,?,?,?,?,?)',id,principal.userId,principal.keyId,kind,JSON.stringify(payload),now());return id;
    });
  }
  function proposeSubscriptions(principal: VerifiedPrincipal, input: Subscription[]) {
    requireScope(principal,'pool:write');const subscriptions=validateSubscriptions(input);const id=storeProposal(principal,'subscriptions',subscriptions);
    return {id,status:'proposed',subscriptions,authoritativeProfileUnchanged:true};
  }
  function proposeCollectionPlan(principal: VerifiedPrincipal, input: { rationale: string; queries: string[] }) {
    requireScope(principal,'pool:write');const v=object(input);keys(v,['rationale','queries']);const plan={rationale:str(v.rationale,'rationale',1,2000),queries:strings(v.queries,'queries',30,500,1)};const id=storeProposal(principal,'collection_plan',plan);
    return {id,status:'proposed',plan,authoritativeProfileUnchanged:true};
  }
  function clearProposals(userId: string): { deleted: number } {
    str(userId,'user ID',1,200);return {deleted:Number(run('DELETE FROM pool_proposals WHERE user_id=?',userId).changes)};
  }
  const getProposals=(userId:string)=>all('SELECT id,kind,payload_json,created_at FROM pool_proposals WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',userId).map(r=>({id:r.id,kind:r.kind,payload:JSON.parse(r.payload_json),createdAt:r.created_at}));
  function getFeedback(principal: VerifiedPrincipal) {
    requireScope(principal,'candidates:read');
    const outcomes=all('SELECT canonical_repository,state,review_note FROM catalog_candidates WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200',principal.userId).map(r=>({canonicalRepository:r.canonical_repository,outcome:r.state,reviewNote:r.review_note}));
    const counts=getDecisions(principal.userId);
    return {outcomes,aggregate:{saved:counts.saved.length,dismissed:counts.dismissed.length},...aggregateFeedback(principal.userId),policy:'Human profile and exclusions are authoritative. Decisions are aggregate signals only. One dismissal never bans a topic; undo removes that signal. No inferred preferences are written automatically.'};
  }
  function retryFailedJob(userId:string) {
    return tx(()=>{const row=one("SELECT * FROM pool_jobs WHERE user_id=? AND state='failed' ORDER BY created_at DESC,rowid DESC LIMIT 1",userId);
      if(!row)fail(404,'NOT_FOUND','No failed job found.');
      if(one("SELECT 1 FROM pool_jobs WHERE user_id=? AND state IN ('queued','leased','backoff')",userId))fail(409,'ACTIVE_JOB_EXISTS','A collection job is already active.');
      // Explicit human retry creates a fresh job with current profile/rules, without claiming it or faking execution.
      const s=settings(userId), rules:PoolRules=JSON.parse(s.rules_json),id=randomUUID(),t=now();
      run("INSERT INTO pool_jobs(id,user_id,state,target,max_attempts,created_at,updated_at,next_attempt_at,rules_json,profile_json,subscriptions_json,feedback_json) VALUES (?,?,'queued',?,?,?,?,?,?,?,?,?)",id,userId,rules.batchTarget,maxAttempts,t,t,t,s.rules_json,s.profile_json,s.subscriptions_json,JSON.stringify(aggregateFeedback(userId)));
      return job(one('SELECT * FROM pool_jobs WHERE id=?',id)!);
    });
  }
  return {getRules,setRules,getProfile,setProfile,getSubscriptions,setSubscriptions,getStatus,getAgentStatus,ensureCollectionJob,getJobs,listCatalog,getAvailable:(userId:string)=>listCatalog(userId),getDecisions,saveDecision,undoDecision,getCandidates,seedCandidates,reviewCandidate,setProjectAvailability,claimJob,heartbeatJob,finishJob,submitCandidates,proposeSubscriptions,proposeCollectionPlan,getProposals,clearProposals,getFeedback,retryFailedJob};
}
export type PoolService = ReturnType<typeof createPoolService>;
