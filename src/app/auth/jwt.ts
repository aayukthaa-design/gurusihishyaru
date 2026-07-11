import type { JWTPayload } from './types';

// ─── JWT decode (client-side, read-only) ─────────────────────────────────────
// The server (server/server.js) signs and verifies tokens with jsonwebtoken.
// The client never has the signing secret and must not attempt to verify the
// signature — it only decodes the payload to read `exp` for the session-restore
// path (deciding whether to even attempt using a stored token). The server is
// always the actual authority: any API call with an expired/invalid/tampered
// token gets a 401, which apiClient.ts turns into a forced logout.

function base64UrlDecode<T>(str: string): T {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const padded2 = pad ? padded + '='.repeat(4 - pad) : padded;
  return JSON.parse(atob(padded2)) as T;
}

/** Decodes a JWT payload without verifying its signature. Returns null if malformed. */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return base64UrlDecode<JWTPayload>(parts[1]);
  } catch {
    return null;
  }
}

/** True if the token is malformed or its `exp` has already passed. */
export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now;
}
