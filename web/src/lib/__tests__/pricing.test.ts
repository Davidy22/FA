import { describe, expect, it } from 'vitest';
import { quoteHeuristic, GOLDEN_20MM_CUBE_PLA } from '@/lib/pricing';

describe('pricing engine — golden 20mm cube PLA 20% infill', () => {
  const q = quoteHeuristic(GOLDEN_20MM_CUBE_PLA);

  it('extrudes ~3.2 cm3', () => {
    expect(q.extrude_vol_cm3).toBeCloseTo(3.2, 0.3);
  });

  it('uses ~4.0 g of filament', () => {
    expect(q.grams).toBeCloseTo(4.0, 0.5);
  });

  it('floor hits min $3 order fee', () => {
    expect(q.total).toBeGreaterThanOrEqual(3.0);
  });
});

describe('pricing basics', () => {
  it('zero volume → grams ~0', () => {
    const q = quoteHeuristic({
      ...GOLDEN_20MM_CUBE_PLA,
      volume_cm3: 0, surface_cm2: 0,
    });
    expect(q.grams).toBeCloseTo(0, 2);
  });

  it('higher infill costs more', () => {
    const low = quoteHeuristic({ ...GOLDEN_20MM_CUBE_PLA, infill_percent: 10 });
    const high = quoteHeuristic({ ...GOLDEN_20MM_CUBE_PLA, infill_percent: 100 });
    expect(high.total).toBeGreaterThan(low.total);
  });

  it('quantity scales costs', () => {
    const one = quoteHeuristic({ ...GOLDEN_20MM_CUBE_PLA, quantity: 1 });
    const two = quoteHeuristic({ ...GOLDEN_20MM_CUBE_PLA, quantity: 2 });
    expect(two.grams).toBeCloseTo(one.grams * 2, 1);
  });
});
