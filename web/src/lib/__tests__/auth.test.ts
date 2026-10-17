import { describe, expect, it } from 'vitest';
import {
  authCallbackUrl,
  authErrorKind,
  providerLabel,
  rememberAuthNext,
  rememberReferral,
  safeNextPath,
  takeAuthNext,
  takePendingReferral,
} from '@/lib/auth';

describe('safeNextPath', () => {
  it('allows relative app paths', () => {
    expect(safeNextPath('/account')).toBe('/account');
    expect(safeNextPath('/rewards#referrals')).toBe('/rewards#referrals');
    expect(safeNextPath('/checkout?step=2')).toBe('/checkout?step=2');
  });

  it('rejects external and protocol-relative URLs', () => {
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath('/account\nnext')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath('account')).toBe('/');
  });
});

describe('authCallbackUrl', () => {
  it('points at the static callback page with no query string', () => {
    expect(authCallbackUrl()).toBe('http://localhost:3000/auth/callback/');
  });
});

describe('post-login destination', () => {
  it('remembers a safe path and consumes it once', () => {
    rememberAuthNext('/account');
    expect(takeAuthNext()).toBe('/account');
    expect(takeAuthNext()).toBeNull();
  });

  it('sanitizes unsafe destinations before storing', () => {
    rememberAuthNext('https://evil.example');
    expect(takeAuthNext()).toBe('/');
  });
});

describe('referral storage', () => {
  it('normalizes, remembers, and consumes a code once', () => {
    rememberReferral(' ab12cd ');
    expect(takePendingReferral()).toBe('AB12CD');
    expect(takePendingReferral()).toBeNull();
  });
});

describe('provider helpers', () => {
  it('labels known providers', () => {
    expect(providerLabel('google')).toBe('Google');
    expect(providerLabel('facebook')).toBe('Facebook');
    expect(providerLabel('email')).toBe('Email');
    expect(providerLabel('custom')).toBe('custom');
  });

  it('recognizes configuration errors', () => {
    expect(authErrorKind('manual_linking_disabled')).toBe('manual_linking_disabled');
    expect(authErrorKind('Unsupported provider: provider is not enabled')).toBe('provider_not_enabled');
    expect(authErrorKind('Invalid login credentials')).toBe('unknown');
  });
});
