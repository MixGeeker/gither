import { createAuth } from './auth.js';
import { authConfiguration, publicAuthStatus, type AuthEnv } from './config.js';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function handleAuthRequest(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/auth/')) return json({ code: 'NOT_FOUND' }, 404);
  if (url.pathname === '/api/auth/status') {
    if (request.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    return json(publicAuthStatus(env));
  }
  const config = authConfiguration(env);
  if (!config.configured) return json({ code: 'AUTH_UNCONFIGURED', message: 'Authentication is not configured.' }, 503);
  if (url.origin !== config.origin) return json({ code: 'INVALID_ORIGIN' }, 403);
  if (request.method !== 'GET' && request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (request.method === 'POST' && request.headers.get('origin') !== config.origin) return json({ code: 'INVALID_ORIGIN' }, 403);
  // These flows are redirect-only and use server-owned scopes, never extra client scopes or ID tokens.
  if (request.method === 'POST' && ['/api/auth/sign-in/social', '/api/auth/link-social'].includes(url.pathname)) {
    let body: Record<string, unknown>;
    try { body = await request.clone().json(); } catch { return json({ code: 'INVALID_REQUEST' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ code: 'INVALID_REQUEST' }, 400);
    if (body.scopes !== undefined || body.additionalParams !== undefined || body.idToken !== undefined) return json({ code: 'UNSUPPORTED_AUTH_PARAMETERS' }, 400);
    if ((body.provider !== 'google' && body.provider !== 'github') || !config.providers[body.provider]) return json({ code: 'PROVIDER_UNAVAILABLE' }, 503);
  }
  try {
    const response = await createAuth(env).handler(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    // Do not leak provider payloads or D1 errors. No fake success/fallback session.
    return json({ code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' }, 503);
  }
}

export default { fetch: handleAuthRequest } satisfies ExportedHandler<AuthEnv>;
