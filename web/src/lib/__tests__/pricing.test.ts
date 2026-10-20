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

  it('prices the cube on its own cost, with no minimum-order floor', () => {
    // material US$0.78 + machine US$1.35 + handling US$1.00, tax-free location
    expect(q.total).toBeCloseTo(q.material_cost + q.machine_cost + q.handling_fee, 2);
    expect(q.total).toBeLessThan(3.5);
  });

  it('keeps a tiny print below the old US$3 minimum', () => {
    const tiny = quoteHeuristic({ ...GOLDEN_20MM_CUBE_PLA, volume_cm3: 0.5, surface_cm2: 3.5 });
    expect(tiny.subtotal).toBeLessThan(3);
    expect(tiny.total).toBe(tiny.subtotal);
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
