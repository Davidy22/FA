import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Location } from '@/lib/types';
import { LocationSelector } from '@/components/LocationSelector';
import { useLocations } from '@/hooks/useLocations';
import { useLocation } from '@/store/location';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: React.PropsWithChildren<{ href: string }>) =>
  <a href={href} {...rest}>{children}</a> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useLocations', () => ({ useLocations: vi.fn() }));
vi.mock('@/store/location', () => ({ useLocation: vi.fn() }));

const locations = [
  { id: '1', name: 'Central', is_active: true },
  { id: '2', name: 'Sha Tin', is_active: true },
] as Location[];

beforeEach(() => {
  vi.mocked(useLocations).mockReturnValue({ data: locations } as ReturnType<typeof useLocations>);
  vi.mocked(useLocation).mockImplementation((selector) => selector({ selectedLocationId: '1', setLocation: vi.fn() }));
});

describe('header location control', () => {
  it('links to the existing picker rather than rendering a dropdown', () => {
    render(<LocationSelector />);
    const link = screen.getByRole('link', { name: /Central/ });
    expect(link).toHaveAttribute('href', '/locations');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Central')).toBeInTheDocument();
  });

  it('does not ask the customer to pick when only one location is active', () => {
    vi.mocked(useLocations).mockReturnValue({ data: [locations[0]] } as ReturnType<typeof useLocations>);
    const { container } = render(<LocationSelector />);
    expect(container).toBeEmptyDOMElement();
  });
});
