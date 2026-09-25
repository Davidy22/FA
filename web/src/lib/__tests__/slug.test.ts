import { describe, expect, it } from 'vitest';
import { slugify } from '@/lib/format';

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('preserves CJK chars', () => {
    expect(slugify('手機架')).toMatch(/手機架/);
  });
});
