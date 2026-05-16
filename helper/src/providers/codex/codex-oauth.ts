import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const CALLBACK_HOST = process.env.AIQM_OAUTH_CALLBACK_HOST ?? '127.0.0.1';
const CALLBACK_PORT = 1455;
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

export type CodexOAuthCredentials = {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  expiresAt: number;
  accountId: string;
};

export type CodexOAuthCallbacks = {
  onAuth(input: { url: string; instructions: string }): void | Promise<void>;
  onPrompt?(input: { message: string }): Promise<string>;
};

export type BrowserOpener = (url: string) => Promise<void>;

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState(): string {
  return randomBytes(16).toString('hex');
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function accountIdFromAccessToken(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH];
  if (!auth || typeof auth !== 'object') return null;
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === 'string' && accountId ? accountId : null;
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined
    };
  } catch {
    // not a URL
  }
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return { code, state };
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined
    };
  }
  return { code: value };
}

function pageHtml(opts: {
  title: string;
  indicatorSvg: string;
  heading: string;
  body: string;
  accentColor: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0b0f1a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:48px 56px;text-align:center;max-width:420px;width:90%;box-shadow:0 0 0 1px rgba(74,222,128,.08),0 24px 48px rgba(0,0,0,.5)}
.brand{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:28px}
.brand-text{text-align:left;line-height:1.15}
.brand-text .t1{font-size:17px;font-weight:600;color:#e2e8f0}
.brand-text .t2{font-size:17px;font-weight:700;color:#4ade80}
.divider{height:1px;background:#1f2937;margin:0 0 28px}
.indicator{width:72px;height:72px;margin:0 auto 20px}
h1{font-size:21px;font-weight:700;color:#f1f5f9;margin-bottom:10px}
p{font-size:14px;color:#94a3b8;line-height:1.6}
</style>
</head>
<body>
<div class="card">
  <div class="brand">
    <svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect width="44" height="44" rx="10" fill="#1a2433"/>
      <rect x="8"  y="26" width="7" height="10" rx="1.5" fill="#4ade80"/>
      <rect x="18" y="18" width="7" height="18" rx="1.5" fill="#4ade80"/>
      <rect x="29" y="10" width="7" height="26" rx="1.5" fill="#4ade80"/>
    </svg>
    <div class="brand-text"><div class="t1">AI Quota</div><div class="t2">Monitor</div></div>
  </div>
  <div class="divider"></div>
  <svg class="indicator" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">${opts.indicatorSvg}</svg>
  <h1>${opts.heading}</h1>
  <p>${opts.body}</p>
</div>
</body>
</html>`;
}

function successHtml(): string {
  return pageHtml({
    title: 'AIQM — Login complete',
    accentColor: '#4ade80',
    indicatorSvg: `<circle cx="36" cy="36" r="34" fill="none" stroke="#4ade80" stroke-width="2" opacity=".25"/>
      <circle cx="36" cy="36" r="28" fill="rgba(74,222,128,.1)"/>
      <polyline points="22,36 32,46 50,26" fill="none" stroke="#4ade80" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    heading: 'Login complete',
    body: 'You can close this tab and return to the terminal.'
  });
}

function errorHtml(message: string): string {
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return pageHtml({
    title: 'AIQM — Login failed',
    accentColor: '#f87171',
    indicatorSvg: `<circle cx="36" cy="36" r="34" fill="none" stroke="#f87171" stroke-width="2" opacity=".25"/>
      <circle cx="36" cy="36" r="28" fill="rgba(248,113,113,.1)"/>
      <line x1="24" y1="24" x2="48" y2="48" stroke="#f87171" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="48" y1="24" x2="24" y2="48" stroke="#f87171" stroke-width="3.5" stroke-linecap="round"/>`,
    heading: 'Login failed',
    body: safe
  });
}

async function waitForCallback(expectedState: string): Promise<{ code: string; close(): void }> {
  let server: Server | null = null;
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/auth/callback') {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(errorHtml('Callback route not found.'));
          return;
        }
        if (url.searchParams.get('state') !== expectedState) {
          res.statusCode = 400;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(errorHtml('State mismatch.'));
          reject(new Error('OAuth state mismatch'));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.statusCode = 400;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(errorHtml('Missing authorization code.'));
          reject(new Error('Missing authorization code'));
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(successHtml());
        resolve({ code, close: () => server?.close() });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    server.on('error', reject);
    server.listen(CALLBACK_PORT, CALLBACK_HOST);
  });
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string
): Promise<CodexOAuthCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI
    })
  });
  if (!response.ok) {
    throw new Error(`OpenAI Codex token exchange failed (${String(response.status)})`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  const accessToken = json.access_token;
  const refreshToken = json.refresh_token;
  const expiresIn = json.expires_in;
  const idToken = json.id_token;
  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresIn !== 'number'
  ) {
    throw new Error('OpenAI Codex token exchange response missing fields');
  }
  const accountId = accountIdFromAccessToken(accessToken);
  if (!accountId) throw new Error('Failed to extract Codex account id from token');
  return {
    accessToken,
    refreshToken,
    idToken: typeof idToken === 'string' ? idToken : null,
    expiresAt: Date.now() + expiresIn * 1000,
    accountId
  };
}

export async function defaultBrowserOpener(url: string): Promise<void> {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => resolve());
    child.unref();
    resolve();
  });
}

export async function loginCodexWithOAuth(
  callbacks: CodexOAuthCallbacks,
  options: { opener?: BrowserOpener; originator?: string } = {}
): Promise<CodexOAuthCredentials> {
  const { verifier, challenge } = createPkce();
  const state = createState();
  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', SCOPE);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('id_token_add_organizations', 'true');
  authorizeUrl.searchParams.set('codex_cli_simplified_flow', 'true');
  authorizeUrl.searchParams.set('originator', options.originator ?? 'aiqm');

  const callbackPromise = waitForCallback(state);
  await callbacks.onAuth({
    url: authorizeUrl.toString(),
    instructions: 'A browser window should open. Complete Codex login to finish AIQM account setup.'
  });
  await (options.opener ?? defaultBrowserOpener)(authorizeUrl.toString());

  let close: (() => void) | null = null;
  try {
    let code: string | undefined;
    try {
      const result = await callbackPromise;
      code = result.code;
      close = () => result.close();
    } catch (error) {
      if (!callbacks.onPrompt) throw error;
      const input = await callbacks.onPrompt({
        message: 'Paste the authorization code or full redirect URL:'
      });
      const parsed = parseAuthorizationInput(input);
      if (parsed.state && parsed.state !== state) throw new Error('OAuth state mismatch');
      code = parsed.code;
    }
    if (!code) throw new Error('Missing authorization code');
    return await exchangeAuthorizationCode(code, verifier);
  } finally {
    close?.();
  }
}
