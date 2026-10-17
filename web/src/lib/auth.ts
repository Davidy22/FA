/** Shared helpers for OAuth sign-in, account linking, and the static-export callback route. */

export type SocialProviderId = 'google' | 'facebook';

export const SOCIAL_PROVIDERS: ReadonlyArray<{ id: SocialProviderId; label: string }> = [
  { id: 'google', label: 'Google' },
  { id: 'facebook', label: 'Facebook' }
];

export const PENDING_REFERRAL_KEY = 'ma.pending_referral';
export const PENDING_AUTH_NEXT_KEY = 'ma.auth_next';

/** Mirrors next.config.mjs: basePath is only applied to production builds. */
export function appBasePath(): string {
  const configured = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return process.env.NODE_ENV === 'production' ? configured.replace(/\/+$/, '') : '';
}

/** Only allow same-site relative paths, so `?next=` cannot be used as an open redirect. */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  // Browsers can normalize backslashes to slashes, turning `/\evil.com` into an
  // external redirect; control characters are never valid in an app path.
  if (value.includes('\\') || /[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

/**
 * Keep the callback URL free of query parameters so it matches the URL
 * allowlist exactly. The post-login destination is stashed locally instead.
 */
export function authCallbackUrl(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${appBasePath()}/auth/callback/`;
}

export function rememberAuthNext(next: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PENDING_AUTH_NEXT_KEY, safeNextPath(next));
}

/** Reads and clears the post-login destination. */
export function takeAuthNext(): string | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(PENDING_AUTH_NEXT_KEY);
  if (value) window.localStorage.removeItem(PENDING_AUTH_NEXT_KEY);
  return value ? safeNextPath(value) : null;
}

export function rememberReferral(code: string): void {
  if (typeof window === 'undefined') return;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;
  window.localStorage.setItem(PENDING_REFERRAL_KEY, normalized);
}

/** Reads and clears the pending code so it is only ever claimed once. */
export function takePendingReferral(): string | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(PENDING_REFERRAL_KEY);
  if (value) window.localStorage.removeItem(PENDING_REFERRAL_KEY);
  return value;
}

export function providerLabel(provider: string): string {
  if (provider === 'email') return 'Email';
  return SOCIAL_PROVIDERS.find((p) => p.id === provider)?.label || provider;
}

export type AuthErrorKind = 'manual_linking_disabled' | 'provider_not_enabled' | 'unknown';

export function authErrorKind(message: string): AuthErrorKind {
  if (/manual.?linking.*disabled/i.test(message)) return 'manual_linking_disabled';
  if (/provider is not enabled|unsupported provider/i.test(message)) return 'provider_not_enabled';
  return 'unknown';
}
