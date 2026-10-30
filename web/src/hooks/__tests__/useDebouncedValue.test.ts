import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useDebouncedValue', () => {
  it('holds the previous value until the pause ends', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    expect(result.current).toBe('a');

    act(() => { vi.advanceTimersByTime(249); });
    expect(result.current).toBe('a');

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('ab');
  });

  it('only emits the final value when typing continues', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'p' },
    });
    for (const value of ['pl', 'pla', 'pla print']) {
      rerender({ value });
      act(() => { vi.advanceTimersByTime(100); });
    }
    expect(result.current).toBe('p');
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current).toBe('pla print');
  });
});
