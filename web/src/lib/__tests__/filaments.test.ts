import { describe, it, expect } from 'vitest';
import {
  alpha,
  describeFilament,
  filamentColors,
  filamentSwatchStyle,
  finishLabel,
  shade,
} from '../filaments';

describe('filament colours', () => {
  it('falls back to grey and drops invalid colours', () => {
    expect(filamentColors({})).toEqual(['#cbd5e1', null]);
    expect(filamentColors({ color_hex: 'not-a-colour', color_hex_2: '#FFFFFF' }))
      .toEqual(['#cbd5e1', '#FFFFFF']);
  });

  it('darkens and lightens for effects', () => {
    expect(shade('#000000', 0.5)).toBe('#808080');
    expect(shade('#ffffff', -1)).toBe('#000000');
    expect(alpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });
});

describe('filamentSwatchStyle', () => {
  it('renders a plain colour for a standard filament', () => {
    expect(filamentSwatchStyle({ color_hex: '#123456' })).toEqual({ backgroundColor: '#123456' });
  });

  it('blends both colours for a gradient spool', () => {
    const style = filamentSwatchStyle({ color_hex: '#ff0000', color_hex_2: '#0000ff', finish: 'gradient' });
    expect(style.background).toContain('linear-gradient');
    expect(style.background).toContain('#ff0000');
    expect(style.background).toContain('#0000ff');
  });

  it('uses a grain or sparkle pattern for textured finishes', () => {
    expect(String(filamentSwatchStyle({ color_hex: '#8b5a2b', finish: 'wood' }).background))
      .toContain('repeating-linear-gradient');
    expect(String(filamentSwatchStyle({ color_hex: '#cccccc', finish: 'carbon' }).background))
      .toContain('repeating-conic-gradient');
    expect(String(filamentSwatchStyle({ color_hex: '#7cf5d1', finish: 'glow' }).backgroundImage))
      .toContain('radial-gradient');
    expect(filamentSwatchStyle({ color_hex: '#aabbcc', finish: 'translucent' }).backgroundColor)
      .toContain('rgba(');
  });

  it('still shows something for a finish with no second colour', () => {
    expect(String(filamentSwatchStyle({ color_hex: '#123456', finish: 'gradient' }).background))
      .toContain('linear-gradient');
  });
});

describe('finish labels', () => {
  it('prefers the database name and falls back to the slug', () => {
    expect(finishLabel({ en: 'Wood fill' }, 'wood', 'en')).toBe('Wood fill');
    expect(finishLabel(null, 'glow-in-the-dark', 'en')).toBe('Glow In The Dark');
    expect(finishLabel(null, null, 'en')).toBe('');
  });

  it('only describes a finish that says more than the colour', () => {
    expect(describeFilament({ finish: 'standard' }, 'en')).toBe('');
    expect(describeFilament({ finish: 'silk', finish_name: { en: 'Silk / shiny' } }, 'en')).toBe('Silk / shiny');
  });
});
