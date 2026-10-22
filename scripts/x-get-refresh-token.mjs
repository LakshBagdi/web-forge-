// One-time helper: log in to X (Twitter) in your browser and print a REFRESH TOKEN for FlowForge.
//
//   X_CLIENT_ID=xxxx X_CLIENT_SECRET=yyyy node scripts/x-get-refresh-token.mjs
//
// Needs Node 18+. In the X developer portal your app must have:
//   - OAuth 2.0 turned on (type "Web App, Automated App or Bot" = confidential client)
//   - Callback URL exactly:  http://127.0.0.1:3000/callback
import http from 'node:http';
import crypto from 'node:crypto';

const clientId = process.env.X_CLIENT_ID;
const clientSecret = process.env.X_CLIENT_SECRET || '';
const port = Number(process.env.PORT || 3000);
const redirect = `http://127.0.0.1:${port}/callback`;
const scope = process.env.X_SCOPE || 'tweet.read tweet.write users.read offline.access';
const authUrlBase = process.env.X_AUTH_URL || 'https://twitter.com/i/oauth2/authorize';
const tokenUrl = process.env.X_TOKEN_URL || 'https://api.twitter.com/2/oauth2/token';

if (!clientId) {
  console.error('Missing X_CLIENT_ID. Example:\n  X_CLIENT_ID=abc X_CLIENT_SECRET=def node scripts/x-get-refresh-token.mjs');
  process.exit(1);
}

const b64url = (buf) => buf.toString('base64url');
const verifier = b64url(crypto.randomBytes(48));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const authUrl = `${authUrlBase}?` + new URLSearchParams({
  response_type: 'code', client_id: clientId, redirect_uri: redirect, scope, state,
  code_challenge: challenge, code_challenge_method: 'S256',
}).toString();

const page = (msg) => `<html><body style="font-family:sans-serif;padding:2em"><h2>${msg}</h2><p>You can close this tab and look at the terminal.</p></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirect);
  if (url.pathname !== '/callback') { res.writeHead(404); return res.end('Not found'); }
  const fail = (m) => { res.writeHead(400, { 'content-type': 'text/html' }); res.end(page('Failed: ' + m)); console.error('\nFAILED:', m); server.close(); process.exitCode = 1; };
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error_description') || url.searchParams.get('error'));
  if (url.searchParams.get('state') !== state) { res.writeHead(400, { 'content-type': 'text/html' }); return res.end(page('Ignored: wrong state (not from this login)')); } // keep waiting for the real one
  const code = url.searchParams.get('code');
  if (!code) return fail('no code returned');
  try {
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });
    if (clientSecret) headers.authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    else form.set('client_id', clientId);
    const r = await fetch(tokenUrl, { method: 'POST', headers, body: form.toString() });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.refresh_token) return fail(`token exchange failed (HTTP ${r.status}): ${body.error_description || body.error || body.detail || JSON.stringify(body)}${body.refresh_token === undefined && r.ok ? ' (no refresh_token: is "offline.access" in the scopes?)' : ''}`);
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(page('Done! Check your terminal.'));
    console.log('\n================ SUCCESS ================');
    console.log('Paste these into FlowForge -> Credentials -> oauth2 (click the "X" link first):\n');
    console.log('token_url     : ' + tokenUrl);
    console.log('client_id     : ' + clientId);
    console.log('client_secret : ' + (clientSecret || '(none)'));
    console.log('scope         : ' + scope);
    console.log('client_auth   : ' + (clientSecret ? 'basic' : 'body'));
    console.log('refresh_token : ' + body.refresh_token);
    console.log('\nKeep the refresh token secret. It is single-use: FlowForge saves each new one automatically.');
    console.log('Do NOT run this script again unless you want to replace it (the old one stops working).\n');
  } catch (e) { fail(String(e && e.message || e)); }
  server.close();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Listening on ${redirect}\n\n1) Open this link in your browser (log in to X and click Authorize):\n\n${authUrl}\n\n2) Waiting for you...`);
});
