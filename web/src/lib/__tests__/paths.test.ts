import { afterEach, describe, expect, it, vi } from 'vitest';
import { withBasePath } from '@/lib/paths';

afterEach(() => vi.unstubAllEnvs());

describe('withBasePath', () => {
  it('prefixes raw asset and redirect URLs for a Pages project site', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/FA');

    expect(withBasePath('/favicon.svg')).toBe('/FA/favicon.svg');
    expect(withBasePath('/cart/')).toBe('/FA/cart/');
    expect(withBasePath('/checkout/success/?session_id={CHECKOUT_SESSION_ID}'))
      .toBe('/FA/checkout/success/?session_id={CHECKOUT_SESSION_ID}');
  });

  it('keeps root paths for a custom domain or user Pages site', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');

    expect(withBasePath('/favicon.svg')).toBe('/favicon.svg');
    expect(withBasePath('/cart/')).toBe('/cart/');
  });

  it('allows an unset base path', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', undefined);

    expect(withBasePath('/cart/')).toBe('/cart/');
  });

  it('matches Next config by ignoring the production base path in dev', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/FA');

    expect(withBasePath('/favicon.svg')).toBe('/favicon.svg');
    expect(withBasePath('/cart/')).toBe('/cart/');
  });
});
