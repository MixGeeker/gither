import type {CandidateInput, Env, RepositoryMetadata} from './contracts';
import {seedInputs} from './seeds';
import {getCandidate, normalizeCandidate, upsertCandidate} from './store';

const RESPONSE_LIMIT = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

function object(value:unknown):Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid GitHub response');
  return value as Record<string, unknown>;
}

/** Ignore descriptions, READMEs, and arbitrary fields in an external payload. */
export function normalizeRepositoryMetadata(payload:unknown, source:CandidateInput, fetchedAt:string):RepositoryMetadata {
  const repository = object(payload);
  const owner = object(repository.owner);
  if (repository.private !== false || typeof repository.full_name !== 'string' || repository.full_name.toLowerCase() !== source.repository.toLowerCase()) {
    throw new TypeError('Unexpected GitHub repository');
  }
  const metadata = {
    avatar:source.metadata.avatar,
    ownerLogin:owner.login, ownerType:owner.type, ownerId:owner.id,
    ownerUrl:owner.html_url, avatarUrl:owner.avatar_url,
    stars:repository.stargazers_count, forks:repository.forks_count,
    fetchedAt, repositoryUrl:repository.html_url,
    metadataApiSource:`https://api.github.com/repos/${source.repository}`,
  } as RepositoryMetadata;
  return normalizeCandidate({...source, metadata}).metadata;
}

async function readBoundedJson(response:Response):Promise<unknown> {
  if (!response.ok || response.status !== 200) throw new Error('GitHub metadata request failed');
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') && !contentType.includes('application/vnd.github+json')) {
    throw new Error('Expected GitHub JSON');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > RESPONSE_LIMIT)) {
    await response.body?.cancel();
    throw new Error('GitHub metadata response too large');
  }
  if (!response.body) throw new Error('Empty GitHub metadata response');
  const reader = response.body.getReader();
  const chunks:Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > RESPONSE_LIMIT) {
        await reader.cancel();
        throw new Error('GitHub metadata response too large');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)) as unknown;
}

async function fetchMetadata(env:Env, input:CandidateInput):Promise<RepositoryMetadata> {
  const controller = new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const request = new Request(`https://api.github.com/repos/${input.repository}`, {
    // Workers support manual/follow, not the browser's error redirect mode.
    // Manual plus the strict status=200 check rejects, and never follows, 3xx.
    method:'GET', redirect:'manual', signal:controller.signal,
    headers:{Accept:'application/vnd.github+json', 'User-Agent':'Gither-Catalog-Preview', 'X-GitHub-Api-Version':'2022-11-28'},
  });
  const operation = async () => {
    const response = env.GITHUB_FETCH ? await env.GITHUB_FETCH.fetch(request) : await fetch(request);
    return normalizeRepositoryMetadata(await readBoundedJson(response), input, new Date().toISOString());
  };
  try {
    // The explicit race bounds injected fetchers too, even if they do not
    // implement AbortSignal. The same deadline includes body consumption.
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('GitHub metadata request timed out')); }, REQUEST_TIMEOUT_MS);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

export async function collectRepositories(env:Env, provenance:'github'|'synthetic'='github'):Promise<{checked:number;changed:number;failed:number}> {
  if (provenance !== 'github' && provenance !== 'synthetic') throw new TypeError('Invalid collection provenance');
  const startedAt = new Date().toISOString();
  const result = {checked:0, changed:0, failed:0};
  // These are the only sources. No caller-supplied URLs, discovery crawl,
  // authentication tokens, model invocations, or publication writes exist.
  for (const seed of seedInputs()) {
    result.checked++;
    try {
      const current = await getCandidate(env.DB, seed.id);
      // Fetch using the immutable source allowlist, not stored user content.
      const metadata = await fetchMetadata(env, seed);
      const input:CandidateInput = {
        ...seed,
        project:current?.project ?? seed.project,
        sourceUrls:current?.sourceUrls ?? seed.sourceUrls,
        metadata,
        provenance,
      };
      if (await upsertCandidate(env.DB, input)) result.changed++;
    } catch {
      // Only aggregate failure counts are persisted. Never store raw payloads,
      // fetch errors, credentials, or synthetic observations as human feedback.
      result.failed++;
    }
  }
  await env.DB.prepare(`INSERT INTO collection_runs
    (id, provenance, started_at, finished_at, checked, changed, failed)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), provenance, startedAt, new Date().toISOString(), result.checked, result.changed, result.failed,
  ).run();
  return result;
}
