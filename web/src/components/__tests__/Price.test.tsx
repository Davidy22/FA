import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Price } from '@/components/Price';

// Keep the real module: the locale store initialises i18next through it.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('price display', () => {
  it('shows a single price when nothing is on sale', () => {
    render(<Price regular={8} now={8} currency="HKD" />);
    expect(screen.getByText('HK$8.00')).toBeInTheDocument();
    // No struck-through duplicate when there is no discount to show.
    expect(document.querySelector('s')).toBeNull();
  });

  it('strikes the regular price out and puts the sale price beside it', () => {
    const { container } = render(<Price regular={8} now={6} currency="HKD" />);
    const struck = container.querySelector('s');
    expect(struck?.textContent).toBe('HK$8.00');
    expect(screen.getByText('HK$6.00')).toBeInTheDocument();
    // The sale price comes after the struck-through one.
    expect(struck!.nextElementSibling?.textContent).toBe('HK$6.00');
  });

  it('can label the discount and follows the location currency', () => {
    const { container } = render(<Price regular={12} now={9} currency="TWD" badge />);
    expect(screen.getByText('sale_badge')).toBeInTheDocument();
    // Both prices are shown in the location's own currency.
    expect(container.textContent).toContain('NT$12.00');
    expect(container.textContent).toContain('NT$9.00');
  });

  it('ignores a "sale" that is not cheaper', () => {
    const { container } = render(<Price regular={8} now={9} currency="HKD" />);
    expect(container.querySelector('s')).toBeNull();
    expect(screen.getByText('HK$8.00')).toBeInTheDocument();
  });
});
