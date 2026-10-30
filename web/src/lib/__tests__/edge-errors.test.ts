import { describe, expect, it } from 'vitest';
import { edgeErrorStatus, edgeErrorMessage } from '@/lib/edge-errors';

const httpError = (status: number, body: unknown) => Object.assign(
  new Error('Edge Function returned a non-2xx status code'),
  { context: { status, json: async () => body } },
);

describe('edge function errors', () => {
  it('surfaces the message the function returned', async () => {
    await expect(edgeErrorMessage(
      httpError(429, { error: 'Too many checkout attempts from this connection.' }),
      'fallback',
    )).resolves.toBe('Too many checkout attempts from this connection.');
  });

  it('falls back when the body is not JSON', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: { status: 502, json: async () => { throw new SyntaxError('not json'); } },
    });
    await expect(edgeErrorMessage(error, 'Checkout could not start.')).resolves.toBe(
      'Checkout could not start.',
    );
  });

  it('keeps a real client-side error message', async () => {
    await expect(edgeErrorMessage(new Error('Checkout returned an unexpected URL'), 'fallback'))
      .resolves.toBe('Checkout returned an unexpected URL');
  });

  it('exposes the status so callers can special-case throttling', () => {
    expect(edgeErrorStatus(new Error('plain'))).toBeUndefined();
    expect(edgeErrorStatus(httpError(429, { error: 'slow down' }))).toBe(429);
  });
});
