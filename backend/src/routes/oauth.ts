import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { HttpError, wrap } from '../middleware/error';
import { createCredential } from '../services/credentials';
import { config } from '../config';

/**
 * "Connect with Google / X" — n8n-style, bring-your-own-app.
 * The person pastes THEIR OWN client id + secret; FlowForge sends them to the provider's allow page,
 * receives the code on /api/oauth/callback, swaps it for a refresh token and saves the credential.
 */
export const oauthRouter = Router();

interface Provider { authUrl: string; tokenUrl: string; scope: string; extra: Record<string, string>; pkce: boolean; clientAuth: 'body' | 'basic'; label: string }
function providers(): Record<string, Provider> {
  const p: Record<string, Provider> = {
    google: {
      label: 'Google', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/calendar.events', extra: { access_type: 'offline', prompt: 'consent' }, pkce: false, clientAuth: 'body',
    },
    x: {
      label: 'X', authUrl: 'https://twitter.com/i/oauth2/authorize', tokenUrl: 'https://api.twitter.com/2/oauth2/token',
      scope: 'tweet.read tweet.write users.read offline.access', extra: {}, pkce: true, clientAuth: 'basic',
    },
  };
  if (!config.isProd) {
    p.mock = { label: 'Demo', authUrl: '/mock/oauth/authorize', tokenUrl: `http://127.0.0.1:${config.port}/mock/oauth/token`, scope: 'demo', extra: {}, pkce: false, clientAuth: 'body' };
  }
  return p;
}

interface Pending { userId: string; name: string; provider: string; clientId: string; clientSecret: string; scope: string; redirectUri: string; verifier: string; createdAt: number }
const pending = new Map<string, Pending>();
const TTL = 10 * 60_000;
const b64url = (b: Buffer) => b.toString('base64url');

const startSchema = z.object({
  provider: z.string(),
  name: z.string().trim().min(1).max(80),
  client_id: z.string().trim().min(1),
  client_secret: z.string().trim().default(''),
  scope: z.string().trim().optional(),
  redirectBase: z.string().url(),
});

oauthRouter.post('/start', requireAuth, wrap(async (req: AuthedRequest, res) => {
  const body = startSchema.parse(req.body);
  const prov = providers()[body.provider];
  if (!prov) throw new HttpError(400, 'Unknown provider');
  const base = new URL(body.redirectBase);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new HttpError(400, 'Bad address');
  const redirectUri = `${base.origin}/api/oauth/callback`;
  for (const [k, v] of pending) if (Date.now() - v.createdAt > TTL) pending.delete(k);
  if (pending.size > 500) throw new HttpError(429, 'Too many logins in progress, try again in a few minutes');

  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const scope = body.scope || prov.scope;
  pending.set(state, { userId: req.userId!, name: body.name, provider: body.provider, clientId: body.client_id, clientSecret: body.client_secret, scope, redirectUri, verifier, createdAt: Date.now() });

  const params = new URLSearchParams({ response_type: 'code', client_id: body.client_id, redirect_uri: redirectUri, scope, state, ...prov.extra });
  if (prov.pkce) { params.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest())); params.set('code_challenge_method', 'S256'); }
  const authBase = prov.authUrl.startsWith('/') ? `${base.origin}${prov.authUrl}` : prov.authUrl;
  res.json({ authUrl: `${authBase}?${params.toString()}`, redirectUri });
}));

const back = (res: any, qs: Record<string, string>) => res.redirect(`/credentials?${new URLSearchParams(qs).toString()}`);

// Public: the provider's allow page sends the browser here. The one-time `state` ties it to the person who started it.
oauthRouter.get('/callback', wrap(async (req, res) => {
  const state = String(req.query.state || '');
  const p = pending.get(state);
  if (!p || Date.now() - p.createdAt > TTL) return back(res, { oauth_error: 'That login link expired or was already used. Press “Connect” again.' });
  pending.delete(state); // single use
  if (req.query.error) {
    const e = String(req.query.error_description || req.query.error);
    return back(res, { oauth_error: e === 'access_denied' ? 'You pressed “Cancel” / access was denied. If Google said “Access blocked”, add your email under OAuth consent screen → Audience → Test users.' : e.slice(0, 300) });
  }
  const code = String(req.query.code || '');
  if (!code) return back(res, { oauth_error: 'The service did not send back a code. Try again.' });
  const prov = providers()[p.provider];
  try {
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (prov.pkce) form.set('code_verifier', p.verifier);
    if (prov.clientAuth === 'basic' && p.clientSecret) headers.authorization = 'Basic ' + Buffer.from(`${p.clientId}:${p.clientSecret}`).toString('base64');
    else { form.set('client_id', p.clientId); if (p.clientSecret) form.set('client_secret', p.clientSecret); }
    const r = await fetch(prov.tokenUrl, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(15_000) });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) return back(res, { oauth_error: `${prov.label} said no (HTTP ${r.status}): ${data.error_description || data.error || data.detail || 'unknown'}`.slice(0, 300) });
    if (!data.refresh_token) {
      return back(res, { oauth_error: prov.label === 'Google'
        ? 'Google did not give a long-lasting key. Open https://myaccount.google.com/permissions, remove “FlowForge”, then press Connect again.'
        : `${prov.label} did not give a long-lasting key. For X make sure the scopes include offline.access.` });
    }
    await createCredential(p.userId, p.name, 'oauth2', {
      token_url: prov.tokenUrl.replace(`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`), client_id: p.clientId, client_secret: p.clientSecret,
      refresh_token: data.refresh_token, scope: p.scope, client_auth: prov.clientAuth,
    });
    return back(res, { connected: p.name });
  } catch (e: any) {
    return back(res, { oauth_error: `Could not finish the login: ${e?.message || e}`.slice(0, 300) });
  }
}));
