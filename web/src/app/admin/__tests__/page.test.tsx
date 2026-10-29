import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminPage from '@/app/admin/page';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: vi.fn() }));
vi.mock('@/components/admin/Locations', () => ({ AdminLocations: () => <div>Edit locations</div> }));

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
let profile: Profile | null;
let signedIn: boolean;
let invoke: ReturnType<typeof vi.fn>;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
}

beforeEach(() => {
  signedIn = true;
  profile = { id: userId, email: 'admin@example.test', display_name: 'Admin',
    role: 'customer', is_active: true, location_id: null, locale: 'en', is_creator: false,
    permissions: [], points_balance: 0, lifetime_points: 0,
    referral_code: 'ADMINTEST', referred_by: null };
  invoke = vi.fn(async () => {
    profile = { ...profile!, role: 'admin' };
    return { data: { ok: true }, error: null };
  });
  vi.mocked(supabase).mockReturnValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? { id: userId } : null }, error: null })) },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }) })),
    functions: { invoke },
  } as unknown as ReturnType<typeof supabase>);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('admin portal access', () => {
  it('lets an eligible first test account activate admin without editing a table', async () => {
    mount();
    const activate = await screen.findByRole('button', { name: 'admin:bootstrap_action' });
    expect(screen.queryByText('Review queue')).not.toBeInTheDocument();
    fireEvent.click(activate);
    const locations = await screen.findByRole('button', { name: 'admin:locations' });
    expect(invoke).toHaveBeenCalledWith('bootstrap-admin');
    fireEvent.click(locations);
    expect(screen.getByText('Edit locations')).toBeInTheDocument();
  });

  it('blocks deactivated admins from all management tabs', async () => {
    profile = { ...profile!, role: 'admin', is_active: false };
    mount();
    await waitFor(() => expect(screen.getByText('admin:admin_only')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'admin:bootstrap_action' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'admin:locations' })).not.toBeInTheDocument();
  });

  it('does not offer activation when signed out', async () => {
    signedIn = false;
    mount();
    await waitFor(() => expect(screen.getByText('admin:admin_only')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'admin:bootstrap_action' })).not.toBeInTheDocument();
  });
});
