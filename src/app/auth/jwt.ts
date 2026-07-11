import type { JWTPayload, User } from './types';

// ─── Simulated JWT (Frontend-only) ───────────────────────────────────────────
// In a real app, JWT signing/verification happens on the server.
// This simulates the structure and expiry logic purely client-side.

const SECRET_KEY = 'gurushishyaru_tutorials_jwt_secret_2026';
const TOKEN_EXPIRY_HOURS = 24;
const REMEMBER_ME_EXPIRY_HOURS = 24 * 7; // 7 days

/**
 * Encodes an object to base64url (URL-safe base64 without padding)
 */
function base64UrlEncode(obj: object): string {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Decodes a base64url string back to an object
 */
function base64UrlDecode<T>(str: string): T {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const padded2 = pad ? padded + '='.repeat(4 - pad) : padded;
  return JSON.parse(atob(padded2)) as T;
}

/**
 * Creates a simple simulated JWT token
 * Format: header.payload.signature
 */
export function createToken(user: User, rememberMe = false): string {
  const now = Math.floor(Date.now() / 1000);
  const expiryHours = rememberMe ? REMEMBER_ME_EXPIRY_HOURS : TOKEN_EXPIRY_HOURS;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: JWTPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    branchId: user.branchId,
    iat: now,
    exp: now + expiryHours * 3600,
  };

  const headerEncoded = base64UrlEncode(header);
  const payloadEncoded = base64UrlEncode(payload);

  // Simulated signature (not cryptographically secure — for UI simulation only)
  const signature = btoa(`${headerEncoded}.${payloadEncoded}.${SECRET_KEY}`)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

/**
 * Decodes and validates a JWT token.
 * Returns the payload if valid, null if expired or malformed.
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = base64UrlDecode<JWTPayload>(parts[1]);
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) {
      return null; // Token expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Checks whether a token is expired without fully verifying it
 */
export function isTokenExpired(token: string): boolean {
  return verifyToken(token) === null;
}
