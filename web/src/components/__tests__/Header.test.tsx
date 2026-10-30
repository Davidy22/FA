import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

type Listener = (event: AuthChangeEvent, session: Session | null) => void;
const listeners: Listener[] = [];

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.PropsWithChildren<{ href: string }>) =>
    <a href={href} {...rest}>{children}</a>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// Zustand hooks are called both bare and with a selector.
vi.mock('@/store/cart', () => ({
  useCart: (selector?: (state: never) => unknown) => {
    const state = { items: [], setLocation: () => {} };
    return selector ? selector(state as never) : state;
  },
}));
vi.mock('@/store/location', () => ({
  useLocation: (selector?: (state: never) => unknown) => {
    const state = { selectedLocationId: null };
    return selector ? selector(state as never) : state;
  },
}));
vi.mock('@/store/locale', () => ({
  useLocale: (selector?: (state: never) => unknown) => {
    const state = { locale: 'en', setLocale: () => {} };
    return selector ? selector(state as never) : state;
  },
}));
vi.mock('@/components/LocationSelector', () => ({ LocationSelector: () => null }));
vi.mock('@/components/LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('@/lib/supabase', () => ({
  supabase: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: (listener: Listener) => {
        listeners.push(listener);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
    }),
  }),
}));

import { Header } from '@/components/Header';

function renderHeader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Header /></QueryClientProvider>);
  const listener = listeners[listeners.length - 1];
  return { client, listener };
}

const session = (id: string) => ({ user: { id } }) as unknown as Session;

beforeEach(() => { listeners.length = 0; });

describe('header auth cache', () => {
  it('drops private cached rows when a different account signs in', () => {
    const { client, listener } = renderHeader();
    client.setQueryData(['my_orders'], [{ id: 'previous-account-order' }]);
    listener('SIGNED_IN', session('user-a'));
    client.setQueryData(['my_orders'], [{ id: 'previous-account-order' }]);

    // A second sign-in for a different account must not inherit the first one's
    // cache: most query keys carry no user id.
    listener('SIGNED_IN', session('user-b'));
    expect(client.getQueryData(['my_orders'])).toBeUndefined();
  });

  it('keeps public data when the same account refreshes its token', () => {
    const { client, listener } = renderHeader();
    listener('SIGNED_IN', session('user-a'));
    client.setQueryData(['products'], [{ id: 'p1' }]);

    listener('TOKEN_REFRESHED', session('user-a'));
    expect(client.getQueryData(['products'])).toEqual([{ id: 'p1' }]);
  });

  it('clears the cache on sign out', () => {
    const { client, listener } = renderHeader();
    listener('SIGNED_IN', session('user-a'));
    client.setQueryData(['my_coupons'], [{ code: 'SECRET' }]);

    listener('SIGNED_OUT', null);
    expect(client.getQueryData(['my_coupons'])).toBeUndefined();
  });
});
