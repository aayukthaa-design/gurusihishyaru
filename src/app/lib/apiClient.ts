// ─── Shared API client ────────────────────────────────────────────────────────
// Central fetch wrapper: resolves the API base URL, attaches the bearer token
// from whichever storage holds the active session, and forces a logout when
// the server reports the token is no longer valid.

export const API_BASE =
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE || 'http://localhost:4000';

const TOKEN_KEY = 'auth_token';

let onUnauthorized: (() => void) | null = null;

/** Registered once by AuthProvider so apiClient can force a logout on 401. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip attaching the Authorization header (only needed for /api/auth/* calls). */
  skipAuth?: boolean;
}

/**
 * Fetch wrapper that prefixes API_BASE, attaches the bearer token, and
 * JSON-encodes a plain object body automatically (pass a FormData/string body
 * to bypass JSON encoding). Throws on network errors; callers should still
 * check response.ok since this does not throw on non-2xx responses.
 */
export async function apiFetch(path: string, options: ApiRequestOptions = {}): Promise<Response> {
  const { body, skipAuth, headers, ...rest } = options;
  const finalHeaders: Record<string, string> = { ...(headers as Record<string, string>) };

  let finalBody: BodyInit | undefined;
  if (body instanceof FormData || typeof body === 'string' || body === undefined) {
    finalBody = body as BodyInit | undefined;
  } else {
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  if (!skipAuth) {
    const token = getToken();
    if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, { ...rest, headers: finalHeaders, body: finalBody });

  if (response.status === 401 && !skipAuth) {
    onUnauthorized?.();
  }

  return response;
}

/** Convenience helper: apiFetch + throws on non-OK + parses JSON. */
export async function apiJson<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
