import { HttpError } from './http';

// Web Crypto only: this module also runs in the Edge middleware.

export interface AuthConfig {
  secret: string;
  passphrase: string;
  /** Part of every session; changing it signs out all devices. */
  version: string;
}

const COOKIE = 'hub_session';
/** Browsers cap cookie lifetime at 400 days. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const encoder = new TextEncoder();

export function authFromEnv(env: Record<string, string | undefined> = process.env): AuthConfig {
  const { HUB_SESSION_SECRET: secret, HUB_PASSPHRASE: passphrase } = env;
  if (!secret || !passphrase) {
    throw new HttpError(500, 'server_not_configured', 'Set HUB_SESSION_SECRET and HUB_PASSPHRASE');
  }
  const version = env.HUB_SESSION_VERSION || '1';
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(version)) {
    throw new HttpError(500, 'server_not_configured', 'HUB_SESSION_VERSION must be alphanumeric');
  }
  return { secret, passphrase, version };
}

export function sessionCookieName(requestUrl: string): string {
  return new URL(requestUrl).protocol === 'https:' ? `__Host-${COOKIE}` : COOKIE;
}

export async function createSessionCookie(config: AuthConfig, requestUrl: string, now = Date.now()): Promise<string> {
  const payload = `${config.version}.${now.toString(36)}`;
  const signature = await sign(config.secret, payload);
  return serializeCookie(sessionCookieName(requestUrl), `${payload}.${signature}`, requestUrl, MAX_AGE_SECONDS);
}

export function clearSessionCookie(requestUrl: string): string {
  return serializeCookie(sessionCookieName(requestUrl), '', requestUrl, 0);
}

export async function hasValidSession(request: Request, config: AuthConfig, now = Date.now()): Promise<boolean> {
  const parts = readCookie(request.headers.get('cookie'), sessionCookieName(request.url))?.split('.');
  if (!parts || parts.length !== 3) return false;
  const [version, issued, signature] = parts;
  if (version !== config.version) return false;
  const issuedAt = parseInt(issued, 36);
  if (!Number.isFinite(issuedAt) || now - issuedAt > MAX_AGE_SECONDS * 1000) return false;
  return constantTimeEqual(signature, await sign(config.secret, `${version}.${issued}`));
}

export async function checkPassphrase(candidate: string, config: AuthConfig): Promise<boolean> {
  // Compare MACs so the timing does not reveal how much of the passphrase matched.
  const [a, b] = await Promise.all([sign(config.secret, candidate), sign(config.secret, config.passphrase)]);
  return constantTimeEqual(a, b);
}

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  let binary = '';
  for (const byte of mac) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function serializeCookie(name: string, value: string, requestUrl: string, maxAge: number): string {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
