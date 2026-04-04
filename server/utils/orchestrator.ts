import type { H3Event } from 'h3'

/**
 * Fetch JSON from the orchestrator with optional X-User-Id header.
 * Used by auth routes that need to inspect the response (e.g., extract JWT).
 * For pass-through proxying, use proxyRequest() in the catch-all instead.
 */
export async function orchestratorFetch<T>(
  event: H3Event,
  path: string,
  options: { method?: string; body?: unknown; userId?: number } = {},
): Promise<T> {
  const config = useRuntimeConfig(event)
  const headers: Record<string, string> = {}

  if (options.userId != null) {
    headers['X-User-Id'] = String(options.userId)
  }

  return $fetch<T>(path, {
    baseURL: config.orchestratorUrl,
    method: (options.method as any) || 'GET',
    body: options.body,
    headers,
  })
}

/** Cookie name used for JWT auth token. */
export const AUTH_COOKIE_NAME = 'murmur_token'

/** Shared httpOnly cookie options for auth routes. */
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 72 * 60 * 60, // 72 hours — matches orchestrator JWT_EXPIRY_HOURS
  }
}
